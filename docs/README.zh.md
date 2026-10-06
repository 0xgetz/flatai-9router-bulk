<div align="center">

<img src="../assets/banner.svg" alt="Flat AI Bulk Creator + 9Router Connector" width="860"/>

# Flat AI 批量账号创建器 + 9Router 连接器

**无需浏览器即可批量注册 [Flat AI](https://flatai.org) 账号，自动捕获所有会话 Cookie 与令牌，并将整个账号池作为一个兼容 OpenAI 的提供商接入 [9Router](https://9router.com)。**

[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A518-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)](../LICENSE)
[![OpenAI Compatible](https://img.shields.io/badge/OpenAI-Compatible-412991?style=for-the-badge&logo=openai&logoColor=white)](#-兼容-openai-的-api)
[![9Router](https://img.shields.io/badge/9Router-Ready-6ea8fe?style=for-the-badge)](#-接入-9router)
[![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen?style=for-the-badge)](#)

[English](../README.md) · [Bahasa Indonesia](README.id.md) · [Español](README.es.md) · [Français](README.fr.md) · **中文**

</div>

---

## ✨ 功能简介

Flat AI 是一个 WordPress + Firebase 服务。本工具直接通过 HTTP 与其通信 —— **无需浏览器、无需验证码、无需邮箱验证**：

1. **批量注册** —— 使用临时邮箱（mail.tm）按需创建账号。
2. **自动捕获** —— 保存每个账号的 WordPress 会话 Cookie **以及** Firebase 的 `idToken` / `refreshToken`。
3. **桥接** —— 本地适配器将 Flat AI 聊天转换为兼容 OpenAI 的 `/v1/chat/completions` 端点。
4. **连接** —— 一条命令即可将整个账号池接入 9Router，作为单一提供商。

## 🏗️ 架构

```
┌─────────────┐      ┌───────────────┐      ┌──────────────────┐      ┌─────────────────┐
│  你的 CLI   │ ───▶ │    9Router    │ ───▶ │   provider-node  │ ───▶ │   adapter.js    │
│ / IDE / 应用│      │ :20128/v1     │      │  OpenAI 兼容     │      │ :8788/v1 (账号池)│
└─────────────┘      └───────────────┘      └──────────────────┘      └────────┬────────┘
                                                                               │ 轮询
                                                                               ▼
                                                                    ┌─────────────────────┐
                                                                    │ Flat AI 账号        │
                                                                    │ admin-ajax (SSE)    │
                                                                    └─────────────────────┘
```

适配器会在账号间轮询，并在出错时自动切换，因此 9Router 只看到一个普通的兼容 OpenAI 端点。

## 📦 工具组件

| 文件 | 说明 |
|------|------|
| `src/register.js` | 注册**单个**账号，捕获 Cookie + `idToken`/`refreshToken`，也可作为模块使用。 |
| `src/bulk.js` | 批量创建器：N 个账号、并发、重试，写入 `accounts.json`。 |
| `src/verify-chat.js` | 无头登录 + `ChatClient`（自动刷新 nonce）。 |
| `src/adapter.js` | 兼容 OpenAI 的服务器（`/v1/chat/completions`、`/v1/models`、`/health`）。 |
| `src/connect-9router.js` | 登录 9Router，自动创建 provider-node + connection。 |

## 🚀 快速开始

```bash
git clone https://github.com/0xgetz/flatai-9router-bulk.git
cd flatai-9router-bulk

# 1) 创建账号（写入 accounts.json）
node src/bulk.js --count 10 --concurrency 3

# 2) 运行兼容 OpenAI 的适配器
PORT=8788 ACCOUNTS=accounts.json node src/adapter.js

# 3) 安装并运行 9Router
npm install -g 9router && 9router
#    全新安装？设置 INITIAL_PASSWORD=<pw> 以便连接器远程登录。

# 4) 将 Flat AI 接入 9Router
node src/connect-9router.js \
  --base http://localhost:20128 \
  --password <面板密码> \
  --adapter http://localhost:8788
```

### 在任意 OpenAI 客户端中使用

```
Base URL : http://localhost:20128/v1
API Key  : <从 9Router 面板复制>
模型     : flatai/account-1        # 任意 flatai/* id —— 适配器会轮询整个账号池
```

## 🔌 兼容 OpenAI 的 API

```bash
curl http://localhost:8788/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"flatai/account-1","messages":[{"role":"user","content":"你好"}],"stream":false}'
```

| 端点 | 方法 | 用途 |
|------|------|------|
| `/v1/chat/completions` | POST | OpenAI 聊天，流式或 JSON |
| `/v1/models` | GET | 列出 `flatai/*` 模型（每个账号一个） |
| `/health` | GET | 账号池状态 |

## ⚙️ 配置

| 变量 | 使用方 | 默认值 |
|------|--------|--------|
| `PORT` | 适配器 | `8788` |
| `ACCOUNTS` | 适配器 | `accounts.json` |
| `FLATAI_MODE` | 适配器 | `Balanced`（`Fast` / `Balanced` / `Professional`） |

### `bulk.js` 参数

| 参数 | 默认值 | 含义 |
|------|--------|------|
| `--count N` | 1 | 创建账号数量 |
| `--concurrency N` | 2 | 并行工作数 |
| `--out file` | `accounts.json` | 输出文件（追加） |
| `--name "..."` | `Flat AI User` | 显示名称 |
| `--email / --password` | — | 固定凭据（跳过 mail.tm） |
| `--connect <url>` | — | 同时运行 9Router 连接器 |

## 🔍 工作原理

<details>
<summary><b>注册流程</b></summary>

```
1. GET  flatai.org/register/                     -> 页面 nonce
2. POST identitytoolkit signupNewUser?key=...     -> idToken + refreshToken
3. POST identitytoolkit setAccountInfo           -> 显示名称
4. POST admin-ajax.php action=flat_register_email (id_token + nonce)
                                                  -> WordPress 用户 + 会话 Set-Cookie
```

</details>

<details>
<summary><b>聊天流程（每个账号）</b></summary>

```
POST admin-ajax.php action=chatbot2_session              -> nonce, history_nonce, scope
POST admin-ajax.php action=chatbot2_history op=load      -> revision
POST admin-ajax.php action=chatbot2_history op=save      (values + revision)
POST admin-ajax.php action=chatbot2_route                -> 模式
POST admin-ajax.php action=my_chatbot                    -> SSE 回答
# 403 SESSION_EXPIRED -> 刷新 nonce 后重试（与网站一致）
```

</details>

<details>
<summary><b>9Router 集成</b></summary>

连接器登录（`/api/auth/login`），然后 `POST /api/provider-nodes` 创建指向适配器的 **openai-compatible** 节点，`POST /api/providers` 创建连接。

</details>

## ✅ 端到端验证

| 测试 | 结果 |
|------|------|
| 无头注册 | 账号创建，会话 Cookie 下发 |
| 无头登录 | `sign-in successful`，`member: true` |
| 无头聊天 | 收到 SSE 回复 |
| OpenAI 适配器 | `/v1/chat/completions` 返回完成结果 |
| **9Router → Flat AI** | **请求经 9Router 转发到真实 Flat AI 账号并返回** |

## 🧩 环境要求

- **Node.js ≥ 18**（使用全局 `fetch`、`FormData`、`crypto.randomUUID`）。
- 零 npm 依赖。
- 9Router 可选 —— 适配器可独立运行。

## 🔐 安全与负责任使用

- `accounts.json` 包含**真实凭据**，默认已被 git 忽略 —— 切勿提交。
- Flat AI 是第三方服务。请负责任地使用，保持适度的并发并遵守其服务条款。

## 🤝 贡献

欢迎 issue 和 pull request。请保持改动聚焦、无依赖并附带文档。

## 📄 许可证

[MIT](../LICENSE) © 2026 0xgetz

<div align="center"><sub>与 Flat AI 或 9Router 无隶属关系。为互操作性而构建。</sub></div>
