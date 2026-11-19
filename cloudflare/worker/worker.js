const PUBLIC_BASE = "https://pub-e9be11aeab4a431e8dc85a854ae160fe.r2.dev";
const MAX_UPLOAD = 200 * 1024 * 1024;
const EXTRA_ORIGINS = []; // add custom domains here
const DEFAULT_STORAGE_LIMIT = 5 * 1024 ** 3;
const STORAGE_FULL_MESSAGE =
  "O espaço do site acabou (limite de 5 GB). Apague materiais antigos ou fale com o Carlos antes de enviar mais.";
const USAGE_KEY = "usage:total";
const R2_PART_SIZE = 8 * 1024 ** 2;
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
// Only Carlos's alert-sender authorization asks for this scope; Tia Vanete's Drive
// authorization never includes it, so she does not see Google's "unverified app" screen.
const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const SENDER_TOKEN_KEY = "alert_sender:refresh_token";
const SENDER_STATUS_KEY = "alert_sender:status";
const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD_URL =
  "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id";
const FOLDER_TYPE = "application/vnd.google-apps.folder";
const DRIVE_FOLDER_FIELDS = "id,name,webViewLink";
const GOOGLE_NOT_CONFIGURED = "A ligação com o Google Drive ainda não foi configurada.";
const GOOGLE_NOT_CONNECTED = "O Google Drive ainda não está ligado. Peça ao Carlos.";
const GOOGLE_NEEDS_REAUTH = "Peça ao Carlos para ligar o Drive de novo.";
const BACKUP_FETCH_BUDGET = 40;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_ALERT_SENDER = "Carloshen.senai@gmail.com";
const ALERT_SENDER_NAME = "Site Tia Vanete";
const BACKUP_PROBLEMS = {
  google_needs_reauth: {
    message: "O Google Drive perdeu a ligação com o site.",
    action: "Abra este link e clique em Permitir.",
  },
  drive_full: {
    message: "O espaço do seu Google Drive acabou.",
    action: "Libere espaço no Google Drive ou compre mais espaço no Google One.",
    actionUrl: "https://one.google.com/",
  },
  repeated_failures: {
    message: "A cópia para o Google Drive falhou várias vezes.",
    action: "Seus arquivos no site estão seguros. Fale com o Carlos para ele ajudar.",
  },
  stale: {
    message: "Faz mais de dois dias que a cópia para o Google Drive não termina sem falhas.",
    action: "Seus arquivos no site estão seguros. Fale com o Carlos para ele ajudar.",
  },
};
// Keep these labels aligned with MATERIAL_CATEGORY_LABELS in src/lib/materials.ts.
const CATEGORY_LABELS = new Map([
  ["pdfs", "PDFs"],
  ["imagens", "Imagens"],
  ["mensagens", "Mensagens"],
]);

function corsHeaders(req) {
  const o = req.headers.get("Origin") || "";
  let ok = false;
  try {
    const u = new URL(o);
    ok =
      u.hostname.endsWith(".vercel.app") ||
      u.hostname === "localhost" ||
      u.hostname === "127.0.0.1" ||
      EXTRA_ORIGINS.includes(o);
  } catch {}
  const h = {
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, x-migrate-secret, x-file-path",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (ok) h["Access-Control-Allow-Origin"] = o;
  return h;
}
function json(req, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(req) },
  });
}
function cleanPath(p) {
  if (!p || typeof p !== "string") return null;
  p = p.replace(/^\/+/, "");
  if (!p || p.length > 512 || p.includes("..") || p.includes("\\") || /[\x00-\x1f]/.test(p))
    return null;
  return p;
}
const publicUrl = (k) => `${PUBLIC_BASE}/${k.split("/").map(encodeURIComponent).join("/")}`;

async function requireAdmin(req, env) {
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return { error: "missing bearer token", status: 401 };
  const base = env.SUPABASE_URL;
  const h = { apikey: env.SUPABASE_ANON_KEY, Authorization: auth };
  const ur = await fetch(`${base}/auth/v1/user`, { headers: h });
  if (!ur.ok) return { error: "invalid session", status: 401 };
  const user = await ur.json();
  if (!user || !user.id) return { error: "invalid session", status: 401 };
  const rr = await fetch(
    `${base}/rest/v1/user_roles?select=role&user_id=eq.${encodeURIComponent(user.id)}&role=eq.admin`,
    { headers: h },
  );
  if (!rr.ok) return { error: "role check failed", status: 403 };
  const rows = await rr.json();
  if (!Array.isArray(rows) || rows.length === 0) return { error: "admin only", status: 403 };
  return { user };
}

async function putStream(env, key, body, len, contentType, cacheControl) {
  const opts = {
    httpMetadata: {
      contentType: contentType || "application/octet-stream",
      cacheControl: cacheControl || "public, max-age=31536000",
    },
  };
  if (len != null && !isNaN(len)) {
    const { readable, writable } = new FixedLengthStream(len);
    const pipe = body.pipeTo(writable);
    const [obj] = await Promise.all([env.BUCKET.put(key, readable, opts), pipe]);
    return obj;
  }
  return putUnknownLength(env.BUCKET, key, body, opts);
}

