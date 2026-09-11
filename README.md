# johukku の作ったもの置き場

https://johukku.pages.dev/ のソースです。johukku が作った Windows 用ツールの配布ページを置いています。

ツール本体は別のリポジトリです。

- [whisper-subtitle-tool](https://github.com/johukku/whisper-subtitle-tool) … Whisper 字幕作成ツール
- [media-downloader](https://github.com/johukku/media-downloader) … メディアダウンローダー

## 構成

静的な HTML を Cloudflare Pages で配信し、掲示板とアクセスカウンターだけ Pages Functions と D1 で動かしています。

```
public/              配信されるファイル（この中身だけが公開される）
  index.html         トップ
  subtitle/          Whisper 字幕作成ツール（概要・使い方・FAQ）
  downloader/        メディアダウンローダー（概要・使い方・FAQ）
  bbs/               掲示板（投稿は承認制）
  admin/             掲示板の管理ページ
  about/  privacy/   運営者情報・プライバシーポリシー
  assets/            CSS と画像
  404.html  _headers  _redirects  robots.txt  sitemap.xml  favicon.ico
functions/api/       counter.js（カウンター）・comments.js（掲示板）・admin.js（承認・非表示・削除）
schema.sql           D1 のテーブル定義
wrangler.toml        Pages と D1 の設定
```

## デプロイ

`master` に push すると Cloudflare Pages が自動でデプロイします（ビルド処理はありません）。

新しく環境を作るときだけ、D1 のテーブル作成と secret の登録が必要です。

```
npx wrangler d1 execute johukku-site --remote --file=schema.sql
npx wrangler pages secret put ADMIN_TOKEN --project-name johukku
npx wrangler pages secret put IP_SALT --project-name johukku
```

| secret | 用途 |
|---|---|
| `ADMIN_TOKEN` | `/admin/` の合言葉 |
| `IP_SALT` | 掲示板の連投判定で IP をハッシュ化するときに混ぜる値（生の IP は保存しない） |

## 手元での確認

```
npx wrangler d1 execute johukku-site --local --file=schema.sql
npx wrangler pages dev
```

`.dev.vars` に `ADMIN_TOKEN` と `IP_SALT` を書いておくと、掲示板と管理ページも動きます（`.dev.vars` はコミットしません）。
