# johukku

https://johukku.com/ のソースです。johukku の個人サイトで、ブラウザで遊べるゲームと小説を置いています。

2026年9月から11月までは、Windows 用ツールの紹介ページを置いていました。ツールは各リポジトリで公開を続けています
（旧ページの URL は `_redirects` で各リポジトリへ転送しています）。

- [whisper-subtitle-tool](https://github.com/johukku/whisper-subtitle-tool) … Whisper 字幕作成ツール
- [media-downloader](https://github.com/johukku/media-downloader) … メディアダウンローダー
- [media-converter](https://github.com/johukku/media-converter) … メディアコンバーター
- [subtitle-editor](https://github.com/johukku/subtitle-editor) … 字幕エディター

## 構成

静的な HTML を Cloudflare Pages で配信し、掲示板とアクセスカウンターだけ Pages Functions と D1 で動かしています。

```
public/              配信されるファイル（この中身だけが公開される）
  index.html         トップ
  games/             ゲームの一覧
    0500/            〇五〇〇 の紹介。play/ が本体（C:\自由\〇五〇〇 の 1 ファイルをそのまま写したもの）
  novels/            小説（作品を置くときは style.css の .novel と .chapter-nav を使う）
  bbs/               掲示板（投稿は承認制）
  admin/             管理ページ（掲示板の承認、訪問者数の内訳、運営者の除外）
  about/  privacy/   このサイトについて・プライバシーポリシー
  assets/            CSS と画像（screenshot.png・downloader.png・editor.png は各ツールの README が表示しているので残す）
  404.html  _headers  _redirects  robots.txt  sitemap.xml  favicon.ico  ads.txt
functions/api/       counter.js（カウンター）・comments.js（掲示板）・admin.js（承認・非表示・削除、訪問者数の内訳、運営者の除外）
schema.sql           D1 のテーブル定義
wrangler.toml        Pages と D1 の設定
```

## デプロイ

`master` に push すると Cloudflare Pages が自動でデプロイします（ビルド処理はありません）。

新しく環境を作るときは、D1 のテーブル作成と secret の登録が必要です。
`schema.sql` にテーブルを足したときも、**push する前に**同じコマンドを流し直します（すべて `IF NOT EXISTS` なので何度流しても安全。流し忘れると `/api/counter` が 500 になり、トップのカウンターが消えます）。

```
npx wrangler d1 execute johukku-site --remote --file=schema.sql
npx wrangler pages secret put ADMIN_TOKEN --project-name johukku
npx wrangler pages secret put IP_SALT --project-name johukku
```

| secret | 用途 |
|---|---|
| `ADMIN_TOKEN` | `/admin/` の合言葉 |
| `IP_SALT` | 掲示板の連投判定と、カウンターの「同じ回線は 1 日 1 回」の判定で、IP をハッシュ化するときに混ぜる値（生の IP は保存しない）。未設定だと掲示板は投稿を受け付けず、カウンターは表示されるだけで増えない |

## 手元での確認

```
npx wrangler d1 execute johukku-site --local --file=schema.sql
npx wrangler pages dev
```

`.dev.vars` に `ADMIN_TOKEN` と `IP_SALT` を書いておくと、掲示板と管理ページも動き、カウンターも数えるようになります（`IP_SALT` が無いと数字は出ますが増えません。`.dev.vars` はコミットしません）。