// R2's single PUT requires a known length. Keep at most one multipart block in memory.
async function putUnknownLength(bucket, key, body, opts) {
  const reader = body.getReader();
  const buffer = new Uint8Array(R2_PART_SIZE);
  const parts = [];
  let upload;
  let filled = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (let offset = 0; offset < value.length;) {
        const count = Math.min(value.length - offset, buffer.length - filled);
        buffer.set(value.subarray(offset, offset + count), filled);
        filled += count;
        offset += count;
        if (filled === buffer.length) {
          upload ??= await bucket.createMultipartUpload(key, opts);
          parts.push(await upload.uploadPart(parts.length + 1, buffer));
          filled = 0;
        }
      }
    }
    if (!upload) return await bucket.put(key, buffer.subarray(0, filled), opts);
    if (filled) parts.push(await upload.uploadPart(parts.length + 1, buffer.subarray(0, filled)));
    return await upload.complete(parts);
  } catch (error) {
    await Promise.allSettled([reader.cancel(), upload?.abort()]);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

async function* bucketPages(bucket) {
  let cursor;
  do {
    const page = await bucket.list({ cursor, limit: 1000 });
    yield page.objects;
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

function storageLimit(env) {
  const limit = Number(env.STORAGE_LIMIT_BYTES);
  return Number.isSafeInteger(limit) && limit > 0 ? limit : DEFAULT_STORAGE_LIMIT;
}

async function countBucket(bucket) {
  let usedBytes = 0;
  let objectCount = 0;
  for await (const objects of bucketPages(bucket)) {
    objectCount += objects.length;
    for (const object of objects) usedBytes += object.size;
  }
  return { usedBytes, objectCount };
}

async function invalidateUsage(env) {
  try {
    await env.STATE?.delete(USAGE_KEY);
  } catch (error) {
    console.warn("Não foi possível limpar o cache de espaço.", error);
  }
}

async function usage(req, env, fresh) {
  let totals;
  try {
    if (!fresh) totals = await env.STATE?.get(USAGE_KEY, "json");
  } catch (error) {
    console.warn("Não foi possível ler o cache de espaço.", error);
  }
  if (!totals) {
    totals = await countBucket(env.BUCKET);
    try {
      await env.STATE?.put(USAGE_KEY, JSON.stringify(totals), { expirationTtl: 60 });
    } catch (error) {
      console.warn("Não foi possível salvar o cache de espaço.", error);
    }
  }
  const limitBytes = storageLimit(env);
  return json(req, {
    ...totals,
    limitBytes,
    freeBytes: Math.max(0, limitBytes - totals.usedBytes),
  });
}

async function storageFull(req, env, path, incomingSize) {
  const [totals, previous] = await Promise.all([countBucket(env.BUCKET), env.BUCKET.head(path)]);
  const { usedBytes } = totals;
  const limitBytes = storageLimit(env);
  if (usedBytes - (previous?.size ?? 0) + incomingSize <= limitBytes) return null;
  return json(
    req,
    { error: "storage_full", message: STORAGE_FULL_MESSAGE, usedBytes, limitBytes },
    413,
  );
}

async function migrate(req, env) {
  if (!env.MIGRATE_SECRET || req.headers.get("x-migrate-secret") !== env.MIGRATE_SECRET)
    return json(req, { error: "forbidden" }, 403);
  const { keys, skipExisting } = await req.json();
  if (!Array.isArray(keys) || keys.length > 40)
    return json(req, { error: "keys must be an array of <= 40" }, 400);
  const results = [];
  let changed = false;
  for (const raw of keys) {
    const key = cleanPath(raw);
    if (!key) {
      results.push({ key: raw, ok: false, error: "bad key" });
      continue;
    }
    try {
      if (skipExisting) {
        const h = await env.BUCKET.head(key);
        if (h) {
          results.push({ key, ok: true, size: h.size, skipped: true });
          continue;
        }
      }
      const src = `${env.SUPABASE_URL}/storage/v1/object/public/materials/${key.split("/").map(encodeURIComponent).join("/")}`;
      const r = await fetch(src);
      if (!r.ok) {
        results.push({ key, ok: false, status: r.status });
        continue;
      }
      const len = r.headers.get("content-length");
      const obj = await putStream(
        env,
        key,
        r.body,
        len != null ? parseInt(len, 10) : null,
        r.headers.get("content-type"),
        r.headers.get("cache-control"),
      );
      changed = true;
      results.push({ key, ok: true, size: obj.size, contentType: r.headers.get("content-type") });
    } catch (e) {
      results.push({ key, ok: false, error: String((e && e.message) || e) });
    }
  }
  if (changed) await invalidateUsage(env);
  return json(req, { results });
}

async function upload(req, env) {
  const a = await requireAdmin(req, env);
  if (a.error) return json(req, { error: a.error }, a.status);
  const ct = req.headers.get("Content-Type") || "";
  const cl = parseInt(req.headers.get("Content-Length") ?? "", 10);
  if (cl > MAX_UPLOAD) return json(req, { error: "file too large" }, 413);
  if (ct.startsWith("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    const path = cleanPath(form.get("path"));
    if (!path || !file || typeof file === "string")
      return json(req, { error: "need file and path" }, 400);
    if (file.size > MAX_UPLOAD) return json(req, { error: "file too large" }, 413);
    const rejection = await storageFull(req, env, path, file.size);
    if (rejection) return rejection;
    await env.BUCKET.put(path, file, {
      httpMetadata: {
        contentType: file.type || "application/octet-stream",
        cacheControl: "public, max-age=31536000",
      },
    });
    await invalidateUsage(env);
    return json(req, { path, url: publicUrl(path), size: file.size });
  }
  // raw body: PUT/POST /upload?path=... (streams, no buffering)
  const path = cleanPath(
    new URL(req.url).searchParams.get("path") || req.headers.get("x-file-path"),
  );
  if (!path || !req.body) return json(req, { error: "need path and body" }, 400);
  const len = Number.isSafeInteger(cl) && cl >= 0 ? cl : null;
  if (len !== null) {
    const rejection = await storageFull(req, env, path, len);
    if (rejection) return rejection;
  }
  const obj = await putStream(env, path, req.body, len, ct || "application/octet-stream");
  await invalidateUsage(env);
  return json(req, { path, url: publicUrl(path), size: obj.size });
}

async function del(req, env) {
  const a = await requireAdmin(req, env);
  if (a.error) return json(req, { error: a.error }, a.status);
  const path = cleanPath(new URL(req.url).searchParams.get("path"));
  if (!path) return json(req, { error: "need path" }, 400);
  await env.BUCKET.delete(path);
  await invalidateUsage(env);
  return json(req, { path, deleted: true });
}

function googleConfigured(env) {
  return Boolean(env.STATE && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

function allowedEmail(env) {
  return env.ALLOWED_GOOGLE_EMAIL || "vanetedeoliveiramaffra@gmail.com";
}

function callbackUrl(req, env) {
  return new URL("/google/callback", env.PUBLIC_WORKER_URL || req.url).href;
}

function alertSenderEmail(env) {
  return env.ALERT_SENDER_EMAIL?.trim() || DEFAULT_ALERT_SENDER;
}

async function googleAuthStart(req, env) {
  const state = crypto.randomUUID();
  const redirectUri = callbackUrl(req, env);
  await env.STATE.put(`oauth_state:${state}`, redirectUri, { expirationTtl: 900 });
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: `openid email ${DRIVE_SCOPE}`,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    login_hint: allowedEmail(env),
    state,
  });
  return new Response(null, {
    status: 302,
    headers: { Location: url.href, "Cache-Control": "no-store" },
  });
}

// Carlos authorizes his own Gmail once so the alerts go out from it. Same OAuth client and
// callback URL as the Drive flow, but its own state prefix, scopes and KV keys.
async function alertSenderAuthStart(req, env) {
  const state = crypto.randomUUID();
  const redirectUri = callbackUrl(req, env);
  await env.STATE.put(`oauth_sender_state:${state}`, redirectUri, { expirationTtl: 900 });
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: `openid email ${GMAIL_SEND_SCOPE}`,
    access_type: "offline",
    prompt: "consent",
    login_hint: alertSenderEmail(env),
    state,
  });
  return new Response(null, {
    status: 302,
    headers: { Location: url.href, "Cache-Control": "no-store" },
  });
}

async function alertSenderCallback(url, env, stateKey, redirectUri) {
  const title = "O aviso por e-mail ainda não foi ligado";
  await env.STATE.delete(stateKey);
  const code = url.searchParams.get("code");
  if (url.searchParams.has("error") || !code) {
    return callbackPage(title, "O pedido foi cancelado. Abra o link de novo para tentar.", 400);
  }
  const response = await requestGoogleToken(env, {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });
  if (!response.ok) throw new Error(`Google OAuth: ${response.status}`);
  const { access_token, refresh_token, scope } = await response.json();
  if (!access_token || !refresh_token)
    throw new Error("Google OAuth não retornou os dados da conexão.");
  if (scope && !scope.split(/\s+/).includes(GMAIL_SEND_SCOPE)) {
    return callbackPage(
      title,
      "Marque a permissão de enviar e-mails pelo Gmail e abra o link de novo.",
      403,
    );
  }
  const user = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  if (!user.ok) throw new Error(`Google userinfo: ${user.status}`);
  const { email, email_verified } = await user.json();
  if (
    !email_verified ||
    typeof email !== "string" ||
    email.toLowerCase() !== alertSenderEmail(env).toLowerCase()
  ) {
    return callbackPage(
      title,
      `Use a conta ${escapeEmailHtml(alertSenderEmail(env))} para ligar o aviso por e-mail.`,
      403,
    );
  }
  await env.STATE.put(
    SENDER_TOKEN_KEY,
    JSON.stringify({
      token: refresh_token,
      email,
      connectedAt: new Date().toISOString(),
      connectionId: crypto.randomUUID(),
    }),
  );
  return callbackPage(
    "Pronto! ✅",
    `Os avisos da cópia no Google Drive vão sair de ${escapeEmailHtml(email)}. Pode fechar esta página.`,
  );
}

async function alertSenderConnection(env) {
  const [sender, status] = await Promise.all([
    env.STATE.get(SENDER_TOKEN_KEY, "json"),
    env.STATE.get(SENDER_STATUS_KEY, "json"),
  ]);
  if (sender?.email?.toLowerCase() !== alertSenderEmail(env).toLowerCase()) {
    return { sender: null, needsReauth: false };
  }
  return {
    sender,
    needsReauth: status?.state === "needs_reauth" && status.connectionId === sender.connectionId,
  };
}

function alertEmailStatus(env, { sender, needsReauth }, requestUrl) {
  return {
    enabled: Boolean(sender) && !needsReauth,
    sender: alertSenderEmail(env),
    to: env.ALERT_EMAIL_TO?.trim() || allowedEmail(env),
    authorized: Boolean(sender),
    needsReauth,
    authUrl: new URL(
      "/google/alert-sender/auth-start",
      env.PUBLIC_WORKER_URL || requestUrl || "https://tiavanete-files.carloshen.workers.dev",
    ).href,
  };
}

function callbackPage(title, message, status = 200) {
  return new Response(
    `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    body { margin: 0; padding: 2rem 1rem; background: #f3f8fc; color: #162c3c; font: 1.375rem/1.5 system-ui, sans-serif; }
    main { max-width: 36rem; margin: 4vh auto; padding: 2rem; background: #fff; border-radius: 1rem; }
    h1 { font-size: 2rem; line-height: 1.2; }
  </style>
</head>
<body><main><h1>${title}</h1><p>${message}</p></main></body>
</html>`,
    {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    },
  );
}

function requestGoogleToken(env, fields, request = fetch) {
  return request(GOOGLE_TOKEN_URL, {
    method: "POST",
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      ...fields,
    }),
  });
}

