import assert from "node:assert/strict";
import { test } from "node:test";
import worker from "./worker.js";

const R2_PUBLIC = "https://pub-e9be11aeab4a431e8dc85a854ae160fe.r2.dev";
const WORKER_URL = "https://arquivos.example";
const FRONTEND_ORIGIN = "https://tiavanete.vercel.app";
const FOLDER_TYPE = "application/vnd.google-apps.folder";
const GMAIL_SEND = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

function parseMime(raw) {
  const [head, ...rest] = raw.split("\r\n\r\n");
  const headers = Object.fromEntries(
    head.split("\r\n").map((line) => {
      const i = line.indexOf(": ");
      return [line.slice(0, i).toLowerCase(), line.slice(i + 2)];
    }),
  );
  const decodeWord = (value) =>
    value.replace(/=\?UTF-8\?B\?([^?]+)\?=/g, (_, b64) => Buffer.from(b64, "base64").toString());
  const body = rest.join("\r\n\r\n");
  const part = (type) => {
    const match = new RegExp(
      `Content-Type: ${type}; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+?)\r\n--`,
    ).exec(body);
    return match && Buffer.from(match[1].replace(/\r\n/g, ""), "base64").toString();
  };
  return {
    headers,
    from: decodeWord(headers.from),
    subject: decodeWord(headers.subject),
    text: part("text/plain"),
    html: part("text/html"),
  };
}

