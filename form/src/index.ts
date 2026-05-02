interface Env {
  GITHUB_APP_ID: string;
  GITHUB_INSTALLATION_ID: string;
  GITHUB_PRIVATE_KEY: string;
  GITHUB_OWNER?: string;
  GITHUB_REPO?: string;
  GITHUB_BASE_BRANCH?: string;
  MEMBERS_CSV_PATH?: string;
  DEFAULT_ROLE?: string;
  ALLOWED_EMAIL_DOMAINS?: string;
  DISCORD_WEBHOOK_URL?: string;
}

interface Application {
  username: string;
  email: string;
  name: string;
  reason: string;
}

const DEFAULT_OWNER = "suzuka-kosen-festa";
const DEFAULT_REPO = "manager-data";
const DEFAULT_BASE_BRANCH = "feat/main";
const DEFAULT_MEMBERS_CSV_PATH = "members.csv";
const DEFAULT_ROLE = "member";
const USERNAME_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return html(renderForm(getAccessAuthenticatedUserEmail(request)));
    }

    if (request.method === "POST" && url.pathname === "/apply") {
      return handleApply(request, env);
    }

    return new Response("Not Found", { status: 404 });
  },
};

async function handleApply(request: Request, env: Env): Promise<Response> {
  const accessEmail = getAccessAuthenticatedUserEmail(request);
  const application = withCanonicalEmail(await readApplication(request), accessEmail);
  const errors = validateApplication(application, env);

  if (errors.length > 0) {
    return json({ ok: false, errors }, 400);
  }

  try {
    const result = await createMemberPullRequest(env, application, accessEmail);
    return json({ ok: true, pullRequestUrl: result.html_url });
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "申請の送信に失敗しました。";
    return json({ ok: false, errors: [message] }, 500);
  }
}

async function readApplication(request: Request): Promise<Application> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const body = (await request.json()) as Partial<Application>;
    return normalizeApplication(body);
  }

  const formData = await request.formData();
  return normalizeApplication({
    username: stringValue(formData.get("username")),
    email: stringValue(formData.get("email")),
    name: stringValue(formData.get("name")),
    reason: stringValue(formData.get("reason")),
  });
}

function normalizeApplication(input: Partial<Application>): Application {
  return {
    username: (input.username ?? "").trim(),
    email: (input.email ?? "").trim(),
    name: (input.name ?? "").trim(),
    reason: (input.reason ?? "").trim(),
  };
}

function validateApplication(application: Application, env: Env): string[] {
  const errors: string[] = [];

  if (!USERNAME_RE.test(application.username)) {
    errors.push("GitHub username の形式が正しくありません。");
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(application.email)) {
    errors.push("高専メールアドレスの形式が正しくありません。");
  }

  const allowedDomains = parseAllowedDomains(env.ALLOWED_EMAIL_DOMAINS);
  if (allowedDomains.length > 0) {
    const domain = application.email.split("@").pop()?.toLowerCase();
    if (!domain || !allowedDomains.includes(domain)) {
      errors.push(`利用できるメールドメインは ${allowedDomains.join(", ")} です。`);
    }
  }

  if (application.name.length < 1 || application.name.length > 80) {
    errors.push("名前は 1 文字以上 80 文字以内で入力してください。");
  }

  if (application.reason.length < 10 || application.reason.length > 1000) {
    errors.push("申請理由は 10 文字以上 1000 文字以内で入力してください。");
  }

  return errors;
}