async function googleCallback(url, env) {
  const state = url.searchParams.get("state") ?? "";
  const validState = /^[a-f0-9-]{36}$/.test(state);
  const senderStateKey = `oauth_sender_state:${state}`;
  const senderRedirect = validState ? await env.STATE.get(senderStateKey) : null;
  if (senderRedirect) return alertSenderCallback(url, env, senderStateKey, senderRedirect);
  const stateKey = `oauth_state:${state}`;
  const redirectUri = validState ? await env.STATE.get(stateKey) : null;
  const title = "O Google Drive ainda não foi ligado";
  if (!redirectUri) {
    return callbackPage(
      title,
      "Este link venceu. Volte ao painel e tente ligar o Google Drive de novo.",
      400,
    );
  }
  await env.STATE.delete(stateKey);
  const code = url.searchParams.get("code");
  if (url.searchParams.has("error") || !code) {
    return callbackPage(
      title,
      "O pedido foi cancelado. Pode voltar ao painel e tentar de novo.",
      400,
    );
  }

  const response = await requestGoogleToken(env, {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });
  if (!response.ok) throw new Error(`Google OAuth: ${response.status}`);
  const { access_token, refresh_token, scope } = await response.json();
  if (!access_token || !refresh_token)
    throw new Error("Google OAuth não retornou os dados da conexão.");
  if (scope && !scope.split(/\s+/).includes(DRIVE_SCOPE)) {
    return callbackPage(
      title,
      "Marque a permissão do Google Drive e tente de novo pelo painel.",
      403,
    );
  }
  const user = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  if (!user.ok) throw new Error(`Google userinfo: ${user.status}`);
  const { email, email_verified } = await user.json();
  if (
    !email_verified ||
    typeof email !== "string" ||
    email.toLowerCase() !== allowedEmail(env).toLowerCase()
  ) {
    return callbackPage(
      title,
      "Use a conta Google da Tia Vanete para ligar o Drive. Volte ao painel e tente de novo.",
      403,
    );
  }
  await env.STATE.put(
    "google:refresh_token",
    JSON.stringify({
      token: refresh_token,
      email,
      connectedAt: new Date().toISOString(),
      connectionId: crypto.randomUUID(),
    }),
  );
  return callbackPage(
    "Pronto! ✅",
    "O site agora guarda uma cópia dos seus arquivos no seu Google Drive. Pode fechar esta página.",
  );
}