function fixture(t, files = [], options = {}) {
  const data = new Map();
  const objects = new Map();
  const calls = [];
  const folders = new Map();
  const sessions = new Map();
  const copies = [];
  const emails = [];
  let listCalls = 0;
  let counter = 0;
  let multipartParts = 0;

  function putObject(key, size, etag = `etag-${++counter}`, body) {
    const object = { key, size, etag, httpMetadata: { contentType: "application/octet-stream" } };
    objects.set(key, { ...object, bytes: body });
    return object;
  }
  for (const file of files) putObject(...file);

  const read = (key, type) => {
    const value = data.get(key)?.value;
    return value === undefined ? null : type === "json" ? JSON.parse(value) : value;
  };
  const env = {
    SUPABASE_URL: "https://supabase.example",
    SUPABASE_ANON_KEY: "anon",
    MIGRATE_SECRET: "migration",
    GOOGLE_CLIENT_ID: "client",
    GOOGLE_CLIENT_SECRET: "secret",
    ALLOWED_GOOGLE_EMAIL: "admin@example.com",
    ALERT_SENDER_EMAIL: "Sender@Example.com",
    PUBLIC_WORKER_URL: WORKER_URL,
    STATE: {
      async get(key, type) {
        return Array.isArray(key)
          ? new Map(key.map((item) => [item, read(item, type)]))
          : read(key, type);
      },
      async put(key, value, metadata) {
        data.set(key, { value, ...metadata });
      },
      async delete(key) {
        data.delete(key);
      },
    },
    BUCKET: {
      async list({ cursor, limit }) {
        assert.equal(limit, 1000);
        listCalls++;
        const all = [...objects.values()].sort((a, b) => a.key.localeCompare(b.key));
        const start = Number(cursor ?? 0);
        const end = start + (options.pageSize ?? limit);
        return {
          objects: all.slice(start, end),
          truncated: end < all.length,
          cursor: String(end),
        };
      },
      async head(key) {
        return objects.get(key) ?? null;
      },
      async get(key, { onlyIf } = {}) {
        const object = objects.get(key);
        if (!object) return null;
        if (onlyIf && onlyIf.etagMatches !== object.etag) return object;
        return {
          ...object,
          body:
            typeof object.bytes === "function"
              ? object.bytes()
              : new Blob([object.bytes ?? new Uint8Array(object.size).fill(65)]).stream(),
        };
      },
      async put(key, body) {
        const bytes = new Uint8Array(await new Response(body).arrayBuffer());
        return putObject(key, bytes.length, undefined, bytes);
      },
      async createMultipartUpload(key) {
        const parts = [];
        return {
          async uploadPart(partNumber, bytes) {
            multipartParts++;
            parts.push(bytes.slice());
            return { partNumber, etag: `part-${partNumber}` };
          },
          async complete(uploaded) {
            assert.equal(uploaded.length, parts.length);
            const bytes = new Uint8Array(await new Blob(parts).arrayBuffer());
            return putObject(key, bytes.length, undefined, bytes);
          },
          async abort() {},
        };
      },
      async delete(key) {
        objects.delete(key);
      },
    },
  };

  t.mock.method(globalThis, "fetch", async (input, init = {}) => {
    const url = new URL(input);
    const method = init.method ?? "GET";
    const headers = new Headers(init.headers);
    calls.push({ url, method, headers });
    if (url.href === GMAIL_SEND) {
      const { raw } = JSON.parse(init.body);
      assert.match(raw, /^[A-Za-z0-9_-]+$/);
      const mime = Buffer.from(raw, "base64url").toString();
      emails.push({ method, httpHeaders: headers, raw: mime, ...parseMime(mime) });
      return Response.json({ id: "mail-id" }, { status: options.mailStatus ?? 200 });
    }
    if (url.pathname === "/auth/v1/user") {
      return headers.get("Authorization") === "Bearer admin"
        ? Response.json({ id: "admin-id" })
        : new Response(null, { status: 401 });
    }
    if (url.pathname === "/rest/v1/user_roles") return Response.json([{ role: "admin" }]);
    if (url.pathname === "/rest/v1/materials") {
      assert.equal(headers.get("apikey"), "anon");
      assert.equal(url.searchParams.get("select"), "category,title,file_path,file_url,cover_url");
      return Response.json(options.materials ?? []);
    }
    if (url.pathname.startsWith("/storage/v1/object/public/materials/")) {
      return new Response("migrated", {
        headers: { "Content-Length": "8", "Content-Type": "text/plain" },
      });
    }
    if (url.host === "oauth2.googleapis.com") {
      const grant = init.body.get("grant_type");
      assert.equal(init.body.get("client_secret"), "secret");
      if (grant === "authorization_code") {
        assert.equal(init.body.get("redirect_uri"), `${WORKER_URL}/google/callback`);
        return Response.json({
          access_token: "callback-token",
          refresh_token: options.callbackRefresh ?? "offline-token",
          ...(options.grantedScope && { scope: options.grantedScope }),
        });
      }
      assert.equal(grant, "refresh_token");
      if (init.body.get("refresh_token") === "sender-token") {
        return options.senderInvalidGrant
          ? Response.json({ error: "invalid_grant" }, { status: 400 })
          : Response.json({ access_token: "sender-access", expires_in: 3600 });
      }
      assert.equal(init.body.get("refresh_token"), "offline-token");
      if (options.tokenStatus) return new Response(null, { status: options.tokenStatus });
      return options.invalidGrant
        ? Response.json({ error: "invalid_grant" }, { status: 400 })
        : Response.json({ access_token: "refreshed-token", expires_in: 3600 });
    }
    if (url.host === "openidconnect.googleapis.com") {
      assert.equal(headers.get("Authorization"), "Bearer callback-token");
      return Response.json({
        email: options.googleEmail ?? "ADMIN@example.com",
        email_verified: true,
      });
    }
    if (url.pathname === "/drive/v3/files" && method === "POST") {
      const created = { ...JSON.parse(init.body), id: `folder-${++counter}`, trashed: false };
      created.webViewLink = `https://drive.google.com/drive/folders/${created.id}`;
      folders.set(created.id, created);
      return Response.json(created);
    }
    if (url.pathname.startsWith("/drive/v3/files/")) {
      const folder = folders.get(url.pathname.split("/").at(-1));
      return folder ? Response.json(folder) : new Response(null, { status: 404 });
    }
    if (url.pathname === "/drive/v3/files") {
      const query = url.searchParams.get("q");
      const version = /value='([a-f0-9]+)'/.exec(query)?.[1];
      if (version) {
        return Response.json({
          files: copies.filter((file) => file.appProperties.backupVersion === version),
        });
      }
      const root = /'([^']+)' in parents/.exec(query)[1];
      const name = /name='([^']+)'/.exec(query)?.[1];
      assert.match(url.searchParams.get("q"), /trashed=false/);
      return Response.json({
        files: [...folders.values()].filter(
          (folder) =>
            (folder.parents?.includes(root) || (root === "root" && !folder.parents)) &&
            (!name || name === folder.name),
        ),
      });
    }
    if (url.pathname === "/upload/drive/v3/files") {
      assert.equal(url.searchParams.get("uploadType"), "resumable");
      const location = `https://www.googleapis.com/session/${++counter}`;
      sessions.set(location, { ...JSON.parse(init.body), headers });
      return new Response(null, { headers: { Location: location } });
    }
    if (method === "PUT" && sessions.has(url.href)) {
      const session = sessions.get(url.href);
      assert.ok(init.body instanceof ReadableStream);
      let bytes = 0;
      for await (const chunk of init.body) bytes += chunk.byteLength;
      assert.equal(bytes, Number(session.headers.get("X-Upload-Content-Length")));
      assert.equal(bytes, Number(headers.get("Content-Length")));
      if (options.failKey && session.description === `R2: ${options.failKey}`) {
        return new Response(null, { status: 503 });
      }
      if (options.uploadStatus) {
        return Response.json(
          { error: { errors: [{ reason: options.uploadReason }] } },
          { status: options.uploadStatus },
        );
      }
      const id = `copy-${++counter}`;
      copies.push({ ...session, id });
      return Response.json({ id });
    }
    assert.fail(`Fetch inesperado: ${method} ${url}`);
  });

  globalThis.FixedLengthStream = class extends TransformStream {
    constructor(length) {
      let written = 0;
      super({
        transform(chunk, controller) {
          written += chunk.byteLength;
          controller.enqueue(chunk);
        },
        flush() {
          assert.equal(written, length);
        },
      });
    }
  };
  t.after(() => delete globalThis.FixedLengthStream);

  function request(path, init = {}) {
    return worker.fetch(
      new Request(WORKER_URL + path, {
        ...init,
        headers: { Authorization: "Bearer admin", Origin: FRONTEND_ORIGIN, ...init.headers },
      }),
      env,
    );
  }

  async function connect() {
    await env.STATE.put(
      "google:refresh_token",
      JSON.stringify({
        token: "offline-token",
        email: "admin@example.com",
        connectedAt: new Date().toISOString(),
        connectionId: "test-connection",
      }),
    );
  }

  async function authorizeSender() {
    await env.STATE.put(
      "alert_sender:refresh_token",
      JSON.stringify({
        token: "sender-token",
        email: "sender@example.com",
        connectedAt: new Date().toISOString(),
        connectionId: "sender-connection",
      }),
    );
  }

  return {
    env,
    request,
    connect,
    authorizeSender,
    data,
    putObject,
    calls,
    folders,
    sessions,
    copies,
    emails,
    get listCalls() {
      return listCalls;
    },
    get multipartParts() {
      return multipartParts;
    },
  };
}

