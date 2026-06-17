# The Historians

Browser-based educational card game — React (Vite + Tailwind) frontend, PHP + MySQL backend.
Edit with Claude Code, push to `main`, and GitHub Actions builds and deploys to GreenGeeks automatically.

```
frontend/   React/Vite/Tailwind source (build with: npm install && npm run build)
backend/    PHP endpoints — deploy to the site's web root
database/   SQL migrations (run in phpMyAdmin)
.github/workflows/deploy.yml   Build + FTPS deploy pipeline
```

---

## How deploying works

On every push to `main`, GitHub Actions:
1. Builds the frontend with Vite (`frontend/dist`).
2. Copies the built app **and** `backend/*.php` into a `publish/` folder.
3. Uploads `publish/` to `public_html/thehistorians.org/` over FTPS.

It never uploads or deletes the server-only files (`config.secret.php`, `dbConfig.php`,
`vendor/`, `uploads/`, `Images/`) — those stay safely on the host.

---

## One-time setup

### 1. Create the private repo and push
```bash
git init
git add .
git commit -m "Initial import"
git branch -M main
git remote add origin git@github.com:<you>/the-historians.git
git push -u origin main
```
Make the repo **Private** on GitHub.

### 2. Add your FTP login as GitHub Actions secrets
GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**. Add three:

| Secret name   | Value                                                        |
|---------------|-------------------------------------------------------------|
| `FTP_SERVER`  | Your FTP host (e.g. `ftp.thehistorians.org` or the server hostname from cPanel) |
| `FTP_USERNAME`| Your cPanel/FTP username                                    |
| `FTP_PASSWORD`| That account's password                                     |

Tip: in cPanel → **FTP Accounts**, create a dedicated FTP account whose directory is
`public_html/thehistorians.org`. If you do, set `server-dir:` in `deploy.yml` to `./`
instead of `public_html/thehistorians.org/`, and use that account's credentials here.

### 3. Put your real credentials on the server (NOT in git)
The committed `mp_dbConfig.php` and `users_helpers.php` no longer contain passwords — they read
them from a server-only file. On the server, in `public_html/thehistorians.org/`:

1. Copy `config.secret.example.php` to **`config.secret.php`**.
2. Fill in your real database and SMTP values.

`config.secret.php` is git-ignored and excluded from deploys, so it is never committed or overwritten.

> **Order matters:** create `config.secret.php` on the server *before* your first deploy.
> The first deploy overwrites the old `mp_dbConfig.php`/`users_helpers.php` with the versions
> that expect `config.secret.php`; if that file isn't there yet, the site will error until it is.

### 4. Leave the other server-only files in place
`dbConfig.php` (your PDO config with its own DB credentials), `vendor/` (PHPMailer +
PhpSpreadsheet), `uploads/` (writable, holds uploaded deck files), and `Images/` already live
on the server and are not in this repo. The deploy never touches them.
Optional tidy-up: edit your server `dbConfig.php` to read its credentials from `config.secret.php`
too, so there's a single source of truth.

### 5. Database migrations
Run files in `database/` in phpMyAdmin in numeric order (then `playtest_feedback_schema.sql`).
For an already-live database these are already applied; only run new ones as they're added.

---

## Day-to-day with Claude Code
```bash
# in the repo folder
claude            # start Claude Code, make your changes
npm --prefix frontend run dev    # optional local preview at localhost
git add -A && git commit -m "…" && git push   # push to main → auto-deploys
```
Watch the deploy under the repo's **Actions** tab. To redeploy without a code change, use
**Run workflow** on the deploy job (the `workflow_dispatch` trigger).

---

## Notes
- `index.html` references `favicon.svg`, which isn't in the project yet — add one to
  `frontend/public/` (anything there is copied into the build), or point the link at your
  existing `favicon.ico`.
- After a deploy, hard-refresh (Ctrl+Shift+R) — `index.html` can cache even when asset hashes change.
