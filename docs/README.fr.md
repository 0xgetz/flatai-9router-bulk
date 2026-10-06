<div align="center">

<img src="../assets/banner.svg" alt="Flat AI Bulk Creator + 9Router Connector" width="860"/>

# Flat AI Bulk Creator + 9Router Connector

**Créez des comptes [Flat AI](https://flatai.org) en masse sans navigateur, capturez automatiquement tous les cookies de session et jetons, puis reliez tout le pool à [9Router](https://9router.com) comme un unique fournisseur compatible OpenAI.**

[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A518-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)](../LICENSE)
[![OpenAI Compatible](https://img.shields.io/badge/OpenAI-Compatible-412991?style=for-the-badge&logo=openai&logoColor=white)](#-api-compatible-openai)
[![9Router](https://img.shields.io/badge/9Router-Ready-6ea8fe?style=for-the-badge)](#-connecter-à-9router)
[![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen?style=for-the-badge)](#)

[English](../README.md) · [Bahasa Indonesia](README.id.md) · [Español](README.es.md) · **Français** · [中文](README.zh.md)

</div>

---

## ✨ Ce qu'il fait

Flat AI est un service WordPress + Firebase. Ce kit communique directement en HTTP — **sans navigateur, sans captcha, sans vérification d'e-mail** :

1. **Bulk-register** — crée des comptes avec des boîtes jetables (mail.tm).
2. **Auto-capture** — enregistre les cookies de session WordPress **et** l'`idToken` / `refreshToken` Firebase de chaque compte.
3. **Bridge** — un adaptateur local transforme le chat Flat AI en endpoint `/v1/chat/completions` compatible OpenAI.
4. **Connect** — une seule commande relie tout le pool de comptes à 9Router comme un unique fournisseur.

## 🏗️ Architecture

```
┌─────────────┐      ┌───────────────┐      ┌──────────────────┐      ┌─────────────────┐
│  Votre CLI  │ ───▶ │    9Router    │ ───▶ │  provider-node   │ ───▶ │   adapter.js    │
│ / IDE / app │      │ :20128/v1     │      │  OpenAI-compat   │      │ :8788/v1 (pool) │
└─────────────┘      └───────────────┘      └──────────────────┘      └────────┬────────┘
                                                                               │ round-robin
                                                                               ▼
                                                                    ┌─────────────────────┐
                                                                    │ Comptes Flat AI     │
                                                                    │ admin-ajax (SSE)    │
                                                                    └─────────────────────┘
```

L'adaptateur alterne entre les comptes et bascule vers le suivant en cas d'erreur : 9Router ne voit qu'un endpoint compatible OpenAI classique.

## 📦 Le kit

| Fichier | Description |
|---------|-------------|
| `src/register.js` | Enregistre **un** compte, capture cookies + `idToken`/`refreshToken`. Utilisable comme module. |
| `src/bulk.js` | Créateur en masse : N comptes, concurrence, réessais, écrit `accounts.json`. |
| `src/verify-chat.js` | Login headless + `ChatClient` avec rafraîchissement automatique du nonce. |
| `src/adapter.js` | Serveur compatible OpenAI (`/v1/chat/completions`, `/v1/models`, `/health`). |
| `src/connect-9router.js` | Connexion à 9Router, création du provider-node + connection. |

## 🚀 Démarrage rapide

```bash
git clone https://github.com/0xgetz/flatai-9router-bulk.git
cd flatai-9router-bulk

# 1) Créer des comptes (écrit accounts.json)
node src/bulk.js --count 10 --concurrency 3

# 2) Lancer l'adaptateur compatible OpenAI
PORT=8788 ACCOUNTS=accounts.json node src/adapter.js

# 3) Installer et lancer 9Router
npm install -g 9router && 9router
#    Installation neuve ? définissez INITIAL_PASSWORD=<pw> pour le login distant.

# 4) Relier Flat AI à 9Router
node src/connect-9router.js \
  --base http://localhost:20128 \
  --password <pw-du-tableau-de-bord> \
  --adapter http://localhost:8788
```

### Utilisation depuis n'importe quel client OpenAI

```
Base URL : http://localhost:20128/v1
API Key  : <copier depuis le tableau de bord 9Router>
Modèle   : flatai/account-1        # tout id flatai/* — l'adaptateur regroupe les comptes
```

## 🔌 API compatible OpenAI

```bash
curl http://localhost:8788/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"flatai/account-1","messages":[{"role":"user","content":"Bonjour"}],"stream":false}'
```

| Endpoint | Méthode | Rôle |
|----------|---------|------|
| `/v1/chat/completions` | POST | Chat OpenAI, streaming ou JSON |
| `/v1/models` | GET | Liste des modèles `flatai/*` (un par compte) |
| `/health` | GET | État du pool |

## ⚙️ Configuration

| Variable | Utilisé par | Défaut |
|----------|-------------|--------|
| `PORT` | adaptateur | `8788` |
| `ACCOUNTS` | adaptateur | `accounts.json` |
| `FLATAI_MODE` | adaptateur | `Balanced` (`Fast` / `Balanced` / `Professional`) |

### Options de `bulk.js`

| Option | Défaut | Signification |
|--------|--------|---------------|
| `--count N` | 1 | Comptes à créer |
| `--concurrency N` | 2 | Workers parallèles |
| `--out file` | `accounts.json` | Fichier de sortie (append) |
| `--name "..."` | `Flat AI User` | Nom affiché |
| `--email / --password` | — | Identifiants fixes (ignore mail.tm) |
| `--connect <url>` | — | Lance aussi le connecteur 9Router |

## 🔍 Fonctionnement

<details>
<summary><b>Flux d'inscription</b></summary>

```
1. GET  flatai.org/register/                     -> nonce de page
2. POST identitytoolkit signupNewUser?key=...     -> idToken + refreshToken
3. POST identitytoolkit setAccountInfo           -> nom affiché
4. POST admin-ajax.php action=flat_register_email (id_token + nonce)
                                                  -> utilisateur WordPress + Set-Cookie de session
```

</details>

<details>
<summary><b>Flux de chat (par compte)</b></summary>

```
POST admin-ajax.php action=chatbot2_session              -> nonce, history_nonce, scope
POST admin-ajax.php action=chatbot2_history op=load      -> revision
POST admin-ajax.php action=chatbot2_history op=save      (values + revision)
POST admin-ajax.php action=chatbot2_route                -> mode
POST admin-ajax.php action=my_chatbot                    -> réponse SSE
# 403 SESSION_EXPIRED -> rafraîchir les nonces et réessayer (comme le site)
```

</details>

<details>
<summary><b>Intégration 9Router</b></summary>

Le connecteur se connecte (`/api/auth/login`), puis `POST /api/provider-nodes` crée un nœud **openai-compatible** vers l'adaptateur, et `POST /api/providers` crée la connection.

</details>

## ✅ Vérifié de bout en bout

| Test | Résultat |
|------|----------|
| Inscription headless | Compte créé, cookies de session émis |
| Login headless | `sign-in successful`, `member: true` |
| Chat headless | Réponse SSE reçue |
| Adaptateur OpenAI | `/v1/chat/completions` renvoie un completion |
| **9Router → Flat AI** | **Requête routée via 9Router vers un vrai compte Flat AI et retour** |

## 🧩 Prérequis

- **Node.js ≥ 18** (utilise `fetch`, `FormData`, `crypto.randomUUID` globaux).
- Zéro dépendance npm.
- 9Router optionnel — l'adaptateur fonctionne seul.

## 🔐 Sécurité et usage responsable

- `accounts.json` contient de **vrais identifiants** et est ignoré par git — ne le committez jamais.
- Flat AI est un service tiers. Utilisez-le responsablement, gardez une concurrence modérée et respectez ses conditions.

## 🤝 Contribuer

Issues et pull requests bienvenus. Gardez les changements ciblés, sans dépendances et documentés.

## 📄 Licence

[MIT](../LICENSE) © 2026 0xgetz

<div align="center"><sub>Non affilié à Flat AI ni à 9Router. Conçu pour l'interopérabilité.</sub></div>