function upload(body, method = "PUT") {
  return {
    method,
    body,
    headers: { "Content-Type": "text/plain", "Content-Length": String(body.length) },
  };
}

test("health and legacy CORS, migration, HEAD and DELETE", async (t) => {
  const f = fixture(t);
  for (const path of ["/", "/health"]) {
    const response = await f.request(path);
    assert.deepEqual(await response.json(), { ok: true, publicBase: R2_PUBLIC });
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), FRONTEND_ORIGIN);
  }
  const preflight = await f.request("/upload", {
    method: "OPTIONS",
    headers: { Origin: "http://127.0.0.1:3000" },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), "http://127.0.0.1:3000");
  assert.equal(
    (await f.request("/", { headers: { Origin: "https://example.org" } })).headers.get(
      "Access-Control-Allow-Origin",
    ),
    null,
  );
  const migration = await f.request("/migrate", {
    method: "POST",
    headers: { "x-migrate-secret": "migration" },
    body: JSON.stringify({ keys: ["arquivo.txt"] }),
  });
  assert.deepEqual(await migration.json(), {
    results: [{ key: "arquivo.txt", ok: true, size: 8, contentType: "text/plain" }],
  });
  const head = await f.request("/object?path=arquivo.txt", { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("x-size"), "8");
  assert.deepEqual(
    await (await f.request("/object?path=arquivo.txt", { method: "DELETE" })).json(),
    { path: "arquivo.txt", deleted: true },
  );
  assert.equal((await f.request("/object?path=arquivo.txt", { method: "HEAD" })).status, 404);
});

test("usage paginates R2, caches results and requires an admin", async (t) => {
  const f = fixture(
    t,
    [
      ["a.txt", 5],
      ["b.txt", 7],
      ["c.txt", 3],
    ],
    { pageSize: 2 },
  );
  const limitBytes = 5 * 1024 ** 3;
  const expected = { usedBytes: 15, limitBytes, objectCount: 3, freeBytes: limitBytes - 15 };
  assert.equal((await f.request("/usage", { headers: { Authorization: "" } })).status, 401);
  assert.deepEqual(await (await f.request("/usage")).json(), expected);
  assert.equal(f.listCalls, 2);
  assert.equal(f.data.get("usage:total").expirationTtl, 60);
  assert.deepEqual(await (await f.request("/usage")).json(), expected);
  assert.equal(f.listCalls, 2);
  f.putObject("d.txt", 4);
  const fresh = await (await f.request("/usage?fresh=1")).json();
  assert.equal(fresh.usedBytes, 19);
  assert.equal(fresh.objectCount, 4);
});

test("raw upload checks fresh usage and allows overwrites within the limit", async (t) => {
  const f = fixture(t, [
    ["a.txt", 6],
    ["b.txt", 3],
  ]);
  f.env.STORAGE_LIMIT_BYTES = "10";
  await f.env.STATE.put("usage:total", JSON.stringify({ usedBytes: 0, objectCount: 0 }));
  const rejected = await f.request("/upload?path=new.txt", upload("12"));
  assert.equal(rejected.status, 413);
  assert.deepEqual(await rejected.json(), {
    error: "storage_full",
    message:
      "O espaço do site acabou (limite de 5 GB). Apague materiais antigos ou fale com o Carlos antes de enviar mais.",
    usedBytes: 9,
    limitBytes: 10,
  });
  const accepted = await f.request("/upload?path=a.txt", upload("1234567", "POST"));
  assert.equal(accepted.status, 200);
  assert.deepEqual(await accepted.json(), { path: "a.txt", url: `${R2_PUBLIC}/a.txt`, size: 7 });
  assert.equal(f.data.has("usage:total"), false);
  assert.deepEqual(await (await f.request("/usage")).json(), {
    usedBytes: 10,
    limitBytes: 10,
    objectCount: 2,
    freeBytes: 0,
  });
  await f.request("/object?path=b.txt", { method: "DELETE" });
  assert.equal(f.data.has("usage:total"), false);
  assert.equal((await (await f.request("/usage")).json()).usedBytes, 7);
  const tooLarge = await f.request("/upload?path=new.txt", {
    ...upload("1"),
    headers: { "Content-Length": String(201 * 1024 ** 2) },
  });
  assert.equal(tooLarge.status, 413);
  assert.deepEqual(await tooLarge.json(), { error: "file too large" });
});

