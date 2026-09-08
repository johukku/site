// ============================================================
//  掲示板（承認制）
//    GET  /api/comments   承認済みの投稿を返す
//    POST /api/comments   投稿を受け付ける（保留状態で保存）
// ============================================================

import { json, clean, hashIp } from "../_shared.js";

const MAX_NAME = 24;
const MAX_BODY = 800;
const LIMIT = 100;             // 一覧の最大件数
const COOLDOWN_MINUTES = 3;    // 同じ人からの連投を防ぐ間隔
const DAILY_PER_IP = 10;       // 同じ人からの 1 日あたりの上限

// スパムに多いパターン。URL は一律で弾く。
const NG = [
  /https?:\/\//i,
  /\[url[=\]]/i,
  /<a\s/i,
  /\b(viagra|cialis|casino|porn|crypto\s*wallet|bitcoin\s*generator)\b/i,
];

export async function onRequestGet({ env }) {
  if (!env.DB) return json({ error: "database is not configured" }, 503);
  try {
    const { results } = await env.DB.prepare(
      "SELECT id, name, body, created_at FROM comments " +
      "WHERE approved = 1 AND hidden = 0 ORDER BY id DESC LIMIT ?"
    ).bind(LIMIT).all();
    return json({ comments: results || [] });
  } catch (e) {
    return json({ error: String(e && e.message ? e.message : e) }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ error: "database is not configured" }, 503);

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "内容を読み取れませんでした。" }, 400);
  }

  const name = clean(payload.name, MAX_NAME) || "名無しさん";
  const body = clean(payload.body, MAX_BODY, { allowNewline: true });

  if (body.length < 2) {
    return json({ error: "本文を 2 文字以上で書いてください。" }, 400);
  }
  if (NG.some((re) => re.test(body) || re.test(name))) {
    return json({ error: "URL を含む投稿は受け付けていません。" }, 400);
  }
  // 蜜壺（bot はここを埋めがち）
  if (clean(payload.website, 40)) {
    return json({ ok: true, pending: true }, 200);
  }

  try {
    const ip = await hashIp(request, env.IP_SALT || "johukku");
    const now = new Date();

    const recent = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM comments WHERE ip_hash = ? AND created_at > ?"
    ).bind(ip, new Date(now.getTime() - COOLDOWN_MINUTES * 60000).toISOString()).first();
    if ((recent?.n ?? 0) > 0) {
      return json(
        { error: `連続投稿はできません。${COOLDOWN_MINUTES} 分ほど空けてください。` },
        429
      );
    }

    const daily = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM comments WHERE ip_hash = ? AND created_at > ?"
    ).bind(ip, new Date(now.getTime() - 86400000).toISOString()).first();
    if ((daily?.n ?? 0) >= DAILY_PER_IP) {
      return json({ error: "本日の投稿数の上限に達しました。" }, 429);
    }

    await env.DB.prepare(
      "INSERT INTO comments (name, body, created_at, ip_hash, approved) " +
      "VALUES (?, ?, ?, ?, 0)"
    ).bind(name, body, now.toISOString(), ip).run();

    return json({ ok: true, pending: true });
  } catch (e) {
    return json({ error: String(e && e.message ? e.message : e) }, 500);
  }
}
