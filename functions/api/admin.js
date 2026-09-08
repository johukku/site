// ============================================================
//  管理用 API（運営者のみ）
//    POST /api/admin  { token, action, id? }
//      action = "list"    保留中と承認済みを一覧
//               "approve" 承認する
//               "hide"    非表示にする
//               "delete"  完全に削除する
//
//  token は Cloudflare の環境変数 ADMIN_TOKEN と比較する。
//  設定: npx wrangler pages secret put ADMIN_TOKEN --project-name johukku
// ============================================================

import { json, safeEqual } from "../_shared.js";

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

      default:
        return json({ error: "不明な操作です。" }, 400);
    }
  } catch (e) {
    return json({ error: String(e && e.message ? e.message : e) }, 500);
  }
}