class DriveError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function googleConnection(env) {
  const [connection, status] = await Promise.all([
    env.STATE.get("google:refresh_token", "json"),
    env.STATE.get("google:status", "json"),
  ]);
  if (connection?.email?.toLowerCase() !== allowedEmail(env).toLowerCase()) {
    return { connection: null, needsReauth: false };
  }
  return {
    connection,
    needsReauth:
      status?.state === "needs_reauth" && status.connectionId === connection.connectionId,
  };
}

async function markReauth(env, connection) {
  await env.STATE.put(
    "google:status",
    JSON.stringify({ state: "needs_reauth", connectionId: connection.connectionId }),
  );
}

async function googleAccessToken(env, request = fetch, forceRefresh = false) {
  const { connection, needsReauth } = await googleConnection(env);
  if (!connection) throw new DriveError(409, "google_not_connected", GOOGLE_NOT_CONNECTED);
  if (needsReauth) throw new DriveError(409, "google_needs_reauth", GOOGLE_NEEDS_REAUTH);
  const cached = await env.STATE.get("google:access_token", "json");
  if (
    !forceRefresh &&
    cached?.connectionId === connection.connectionId &&
    cached.expiresAt > Date.now()
  )
    return cached.token;

  const response = await requestGoogleToken(
    env,
    { grant_type: "refresh_token", refresh_token: connection.token },
    request,
  );
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 || data?.error === "invalid_grant") {
    await markReauth(env, connection);
    throw new DriveError(409, "google_needs_reauth", GOOGLE_NEEDS_REAUTH);
  }
  if (!response.ok || !data?.access_token) throw new Error(`Google token: ${response.status}`);
  const ttl = Math.floor(data.expires_in - 60);
  if (ttl >= 60) {
    try {
      await env.STATE.put(
        "google:access_token",
        JSON.stringify({
          token: data.access_token,
          connectionId: connection.connectionId,
          expiresAt: Date.now() + ttl * 1000,
        }),
        { expirationTtl: ttl },
      );
    } catch (error) {
      console.warn("Não foi possível guardar a sessão do Drive no cache.", error);
    }
  }
  return data.access_token;
}

async function googleStatus(req, env) {
  const [{ connection, needsReauth }, last, alert, sender] = await Promise.all([
    googleConnection(env),
    env.STATE.get("backup:last", "json"),
    env.STATE.get("backup:alert", "json"),
    alertSenderConnection(env),
  ]);
  const alertEmail = alertEmailStatus(env, sender, req.url);
  return json(req, {
    configured: true,
    connected: Boolean(connection) && !needsReauth,
    email: connection?.email ?? null,
    needsReauth,
    health: backupHealth(
      env,
      connection,
      needsReauth,
      healthFor(last, connection),
      alert,
      req.url,
      alertEmail.enabled,
    ),
    alertEmail,
    lastBackup: last && {
      at: last.at,
      copied: last.copied,
      failed: last.failed,
      remaining: last.remaining,
    },
  });
}

function driveClient(token, request = fetch) {
  return (url, options = {}) =>
    request(url, {
      ...options,
      headers: { Authorization: `Bearer ${token}`, ...options.headers },
      redirect: "error",
    });
}

async function driveFailure(response, message) {
  const data = await response.json().catch(() => null);
  const storageFull =
    response.status === 507 ||
    data?.error?.errors?.some(({ reason }) => reason === "storageQuotaExceeded") ||
    data?.error?.details?.some(({ reason }) => reason === "STORAGE_QUOTA_EXCEEDED");
  const problem =
    response.status === 401 ? "google_needs_reauth" : storageFull ? "drive_full" : null;
  return Object.assign(new Error(message), { problem });
}

async function driveJson(response) {
  if (!response.ok) throw await driveFailure(response, `Google Drive: ${response.status}`);
  return response.json();
}

function driveFolder({ id, name, webViewLink }) {
  return {
    id,
    name,
    webViewLink: webViewLink || `https://drive.google.com/drive/folders/${encodeURIComponent(id)}`,
  };
}

async function getDriveFolder(drive, id) {
  const response = await drive(
    `${DRIVE_FILES_URL}/${encodeURIComponent(id)}?fields=${DRIVE_FOLDER_FIELDS},parents,trashed,mimeType`,
  );
  if (response.status === 404) {
    await response.body?.cancel();
    return null;
  }
  const folder = await driveJson(response);
  return !folder.trashed && folder.mimeType === FOLDER_TYPE ? folder : null;
}

