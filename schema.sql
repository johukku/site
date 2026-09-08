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
