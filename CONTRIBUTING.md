# Contributing

Thanks for your interest in improving **Flat AI Bulk Creator + 9Router Connector**.

## Ground rules

- Keep the toolkit **dependency-free** — it must run on a clean Node.js ≥ 18 install.
- Match the existing style: small, focused files in `src/`, plain ES modules, no build step.
- Never commit real credentials. `accounts.json` and variants are git-ignored; use `accounts.sample.json` for examples.

## Development

```bash
git clone https://github.com/0xgetz/flatai-9router-bulk.git
cd flatai-9router-bulk

# syntax check every script
for f in src/*.js; do node --check "$f"; done
```

## Testing locally

```bash
# one account, verbose
node src/register.js

# small batch
node src/bulk.js --count 2 --concurrency 1

# adapter alone
PORT=8788 node src/adapter.js
curl http://localhost:8788/v1/models
```

If you touch the flow logic, please describe in the PR how you verified it against the live
service (register → login → chat → adapter → 9Router) and paste the observed output.

## Pull requests

1. Fork, branch (`feat/...`, `fix/...`).
2. Make the change, run the syntax check.
3. Explain **what changed**, **why**, and **how you verified it**.
4. Keep the diff focused — one concern per PR.

## Reporting issues

Include your Node.js version, the exact command, and the error output. Redact any tokens or cookies.
