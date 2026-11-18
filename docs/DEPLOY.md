# Deploying the public demo

**What this is.** A hosted copy with **synthetic data only**, behind one shared password, that resets itself to the demo state on every start and every 24 hours (`PUBLIC_DEMO=1`). It is not a production deployment: the shared password is not per-user login, anyone who has it can act as any demo role, and the database is deliberately ephemeral. Do not put real documents in it.

**What `PUBLIC_DEMO=1` does** (server/index.ts, server/access.ts): refuses to start without `DEMO_PASSWORD` (8+ characters); requires that password (HTTP Basic, any user name) on every route except `/api/health`; is the only mode that listens beyond 127.0.0.1; wipes and reloads all three demo organisations on boot and every `DEMO_RESET_HOURS`. OCR and the Claude adapters stay off. Tested by `tests/integration/public-demo.test.ts`.

**Not verified:** the Docker image has never been built (Docker is not installed on the dev machine), and nothing has been deployed. The server start itself was smoke-tested locally with `PUBLIC_DEMO=1`.

## Option A: Fly.io (`fly.toml`)
New Fly accounts have no standing free tier. A 512 MB shared machine that stops when idle is on the order of a few dollars a month (check [fly.io/pricing](https://fly.io/pricing) first). A card is required.
```bash
brew install flyctl && fly auth login
fly launch --copy-config --no-deploy        # pick a unique app name when asked
fly secrets set DEMO_PASSWORD='choose-a-long-passphrase'
fly deploy
```

## Option B: Render (`render.yaml`, free plan)
New Blueprint from this GitHub repo; set `DEMO_PASSWORD` when prompted. Free services sleep when idle (first request takes about a minute) and lose their disk on redeploy, which suits a reset-to-demo app.

## After deploying
Open the URL, enter the password, confirm the Overview shows demo data, then try one approval. Share the URL and password only with people you want to see it.