test("multipart upload enforces storage while unknown-length raw upload streams", async (t) => {
  const f = fixture(t, [["existing", 5]]);
  f.env.STORAGE_LIMIT_BYTES = "8";
  const form = new FormData();
  form.set("file", new Blob(["1234"], { type: "text/plain" }), "new.txt");
  form.set("path", "novo arquivo.txt");
  const response = await f.request("/upload", { method: "POST", body: form });
  assert.equal(response.status, 413);
  assert.equal((await response.json()).error, "storage_full");
  form.set("file", new Blob(["123"], { type: "text/plain" }), "new.txt");
  assert.deepEqual(await (await f.request("/upload", { method: "POST", body: form })).json(), {
    path: "novo arquivo.txt",
    url: `${R2_PUBLIC}/novo%20arquivo.txt`,
    size: 3,
  });
  const size = 8 * 1024 ** 2 + 9;
  const raw = new Blob([new Uint8Array(size)]).stream();
  const streamed = await f.request("/upload", {
    method: "PUT",
    body: raw,
    duplex: "half",
    headers: { "x-file-path": "streamed.bin" },
  });
  assert.equal(streamed.status, 200);
  assert.equal((await streamed.json()).size, size);
  assert.equal(f.multipartParts, 2);
});

test("Google endpoints return a friendly 503 without OAuth secrets and cron is a no-op", async (t) => {
  const f = fixture(t);
  delete f.env.GOOGLE_CLIENT_SECRET;
  for (const path of [
    "/google/auth-start",
    "/google/callback",
    "/google/status",
    "/drive/folders",
  ]) {
    const response = await f.request(path);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, "google_not_configured");
  }
  for (const path of ["/drive/folders", "/drive/upload-session", "/backup/run"]) {
    const response = await f.request(path, { method: "POST" });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, "google_not_configured");
  }
  await worker.scheduled({}, f.env);
  assert.equal(f.calls.length, 0);
  assert.equal(f.listCalls, 0);
});

test("OAuth rejects the wrong Google email and consumes state", async (t) => {
  const f = fixture(t, [], { googleEmail: "outra@example.com" });
  const start = await f.request("/google/auth-start");
  assert.equal(start.status, 302);
  const google = new URL(start.headers.get("Location"));
  const state = google.searchParams.get("state");
  assert.equal(
    google.searchParams.get("scope"),
    "openid email https://www.googleapis.com/auth/drive.file",
  );
  assert.equal(google.searchParams.get("login_hint"), "admin@example.com");
  assert.equal(google.searchParams.get("access_type"), "offline");
  assert.equal(google.searchParams.get("prompt"), "consent");
  assert.equal(f.data.get(`oauth_state:${state}`).expirationTtl, 900);
  const callback = await f.request(`/google/callback?state=${state}&code=code`);
  assert.equal(callback.status, 403);
  assert.match(await callback.text(), /Use a conta Google da Tia Vanete/);
  assert.equal(f.data.has("google:refresh_token"), false);
  assert.equal(f.data.has(`oauth_state:${state}`), false);
  assert.equal((await f.request(`/google/callback?state=${state}&code=code`)).status, 400);
});

test("OAuth accepts the configured email regardless of case", async (t) => {
  const f = fixture(t);
  const start = new URL((await f.request("/google/auth-start")).headers.get("Location"));
  const callback = await f.request(
    `/google/callback?state=${start.searchParams.get("state")}&code=code`,
  );
  assert.equal(callback.status, 200);
  assert.match(await callback.text(), /Pronto! ✅/);
  const status = await (await f.request("/google/status")).json();
  assert.deepEqual(status, {
    configured: true,
    connected: true,
    email: "ADMIN@example.com",
    needsReauth: false,
    lastBackup: null,
    health: {
      status: "ok",
      problem: null,
      message: null,
      action: null,
      actionUrl: null,
      lastSuccessAt: null,
      emailConfigured: false,
      lastAlertAt: null,
    },
    alertEmail: {
      enabled: false,
      sender: "Sender@Example.com",
      to: "admin@example.com",
      authorized: false,
      needsReauth: false,
      authUrl: `${WORKER_URL}/google/alert-sender/auth-start`,
    },
  });
});

test("invalid_grant requires reconnecting the Drive", async (t) => {
  const f = fixture(t, [], { invalidGrant: true });
  await f.connect();
  const response = await f.request("/drive/folders");
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, "google_needs_reauth");
  const status = await (await f.request("/google/status")).json();
  assert.equal(status.connected, false);
  assert.equal(status.needsReauth, true);
  assert.equal(f.data.has("google:access_token"), false);
});

