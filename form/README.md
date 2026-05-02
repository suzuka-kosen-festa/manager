# manager username form

Cloudflare Access の背後で動かす GitHub username 申請フォームです。

フォームから送信された GitHub username、高専メールアドレス、名前、申請理由を使って、GitHub App の installation token で `suzuka-kosen-festa/manager-data` の `members.csv` にユーザーを追加する Pull Request を作成します。

## 必要な GitHub App 権限

- Contents: Read and write
- Pull requests: Read and write
- Metadata: Read-only

GitHub App は `manager-data` リポジトリに install してください。

## Worker secrets

```sh
cd form
wrangler secret put GITHUB_APP_ID
wrangler secret put GITHUB_INSTALLATION_ID
wrangler secret put GITHUB_PRIVATE_KEY
```

`GITHUB_PRIVATE_KEY` は GitHub App の PEM 秘密鍵をそのまま登録します。

## 設定

`wrangler.toml` の `[vars]` で対象リポジトリやブランチを変更できます。

- `GITHUB_OWNER`: 対象 owner
- `GITHUB_REPO`: 対象 repository
- `GITHUB_BASE_BRANCH`: PR の base branch
- `MEMBERS_CSV_PATH`: CSV path
- `DEFAULT_ROLE`: 追加する role
- `ALLOWED_EMAIL_DOMAINS`: 任意。カンマ区切りでメールドメインを制限できます。

## 開発

```sh
pnpm install
pnpm run dev
```

## デプロイ

```sh
pnpm run deploy
```

Cloudflare Access の認証制限は Worker の route 側に設定してください。Worker 自体にはログイン処理を入れていません。
