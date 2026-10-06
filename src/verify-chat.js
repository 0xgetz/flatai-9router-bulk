#!/usr/bin/env node
// Verify headless Flat AI chat end-to-end, mirroring the site's own client exactly:
//   session(nonce,history_nonce,scope) -> [history save] -> route -> my_chatbot (SSE)
// On 403 SESSION_EXPIRED the nonces are refreshed from chatbot2_session and retried.
import { readFile } from "node:fs/promises";

const FIREBASE_KEY = "AIzaSyA60wVELx0FY_HEN8YlNlrGlMDKYOPm87s";
const AJAX = "https://flatai.org/wp-admin/admin-ajax.php";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";

class Jar {
  constructor() { this.map = new Map(); }
  absorb(h) {
    const sc = typeof h.getSetCookie === "function" ? h.getSetCookie() : [];
    for (const c of sc) { const [p] = c.split(";"); const i = p.indexOf("="); if (i > 0) this.map.set(p.slice(0, i).trim(), p.slice(i + 1).trim()); }
  }
  header() { return [...this.map].map(([k, v]) => `${k}=${v}`).join("; "); }
  toObject() { return Object.fromEntries(this.map); }
}

export async function login(email, password) {
  const jar = new Jar();
  const page = await fetch("https://flatai.org/register/", { headers: { "User-Agent": UA } });
  jar.absorb(page.headers);
  const html = await page.text();
  const nonce = html.match(/"nonce":"([a-f0-9]{8,12})"/)[1];

  const fb = await (await fetch(`https://www.googleapis.com/identitytoolkit/v3/relyingparty/verifyPassword?key=${FIREBASE_KEY}`, {
    method: "POST", headers: { "Content-Type": "application/json", "User-Agent": UA },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  })).json();
  if (!fb.idToken) throw new Error("login failed: " + JSON.stringify(fb));

  const res = await fetch(AJAX, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA, Cookie: jar.header() },
    body: new URLSearchParams({ action: "flat_auth_email", id_token: fb.idToken, nonce }),
  });
  jar.absorb(res.headers);
  const body = await res.text();
  // chat needs its own cookies after login; fetch the chat page to warm them
  const chatPage = await fetch("https://flatai.org/free-ai-chatbot-no-registration/", { headers: { "User-Agent": UA, Cookie: jar.header() } });
  jar.absorb(chatPage.headers);
  await chatPage.text().catch(() => {});
  return { cookies: jar.toObject(), cookieHeader: jar.header(), raw: body.slice(0, 200), idToken: fb.idToken, refreshToken: fb.refreshToken };
}

export class ChatClient {
  constructor(session) {
    this.cookieHeader = session.cookieHeader;
    this.nonce = null;
    this.historyNonce = null;
    this.scope = null;
  }
  async session() {
    const fd = new FormData();
    fd.set("action", "chatbot2_session");
    const r = await fetch(AJAX, { method: "POST", headers: { "User-Agent": UA, Cookie: this.cookieHeader }, body: fd });
    const j = await r.json();
    if (!j.success) throw new Error("session failed: " + JSON.stringify(j).slice(0, 200));
    this.nonce = j.data.nonce;
    this.historyNonce = j.data.history_nonce;
    this.scope = j.data.storage_scope;
    this.member = j.data.member === true;
    return j.data;
  }
  // request() with auto nonce-refresh on 403, exactly like the site.
  async request(init, path) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const fd = init();
      if (path) fd.set("nonce", this.nonce);
      if (path && ["chatbot2_history", "chatbot2_asset", "chatbot2_memory", "chatbot2_route", "chatbot2_dismiss_legacy_notice", "my_chatbot", "generate_image_chatbot2"].includes(fd.get("action"))) {
        fd.set("history_nonce", this.historyNonce);
      }
      const r = await fetch(AJAX, { method: "POST", headers: { "User-Agent": UA, Cookie: this.cookieHeader }, body: fd });
      if (r.status === 403) {
        const b = await r.clone().json().catch(() => ({}));
        if (b?.data?.code === "SESSION_EXPIRED" && attempt < 2) { await this.session(); continue; }
      }
      return r;
    }
  }
}

export async function chat(client, text, system) {
  const systemMessage = system || "Use the Flat AI house voice.";
  await client.session();
  const chatId = "chat_" + crypto.randomUUID();
  const uuid = crypto.randomUUID();
  const userMsg = { role: "user", content: text, requestId: uuid, mode: "chat", pending: false, attachment: null, requestContext: { style: systemMessage } };

  // 1) load existing history snapshot + revision (optimistic lock)
  const loadRes = await client.request(() => {
    const fd = new FormData(); fd.set("action", "chatbot2_history"); fd.set("operation", "load"); return fd;
  }, true);
  const loadBody = await loadRes.json().catch(() => ({}));
  let revision = loadBody?.data?.revision || "new";
  let values = loadBody?.data?.values || { allChats: "{}", chatToFolderMap: "{}" };

  // 2) merge our new conversation into the snapshot and save
  let allChats = {};
  try { allChats = JSON.parse(values.allChats || "{}"); } catch {}
  allChats[chatId] = { timestamp: new Date().toISOString(), title: text.slice(0, 40), messages: [userMsg] };
  const saveValues = { ...values, allChats: JSON.stringify(allChats) };
  const histRes = await client.request(() => {
    const fd = new FormData(); fd.set("action", "chatbot2_history"); fd.set("operation", "save");
    fd.set("values", JSON.stringify(saveValues)); fd.set("revision", revision); return fd;
  }, true);
  const histBody = await histRes.json().catch(() => ({}));
  if (histBody?.data?.revision) revision = histBody.data.revision;

  // 3) route (mode decision)
  const routeRes = await client.request(() => {
    const fd = new FormData(); fd.set("action", "chatbot2_route"); fd.set("request_id", uuid); fd.set("chat_id", chatId); return fd;
  }, true);
  const routeBody = await routeRes.json().catch(() => ({}));

  // 4) chat (SSE)
  const res = await client.request(() => {
    const fd = new FormData(); fd.set("action", "my_chatbot"); fd.set("request_id", uuid); fd.set("chat_id", chatId);
    fd.set("messages", JSON.stringify([{ role: "user", content: text }]));
    fd.set("system_message_content", systemMessage); return fd;
  }, true);

  const stream = await res.text();
  const chunks = [];
  for (const line of stream.split("\n")) {
    if (line.startsWith("data:")) {
      const d = line.slice(5).trim();
      if (!d || d === "[DONE]") continue;
      try { const j = JSON.parse(d); const c = j.content ?? j.delta ?? j.text ?? j.token; if (typeof c === "string") chunks.push(c); } catch {}
    }
  }
  return { chatId, scope: client.scope, histOk: histBody?.success, histCode: histBody?.data?.code, routeMode: routeBody?.data?.mode, raw: stream.slice(0, 600), reply: chunks.join("") };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cred = JSON.parse(await readFile(process.argv[2] || "/tmp/last_acct.json", "utf8"));
  const session = await login(cred.email, cred.password);
  console.log("cookies:", Object.keys(session.cookies));
  const client = new ChatClient(session);
  const out = await chat(client, "Reply with exactly one word: PONG");
  console.log("member:", client.member, "scope:", out.scope);
  console.log("history ok:", out.histOk, "route mode:", out.routeMode);
  console.log("raw:", out.raw);
  console.log("REPLY:", out.reply);
}