test("backup copies only new and changed keys, files by material, and respects the fetch budget", async (t) => {
  const files = [
    ["0-unchanged.pdf", 4, "same"],
    ["1/folha.pdf", 5, "new"],
    ["2/capa com espaço.png", 6],
    ["3/folha.pdf", 7],
    ...Array.from({ length: 20 }, (_, i) => [`outros/${i}.txt`, 3]),
  ];
  const f = fixture(t, files, {
    pageSize: 10,
    materials: [
      {
        category: "pdfs",
        title: "Lição / Abril",
        file_path: "1/folha.pdf",
        cover_url: `${R2_PUBLIC}/2/capa%20com%20espa%C3%A7o.png`,
      },
      { category: "pdfs", title: "Lição / Abril", file_url: `${R2_PUBLIC}/3/folha.pdf` },
    ],
  });
  await f.connect();
  await f.env.STATE.put(
    "backup:0-unchanged.pdf",
    JSON.stringify({ etag: "same", driveId: "existing" }),
  );
  await f.env.STATE.put("backup:1/folha.pdf", JSON.stringify({ etag: "old", driveId: "previous" }));
  const response = await f.request("/backup/run", { method: "POST" });
  assert.equal(response.status, 200);
  const first = await response.json();
  assert.ok(first.copied >= 9 && first.remaining > 0);
  assert.equal(first.failed, 0);
  assert.equal(first.copied + first.remaining, files.length - 1);
  assert.ok(f.calls.length <= 40, `Chamadas externas: ${f.calls.length}`);
  assert.equal(f.calls.filter(({ url }) => url.pathname === "/rest/v1/materials").length, 1);
  assert.deepEqual(
    f.copies.slice(0, 3).map(({ name }) => name),
    ["Lição - Abril.pdf", "Lição - Abril.png", "Lição - Abril (2).pdf"],
  );
  assert.deepEqual(
    [...f.folders.values()].map(({ name }) => name),
    ["Backup Site Tia Vanete", "PDFs", "Capas", "Outros"],
  );
  const record = await f.env.STATE.get("backup:1/folha.pdf", "json");
  assert.ok(record.driveId && record.at);
  assert.equal(record.etag, "new");
  assert.equal(record.size, 5);
  assert.ok(!f.copies.some(({ description }) => description === "R2: 0-unchanged.pdf"));

  let calls = f.calls.length;
  await worker.scheduled({}, f.env);
  assert.ok(f.calls.length - calls <= 40);
  while ((await f.env.STATE.get("backup:last", "json")).remaining > 0) {
    const total = f.copies.length;
    await worker.scheduled({}, f.env);
    assert.ok(f.copies.length > total);
  }
  assert.equal(f.copies.length, files.length - 1);
  assert.equal(f.calls.filter(({ url }) => url.host === "oauth2.googleapis.com").length, 2);

  calls = f.calls.length;
  await worker.scheduled({}, f.env);
  assert.equal(f.calls.length - calls, 0);
  assert.equal(f.copies.length, files.length - 1);
  const status = await (await f.request("/google/status")).json();
  assert.deepEqual(status.lastBackup, {
    at: (await f.env.STATE.get("backup:last", "json")).at,
    copied: 0,
    failed: 0,
    remaining: 0,
  });
});

test("backup logs and tracks failures without marking the key as copied", async (t) => {
  t.mock.method(console, "error", () => {});
  const f = fixture(
    t,
    [
      ["erro.txt", 5],
      ["ok.txt", 2],
    ],
    { failKey: "erro.txt" },
  );
  await f.connect();
  await worker.scheduled({}, f.env);
  const last = await f.env.STATE.get("backup:last", "json");
  assert.equal(last.copied, 1);
  assert.equal(last.failed, 1);
  assert.equal(last.remaining, 1);
  assert.deepEqual(last.errors, [{ key: "erro.txt", error: "Google Drive: 503" }]);
  assert.equal(f.data.has("backup:erro.txt"), false);
  assert.equal(f.data.has("backup:ok.txt"), true);
  assert.equal(console.error.mock.callCount(), 1);
});

test("backup streams a 200 MiB R2 object in one Drive PUT", async (t) => {
  const f = fixture(t);
  const chunk = new Uint8Array(1024 ** 2);
  let emitted = 0;
  f.putObject(
    "arquivo-grande.pdf",
    200 * chunk.length,
    "large-etag",
    () =>
      new ReadableStream({
        pull(controller) {
          controller.enqueue(chunk);
          if (++emitted === 200) controller.close();
        },
      }),
  );
  await f.connect();
  await worker.scheduled({}, f.env);
  assert.equal(emitted, 200);
  assert.equal(f.calls.filter(({ method }) => method === "PUT").length, 1);
  assert.equal(
    (await f.env.STATE.get("backup:arquivo-grande.pdf", "json")).size,
    200 * chunk.length,
  );
});

