// ============================================================
//  管理用 API（運営者のみ）
//    POST /api/admin  { token, action, id?, on? }
//      action = "list"    保留中と承認済みを一覧
//               "approve" 承認する
//               "hide"    非表示にする
//               "delete"  完全に削除する
//               "owner"   このブラウザを訪問者数から外す（on: false で戻す）
//               "stats"   訪問者数の推移と、数えなかった理由の内訳
//
//  token は Cloudflare の環境変数 ADMIN_TOKEN と比較する。
//  設定: npx wrangler pages secret put ADMIN_TOKEN --project-name johukku
// ============================================================

import {
  json, safeEqual, jstDay, getCookie, visitHash, ownerCookie, OWNER_COOKIE, SEEN_COOKIE,
} from "../_shared.js";

const STATS_DAYS = 30;       // 管理画面に出す日数
const SKIPS_KEEP_DAYS = 60;  // 理由ごとの件数を残す日数

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ error: "database is not configured" }, 503);
  if (!env.ADMIN_TOKEN) return json({ error: "ADMIN_TOKEN が未設定です。" }, 503);

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "bad request" }, 400);
  }

  if (!safeEqual(payload.token, env.ADMIN_TOKEN)) {
    // 総当たりを遅くするための待ち時間
    await new Promise((r) => setTimeout(r, 700));
    return json({ error: "合言葉が違います。" }, 401);
  }

  const id = Number(payload.id);
  try {
    switch (payload.action) {
      case "list": {
        const { results } = await env.DB.prepare(
          "SELECT id, name, body, created_at, approved, hidden FROM comments " +
          "ORDER BY approved ASC, id DESC LIMIT 200"
        ).all();
        return json({ comments: results || [] });
      }
      case "approve":
        if (!id) return json({ error: "id が必要です。" }, 400);
        await env.DB.prepare(
          "UPDATE comments SET approved = 1, hidden = 0 WHERE id = ?"
        ).bind(id).run();
        return json({ ok: true });

      case "hide":
        if (!id) return json({ error: "id が必要です。" }, 400);
        await env.DB.prepare("UPDATE comments SET hidden = 1 WHERE id = ?")
          .bind(id).run();
        return json({ ok: true });

      case "delete":
        if (!id) return json({ error: "id が必要です。" }, 400);
        await env.DB.prepare("DELETE FROM comments WHERE id = ?").bind(id).run();
        return json({ ok: true });

      // このブラウザを集計から外す / 戻す。Set-Cookie を出すのはここだけ
      // （list で出すと、「数える」に戻した直後の再読み込みで元に戻ってしまう）
      case "owner": {
        const on = payload.on !== false;
        let line = false;
        try {
          const today = jstDay(0);
          const hash = await visitHash(request, env, today);
          if (hash) {
            // 外すとき: 今日のこの回線を「数えた扱い」にする（counter.js の bump とは別の呼び出し。続けて bump を置かないこと）
            // 戻すとき: 今日のうちに確かめられるよう、この回線の印を消す
            await env.DB.prepare(on
              ? "INSERT INTO visits (day, ip_hash) VALUES (?1, ?2) ON CONFLICT(day, ip_hash) DO NOTHING"
              : "DELETE FROM visits WHERE day = ?1 AND ip_hash = ?2"
            ).bind(today, hash).run();
            line = true;
          }
        } catch {
          // 表が無いなどで失敗しても、Cookie だけは効かせる。掲示板の管理は止めない
        }
        const res = json({ ok: true, owner: on, line });
        res.headers.append("set-cookie", ownerCookie(request, on));
        // 戻すとき: 今日すでに付いている jk_seen も消す（HttpOnly なのでページ側では消せない）。
        // counter.js が付けたときと同じ Path・Domain なし（ホスト限定）で消すこと
        if (!on) {
          res.headers.append("set-cookie",
            `${SEEN_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax; Secure; HttpOnly`);
        }
        return res;
      }

      case "stats": {
        const today = jstDay(0);
        const from = jstDay(-(STATS_DAYS - 1));
        const res = await env.DB.batch([
          // 訪問者が来ない日でも、古い印が残り続けないように
          env.DB.prepare("DELETE FROM visits WHERE day < ?1").bind(today),
          env.DB.prepare("DELETE FROM counter_skips WHERE day < ?1").bind(jstDay(-SKIPS_KEEP_DAYS)),
          env.DB.prepare("SELECT day, hits FROM counter WHERE day >= ?1").bind(from),
          env.DB.prepare("SELECT COALESCE(SUM(hits), 0) AS total, MIN(day) AS since FROM counter"),
          env.DB.prepare("SELECT day, reason, n FROM counter_skips WHERE day >= ?1").bind(from),
          // 投稿が来ない間も、連投判定の済んだ IP ハッシュを残さない（comments.js と同じ 2 日）。
          // 上の res[2]〜res[4] の番号がずれないよう、必ず最後に置く
          env.DB.prepare("UPDATE comments SET ip_hash = NULL WHERE ip_hash IS NOT NULL AND created_at < ?1")
            .bind(new Date(Date.now() - 2 * 86400000).toISOString()),
        ]);
        const hits = Object.create(null);
        const skips = Object.create(null);
        for (const r of res[2].results || []) hits[r.day] = r.hits;
        for (const r of res[4].results || []) (skips[r.day] ||= {})[r.reason] = r.n;
        const { total = 0, since = null } = res[3].results?.[0] || {};

        const days = [];
        for (let i = 0; i < STATS_DAYS; i++) {
          const day = jstDay(-i);
          if (since && day < since) break;                       // 設置前の日は出さない
          days.push({ day, hits: hits[day] || 0, skips: skips[day] || {} });   // 行が無い日は 0 人
        }
        // owner はサーバーが実際に受け取った Cookie から答える（HttpOnly なのでページ側では読めない）
        return json({ today, total, since, days, owner: getCookie(request, OWNER_COOKIE) === "1" });
      }

      default:
        return json({ error: "不明な操作です。" }, 400);
    }
  } catch (e) {
    return json({ error: String(e && e.message ? e.message : e) }, 500);
  }
}