async function createMemberPullRequest(
  env: Env,
  application: Application,
  accessEmail: string | undefined,
): Promise<{ html_url: string }> {
  const config = githubConfig(env);
  const token = await createInstallationToken(env);
  const headers = githubHeaders(token);
  const baseRef = await githubFetch<{ object: { sha: string } }>(
    config,
    `/repos/${config.owner}/${config.repo}/git/ref/heads/${config.baseBranch}`,
    { headers },
  );

  const file = await githubFetch<{ content: string; sha: string }>(
    config,
    `/repos/${config.owner}/${config.repo}/contents/${encodeURI(config.csvPath)}?ref=${encodeURIComponent(config.baseBranch)}`,
    { headers },
  );

  const currentCsv = base64Decode(file.content);
  const rows = parseCsv(currentCsv);
  if (rows.some((row) => row[0]?.trim().toLowerCase() === application.username.toLowerCase())) {
    throw new Error("この GitHub username はすでに CSV に登録されています。");
  }

  const branchName = `applications/add-${application.username.toLowerCase()}-${Date.now()}`;
  await githubFetch(
    config,
    `/repos/${config.owner}/${config.repo}/git/refs`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        ref: `refs/heads/${branchName}`,
        sha: baseRef.object.sha,
      }),
    },
  );

  const memo = buildMemo(application);
  const nextCsv = appendCsvRow(currentCsv, [application.username, config.defaultRole, memo]);
  const diff = buildAppendDiff(config.csvPath, currentCsv, nextCsv);
  await githubFetch(
    config,
    `/repos/${config.owner}/${config.repo}/contents/${encodeURI(config.csvPath)}`,
    {
      method: "PUT",
      headers,
      body: JSON.stringify({
        message: `Add ${application.username} to members`,
        content: base64Encode(nextCsv),
        sha: file.sha,
        branch: branchName,
      }),
    },
  );

  const pullRequest = await githubFetch<{ html_url: string }>(
    config,
    `/repos/${config.owner}/${config.repo}/pulls`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        title: `Add ${application.username} to members`,
        head: branchName,
        base: config.baseBranch,
        body: [
          "GitHub username 申請フォームから作成された PR です。",
          "",
          `- GitHub username: \`${application.username}\``,
          `- 名前: ${application.name}`,
          `- 高専メールアドレス: ${application.email}`,
          accessEmail ? `- Cloudflare Access user: ${accessEmail}` : undefined,
          "",
          "申請理由:",
          application.reason,
        ].filter(Boolean).join("\n"),
      }),
    },
  );

  await notifyDiscord(env, {
    application,
    accessEmail,
    diff,
    pullRequestUrl: pullRequest.html_url,
    repo: `${config.owner}/${config.repo}`,
  });

  return pullRequest;
}

async function notifyDiscord(
  env: Env,
  notification: {
    application: Application;
    accessEmail: string | undefined;
    diff: string;
    pullRequestUrl: string;
    repo: string;
  },
): Promise<void> {
  if (!env.DISCORD_WEBHOOK_URL) {
    return;
  }

  const content = truncateDiscordContent([
    "GitHub username 申請フォームで Pull Request を作成しました。",
    "",
    `Repository: ${notification.repo}`,
    `Pull Request: ${notification.pullRequestUrl}`,
    `GitHub username: ${notification.application.username}`,
    `名前: ${notification.application.name}`,
    `高専メールアドレス: ${notification.application.email}`,
    notification.accessEmail ? `Cloudflare Access user: ${notification.accessEmail}` : undefined,
    "",
    "```diff",
    notification.diff,
    "```",
  ].filter(Boolean).join("\n"));

  try {
    const response = await fetch(env.DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });

    if (!response.ok) {
      console.error(`Discord webhook request failed: ${response.status} ${await response.text()}`);
    }
  } catch (error) {
    console.error("Discord webhook request failed", error);
  }
}

function truncateDiscordContent(content: string): string {
  const limit = 2000;
  if (content.length <= limit) {
    return content;
  }

  const suffix = "\n...(truncated)\n```";
  return `${content.slice(0, limit - suffix.length)}${suffix}`;
}

function buildAppendDiff(path: string, currentCsv: string, nextCsv: string): string {
  const currentLines = splitLines(currentCsv);
  const nextLines = splitLines(nextCsv);
  const addedLines = nextLines.slice(currentLines.length);
  const startLine = currentLines.length + 1;

  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${currentLines.length},0 +${startLine},${addedLines.length} @@`,
    ...addedLines.map((line) => `+${line}`),
  ].join("\n");
}

function splitLines(value: string): string[] {
  const normalized = value.replace(/\r\n/g, "\n").replace(/\n$/, "");
  return normalized.length === 0 ? [] : normalized.split("\n");
}

function withCanonicalEmail(application: Application, accessEmail: string | undefined): Application {
  if (!accessEmail) {
    return application;
  }

  return {
    ...application,
    email: accessEmail,
  };
}

function githubConfig(env: Env) {
  return {
    owner: env.GITHUB_OWNER ?? DEFAULT_OWNER,
    repo: env.GITHUB_REPO ?? DEFAULT_REPO,
    baseBranch: env.GITHUB_BASE_BRANCH ?? DEFAULT_BASE_BRANCH,
    csvPath: env.MEMBERS_CSV_PATH ?? DEFAULT_MEMBERS_CSV_PATH,
    defaultRole: env.DEFAULT_ROLE ?? DEFAULT_ROLE,
  };
}

async function createInstallationToken(env: Env): Promise<string> {
  assertEnv(env.GITHUB_APP_ID, "GITHUB_APP_ID");
  assertEnv(env.GITHUB_INSTALLATION_ID, "GITHUB_INSTALLATION_ID");
  assertEnv(env.GITHUB_PRIVATE_KEY, "GITHUB_PRIVATE_KEY");

  const appId = cleanSecret(env.GITHUB_APP_ID);
  const installationId = cleanSecret(env.GITHUB_INSTALLATION_ID);
  const jwt = await createAppJwt(appId, cleanPrivateKey(env.GITHUB_PRIVATE_KEY));
  const response = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${jwt}`,
      "User-Agent": "suzuka-kosen-festa-manager-form",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub installation token の作成に失敗しました: ${response.status} ${body}`);
  }

  const body = (await response.json()) as { token: string };
  return body.token;
}

async function createAppJwt(appId: string, privateKeyPem: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iat: now - 60,
    exp: now + 9 * 60,
    iss: appId,
  };
  const unsignedToken = `${base64UrlEncodeJson(header)}.${base64UrlEncodeJson(payload)}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(privateKeyPem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsignedToken));
  return `${unsignedToken}.${base64UrlEncodeBytes(new Uint8Array(signature))}`;
}

