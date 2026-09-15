// ============================================================
//  アクセスカウンター
//    GET /api/counter        現在の数値を返す（加算あり）
//    GET /api/counter?peek=1 加算せずに数値だけ返す
// ============================================================

import { json, jstDay } from "../_shared.js";

const COOKIE = "jk_seen";

// bot は数えない（ざっくりで十分）
const BOT = /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|headless|monitor|curl|wget|python-requests|axios|okhttp/i;

function hasCookieForToday(request, today) {
  const raw = request.headers.get("cookie") || "";
  const m = raw.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return m && decodeURIComponent(m[1]) === today;
}

export async function onRequestGet({ request, env }) {
  if (!env.DB) return json({ error: "database is not configured" }, 503);

  const today = jstDay(0);
  const url = new URL(request.url);
  const peek = url.searchParams.get("peek") === "1";
  const ua = request.headers.get("user-agent") || "";
  const skip = peek || BOT.test(ua) || hasCookieForToday(request, today);

  // 合計・今日・昨日は 1 回の SELECT でまとめて取れる
  const read = env.DB.prepare(
    "SELECT COALESCE(SUM(hits), 0) AS total, " +
    "COALESCE(SUM(CASE WHEN day = ?1 THEN hits END), 0) AS today, " +
    "COALESCE(SUM(CASE WHEN day = ?2 THEN hits END), 0) AS yesterday " +
    "FROM counter"
  ).bind(today, jstDay(-1));

  try {
    let row;
    if (skip) {
      row = (await read.all()).results?.[0];
    } else {
      // 加算と読み取りを 1 往復にまとめる
      const bump = env.DB.prepare(
        "INSERT INTO counter (day, hits) VALUES (?, 1) " +
        "ON CONFLICT(day) DO UPDATE SET hits = hits + 1"
      ).bind(today);
      const results = await env.DB.batch([bump, read]);
      row = results[1].results?.[0];
    }

    const headers = {};
    if (!skip) {
      // 同じ人を 1 日 1 回だけ数えるための印
      headers["set-cookie"] =
        `${COOKIE}=${encodeURIComponent(today)}; Path=/; Max-Age=86400; ` +
        `SameSite=Lax; Secure`;
    }
    return json(
      {
        total: row?.total ?? 0,
        today: row?.today ?? 0,
        yesterday: row?.yesterday ?? 0,
      },
      200,
      headers
    );
  } catch (e) {
    return json({ error: String(e && e.message ? e.message : e) }, 500);
  }
}
