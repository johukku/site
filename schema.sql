-- ============================================================
--  johukku の作ったもの置き場 - D1 スキーマ
--  適用: npx wrangler d1 execute johukku-site --remote --file=./schema.sql
-- ============================================================

-- 日別のアクセス数。総計はこの合計で求める。
CREATE TABLE IF NOT EXISTS counter (
  day  TEXT PRIMARY KEY,              -- 'YYYY-MM-DD'（日本時間）
  hits INTEGER NOT NULL DEFAULT 0
);

-- 掲示板の投稿。承認制なので approved が 1 のものだけ表示する。
CREATE TABLE IF NOT EXISTS comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL,           -- ISO8601（UTC）
  ip_hash    TEXT,                    -- 連投防止用。生の IP は保存しない
  approved   INTEGER NOT NULL DEFAULT 0,
  hidden     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_comments_approved
  ON comments (approved, hidden, id DESC);

CREATE INDEX IF NOT EXISTS idx_comments_ip
  ON comments (ip_hash, created_at);

-- 同じ回線を 1 日 1 回だけ数えるための印。生の IP は保存しない。
-- ip_hash = SHA-256(IP_SALT ":" day ":" IP（IPv6 は /64）) の先頭 16 バイト。
-- 日付入りなので、日をまたいで突き合わせることはできない。
-- 前日までの分は、日付が変わったあとの最初のアクセス（または管理画面を開いたとき）に消す。
CREATE TABLE IF NOT EXISTS visits (
  day     TEXT NOT NULL,              -- 'YYYY-MM-DD'（日本時間）
  ip_hash TEXT NOT NULL,
  PRIMARY KEY (day, ip_hash)          -- day が先頭: 古い日の DELETE が範囲検索になる
) WITHOUT ROWID;

-- 数えなかったアクセスの、理由ごとの件数（管理画面で「誰が来ていたのか」を見るため）。
-- 合計の数字だけで、個々のアクセスの情報は持たない。
CREATE TABLE IF NOT EXISTS counter_skips (
  day    TEXT NOT NULL,
  reason TEXT NOT NULL,               -- owner / bot / robot_network / prerender / seen_cookie / seen_ip / no_ip
  n      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, reason)
) WITHOUT ROWID;