async function githubFetch<T = unknown>(
  config: { owner: string; repo: string },
  path: string,
  init: RequestInit,
): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, init);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API request failed: ${response.status} ${body}`);
  }
  return response.json() as Promise<T>;
}

function githubHeaders(token: string): HeadersInit {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "User-Agent": "suzuka-kosen-festa-manager-form",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function buildMemo(application: Application): string {
  return `name=${application.name}; email=${application.email}; reason=${application.reason.replace(/\s+/g, " ")}`;
}

function appendCsvRow(csv: string, row: string[]): string {
  const lineEnding = csv.includes("\r\n") ? "\r\n" : "\n";
  const trimmedCsv = csv.endsWith("\n") ? csv.slice(0, -1) : csv;
  return `${trimmedCsv}${lineEnding}${row.map(csvEscape).join(",")}${lineEnding}`;
}

function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < csv.length; i += 1) {
    const char = csv[i];
    const next = csv[i + 1];

    if (quoted) {
      if (char === "\"" && next === "\"") {
        field += "\"";
        i += 1;
      } else if (char === "\"") {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === "\"") {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function csvEscape(value: string): string {
  if (!/[",\r\n]/.test(value)) {
    return value;
  }
  return `"${value.replaceAll("\"", "\"\"")}"`;
}

function parseAllowedDomains(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const normalized = cleanPrivateKey(pem);
  const isPkcs1 = normalized.includes("BEGIN RSA PRIVATE KEY");
  const base64 = normalized
    .replace("-----BEGIN RSA PRIVATE KEY-----", "")
    .replace("-----END RSA PRIVATE KEY-----", "")
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");
  const der = bytesFromBase64(base64);
  return bytesToArrayBuffer(isPkcs1 ? wrapPkcs1AsPkcs8(der) : der);
}

function wrapPkcs1AsPkcs8(pkcs1: Uint8Array): Uint8Array {
  const algorithmIdentifier = new Uint8Array([
    0x30, 0x0d,
    0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01,
    0x05, 0x00,
  ]);
  const version = new Uint8Array([0x02, 0x01, 0x00]);
  const privateKey = derElement(0x04, pkcs1);
  return derElement(0x30, concatBytes(version, algorithmIdentifier, privateKey));
}

function derElement(tag: number, value: Uint8Array): Uint8Array {
  return concatBytes(new Uint8Array([tag]), derLength(value.length), value);
}

function derLength(length: number): Uint8Array {
  if (length < 128) {
    return new Uint8Array([length]);
  }

  const bytes: number[] = [];
  let remaining = length;
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff);
    remaining >>= 8;
  }
  return new Uint8Array([0x80 | bytes.length, ...bytes]);
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const length = arrays.reduce((total, array) => total + array.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  arrays.forEach((array) => {
    result.set(array, offset);
    offset += array.length;
  });
  return result;
}

function base64UrlEncodeJson(value: unknown): string {
  return base64UrlEncodeBytes(new TextEncoder().encode(JSON.stringify(value)));
}

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  return base64FromBytes(bytes).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64Encode(value: string): string {
  return base64FromBytes(new TextEncoder().encode(value));
}

function base64Decode(value: string): string {
  return new TextDecoder().decode(bytesFromBase64(value.replace(/\s/g, "")));
}