test("personal folders are managed under the upload root and sessions forward the browser Origin", async (t) => {
  const f = fixture(t);
  await f.connect();
  const post = (body) => ({ method: "POST", body: JSON.stringify(body) });
  const initial = await (await f.request("/drive/folders")).json();
  assert.equal(initial.root.name, "Arquivos da Tia Vanete");
  assert.deepEqual(initial.folders, []);
  assert.equal((await f.request("/drive/folders", post({ name: " " }))).status, 400);
  const creating = await f.request("/drive/folders", post({ name: " Receitas " }));
  assert.equal(creating.status, 201);
  const created = await creating.json();
  assert.equal(created.name, "Receitas");
  assert.equal(f.folders.get(created.id).mimeType, FOLDER_TYPE);
  assert.deepEqual((await (await f.request("/drive/folders")).json()).folders, [created]);
  const size = 3 * 1024 ** 3;
  const file = { folderId: created.id, name: "receitas.pdf", mimeType: "application/pdf", size };
  assert.equal(
    (await f.request("/drive/upload-session", post({ ...file, folderId: "fora" }))).status,
    400,
  );
  const response = await f.request("/drive/upload-session", post(file));
  assert.equal(response.status, 200);
  const session = f.sessions.get((await response.json()).uploadUrl);
  assert.equal(session.headers.get("Origin"), FRONTEND_ORIGIN);
  assert.equal(session.headers.get("X-Upload-Content-Length"), String(size));
  assert.deepEqual(session.parents, [created.id]);
  assert.equal(f.copies.length, 0);
  assert.equal(f.listCalls, 0);

  f.folders.delete(initial.root.id);
  const recovered = await (await f.request("/drive/folders")).json();
  assert.notEqual(recovered.root.id, initial.root.id);
  assert.deepEqual(recovered.folders, []);
});

test("backup uses all category folders and recovers existing Drive items after KV loss", async (t) => {
  const f = fixture(
    t,
    [
      ["a.txt", 1],
      ["avatar.png", 2],
      ["c.png", 3],
      ["i.png", 4],
      ["p.pdf", 5],
      ["v.mp4", 6],
    ],
    {
      materials: [
        {
          category: "mensagens",
          title: "Oração",
          file_path: "a.txt",
          cover_url: `${R2_PUBLIC}/c.png`,
        },
        { category: "imagens", title: "Flores", file_path: "i.png" },
        { category: "pdfs", title: "Leitura", file_path: "p.pdf" },
        { category: "vídeos-curtos", title: "Vídeo", file_path: "v.mp4" },
      ],
    },
  );
  await f.connect();
  await worker.scheduled({}, f.env);
  function folderPath(id) {
    const { name, parents } = f.folders.get(id);
    return parents ? `${folderPath(parents[0])}/${name}` : name;
  }
  assert.deepEqual(
    f.copies.map(({ name, parents }) => `${folderPath(parents[0])}/${name}`),
    [
      "Backup Site Tia Vanete/Mensagens/Oração.txt",
      "Backup Site Tia Vanete/Outros/avatar.png",
      "Backup Site Tia Vanete/Mensagens/Capas/Oração.png",
      "Backup Site Tia Vanete/Imagens/Flores.png",
      "Backup Site Tia Vanete/PDFs/Leitura.pdf",
      "Backup Site Tia Vanete/Vídeos curtos/Vídeo.mp4",
    ],
  );
  for (const key of f.data.keys()) {
    if (key.startsWith("folder:") || /^(backup:).+\./.test(key)) f.data.delete(key);
  }
  await worker.scheduled({}, f.env);
  assert.equal(f.copies.length, 6);
  assert.equal(f.folders.size, 7);
  assert.equal((await f.env.STATE.get("backup:last", "json")).remaining, 0);
});

test("daily token check with an empty bucket detects revocation and throttles the Gmail alert for 24h", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-19T06:00:00Z") });
  const options = {};
  const f = fixture(t, [], options);
  await f.authorizeSender();
  f.env.ALERT_EMAIL_TO = "vanete@example.com";
  f.env.ALERT_CC = "carlos@example.com";
  await f.connect();
  await worker.scheduled({}, f.env);
  const original = (await f.env.STATE.get("backup:last", "json")).health;
  assert.equal(original.lastSuccessAt, "2026-11-19T06:00:00.000Z");
  assert.equal(original.lastRunAt, original.lastSuccessAt);
  assert.equal(original.failedRuns, 0);
  assert.equal(f.emails.length, 0);

  options.invalidGrant = true;
  t.mock.timers.setTime(Date.parse("2026-11-20T06:00:00Z"));
  await worker.scheduled({}, f.env);
  const status = await (await f.request("/google/status")).json();
  assert.equal(status.connected, false);
  assert.equal(status.needsReauth, true);
  assert.equal(status.health.status, "error");
  assert.equal(status.health.problem, "google_needs_reauth");
  assert.equal(status.health.actionUrl, `${WORKER_URL}/google/auth-start`);
  assert.equal(status.health.lastSuccessAt, original.lastSuccessAt);
  assert.equal(status.health.emailConfigured, true);
  assert.equal(status.health.lastAlertAt, "2026-11-20T06:00:00.000Z");
  const [mail] = f.emails;
  assert.equal(mail.method, "POST");
  assert.equal(mail.httpHeaders.get("Authorization"), "Bearer sender-access");
  assert.equal(mail.httpHeaders.get("Content-Type"), "application/json");
  assert.equal(mail.headers.from, "Site Tia Vanete <Sender@Example.com>");
  assert.equal(mail.from, "Site Tia Vanete <Sender@Example.com>");
  assert.equal(mail.headers.to, "vanete@example.com");
  assert.equal(mail.headers.cc, "carlos@example.com");
  assert.match(mail.headers.subject, /^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
  assert.equal(mail.subject, "Aviso sobre a cópia no Google Drive");
  assert.match(mail.headers["content-type"], /^multipart\/alternative; boundary=/);
  assert.equal(mail.headers["mime-version"], "1.0");
  assert.match(mail.text, /Abra este link e clique em Permitir/);
  assert.ok(mail.text.includes(status.health.actionUrl));
  assert.ok(mail.html.includes(status.health.actionUrl));
  assert.match(mail.html, /22px/);
  const alert = await f.env.STATE.get("backup:alert", "json");
  assert.equal(alert.result, "sent");
  assert.equal(alert.provider, "gmail");

  t.mock.timers.setTime(Date.parse("2026-11-21T05:59:59Z"));
  await worker.scheduled({}, f.env);
  assert.equal(f.emails.length, 1);
  t.mock.timers.setTime(Date.parse("2026-11-21T06:00:00Z"));
  await worker.scheduled({}, f.env);
  assert.equal(f.emails.length, 2);
});

