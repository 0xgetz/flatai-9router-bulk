<div align="center">

<img src="../assets/banner.svg" alt="Flat AI Bulk Creator + 9Router Connector" width="860"/>

# Flat AI Bulk Creator + 9Router Connector

**Buat akun [Flat AI](https://flatai.org) secara massal tanpa browser, ambil semua cookie sesi & token secara otomatis, lalu sambungkan seluruh pool ke [9Router](https://9router.com) sebagai satu provider OpenAI-compatible.**

[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A518-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)](../LICENSE)
[![OpenAI Compatible](https://img.shields.io/badge/OpenAI-Compatible-412991?style=for-the-badge&logo=openai&logoColor=white)](#-api-openai-compatible)
[![9Router](https://img.shields.io/badge/9Router-Ready-6ea8fe?style=for-the-badge)](#-sambungkan-ke-9router)
[![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen?style=for-the-badge)](#)

[English](../README.md) · **Bahasa Indonesia** · [Español](README.es.md) · [Français](README.fr.md) · [中文](README.zh.md)

</div>

---

## ✨ Apa fungsinya

Flat AI adalah layanan WordPress + Firebase. Toolkit ini berbicara langsung lewat HTTP — **tanpa browser, tanpa captcha, tanpa verifikasi email**:

1. **Bulk-register** — membuat akun dengan inbox sekali pakai (mail.tm).
2. **Auto-capture** — menyimpan cookie sesi WordPress **dan** `idToken` / `refreshToken` Firebase tiap akun.
3. **Bridge** — adapter lokal mengubah chat Flat AI menjadi endpoint OpenAI-compatible `/v1/chat/completions`.
4. **Connect** — satu perintah menyambungkan seluruh pool akun ke 9Router sebagai satu provider.

## 🏗️ Arsitektur

```
┌─────────────┐      ┌───────────────┐      ┌──────────────────┐      ┌─────────────────┐
│  CLI Anda   │ ───▶ │    9Router    │ ───▶ │  provider-node   │ ───▶ │   adapter.js    │
│ / IDE / app │      │ :20128/v1     │      │  OpenAI-compat   │      │ :8788/v1 (pool) │
└─────────────┘      └───────────────┘      └──────────────────┘      └────────┬────────┘
                                                                               │ round-robin
                                                                               ▼
                                                                    ┌─────────────────────┐
                                                                    │ Akun Flat AI        │
                                                                    │ admin-ajax (SSE)    │
                                                                    └─────────────────────┘
```

Adapter memutar akun (round-robin) dan otomatis pindah akun lain saat error, jadi 9Router hanya melihat endpoint OpenAI-compatible biasa.

## 📦 Isi toolkit

| File | Deskripsi |
|------|-----------|
| `src/register.js` | Daftar **satu** akun, ambil cookies + `idToken`/`refreshToken`. Bisa jadi modul. |
| `src/bulk.js` | Bulk creator: N akun, concurrency, retry, tulis `accounts.json`. |
| `src/verify-chat.js` | Login headless + `ChatClient` dengan auto-refresh nonce. |
| `src/adapter.js` | Server OpenAI-compatible (`/v1/chat/completions`, `/v1/models`, `/health`). |
| `src/connect-9router.js` | Login 9Router, buat provider-node + connection otomatis. |

## 🚀 Mulai cepat

```bash
git clone https://github.com/0xgetz/flatai-9router-bulk.git
cd flatai-9router-bulk

# 1) Buat akun (menulis accounts.json)
node src/bulk.js --count 10 --concurrency 3

# 2) Jalankan adapter OpenAI-compatible
PORT=8788 ACCOUNTS=accounts.json node src/adapter.js

# 3) Install & jalankan 9Router
npm install -g 9router && 9router
#    Fresh install? set INITIAL_PASSWORD=<pw> agar connector bisa login remote.

# 4) Sambungkan Flat AI ke 9Router
node src/connect-9router.js \
  --base http://localhost:20128 \
  --password <pw-dashboard> \
  --adapter http://localhost:8788
```

### Pakai dari klien OpenAI apa pun

```
Base URL : http://localhost:20128/v1
API Key  : <salin dari dashboard 9Router>
Model    : flatai/account-1        # id flatai/* apa pun — adapter memutar seluruh pool
```

## 🔌 API OpenAI-compatible

```bash
curl http://localhost:8788/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"flatai/account-1","messages":[{"role":"user","content":"Halo"}],"stream":false}'
```

| Endpoint | Metode | Fungsi |
|----------|--------|--------|
| `/v1/chat/completions` | POST | Chat OpenAI, streaming atau JSON |
| `/v1/models` | GET | Daftar model `flatai/*` (satu per akun) |
| `/health` | GET | Status pool |

## ⚙️ Konfigurasi

| Variabel | Dipakai oleh | Default |
|----------|--------------|---------|
| `PORT` | adapter | `8788` |
| `ACCOUNTS` | adapter | `accounts.json` |
| `FLATAI_MODE` | adapter | `Balanced` (`Fast` / `Balanced` / `Professional`) |

### Flag `bulk.js`

| Flag | Default | Arti |
|------|---------|------|
| `--count N` | 1 | Jumlah akun |
| `--concurrency N` | 2 | Worker paralel |
| `--out file` | `accounts.json` | File keluaran (append) |
| `--name "..."` | `Flat AI User` | Nama tampilan |
| `--email / --password` | — | Kredensial tetap (lewati mail.tm) |
| `--connect <url>` | — | Ikut jalankan connector 9Router |

## 🔍 Cara kerjanya

<details>
<summary><b>Alur registrasi</b></summary>

```
1. GET  flatai.org/register/                     -> nonce halaman
2. POST identitytoolkit signupNewUser?key=...     -> idToken + refreshToken
3. POST identitytoolkit setAccountInfo           -> display name
4. POST admin-ajax.php action=flat_register_email (id_token + nonce)
                                                  -> user WordPress + Set-Cookie sesi
```

</details>

<details>
<summary><b>Alur chat (per akun)</b></summary>

```
POST admin-ajax.php action=chatbot2_session              -> nonce, history_nonce, scope
POST admin-ajax.php action=chatbot2_history op=load      -> revision
POST admin-ajax.php action=chatbot2_history op=save      (values + revision)
POST admin-ajax.php action=chatbot2_route                -> mode
POST admin-ajax.php action=my_chatbot                    -> jawaban SSE
# 403 SESSION_EXPIRED -> refresh nonce lalu retry (sama seperti situs)
```

</details>

<details>
<summary><b>Integrasi 9Router</b></summary>

Connector login (`/api/auth/login`), lalu `POST /api/provider-nodes` membuat node **openai-compatible** ke adapter, dan `POST /api/providers` membuat connection.

</details>

## ✅ Terverifikasi end-to-end

| Uji | Hasil |
|-----|-------|
| Registrasi headless | Akun dibuat, cookie sesi terbit |
| Login headless | `sign-in successful`, `member: true` |
| Chat headless | Balasan SSE diterima |
| Adapter OpenAI | `/v1/chat/completions` mengembalikan completion |
| **9Router → Flat AI** | **Request lewat 9Router ke akun Flat AI nyata dan kembali** |

## 🧩 Kebutuhan

- **Node.js ≥ 18** (memakai `fetch`, `FormData`, `crypto.randomUUID` global).
- Tanpa dependensi npm.
- 9Router opsional — adapter bisa jalan mandiri.

## 🔐 Keamanan & penggunaan bertanggung jawab

- `accounts.json` berisi **kredensial asli** dan sudah di-ignore git — jangan pernah di-commit.
- Flat AI layanan pihak ketiga. Gunakan dengan bijak, jaga concurrency tetap wajar, dan patuhi ToS mereka.

## 🤝 Kontribusi

Issue dan pull request diterima. Jaga perubahan tetap fokus, tanpa dependensi, dan terdokumentasi.

## 📄 Lisensi

[MIT](../LICENSE) © 2026 0xgetz

<div align="center"><sub>Tidak berafiliasi dengan Flat AI atau 9Router. Dibuat untuk interoperabilitas.</sub></div>