async function createDriveFolder(drive, name, parentId) {
  return driveJson(
    await drive(`${DRIVE_FILES_URL}?fields=${DRIVE_FOLDER_FIELDS}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        mimeType: FOLDER_TYPE,
        ...(parentId && { parents: [parentId] }),
      }),
    }),
  );
}

function driveQueryLiteral(value) {
  return "'" + value.replace(/[\\']/g, "\\$&") + "'";
}

async function findDriveFile(drive, query, fields = "id") {
  const url = new URL(DRIVE_FILES_URL);
  url.search = new URLSearchParams({
    q: `trashed=false and ${query}`,
    fields: `files(${fields})`,
    pageSize: "1",
  });
  return (await driveJson(await drive(url))).files?.[0];
}

async function ensureDriveFolder(env, drive, path, name, parentId, backup = false) {
  const cacheKey = `folder:${path}`;
  const cachedId = await env.STATE.get(cacheKey);
  if (cachedId) {
    const folder = await getDriveFolder(drive, cachedId);
    if (folder && (!parentId || folder.parents?.includes(parentId))) return folder;
  }
  const existing =
    backup &&
    (await findDriveFile(
      drive,
      `mimeType='${FOLDER_TYPE}' and name=${driveQueryLiteral(name)} and ${driveQueryLiteral(parentId || "root")} in parents`,
      DRIVE_FOLDER_FIELDS,
    ));
  const folder = existing || (await createDriveFolder(drive, name, parentId));
  await env.STATE.put(cacheKey, folder.id);
  return folder;
}

async function listDriveFolders(drive, rootId) {
  const folders = [];
  const escapedId = rootId.replace(/[\\']/g, "\\$&");
  const url = new URL(DRIVE_FILES_URL);
  url.search = new URLSearchParams({
    q: `'${escapedId}' in parents and mimeType='${FOLDER_TYPE}' and trashed=false`,
    fields: `nextPageToken,files(${DRIVE_FOLDER_FIELDS})`,
    orderBy: "name",
    pageSize: "1000",
  });
  for (let page = 0; page < 40; page++) {
    const data = await driveJson(await drive(url));
    folders.push(...(data.files ?? []).map(driveFolder));
    if (!data.nextPageToken) return folders;
    url.searchParams.set("pageToken", data.nextPageToken);
  }
  throw new Error("O Drive tem páginas demais para listar em uma chamada.");
}

async function uploadSession(drive, metadata, mimeType, size, origin) {
  const response = await drive(DRIVE_UPLOAD_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Upload-Content-Type": mimeType,
      "X-Upload-Content-Length": String(size),
      ...(origin && { Origin: origin }),
    },
    body: JSON.stringify(metadata),
  });
  const location = response.headers.get("Location");
  if (!response.ok)
    throw await driveFailure(response, `Sessão de envio do Google Drive: ${response.status}`);
  await response.body?.cancel();
  if (!location) throw new Error(`Sessão de envio do Google Drive: ${response.status}`);
  return location;
}

function validName(name, maxLength) {
  return (
    typeof name === "string" &&
    name.trim().length > 0 &&
    name.length <= maxLength &&
    !/[\x00-\x1f\x7f]/.test(name)
  );
}

async function requestJson(req) {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

async function driveRequest(req, env, path) {
  let data;
  if (req.method === "POST") {
    data = await requestJson(req);
    if (path === "/drive/folders" && !validName(data?.name, 120)) {
      return json(
        req,
        { error: "invalid_name", message: "Escreva um nome de pasta de até 120 caracteres." },
        400,
      );
    }
    if (
      path === "/drive/upload-session" &&
      (!validName(data?.name, 255) ||
        typeof data.folderId !== "string" ||
        !/^[\w-]{1,256}$/.test(data.folderId) ||
        !Number.isSafeInteger(data.size) ||
        data.size < 0 ||
        typeof data.mimeType !== "string" ||
        !/^[\w!#$%&'*+.^`|~-]+\/[\w!#$%&'*+.^`|~-]+$/.test(data.mimeType))
    ) {
      return json(
        req,
        {
          error: "invalid_file",
          message: "Não foi possível preparar este arquivo. Escolha a pasta e o arquivo de novo.",
        },
        400,
      );
    }
  }

  const drive = driveClient(await googleAccessToken(env));
  const root = await ensureDriveFolder(
    env,
    drive,
    "upload-root",
    env.UPLOAD_ROOT_NAME || "Arquivos da Tia Vanete",
  );
  if (path === "/drive/folders") {
    if (req.method === "POST") {
      return json(req, driveFolder(await createDriveFolder(drive, data.name.trim(), root.id)), 201);
    }
    return json(req, { root: driveFolder(root), folders: await listDriveFolders(drive, root.id) });
  }

  if (data.folderId !== root.id) {
    const folder = await getDriveFolder(drive, data.folderId);
    if (!folder?.parents?.includes(root.id)) {
      return json(
        req,
        {
          error: "invalid_folder",
          message: "Esta pasta não está disponível. Escolha outra pasta.",
        },
        400,
      );
    }
  }
  const uploadUrl = await uploadSession(
    drive,
    { name: data.name, parents: [data.folderId] },
    data.mimeType,
    data.size,
    req.headers.get("Origin"),
  );
  return json(req, { uploadUrl });
}

