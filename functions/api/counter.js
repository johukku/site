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

async function readCounts(db) {
  const today = jstDay(0);
  const yesterday = jstDay(-1);
  const [totalRow, todayRow, yRow] = await db.batch([
    db.prepare("SELECT COALESCE(SUM(hits), 0) AS n FROM counter"),
    db.prepare("SELECT COALESCE(hits, 0) AS n FROM counter WHERE day = ?").bind(today),
    db.prepare("SELECT COALESCE(hits, 0) AS n FROM counter WHERE day = ?").bind(yesterday),
  ]);
  return {
    total: totalRow.results[0]?.n ?? 0,
    today: todayRow.results[0]?.n ?? 0,
    yesterday: yRow.results[0]?.n ?? 0,
  };
}

export async function onRequestGet({ request, env }) {
  if (!env.DB) return json({ error: "database is not configured" }, 503);

  const today = jstDay(0);
  const url = new URL(request.url);
  const peek = url.searchParams.get("peek") === "1";
  const ua = request.headers.get("user-agent") || "";
  const skip = peek || BOT.test(ua) || hasCookieForToday(request, today);

  try {
    if (!skip) {
      await env.DB.prepare(
        "INSERT INTO counter (day, hits) VALUES (?, 1) " +
        "ON CONFLICT(day) DO UPDATE SET hits = hits + 1"
      ).bind(today).run();
    }

    const counts = await readCounts(env.DB);
    const headers = {};
    if (!skip) {
      // 同じ人を 1 日 1 回だけ数えるための印
      headers["set-cookie"] =
        `${COOKIE}=${encodeURIComponent(today)}; Path=/; Max-Age=86400; ` +
        `SameSite=Lax; Secure`;
    }
    return json(counts, 200, headers);
  } catch (e) {
    return json({ error: String(e && e.message ? e.message : e) }, 500);
  }
}
