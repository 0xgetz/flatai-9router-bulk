#!/usr/bin/env node
// Connect Flat AI accounts to a local 9Router instance.
//
// Two modes:
//  A) adapter mode (recommended): one "OpenAI compatible" node + one connection
//     that points at the Flat AI adapter (which pools every account behind one
//     OpenAI-compatible endpoint).  -> connectViaAdapter()
//  B) direct mode: one OpenAI-compatible node per account is NOT possible because
//     Flat AI is not OpenAI-shaped; use the adapter.
//
// Usage:
//   node connect-9router.js --base http://localhost:20128 --password 123456 \
//        --adapter http://localhost:8788
//
// Requires a running Flat AI adapter (adapter.js) for the connection to work.

import { readFile } from "node:fs/promises";

const UA = "flat-ai-9router-connector/1.0";

export async function login9router(base, password) {
  // 9Router issues an auth_token cookie; if login isn't required, calls still work.
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": UA },
    body: JSON.stringify({ password: password ?? "123456" }),
  });
  const setCookie = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  const cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
  const body = await res.text();
  return { ok: res.ok, cookie, body: body.slice(0, 200) };
}

async function api(base, cookie, path, init = {}) {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "User-Agent": UA,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, ok: res.ok, json, text: text.slice(0, 400) };
}

// Create the provider-node (custom OpenAI-compatible endpoint) once.
export async function ensureNode(base, cookie, { name, prefix, baseUrl }) {
  const list = await api(base, cookie, "/api/provider-nodes");
  const nodes = list.json?.nodes || [];
  const existing = nodes.find((n) => n.name === name || n.prefix === prefix);
  if (existing) {
    console.log(`provider-node exists: ${existing.id}`);
    return existing;
  }
  const created = await api(base, cookie, "/api/provider-nodes", {
    method: "POST",
    body: JSON.stringify({ name, prefix, apiType: "chat", type: "openai-compatible", baseUrl }),
  });
  if (!created.ok) throw new Error(`create node failed ${created.status}: ${created.text}`);
  console.log(`provider-node created: ${created.json.node.id}`);
  return created.json.node;
}

// Create a connection for the node with an arbitrary (non-empty) API key.
export async function ensureConnection(base, cookie, { nodeId, name, apiKey = "flatai", defaultModel }) {
  const list = await api(base, cookie, "/api/providers");
  const conns = list.json?.connections || [];
  const existing = conns.find((c) => c.provider === nodeId && c.name === name);
  if (existing) {
    console.log(`connection exists: ${existing.id} (${existing.name})`);
    return existing;
  }
  const created = await api(base, cookie, "/api/providers", {
    method: "POST",
    body: JSON.stringify({
      provider: nodeId,
      apiKey,
      name,
      priority: 1,
      defaultModel: defaultModel || null,
    }),
  });
  if (!created.ok && created.status !== 409) {
    throw new Error(`create connection failed ${created.status}: ${created.text}`);
  }
  console.log(`connection created: ${created.json?.connection?.id || "(conflict)"}`);
  return created.json?.connection;
}

// Convenience: full adapter-mode wiring.
export async function connectViaAdapter(accounts, { base, password, adapterUrl }) {
  const { cookie, ok, body } = await login9router(base, password);
  console.log(`9Router login: ${ok ? "ok" : "not required/failed"} ${ok ? "" : body}`);
  const node = await ensureNode(base, cookie, {
    name: "Flat AI",
    prefix: "flatai",
    baseUrl: `${adapterUrl.replace(/\/$/, "")}/v1`,
  });
  await ensureConnection(base, cookie, {
    nodeId: node.id,
    name: `Flat AI (${accounts.length} accounts)`,
    apiKey: "flatai",
    defaultModel: "flatai/account-1",
  });
  console.log(`\nDone. In 9Router use model: flatai/account-1 (provider prefix "flatai").`);
  console.log(`The adapter at ${adapterUrl} round-robins all ${accounts.length} accounts.`);
}

// Also allow one connection per account if the adapter exposes per-account models
// (same node, multiple keys is not supported for a single node; we keep the pool model).
export async function connectAll(accounts, opts) {
  return connectViaAdapter(accounts, opts);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = Object.fromEntries(
    process.argv.slice(2).reduce((a, v, i, arr) => {
      if (v.startsWith("--")) a.push([v.slice(2), arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : true]);
      return a;
    }, [])
  );
  const accountsFile = args.accounts || "accounts.json";
  let accounts = [];
  try { accounts = JSON.parse(await readFile(accountsFile, "utf8")); } catch {}
  await connectViaAdapter(accounts, {
    base: String(args.base || "http://localhost:20128"),
    password: args.password,
    adapterUrl: String(args.adapter || "http://localhost:8788"),
  });
}