async function digestText(value) {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function backupRecordKey(key) {
  const recordKey = `backup:${key}`;
  if (new TextEncoder().encode(recordKey).length <= 512 && !["last", "alert"].includes(key))
    return recordKey;
  return `backup-long:${await digestText(recordKey)}`;
}

async function backupInventory(env) {
  const inventory = [];
  for await (const objects of bucketPages(env.BUCKET)) {
    for (let start = 0; start < objects.length; start += 100) {
      const group = objects.slice(start, start + 100);
      const keys = await Promise.all(group.map(({ key }) => backupRecordKey(key)));
      const records = await env.STATE.get(keys, "json");
      for (const [index, object] of group.entries()) {
        const recordKey = keys[index];
        inventory.push({
          object,
          recordKey,
          needsCopy: records.get(recordKey)?.etag !== object.etag,
        });
      }
    }
  }
  return inventory;
}

function r2Key(url) {
  if (typeof url !== "string" || !url.startsWith(`${PUBLIC_BASE}/`)) return null;
  try {
    return decodeURIComponent(new URL(url).pathname.slice(1)) || null;
  } catch {
    return null;
  }
}

async function backupMaterials(env, request) {
  const result = new Map();
  const url = new URL(`${env.SUPABASE_URL}/rest/v1/materials`);
  url.search = new URLSearchParams({
    select: "category,title,file_path,file_url,cover_url",
    order: "id.asc",
  });
  for (let start = 0; ;) {
    const response = await request(url, {
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
        Range: `${start}-${start + 999}`,
        Prefer: "count=exact",
      },
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Leitura dos materiais: ${response.status}`);
    }
    const materials = await response.json();
    for (const material of materials) {
      const label = material.category
        ?.trim()
        .replace(/[_/\\-]+/g, " ")
        .trim();
      const category =
        CATEGORY_LABELS.get(material.category) ||
        (label ? label[0].toLocaleUpperCase("pt-BR") + label.slice(1) : "Outros");
      for (const key of [
        r2Key(material.file_path) || material.file_path,
        r2Key(material.file_url),
      ]) {
        if (key && !result.has(key))
          result.set(key, { title: material.title, folders: [category] });
      }
      const cover = r2Key(material.cover_url);
      if (cover && !result.has(cover))
        result.set(cover, { title: material.title, folders: [category, "Capas"] });
    }
    start += materials.length;
    const total = Number(response.headers.get("Content-Range")?.split("/")[1]);
    if (materials.length === 0 || !Number.isFinite(total) || start >= total) return result;
  }
}

function backupDestination(key, materials, names) {
  const material = materials.get(key);
  const folders = material?.folders ?? ["Outros"];
  const basename = key.split("/").at(-1) || "Arquivo";
  const dot = basename.lastIndexOf(".");
  const extension = dot > 0 ? basename.slice(dot) : "";
  const title =
    material?.title?.replace(/[\/\\\x00-\x1f]/g, "-").trim() ||
    (dot > 0 ? basename.slice(0, dot) : basename);
  const path = folders.join("/");
  if (!names.has(path)) names.set(path, { seen: new Set(), counts: new Map() });
  const { seen, counts } = names.get(path);
  let count = (counts.get(title) ?? 0) + 1;
  let name = count === 1 ? title + extension : `${title} (${count})${extension}`;
  while (seen.has(name)) name = `${title} (${++count})${extension}`;
  seen.add(name);
  counts.set(title, count);
  return { folders, name };
}

async function copyToDrive(env, drive, item, name, parentId, request) {
  const { key, size, etag } = item.object;
  const version = await digestText(JSON.stringify([key, etag]));
  const existing = await findDriveFile(
    drive,
    `appProperties has { key='backupVersion' and value='${version}' }`,
  );
  const driveId =
    existing?.id || (await uploadBackupFile(env, drive, item, name, parentId, request, version));
  await env.STATE.put(
    item.recordKey,
    JSON.stringify({ driveId, etag, size, at: new Date().toISOString() }),
  );
}

async function uploadBackupFile(env, drive, item, name, parentId, request, version) {
  const { key, size, etag } = item.object;
  const object = await env.BUCKET.get(key, { onlyIf: { etagMatches: etag } });
  if (!object?.body) throw new Error("O arquivo mudou antes da cópia.");
  try {
    const mimeType = object.httpMetadata?.contentType || "application/octet-stream";
    const url = await uploadSession(
      drive,
      {
        name,
        parents: [parentId],
        description: `R2: ${key}`,
        appProperties: { backupVersion: version },
      },
      mimeType,
      size,
    );
    // Workers set Content-Length from the stream, so the PUT stays length-delimited.
    const { readable, writable } = new FixedLengthStream(size);
    const [response] = await Promise.all([
      request(url, {
        method: "PUT",
        headers: { "Content-Type": mimeType, "Content-Length": String(size) },
        body: readable,
      }),
      object.body.pipeTo(writable),
    ]);
    const { id: driveId } = await driveJson(response);
    if (!driveId) throw new Error("O Drive não confirmou a cópia.");
    return driveId;
  } finally {
    if (!object.body.locked) await object.body.cancel();
  }
}

async function runBackup(env, { budget, scheduled = false }) {
  const { connection, needsReauth } = await googleConnection(env);
  if (scheduled && !connection) return;
  const previous = connection
    ? healthFor(await env.STATE.get("backup:last", "json"), connection)
    : {};
  let tokenCheckAt = previous.tokenCheckAt ?? null;
  let problem = null;
  let fatal = false;
  const summary = { at: new Date().toISOString(), copied: 0, failed: 0, remaining: 0 };
  const errors = [];
  const signal = AbortSignal.timeout((scheduled ? 9 : 13) * 60 * 1000);
  let available = budget;
  const request = (url, options) => {
    if (available <= 0) throw new Error("Limite de chamadas do backup atingido.");
    available--;
    return fetch(url, { ...options, redirect: "error", signal });
  };

  try {
    const checkToken =
      scheduled && (needsReauth || tokenCheckAt?.slice(0, 10) !== summary.at.slice(0, 10));
    const token = checkToken ? await googleAccessToken(env, request, true) : null;
    if (checkToken) tokenCheckAt = summary.at;
    const inventory = await backupInventory(env);
    summary.remaining = inventory.filter(({ needsCopy }) => needsCopy).length;
    if (!summary.remaining) return summary;

    const drive = driveClient(token || (await googleAccessToken(env, request)), request);
    const materials = await backupMaterials(env, request);
    const names = new Map();
    const folders = new Map();
    const rootName = env.BACKUP_ROOT_NAME || "Backup Site Tia Vanete";

    for (const item of inventory) {
      const { folders: categories, name } = backupDestination(item.object.key, materials, names);
      if (!item.needsCopy) continue;
      const path = ["backup-root", ...categories];
      const folderKeys = path.map((_, index) => path.slice(0, index + 1).join("/"));
      // Allow for a cached folder check, lookup and create, plus a file lookup and upload.
      const missing = folderKeys.filter((key) => !folders.has(key)).length;
      if (available < 3 + 3 * missing) break;
      signal.throwIfAborted();

      try {
        let parentId;
        for (const [index, key] of folderKeys.entries()) {
          if (!folders.has(key)) {
            const folder = await ensureDriveFolder(
              env,
              drive,
              key,
              index === 0 ? rootName : path[index],
              parentId,
              true,
            );
            folders.set(key, folder.id);
          }
          parentId = folders.get(key);
        }
        await copyToDrive(env, drive, item, name, parentId, request);
        summary.copied++;
        summary.remaining--;
      } catch (error) {
        summary.failed++;
        errors.push({ key: item.object.key, error: error.message });
        console.error("Falha ao copiar arquivo para o Drive.", item.object.key, error.message);
        if (error.problem) {
          problem = error.problem;
          if (problem === "google_needs_reauth") await markReauth(env, connection);
          break;
        }
      }
    }
    signal.throwIfAborted();
    return summary;
  } catch (error) {
    fatal = true;
    problem = error.problem || (error.code === "google_needs_reauth" ? error.code : problem);
    throw error;
  } finally {
    const success = !needsReauth && !fatal && summary.failed === 0;
    const failedRuns = success ? 0 : (previous.failedRuns ?? 0) + 1;
    const health = connection && {
      connectionId: connection.connectionId ?? connection.connectedAt,
      lastRunAt: summary.at,
      lastSuccessAt: success ? summary.at : (previous.lastSuccessAt ?? null),
      tokenCheckAt,
      failedRuns,
      problem,
    };
    if (health) {
      health.problem = backupProblem(connection, needsReauth, health);
      health.message = BACKUP_PROBLEMS[health.problem]?.message ?? null;
    }
    try {
      if (connection || !scheduled)
        await env.STATE.put("backup:last", JSON.stringify({ ...summary, errors, health }));
    } catch (error) {
      console.error("Não foi possível salvar o resultado do backup.", error);
    }
  }
}

function healthFor(last, connection) {
  const id = connection?.connectionId ?? connection?.connectedAt;
  return last?.health && last.health.connectionId === id ? last.health : {};
}

function backupProblem(connection, needsReauth, health) {
  if (!connection) return null;
  if (needsReauth) return "google_needs_reauth";
  if (health.problem === "drive_full" || health.problem === "google_needs_reauth")
    return health.problem;
  const since = health.lastSuccessAt ?? connection.connectedAt;
  if (Date.now() - Date.parse(since) > 2 * DAY_MS) return "stale";
  return health.failedRuns >= 3 ? "repeated_failures" : null;
}

function backupHealth(env, connection, needsReauth, health, alert, requestUrl, emailEnabled) {
  const problem = backupProblem(connection, needsReauth, health);
  const detail = BACKUP_PROBLEMS[problem];
  return {
    status: !problem
      ? "ok"
      : problem === "stale" || problem === "repeated_failures"
        ? "warning"
        : "error",
    problem,
    message: detail?.message ?? null,
    action: detail?.action ?? null,
    actionUrl:
      problem === "google_needs_reauth"
        ? new URL(
            "/google/auth-start",
            env.PUBLIC_WORKER_URL || requestUrl || "https://tiavanete-files.carloshen.workers.dev",
          ).href
        : (detail?.actionUrl ?? null),
    lastSuccessAt: health.lastSuccessAt ?? null,
    emailConfigured: Boolean(emailEnabled),
    lastAlertAt: alert?.lastAlertAt ?? null,
  };
}

function escapeEmailHtml(value) {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char],
  );
}

function base64Utf8(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function encodedWord(value) {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${base64Utf8(value)}?=`;
}

function mimeMessage({ from, to, cc, subject, text, html }) {
  for (const value of [from, to, cc ?? "", subject]) {
    if (/[\r\n]/.test(value)) throw new Error("Cabeçalho inválido.");
  }
  const boundary = `alt-${crypto.randomUUID()}`;
  const part = (type, body) => [
    `--${boundary}`,
    `Content-Type: ${type}; charset=UTF-8`,
    "Content-Transfer-Encoding: base64",
    "",
    ...base64Utf8(body).match(/.{1,76}/g),
  ];
  return [
    `From: ${encodedWord(ALERT_SENDER_NAME)} <${from}>`,
    `To: ${to}`,
    ...(cc ? [`Cc: ${cc}`] : []),
    `Subject: ${encodedWord(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    ...part("text/plain", text),
    ...part("text/html", html),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

function base64Url(value) {
  return base64Utf8(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function markSenderReauth(env, sender) {
  await env.STATE.put(
    SENDER_STATUS_KEY,
    JSON.stringify({ state: "needs_reauth", connectionId: sender.connectionId }),
  );
}

// Sends through the Gmail API as the authorized sender. Returns "sent" or "failed".
async function sendGmailAlert(env, sender, mail) {
  const tokenResponse = await requestGoogleToken(env, {
    grant_type: "refresh_token",
    refresh_token: sender.token,
  });
  const token = await tokenResponse.json().catch(() => ({}));
  if (tokenResponse.status === 401 || token?.error === "invalid_grant") {
    await markSenderReauth(env, sender);
    console.warn("A autorização do Gmail que envia os avisos foi revogada.");
    return "failed";
  }
  if (!tokenResponse.ok || !token?.access_token)
    throw new Error(`Google token: ${tokenResponse.status}`);
  const response = await fetch(GMAIL_SEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw: base64Url(mimeMessage({ ...mail, from: alertSenderEmail(env) })) }),
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  await response.body?.cancel();
  if (response.status === 401) {
    await markSenderReauth(env, sender);
    return "failed";
  }
  return response.ok ? "sent" : "failed";
}

async function alertBackupProblem(env) {
  const [{ connection, needsReauth }, last, alert, senderState] = await Promise.all([
    googleConnection(env),
    env.STATE.get("backup:last", "json"),
    env.STATE.get("backup:alert", "json"),
    alertSenderConnection(env),
  ]);
  if (!connection) return;
  const emailEnabled = Boolean(senderState.sender) && !senderState.needsReauth;
  const health = backupHealth(
    env,
    connection,
    needsReauth,
    healthFor(last, connection),
    alert,
    undefined,
    emailEnabled,
  );
  if (!health.problem) return;
  if (!emailEnabled) {
    console.info(
      "Aviso da cópia do Google Drive sem Gmail autorizado para enviar.",
      health.problem,
    );
    return;
  }
  const now = Date.now();
  if (
    now - Date.parse(alert?.lastAlertAt) < DAY_MS ||
    now - Date.parse(alert?.lastAttemptAt) < 60 * 60 * 1000
  )
    return;
  const at = new Date(now).toISOString();
  const actionLink = health.actionUrl
    ? `<p><a href="${escapeEmailHtml(health.actionUrl)}" style="font-size:24px;font-weight:bold">${
        health.problem === "google_needs_reauth"
          ? "Ligar o Google Drive de novo"
          : "Abrir o Google One"
      }</a></p>`
    : "";
  const to = env.ALERT_EMAIL_TO?.trim() || allowedEmail(env);
  const cc = env.ALERT_CC?.trim();
  const mail = {
    to,
    ...(cc && cc.toLowerCase() !== to.toLowerCase() && { cc }),
    subject: "Aviso sobre a cópia no Google Drive",
    text: ["Olá, Tia Vanete!", health.message, health.action, health.actionUrl]
      .filter(Boolean)
      .join("\n\n"),
    html: `<div lang="pt-BR" style="font:22px/1.5 Arial,sans-serif;color:#181818"><p>Olá, Tia Vanete!</p><p><strong>${health.message}</strong></p><p>${health.action}</p>${actionLink}</div>`,
  };
  let result = "failed";
  try {
    result = await sendGmailAlert(env, senderState.sender, mail);
  } catch {
    console.warn("Falha ao enviar o aviso da cópia do Google Drive pelo Gmail.");
  }
  await env.STATE.put(
    "backup:alert",
    JSON.stringify({
      lastAttemptAt: at,
      lastAlertAt: result === "sent" ? new Date().toISOString() : (alert?.lastAlertAt ?? null),
      result,
      provider: "gmail",
      problem: health.problem,
    }),
  );
}

function googleRoute(path, method) {
  if (method === "GET")
    return [
      "/google/auth-start",
      "/google/alert-sender/auth-start",
      "/google/callback",
      "/google/status",
      "/drive/folders",
    ].includes(path);
  return (
    method === "POST" && ["/backup/run", "/drive/folders", "/drive/upload-session"].includes(path)
  );
}

async function handleGoogle(req, env, url) {
  const path = url.pathname;
  if (!googleConfigured(env)) {
    return json(req, { error: "google_not_configured", message: GOOGLE_NOT_CONFIGURED }, 503);
  }

  try {
    if (path === "/google/auth-start") return await googleAuthStart(req, env);
    if (path === "/google/alert-sender/auth-start") return await alertSenderAuthStart(req, env);
    if (path === "/google/callback") return await googleCallback(url, env);
    const admin = await requireAdmin(req, env);
    if (admin.error) return json(req, { error: admin.error }, admin.status);
    if (path === "/google/status") return await googleStatus(req, env);
    if (path === "/backup/run")
      return json(req, await runBackup(env, { budget: BACKUP_FETCH_BUDGET - 2 }));
    return await driveRequest(req, env, path);
  } catch (error) {
    if (error instanceof DriveError)
      return json(req, { error: error.code, message: error.message }, error.status);
    console.error("Falha na operação do Google Drive.", path, error.name);
    if (path === "/google/callback") {
      return callbackPage(
        "O Google Drive ainda não foi ligado",
        "Pode voltar ao painel e tentar de novo. Se precisar de ajuda, fale com o Carlos.",
        502,
      );
    }
    return json(
      req,
      {
        error: "google_drive_error",
        message: "Não foi possível usar o Google Drive agora. Tente de novo.",
      },
      502,
    );
  }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS")
      return new Response(null, { status: 204, headers: corsHeaders(req) });
    try {
      if (googleRoute(url.pathname, req.method)) return await handleGoogle(req, env, url);
      if (url.pathname === "/usage" && req.method === "GET") {
        const admin = await requireAdmin(req, env);
        if (admin.error) return json(req, { error: admin.error }, admin.status);
        return await usage(req, env, url.searchParams.get("fresh") === "1");
      }
      if (url.pathname === "/migrate" && req.method === "POST") return await migrate(req, env);
      if (url.pathname === "/upload" && (req.method === "POST" || req.method === "PUT"))
        return await upload(req, env);
      if (url.pathname === "/object" && req.method === "DELETE") return await del(req, env);
      if (url.pathname === "/object" && req.method === "HEAD") {
        const p = cleanPath(url.searchParams.get("path"));
        const h = p && (await env.BUCKET.head(p));
        return new Response(null, {
          status: h ? 200 : 404,
          headers: { ...(h ? { "x-size": String(h.size) } : {}), ...corsHeaders(req) },
        });
      }
      if (url.pathname === "/" || url.pathname === "/health")
        return json(req, { ok: true, publicBase: PUBLIC_BASE });
      return json(req, { error: "not found" }, 404);
    } catch (e) {
      return json(req, { error: String((e && e.message) || e) }, 500);
    }
  },
  async scheduled(_event, env) {
    if (!googleConfigured(env)) return;
    try {
      await runBackup(env, { budget: BACKUP_FETCH_BUDGET, scheduled: true });
    } catch (error) {
      if (!(error instanceof DriveError)) console.error("Falha no backup do Drive.", error.name);
    }
    try {
      await alertBackupProblem(env);
    } catch {
      console.error("Não foi possível registrar o aviso da cópia do Google Drive.");
    }
  },
};