test("Google Drive 401 requests reconnection and a storage quota error asks for more space", async (t) => {
  t.mock.method(console, "error", () => {});
  const options = { uploadStatus: 403, uploadReason: "storageQuotaExceeded" };
  const f = fixture(t, [["arquivo.txt", 1]], options);
  await f.authorizeSender();
  await f.connect();
  await f.request("/backup/run", { method: "POST" });
  let status = await (await f.request("/google/status")).json();
  assert.equal(status.health.problem, "drive_full");
  assert.equal(status.health.status, "error");
  assert.equal(f.emails.length, 0);
  await worker.scheduled({}, f.env);
  assert.equal(f.emails[0].headers.to, "admin@example.com");
  assert.equal("cc" in f.emails[0].headers, false);
  assert.match(f.emails[0].text, /Libere espaço.*Google One/);
  options.uploadStatus = 401;
  await worker.scheduled({}, f.env);
  status = await (await f.request("/google/status")).json();
  assert.equal(status.health.problem, "google_needs_reauth");
  assert.equal(status.needsReauth, true);
  assert.equal(f.emails.length, 1);
});

test("repeated errors warn on the third failure and a clean run clears health", async (t) => {
  t.mock.method(console, "error", () => {});
  const options = { failKey: "arquivo.txt" };
  const f = fixture(t, [["arquivo.txt", 1]], options);
  await f.authorizeSender();
  await f.connect();
  for (let failures = 1; failures <= 3; failures++) {
    await worker.scheduled({}, f.env);
    const { health } = await f.env.STATE.get("backup:last", "json");
    assert.equal(health.failedRuns, failures);
    assert.equal(health.lastSuccessAt, null);
    assert.equal(f.emails.length, failures < 3 ? 0 : 1);
  }
  assert.match(f.emails[0].text, /Seus arquivos no site estão seguros.*Carlos/);
  options.failKey = null;
  await worker.scheduled({}, f.env);
  const { health } = await f.env.STATE.get("backup:last", "json");
  assert.equal(health.failedRuns, 0);
  assert.ok(health.lastSuccessAt);
  assert.equal(health.problem, null);
});

test("stale warning starts after 48 hours even if the next run fails before any upload", async (t) => {
  t.mock.method(console, "error", () => {});
  const start = Date.parse("2026-11-19T06:00:00Z");
  t.mock.timers.enable({ apis: ["Date"], now: start });
  const options = {};
  const f = fixture(t, [], options);
  await f.authorizeSender();
  await f.connect();
  await worker.scheduled({}, f.env);
  t.mock.timers.setTime(start + 48 * 60 * 60 * 1000);
  const status = async () => (await (await f.request("/google/status")).json()).health;
  assert.equal((await status()).status, "ok");
  t.mock.timers.tick(1);
  assert.equal((await status()).problem, "stale");
  options.tokenStatus = 503;
  await worker.scheduled({}, f.env);
  assert.equal((await status()).problem, "stale");
  assert.equal((await f.env.STATE.get("backup:last", "json")).health.problem, "stale");
  assert.match(f.emails[0].text, /mais de dois dias.*\n\nSeus arquivos no site estão seguros/);
});

test("scheduled alerts require Google configuration, a connection, and an email provider", async (t) => {
  t.mock.method(console, "info", () => {});
  const f = fixture(t, [], { invalidGrant: true });
  await f.authorizeSender();
  await worker.scheduled({}, f.env);
  assert.equal(f.calls.length, 0);
  await f.connect();
  delete f.env.GOOGLE_CLIENT_ID;
  await worker.scheduled({}, f.env);
  assert.equal(f.calls.length, 0);
  f.env.GOOGLE_CLIENT_ID = "client";
  await f.env.STATE.delete("alert_sender:refresh_token");
  await worker.scheduled({}, f.env);
  const status = await (await f.request("/google/status")).json();
  assert.equal(status.health.emailConfigured, false);
  assert.equal(status.health.problem, "google_needs_reauth");
  assert.equal(f.emails.length, 0);
  assert.equal(f.data.has("backup:alert"), false);
});

