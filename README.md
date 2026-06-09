# Storeveu Status

Public status page for the Storeveu platform — live up/down + 90-day uptime
history for every service. Runs entirely on **GitHub Actions + GitHub Pages**
(no server, **no Personal Access Token**, no third-party service), so it stays
up even when Storeveu's own infrastructure is down.

Live at **https://status.storeveu.com**.

## How it works

- `.github/workflows/status.yml` runs every ~10 minutes (and on every push).
- `scripts/check.mjs` pings each service in `services.json`, records the result
  into `data/uptime.json` (committed history) and writes `public/uptime.json`.
- The static page in `public/` (`index.html` + `app.js` + `style.css`) reads
  `uptime.json` and renders current status + 90-day uptime bars.
- The workflow deploys `public/` to GitHub Pages using the built-in
  `GITHUB_TOKEN` — no PAT required.

## One-time deploy

The repo must be **public** (private repos need a paid plan for Pages + free
Actions). From this folder:

```bash
git init
git add .
git commit -m "Storeveu status page"
git branch -M main
git remote add origin https://github.com/Fortune-Technology/storeveu-status.git
git push -u origin main
```

> If the GitHub repo was created **with** a README/license, the push will be
> rejected. Fix once with: `git pull origin main --allow-unrelated-histories`
> then `git push -u origin main`.

Then in the repo on GitHub:

1. **Settings → Pages → Source: GitHub Actions.** (The first workflow run also
   tries to enable this automatically via `configure-pages`.)
2. **Actions tab → "Status check & deploy" → Run workflow.** (If the push-run
   failed because Pages wasn't enabled yet, just re-run it.)
3. **Settings → Pages → Custom domain:** confirm `status.storeveu.com` (set from
   `public/CNAME`). Wait for the certificate, then tick **Enforce HTTPS**.

The page is live at the `github.io` URL immediately, and at
`status.storeveu.com` once the certificate provisions.

## Add / change / remove a monitored service

Edit `services.json` (`name` + `url`), commit, push. That's it.

> Only **production** domains belong here — never test/staging. This page is
> public and customer-facing.

## Tuning

- **Check frequency:** the `cron` in `.github/workflows/status.yml` (default
  `*/10` = every 10 min).
- **"Up" definition:** `scripts/check.mjs` treats HTTP `200–399` as up; anything
  else (incl. timeout/network error) as down.
- **History retention:** `RETAIN_DAYS` in `scripts/check.mjs` (default 90).
