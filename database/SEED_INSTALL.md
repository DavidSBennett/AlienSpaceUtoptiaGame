# Seed / lab installation — setup

The seed build is the **same app** as the live game, built with
`VITE_SEED_MODE=1`, deployed to its **own subdomain** (`seed.thehistorians.org`)
that points at its **own database**. It adds an admin-only "reproducible seed"
field: give a game the same seed and the deck shuffle + opening hands come out
identical every time. The live game and live database are never touched.

One-time setup (all in cPanel / phpMyAdmin — the code side is already done):

## 1. Create the subdomain
cPanel → **Domains → Create a New Subdomain** → `seed` (→ `seed.thehistorians.org`).
Note the **Document Root** it gives you (e.g. `public_html/seed.thehistorians.org`).
If it differs from that path, update `TARGET:` in
`.github/workflows/deploy-seed.yml`.

## 2. Create a separate database
cPanel → **MySQL Databases** → create a new database + user, add the user to the
database with all privileges. Note the DB name / user / password.

## 3. Load the schema + data into the seed database
In phpMyAdmin, select the **live** database → **Export** (structure + data) for at
least: the `Cards`, `Decks`, and any settings/`users` tables the app needs, plus
the `mp_*` tables' **structure**. Import that into the **seed** database. Then run
any migrations the live DB has, PLUS these seed-specific ones:
- `database/31_review_flagged_works.sql`
- `database/32_mp_seed_input.sql`

(Every `NN_*.sql` migration in `database/` should be applied to the seed DB so
its schema matches the current code.)

You'll also want at least one **admin** account in the seed DB (the seed field
only shows to admins) — register on the seed site, then set that user's admin
flag in phpMyAdmin the same way you did on live.

## 4. Point the seed backend at the seed database + copy server-only files
The deploy intentionally **excludes** the server-only files
(`config.secret.php, dbConfig.php, vendor/, uploads/, Images/`), so the seed
docroot needs its own copies. In cPanel File Manager, copy these from the live
docroot (`public_html/thehistorians.org/`) into the seed docroot:

- **`vendor/`** — PhpSpreadsheet; **required for deck upload** (missing it = 500).
- **`dbConfig.php`** — then edit it to point at the **seed** DB.
- **`Images/`** and **`uploads/`** — if your decks use card images.

Then create **`config.secret.php`** in the seed docroot (copy
`backend/config.secret.example.php`) with the **seed** DB credentials, and add:

```php
define('SEED_MODE', true);
```

These files live only on the server and are never deployed.

## 5. Deploy the seed build
GitHub → **Actions → "Build & Deploy SEED build" → Run workflow**. This builds
with the seed flag and rsyncs to the seed docroot. (It reuses the same SSH
secrets as the live deploy.)

## 6. Use it
Visit `https://seed.thehistorians.org/`, sign in as an admin, and you'll see the
**Seed mode** field on the setup and create-lobby screens. Enter a seed (any word
or number) for a reproducible game; leave it blank for a normal random one.

To keep the seed build auto-updating on every push, add a `push: branches:
[main]` trigger to `deploy-seed.yml`.