test("a rejected email records the failure and leaves lastAlertAt empty", async (t) => {
  const f = fixture(t, [], { invalidGrant: true, mailStatus: 403 });
  await f.authorizeSender();
  await f.connect();
  await worker.scheduled({}, f.env);
  await worker.scheduled({}, f.env);
  const alert = await f.env.STATE.get("backup:alert", "json");
  assert.equal(alert.result, "failed");
  assert.equal(alert.lastAlertAt, null);
  assert.ok(alert.lastAttemptAt);
  assert.equal(f.emails.length, 1);
});

test("Drive authorization asks only for Drive scopes, never gmail.send", async (t) => {
  const f = fixture(t);
  const start = new URL((await f.request("/google/auth-start")).headers.get("Location"));
  assert.equal(
    start.searchParams.get("scope"),
    "openid email https://www.googleapis.com/auth/drive.file",
  );
  assert.doesNotMatch(start.href, /gmail/);
});

test("alert sender flow accepts only ALERT_SENDER_EMAIL and stores its own token", async (t) => {
  const options = {
    googleEmail: "outra@example.com",
    callbackRefresh: "sender-token",
    grantedScope: "openid email https://www.googleapis.com/auth/gmail.send",
  };
  const f = fixture(t, [], options);
  const response = await f.request("/google/alert-sender/auth-start");
  assert.equal(response.status, 302);
  const start = new URL(response.headers.get("Location"));
  assert.equal(
    start.searchParams.get("scope"),
    "openid email https://www.googleapis.com/auth/gmail.send",
  );
  assert.equal(start.searchParams.get("redirect_uri"), `${WORKER_URL}/google/callback`);
  assert.equal(start.searchParams.get("login_hint"), "Sender@Example.com");
  assert.equal(start.searchParams.get("access_type"), "offline");
  assert.equal(start.searchParams.has("include_granted_scopes"), false);
  let state = start.searchParams.get("state");
  assert.equal(f.data.get(`oauth_sender_state:${state}`).expirationTtl, 900);
  assert.equal(f.data.has(`oauth_state:${state}`), false);

  let callback = await f.request(`/google/callback?state=${state}&code=code`);
  assert.equal(callback.status, 403);
  assert.match(await callback.text(), /Sender@Example.com/);
  assert.equal(f.data.has("alert_sender:refresh_token"), false);
  assert.equal(f.data.has(`oauth_sender_state:${state}`), false);

  options.googleEmail = "SENDER@example.com";
  state = new URL(
    (await f.request("/google/alert-sender/auth-start")).headers.get("Location"),
  ).searchParams.get("state");
  callback = await f.request(`/google/callback?state=${state}&code=code`);
  assert.equal(callback.status, 200);
  assert.match(await callback.text(), /Pronto! ✅/);
  const sender = await f.env.STATE.get("alert_sender:refresh_token", "json");
  assert.equal(sender.token, "sender-token");
  assert.equal(sender.email, "SENDER@example.com");
  assert.equal(f.data.has("google:refresh_token"), false);
  const status = await (await f.request("/google/status")).json();
  assert.equal(status.alertEmail.enabled, true);
  assert.equal(status.alertEmail.authorized, true);
  assert.equal(status.connected, false);
});

test("alert sender flow rejects a grant without gmail.send", async (t) => {
  const f = fixture(t, [], {
    googleEmail: "sender@example.com",
    grantedScope: "openid email",
  });
  const state = new URL(
    (await f.request("/google/alert-sender/auth-start")).headers.get("Location"),
  ).searchParams.get("state");
  const callback = await f.request(`/google/callback?state=${state}&code=code`);
  assert.equal(callback.status, 403);
  assert.equal(f.data.has("alert_sender:refresh_token"), false);
});

test("a revoked sender token turns the e-mail alert off and shows it in /google/status", async (t) => {
  t.mock.method(console, "warn", () => {});
  t.mock.method(console, "info", () => {});
  const f = fixture(t, [], { invalidGrant: true, senderInvalidGrant: true });
  await f.connect();
  await f.authorizeSender();
  await worker.scheduled({}, f.env);
  assert.equal(f.emails.length, 0);
  const alert = await f.env.STATE.get("backup:alert", "json");
  assert.equal(alert.result, "failed");
  assert.equal(alert.lastAlertAt, null);
  const status = await (await f.request("/google/status")).json();
  assert.equal(status.alertEmail.enabled, false);
  assert.equal(status.alertEmail.authorized, true);
  assert.equal(status.alertEmail.needsReauth, true);
  assert.equal(status.health.emailConfigured, false);
  assert.equal(status.health.problem, "google_needs_reauth");
  // Re-authorizing (new connection id) turns it back on.
  await f.env.STATE.put(
    "alert_sender:refresh_token",
    JSON.stringify({ token: "sender-token", email: "sender@example.com", connectionId: "novo" }),
  );
  assert.equal((await (await f.request("/google/status")).json()).alertEmail.enabled, true);
});
