// ============================================================
//  アクセスカウンター
//    GET /api/counter        現在の数値を返す（条件を満たせば 1 人として数える）
//    GET /api/counter?peek=1 数えずに数値だけ返す
//
//  数えるのは「人がトップページを開いたときの fetch」だけ。
//  同じ人を 1 日に 2 回数えないために、ブラウザ単位（Cookie）と回線単位（IP のハッシュ）の両方で見る。
//  生の IP は保存しない。ハッシュは日付入りで、前日までの分は日付が変わったあとの最初のアクセスで消す。
// ============================================================

import { json, jstDay, getCookie, visitHash, OWNER_COOKIE, SEEN_COOKIE } from "../_shared.js";

const COOKIE = SEEN_COOKIE;

// 本物のブラウザは必ずこの形で始まる（"Mediapartners-Google" や "curl/8" はここで落ちる）
const LOOKS_LIKE_BROWSER = /^Mozilla\/5\.0 \(/;

// 人ではないもの。ブラウザのふりをして JavaScript まで実行する巡回があるので、広めに取る
const BOT = new RegExp([
  // 本物のブラウザが名乗らない単語
  "bot", "crawl", "spider", "slurp", "scrape", "fetch", "scan", "preview", "monitor",
  "check", "probe", "archiv", "validator", "headless", "prerender", "rendertron",
  // Google の巡回（Mediapartners-Google / AdsBot / Google-InspectionTool / GoogleOther など）と計測ツール
  "google", "lighthouse", "pagespeed", "ptst", "gtmetrix",
  // 検索エンジン・国内の巡回
  "yeti\\/", "ichiro", "y!j", "hatena", "yandex", "baidu", "sogou",
  // リンクの下見
  "facebookexternalhit", "facebookcatalog", "meta-external", "whatsapp",
  "embedly", "iframely", "mastodon", "misskey", "bluesky", "cardyb",
  // AI の取得
  "gpt", "openai", "oai-", "claude", "anthropic", "perplexity", "cohere", "mistral",
  // 死活監視・Cloudflare 自身の検査
  "pingdom", "uptime", "statuscake", "site24x7", "datadog", "newrelic", "synthetic", "cloudflare",
  // 自動操縦のブラウザ
  "phantomjs", "puppeteer", "playwright", "selenium", "webdriver", "cypress", "electron",
  // HTTP ライブラリ（同一オリジンの判定で先に落ちるが、念のため）
  "curl", "wget", "python", "httpx", "aiohttp", "urllib", "axios", "^node", "node-fetch", "undici",
  "deno\\/", "bun\\/", "okhttp", "java\\/", "apache-http", "go-http", "libwww", "perl", "ruby", "php",
  "guzzle", "postman", "insomnia", "httpie", "powershell", "winhttp", "dart",
].join("|"), "i");

// Google の設備から来るアクセス（ページを描画しに来る巡回）。UA を偽っていてもここで分かる
const ROBOT_ASN = new Set([15169, 396982]);

// 数える対象のホスト。プレビュー用の URL などは数えない（localhost は手元での確認用）
const HOSTS = new Set(["johukku.com", "www.johukku.com", "localhost", "127.0.0.1"]);

/**
 * 数えない理由を返す。数えてよければ null。上から順に、最初に当てはまったもの。
 * tally が true の理由だけ、管理画面用に件数を記録する
 * （host と同一オリジンの判定を通ったもの＝実際のページ表示から来たものだけ。curl の連打では何も書き込まない）。
 */
function whySkip(request, url, today) {
  const h = request.headers;
  if (url.searchParams.get("peek") === "1") return { reason: "peek", tally: false };
  if (!HOSTS.has(url.hostname)) return { reason: "host", tally: false };

  const sfs = h.get("sec-fetch-site");
  const sameOrigin = sfs
    ? sfs === "same-origin"
    : (h.get("referer") || "").startsWith(url.origin + "/");   // Sec-Fetch-Site を送らない古い Safari 向け
  if (!sameOrigin) return { reason: "not_same_origin", tally: false };

  const purpose = h.get("sec-purpose") || h.get("purpose") || h.get("x-purpose") || h.get("x-moz") || "";
  if (/prefetch|prerender|preview/i.test(purpose)) return { reason: "prerender", tally: true };

  const ua = h.get("user-agent") || "";
  if (!LOOKS_LIKE_BROWSER.test(ua) || BOT.test(ua)) return { reason: "bot", tally: true };
  if (ROBOT_ASN.has(request.cf && request.cf.asn)) return { reason: "robot_network", tally: true };

  if (getCookie(request, OWNER_COOKIE) === "1") return { reason: "owner", tally: true };
  if (getCookie(request, COOKIE) === today) return { reason: "seen_cookie", tally: true };
  return { reason: null, tally: true };
}

export async function onRequestGet({ request, env }) {
  if (!env.DB) return json({ error: "database is not configured" }, 503);

  const db = env.DB;
  const today = jstDay(0);          // 1 回だけ求めて、ハッシュ・行・Cookie のすべてに同じ値を使う
  const url = new URL(request.url);
  let { reason, tally } = whySkip(request, url, today);

  // 回線の印が要るのは「数える」ときと「運営者の回線を覚える」ときだけ
  let hash = null;
  if (reason === null || reason === "owner") {
    hash = await visitHash(request, env, today);
    if (reason === null && !hash) reason = "no_ip";   // 材料が足りないときは数えない（不明な回線を 1 人にまとめない）
  }

  const read = db.prepare(
    "SELECT COALESCE(SUM(hits), 0) AS total, " +
    "COALESCE(SUM(CASE WHEN day = ?1 THEN hits END), 0) AS today, " +
    "COALESCE(SUM(CASE WHEN day = ?2 THEN hits END), 0) AS yesterday " +
    "FROM counter"
  ).bind(today, jstDay(-1));
  // 回線の印は当日分しか要らない。どの経路でも、前日までの分はここで消す
  const purge = db.prepare("DELETE FROM visits WHERE day < ?1").bind(today);
  const mark = () => db.prepare(
    "INSERT INTO visits (day, ip_hash) VALUES (?1, ?2) ON CONFLICT(day, ip_hash) DO NOTHING"
  ).bind(today, hash);
  const skip = (why) => db.prepare(
    "INSERT INTO counter_skips (day, reason, n) VALUES (?1, ?2, 1) " +
    "ON CONFLICT(day, reason) DO UPDATE SET n = n + 1"
  ).bind(today, why);

  try {
    const headers = {};
    let row;

    if (reason === null) {
      // ！bump は必ず mark の直後に置くこと。changes() は「直前の INSERT/UPDATE/DELETE が変えた行数」なので、
      //   間に別の書き込みを挟むと、新しい回線でも数え漏れる（DELETE が 0 件でも changes() は 0 に戻る）
      const bump = db.prepare(
        "INSERT INTO counter (day, hits) SELECT ?1, 1 WHERE changes() > 0 " +
        "ON CONFLICT(day) DO UPDATE SET hits = hits + 1"
      ).bind(today);
      const r = await db.batch([mark(), bump, purge, read]);
      row = r[3].results?.[0];

      // 保険: changes() の結果を、D1 が返す meta.changes で突き合わせる（通常は必ず一致する）
      const inserted = (r[0].meta?.changes ?? 0) > 0;
      const bumped = (r[1].meta?.changes ?? 0) > 0;
      if (inserted !== bumped) {
        console.warn("counter: changes() mismatch", { inserted, bumped });
        const fix = inserted
          ? db.prepare(
              "INSERT INTO counter (day, hits) VALUES (?1, 1) " +
              "ON CONFLICT(day) DO UPDATE SET hits = hits + 1").bind(today)
          : db.prepare("UPDATE counter SET hits = hits - 1 WHERE day = ?1 AND hits > 0").bind(today);
        row = (await db.batch([fix, read]))[1].results?.[0];
      }
      if (!inserted) await skip("seen_ip").run();   // 同じ回線の別のブラウザ・端末

      // 回線が新しくても既知でも印を付ける。このブラウザは今日はもう DB に触らない
      headers["set-cookie"] =
        `${COOKIE}=${encodeURIComponent(today)}; Path=/; Max-Age=86400; ` +
        "SameSite=Lax; Secure; HttpOnly";
    } else if (reason === "owner" && hash) {
      // 運営者のブラウザ：数えずに「今日のこの回線」だけ覚える（同じ回線の別の端末も数えなくなる）。
      // jk_seen は付けない。「数える」に戻すときは admin.js が jk_seen も消すので、その直後に確かめられる
      const r = await db.batch([mark(), skip("owner"), purge, read]);
      row = r[3].results?.[0];
    } else {
      const r = await db.batch(tally ? [skip(reason), purge, read] : [purge, read]);
      row = r[r.length - 1].results?.[0];
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
