<div align="center">

<img src="assets/banner.svg" alt="Flat AI Bulk Creator + 9Router Connector" width="860"/>

# Flat AI Bulk Creator + 9Router Connector

**Bulk-create [Flat AI](https://flatai.org) accounts headlessly, capture every session cookie & token automatically, and bridge the whole pool into [9Router](https://9router.com) as one OpenAI-compatible provider.**

[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A518-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)](LICENSE)
[![OpenAI Compatible](https://img.shields.io/badge/OpenAI-Compatible-412991?style=for-the-badge&logo=openai&logoColor=white)](#-openai-compatible-api)
[![9Router](https://img.shields.io/badge/9Router-Ready-6ea8fe?style=for-the-badge)](#-connect-to-9router)
[![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen?style=for-the-badge)](#)
[![Platform](https://img.shields.io/badge/platform-linux%20%7C%20macOS%20%7C%20windows-555?style=for-the-badge)](#)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-ff69b4?style=for-the-badge)](#contributing)

**English** · [Bahasa Indonesia](docs/README.id.md) · [Español](docs/README.es.md) · [Français](docs/README.fr.md) · [中文](docs/README.zh.md)

</div>

---

## ✨ What it does

Flat AI is a WordPress + Firebase service. This toolkit talks to it directly over HTTP — **no browser, no captcha, no email verification**:

1. **Bulk-register** — creates accounts on demand with disposable inboxes (mail.tm).
2. **Auto-capture** — saves the WordPress session cookies **and** the Firebase `idToken` / `refreshToken` for every account.
3. **Bridge** — a local adapter turns Flat AI's chat into an OpenAI-compatible `/v1/chat/completions` endpoint.
4. **Connect** — one command wires the entire account pool into 9Router as a single provider.

## 🏗️ Architecture

```
┌─────────────┐      ┌───────────────┐      ┌──────────────────┐      ┌─────────────────┐
│  Your CLI   │ ───▶ │    9Router    │ ───▶ │  OpenAI-compat   │ ───▶ │   adapter.js    │
│ / IDE / app │      │ :20128/v1     │      │  provider-node   │      │ :8788/v1 (pool) │
└─────────────┘      └───────────────┘      └──────────────────┘      └────────┬────────┘
                                                                               │ round-robin
                                                                               ▼
                                                                    ┌─────────────────────┐
                                                                    │ Flat AI accounts    │
                                                                    │ admin-ajax (SSE)    │
                                                                    └─────────────────────┘
```

The adapter round-robins accounts and fails over to the next one on error, so 9Router just sees a normal OpenAI-compatible endpoint backed by a pool.

## 📦 Toolkit

| File | Description |
|------|-------------|
| `src/register.js` | Register **one** account, capture cookies + `idToken`/`refreshToken`. Works as a module too. |
| `src/bulk.js` | Bulk creator: N accounts, concurrency, retries, writes `accounts.json`. |
| `src/verify-chat.js` | Headless login + `ChatClient` (`login()`, `chat()`) with automatic nonce refresh. |
| `src/adapter.js` | OpenAI-compatible server (`/v1/chat/completions`, `/v1/models`, `/health`). |
| `src/connect-9router.js` | Logs into 9Router, creates the provider-node + connection automatically. |

## 🚀 Quick start

```bash
git clone https://github.com/0xgetz/flatai-9router-bulk.git
cd flatai-9router-bulk

# 1) Create accounts (writes accounts.json)
node src/bulk.js --count 10 --concurrency 3

# 2) Run the OpenAI-compatible adapter
PORT=8788 ACCOUNTS=accounts.json node src/adapter.js

# 3) Install & run 9Router
npm install -g 9router && 9router
#    Fresh install? set INITIAL_PASSWORD=<pw> so the connector can log in remotely.

# 4) Connect Flat AI into 9Router
node src/connect-9router.js \
  --base http://localhost:20128 \
  --password <dashboard-pw> \
  --adapter http://localhost:8788
```

### Use it from any OpenAI client

```
Base URL : http://localhost:20128/v1
API Key  : <copy from the 9Router dashboard>
Model    : flatai/account-1        # any flatai/* id — the adapter pools all accounts
```

## 🔌 OpenAI-compatible API

Run the adapter standalone and call it directly:

```bash
curl http://localhost:8788/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"flatai/account-1","messages":[{"role":"user","content":"Hello"}],"stream":false}'
```

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/v1/chat/completions` | POST | OpenAI chat, streaming or JSON |
| `/v1/models` | GET | List `flatai/*` models (one per account) |
| `/health` | GET | Pool status |

## ⚙️ Configuration

| Variable | Used by | Default |
|----------|---------|---------|
| `PORT` | adapter | `8788` |
| `ACCOUNTS` | adapter | `accounts.json` |
| `FLATAI_MODE` | adapter | `Balanced` (`Fast` / `Balanced` / `Professional`) |

### `bulk.js` flags

| Flag | Default | Meaning |
|------|---------|---------|
| `--count N` | 1 | Accounts to create |
| `--concurrency N` | 2 | Parallel workers |
| `--out file` | `accounts.json` | Output file (appended across runs) |
| `--name "..."` | `Flat AI User` | Display name |
| `--email / --password` | — | Fixed credentials (skips mail.tm) |
| `--connect <url>` | — | Also run the 9Router connector |

## 🔍 How it works (under the hood)

<details>
<summary><b>Registration flow</b></summary>

```
1. GET  flatai.org/register/                     -> page nonce
2. POST identitytoolkit signupNewUser?key=...     -> idToken + refreshToken
3. POST identitytoolkit setAccountInfo           -> display name
4. POST admin-ajax.php action=flat_register_email (id_token + nonce)
                                                  -> WordPress user + Set-Cookie session
```

</details>

<details>
<summary><b>Chat flow (per account)</b></summary>

```
POST admin-ajax.php action=chatbot2_session              -> nonce, history_nonce, scope
POST admin-ajax.php action=chatbot2_history op=load      -> revision
POST admin-ajax.php action=chatbot2_history op=save      (values + revision)
POST admin-ajax.php action=chatbot2_route                -> mode decision
POST admin-ajax.php action=my_chatbot                    -> SSE answer
# 403 SESSION_EXPIRED -> refresh nonces and retry (same as the site)
```

</details>

<details>
<summary><b>9Router integration</b></summary>

The connector logs in (`/api/auth/login`), then:

- `POST /api/provider-nodes` — creates an **openai-compatible** node pointing at the adapter.
- `POST /api/providers` — creates a connection with a non-empty API key.

</details>

## ✅ Verified end-to-end

| Test | Result |
|------|--------|
| Headless registration | Account created, session cookies issued |
| Headless login | `sign-in successful`, `member: true` |
| Headless chat | SSE reply received |
| OpenAI adapter | `/v1/chat/completions` returns completion |
| 9Router connection | provider-node + connection created |
| **9Router → Flat AI** | **Request routed through 9Router to a real Flat AI account and back** |

## 🧩 Requirements

- **Node.js ≥ 18** (uses global `fetch`, `FormData`, `crypto.randomUUID`).
- Zero npm dependencies.
- 9Router optional — the adapter runs standalone.

## 🔐 Security & responsible use

- `accounts.json` holds **real credentials**. It is git-ignored by default — never commit it.
- Flat AI is a third-party service. Use this responsibly, keep concurrency modest, and respect their Terms of Service.
- This project is for automation and interoperability research. You are responsible for how you use it.

## 🤝 Contributing

Issues and pull requests are welcome. Keep changes focused, dependency-free, and documented.

## 📄 License

[MIT](LICENSE) © 2026 0xgetz

<div align="center"><sub>Not affiliated with Flat AI or 9Router. Built for interoperability.</sub></div>
