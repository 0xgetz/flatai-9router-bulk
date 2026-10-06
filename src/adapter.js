#!/usr/bin/env node
// Flat AI -> OpenAI-compatible adapter.
// Exposes /v1/chat/completions (+ /v1/models) so 9Router can treat a pool of
// Flat AI accounts as one "OpenAI compatible" provider.
//
// Each stored account contributes a model id `flatai/<n>`; the adapter rotates
// accounts (round-robin) and retries the next account on failure.
//
// Usage:
//   node adapter.js                         # port 8788
//   PORT=9000 ACCOUNTS=accounts.json node adapter.js
//   FLATAI_MODE=Balanced node adapter.js    # Fast | Balanced | Professional

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { login, ChatClient, chat } from "./verify-chat.js";

const PORT = Number(process.env.PORT || 8788);
const ACCOUNTS_FILE = process.env.ACCOUNTS || "accounts.json";
const MODE = process.env.FLATAI_MODE || "Balanced";

let accounts = [];
let cursor = 0;
const clients = new Map(); // email -> ChatClient

async function loadAccounts() {
  accounts = JSON.parse(await readFile(ACCOUNTS_FILE, "utf8"));
  console.log(`loaded ${accounts.length} account(s) from ${ACCOUNTS_FILE}`);
}

// Get (or lazily build) an authenticated ChatClient for an account.
async function getClient(acct) {
  let c = clients.get(acct.email);
  if (c) return c;
  const session = await login(acct.email, acct.password);
  acct.cookies = session.cookies;
  acct.cookieHeader = session.cookieHeader;
  c = new ChatClient(session);
  clients.set(acct.email, c);
  return c;
}

function pickAccounts(n) {
  const out = [];
  for (let i = 0; i < n && i < accounts.length; i++) {
    out.push(accounts[(cursor + i) % accounts.length]);
  }
  cursor = (cursor + 1) % Math.max(1, accounts.length);
  return out;
}

function messagesToFlat(messages) {
  const sys = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n").trim();
  const convo = messages.filter((m) => m.role !== "system");
  const last = convo[convo.length - 1];
  return {
    prompt: typeof last?.content === "string" ? last.content : JSON.stringify(last?.content ?? ""),
    system: sys || "Use the Flat AI house voice.",
  };
}

// Ask Flat AI and collect the streamed answer.
async function askFlat(acct, prompt, system) {
  const client = await getClient(acct);
  const out = await chat(client, prompt, system);
  return out.reply || out.raw;
}

async function withFailover(prompt, system) {
  const tried = [];
  for (const acct of pickAccounts(accounts.length)) {
    try {
      const reply = await askFlat(acct, prompt, system);
      return { reply, account: acct.email };
    } catch (e) {
      tried.push(`${acct.email}: ${e.message}`);
      clients.delete(acct.email); // force re-login next time
    }
  }
  throw new Error("all accounts failed: " + tried.join(" | "));
}

function sseChunk(obj) { return `data: ${JSON.stringify(obj)}\n\n`; }

function streamOpenAI(res, model, reply, id) {
  res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.write(sseChunk({ id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] }));
  // stream in small pieces to look like a normal completion
  const words = reply.match(/[\s\S]{1,24}/g) || [reply];
  let i = 0;
  const timer = setInterval(() => {
    if (i >= words.length) {
      clearInterval(timer);
      res.write(sseChunk({ id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }));
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }
    res.write(sseChunk({ id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, delta: { content: words[i++] }, finish_reason: null }] }));
  }, 8);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === "GET" && (url.pathname === "/v1/models" || url.pathname === "/models")) {
    const data = accounts.length
      ? accounts.map((a, i) => ({ id: `flatai/account-${i + 1}`, object: "model", created: 0, owned_by: "flatai", flat_account: a.email }))
      : [{ id: "flatai/default", object: "model", created: 0, owned_by: "flatai" }];
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ object: "list", data }));
    return;
  }

  if (req.method === "POST" && url.pathname.endsWith("/chat/completions")) {
    let raw = "";
    for await (const c of req) raw += c;
    let body = {};
    try { body = JSON.parse(raw || "{}"); } catch {}
    const model = body.model || "flatai/default";
    const { prompt, system } = messagesToFlat(body.messages || [{ role: "user", content: "Hello" }]);
    const id = "chatcmpl-" + crypto.randomUUID();
    try {
      const { reply, account } = await withFailover(prompt, system);
      console.log(`[chat] ${account} -> ${reply.slice(0, 60).replace(/\n/g, " ")}…`);
      if (body.stream === false) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id, object: "chat.completion", created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, message: { role: "assistant", content: reply }, finish_reason: "stop" }], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } }));
      } else {
        streamOpenAI(res, model, reply, id);
      }
    } catch (e) {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: e.message, type: "upstream_error" } }));
    }
    return;
  }

  if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, accounts: accounts.length, mode: MODE }));
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

await loadAccounts();
server.listen(PORT, () => console.log(`Flat AI adapter on http://localhost:${PORT}/v1  (mode ${MODE})`));
