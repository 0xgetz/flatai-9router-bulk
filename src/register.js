#!/usr/bin/env node
// Flat AI single-account registration + credential capture.
// Pure HTTP, no browser. Mirrors the site's own flow:
//   1. Firebase Identity Toolkit signupNewUser  -> idToken + refreshToken
//   2. POST admin-ajax.php action=flat_register_email with the idToken
//      (WordPress creates the user and returns Set-Cookie session cookies)

const FIREBASE_KEY = "AIzaSyA60wVELx0FY_HEN8YlNlrGlMDKYOPm87s";
const AJAX_URL = "https://flatai.org/wp-admin/admin-ajax.php";

function ua() {
  return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";
}

// ---- mail.tm disposable inbox ----
async function createInbox() {
  const domains = await (await fetch("https://api.mail.tm/domains")).json();
  const domain = domains["hydra:member"].find((d) => d.isActive).domain;
  const user = randName(8);
  const address = `${user}@${domain}`;
  const password = `Pa55_${randName(14)}`;
  const res = await fetch("https://api.mail.tm/accounts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address, password }),
  });
  if (!res.ok) throw new Error(`mail.tm account ${res.status}: ${await res.text()}`);
  const tok = await (
    await fetch("https://api.mail.tm/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, password }),
    })
  ).json();
  return { address, password, token: tok.token, id: tok.id };
}

function randName(n) {
  const c = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < n; i++) s += c[Math.floor(Math.random() * c.length)];
  return s[0].match(/[a-z]/) ? s : "u" + s.slice(1);
}

// ---- Firebase REST ----
async function firebaseSignup(email, password) {
  const res = await fetch(
    `https://www.googleapis.com/identitytoolkit/v3/relyingparty/signupNewUser?key=${FIREBASE_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": ua() },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    }
  );
  const j = await res.json();
  if (!res.ok) throw new Error(`firebase signup ${res.status}: ${JSON.stringify(j)}`);
  return j; // idToken, refreshToken, localId, expiresIn
}

async function firebaseSetName(idToken, name) {
  await fetch(
    `https://www.googleapis.com/identitytoolkit/v3/relyingparty/setAccountInfo?key=${FIREBASE_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": ua() },
      body: JSON.stringify({ idToken, displayName: name, returnSecureToken: true }),
    }
  );
}

async function firebaseRefresh(refreshToken) {
  const res = await fetch(`https://securetoken.googleapis.com/v1/token?key=${FIREBASE_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": ua() },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
  });
  if (!res.ok) throw new Error(`firebase refresh ${res.status}: ${await res.text()}`);
  return res.json();
}

// ---- Flat AI WordPress sync (returns Set-Cookie session) ----
async function flatCheckEmail(email, nonce, jar) {
  const body = new URLSearchParams({ action: "flat_check_email", email, nonce });
  const res = await fetch(AJAX_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": ua(),
      ...(jar.cookieHeader() ? { Cookie: jar.cookieHeader() } : {}),
    },
    body,
  });
  return res.json().catch(() => ({}));
}

async function flatRegister(idToken, nonce, jar) {
  const body = new URLSearchParams({ action: "flat_register_email", id_token: idToken, nonce });
  const res = await fetch(AJAX_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": ua(),
      ...(jar.cookieHeader() ? { Cookie: jar.cookieHeader() } : {}),
    },
    body,
  });
  jar.absorb(res.headers);
  const text = await res.text();
  let j = {};
  try { j = JSON.parse(text); } catch {}
  return { ok: res.ok && j.success === true, raw: text.slice(0, 300), data: j };
}

// ---- tiny cookie jar ----
class Jar {
  constructor() { this.map = new Map(); }
  absorb(headers) {
    const setCookies = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
    for (const sc of setCookies) {
      const [pair] = sc.split(";");
      const idx = pair.indexOf("=");
      if (idx > 0) this.map.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
    }
  }
  cookieHeader() {
    return [...this.map.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  toObject() { return Object.fromEntries(this.map); }
}

export async function registerAccount({ email, password, name, log = () => {} } = {}) {
  const jar = new Jar();
  let mailbox = null;

  if (!email) {
    mailbox = await createInbox();
    email = mailbox.address;
    password = password || mailbox.password;
    log(`inbox: ${email}`);
  }
  name = name || "Flat AI User";

  // warm up: get guest cookies + the page nonce (needed by admin-ajax actions)
  const warm = await fetch("https://flatai.org/register/", { headers: { "User-Agent": ua() } });
  jar.absorb(warm.headers);
  const warmHtml = await warm.text();
  const nonce = (warmHtml.match(/"nonce":"([a-f0-9]{8,12})"/) || [])[1];
  if (!nonce) throw new Error("could not extract page nonce");
  log(`nonce: ${nonce}`);

  await flatCheckEmail(email, nonce, jar).catch(() => {});

  const fb = await firebaseSignup(email, password);
  log(`firebase uid: ${fb.localId}`);
  await firebaseSetName(fb.idToken, name);

  const reg = await flatRegister(fb.idToken, nonce, jar);
  if (!reg.ok) throw new Error(`flat_register_email failed: ${reg.raw}`);
  log(`wordpress: ${reg.data?.message || "ok"}`);

  const cookies = jar.toObject();
  const hasSession = Object.keys(cookies).some((k) => k.startsWith("wordpress_logged_in_"));
  if (!hasSession) throw new Error(`no wordpress session cookie. got: ${Object.keys(cookies).join(",")}`);

  // Verify the session actually authenticates by reading the account page.
  const home = await fetch("https://flatai.org/", { headers: { "User-Agent": ua(), Cookie: jar.cookieHeader() } });
  const html = await home.text();
  const loggedIn = /flatAuth\s*=\s*\{[^}]*"isLoggedIn":"1"/.test(html) || /"isLoggedIn":"1"/.test(html);
  const uidMatch = html.match(/"userId":"(\d+)"/);
  const nonceMatch = html.match(/"nonce":"([a-f0-9]{8,12})"/);

  return {
    email,
    password,
    name,
    firebase: { localId: fb.localId, idToken: fb.idToken, refreshToken: fb.refreshToken },
    cookies,
    cookieHeader: jar.cookieHeader(),
    wordpress: { userId: uidMatch ? uidMatch[1] : null, loggedIn, nonce: nonceMatch ? nonceMatch[1] : null },
    mailbox,
    createdAt: new Date().toISOString(),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await registerAccount({ log: console.log });
  console.log(JSON.stringify(r, null, 2));
}