function base64FromBytes(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function bytesFromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function cleanSecret(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function cleanPrivateKey(value: string): string {
  return cleanSecret(value).replace(/\\n/g, "\n").trim();
}

function assertEnv(value: string | undefined, name: string): asserts value is string {
  if (!value) {
    throw new Error(`${name} is not configured.`);
  }
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function getAccessAuthenticatedUserEmail(request: Request): string | undefined {
  const email = request.headers.get("cf-access-authenticated-user-email")?.trim();
  return email || undefined;
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=UTF-8" },
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=UTF-8" },
  });
}

function renderForm(accessEmail: string | undefined): string {
  const emailInputAttributes = accessEmail
    ? `value="${escapeHtml(accessEmail)}" readonly`
    : `placeholder="name@example.ac.jp"`;
  const emailHint = accessEmail
    ? `<span class="hint">Cloudflare Access で認証されたメールアドレスを使用します。</span>`
    : "";

  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>GitHub username 申請</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f7f4ee;
      --panel: #ffffff;
      --text: #202124;
      --muted: #5f6368;
      --line: #d8d2c8;
      --accent: #0f766e;
      --accent-strong: #115e59;
      --danger: #b3261e;
      --success: #146c43;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.6;
    }
    main {
      width: min(720px, calc(100% - 32px));
      margin: 0 auto;
      padding: 48px 0;
    }
    h1 {
      margin: 0 0 8px;
      font-size: clamp(1.75rem, 4vw, 2.5rem);
      line-height: 1.2;
      letter-spacing: 0;
    }
    p {
      margin: 0 0 28px;
      color: var(--muted);
    }
    form {
      display: grid;
      gap: 18px;
      padding: 24px;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: 0 12px 30px rgb(32 33 36 / 8%);
    }
    label {
      display: grid;
      gap: 7px;
      font-weight: 700;
    }
    input,
    textarea {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 12px 13px;
      color: var(--text);
      background: #fff;
      font: inherit;
    }
    textarea {
      min-height: 140px;
      resize: vertical;
    }
    input:focus,
    textarea:focus {
      outline: 3px solid rgb(15 118 110 / 22%);
      border-color: var(--accent);
    }
    .hint {
      color: var(--muted);
      font-size: 0.9rem;
      font-weight: 400;
    }
    button {
      min-height: 48px;
      border: 0;
      border-radius: 6px;
      padding: 0 18px;
      background: var(--accent);
      color: #fff;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
    }
    button:hover { background: var(--accent-strong); }
    button:disabled {
      cursor: wait;
      opacity: 0.7;
    }
    #message {
      display: none;
      padding: 14px 16px;
      border-radius: 6px;
      border: 1px solid var(--line);
      background: #fff;
      overflow-wrap: anywhere;
    }
    #message.error {
      display: block;
      color: var(--danger);
      border-color: rgb(179 38 30 / 35%);
      background: rgb(179 38 30 / 6%);
    }
    #message.success {
      display: block;
      color: var(--success);
      border-color: rgb(20 108 67 / 35%);
      background: rgb(20 108 67 / 7%);
    }
    a { color: inherit; }
  </style>
</head>
<body>
  <main>
    <h1>GitHub username 申請</h1>
    <p>manager-data に追加する GitHub username を申請します。</p>
    <form id="application-form">
      <label>
        GitHub username
        <input name="username" autocomplete="username" required pattern="[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?" maxlength="39" placeholder="octocat">
        <span class="hint">GitHub のユーザー名だけを入力してください。</span>
      </label>
      <label>
        高専メールアドレス
        <input name="email" type="email" autocomplete="email" required ${emailInputAttributes}>
        ${emailHint}
      </label>
      <label>
        名前
        <input name="name" autocomplete="name" required maxlength="80" placeholder="鈴鹿 太郎">
      </label>
      <label>
        申請理由
        <textarea name="reason" required minlength="10" maxlength="1000" placeholder="参加・管理に必要な理由を入力してください。"></textarea>
      </label>
      <div id="message" role="status" aria-live="polite"></div>
      <button type="submit">申請を送信</button>
    </form>
  </main>
  <script>
    const form = document.querySelector("#application-form");
    const message = document.querySelector("#message");
    const button = form.querySelector("button");

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      message.className = "";
      message.style.display = "none";
      button.disabled = true;

      try {
        const response = await fetch("/apply", {
          method: "POST",
          body: new FormData(form),
        });
        const body = await response.json();
        if (!response.ok || !body.ok) {
          throw new Error((body.errors || ["送信に失敗しました。"]).join("\\n"));
        }

        message.className = "success";
        message.innerHTML = 'Pull Request を作成しました。<br><a href="' + body.pullRequestUrl + '" rel="noreferrer" target="_blank">' + body.pullRequestUrl + "</a>";
        form.reset();
      } catch (error) {
        message.className = "error";
        message.textContent = error instanceof Error ? error.message : "送信に失敗しました。";
      } finally {
        message.style.display = "block";
        button.disabled = false;
      }
    });
  </script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}
