#!/usr/bin/env node
// Bulk Flat AI account creator.
// For each account: mail.tm inbox -> Firebase signup -> WordPress register ->
// capture cookies + idToken/refreshToken -> (optionally) connect to 9Router.
//
// Usage:
//   node bulk.js --count 10
//   node bulk.js --count 10 --concurrency 3
//   node bulk.js --count 10 --connect http://localhost:20128 --password <dashboard-pw>
//   node bulk.js --count 1 --email me@x.com --password Secret123   (fixed creds, no inbox)
//
// Output: accounts.json  (all captured account data, appended incrementally)

import { registerAccount } from "./register.js";
import { writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const args = parseArgs(process.argv.slice(2));
const COUNT = Number(args.count || 1);
const CONCURRENCY = Math.max(1, Number(args.concurrency || 2));
const OUT = args.out || "accounts.json";
const NAME = args.name || "Flat AI User";

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) { o[k] = next; i++; } else o[k] = true;
    }
  }
  return o;
}

async function loadExisting() {
  if (!existsSync(OUT)) return [];
  try { return JSON.parse(await readFile(OUT, "utf8")); } catch { return []; }
}

async function saveAll(list) {
  await writeFile(OUT, JSON.stringify(list, null, 2));
}

async function makeOne(index) {
  const name = COUNT > 1 ? `${NAME} ${index + 1}` : NAME;
  const fixed = args.email ? { email: args.email, password: args.password, name } : { name };
  const acct = await registerAccount({ ...fixed, log: (m) => console.log(`  [#${index + 1}] ${m}`) });
  console.log(`[#${index + 1}] OK ${acct.email} (wp user ${acct.wordpress.userId})`);
  return acct;
}

async function main() {
  console.log(`Flat AI bulk creator: ${COUNT} account(s), concurrency ${CONCURRENCY}`);
  const all = await loadExisting();
  const start = all.length;
  const results = { ok: 0, fail: 0 };

  const queue = Array.from({ length: COUNT }, (_, i) => start + i);
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      const idx = queue.shift();
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const acct = await makeOne(idx);
          all.push(acct);
          await saveAll(all);
          results.ok++;
          break;
        } catch (e) {
          if (attempt === 3) {
            console.error(`[#${idx + 1}] FAILED after 3 tries: ${e.message}`);
            results.fail++;
          } else {
            console.warn(`[#${idx + 1}] retry ${attempt}: ${e.message}`);
            await new Promise((r) => setTimeout(r, 2000 * attempt));
          }
        }
      }
    }
  });
  await Promise.all(workers);

  await saveAll(all);
  console.log(`\nDone. ok=${results.ok} fail=${results.fail} total saved=${all.length} -> ${OUT}`);

  if (args.connect) {
    const { connectAll } = await import("./connect-9router.js");
    await connectAll(all, {
      base: String(args.connect),
      password: args.password9router || args.password,
      adapterUrl: args.adapter || "http://localhost:8788",
    });
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
