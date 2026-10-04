# Board Game Gift Register / Реестр подарков

A tiny web app for a family buying board games as presents: **check whether someone has already
claimed a game before you buy it**, without the register ever revealing which games those are.

The interface is in Russian; this README and the code are in English.

Live at `https://board-game-guess.<your-subdomain>.workers.dev/`.

## How it works

1. You log in with one shared password. Nothing else is shown until you do.
2. You type a game name. The browser normalises it (lower case, no accents, no punctuation) and
   hashes it with SHA-256.
3. **Only the hash leaves your browser.** The API compares it against the stored hashes.
4. Three actions, each taking a game name:
   - **Проверить** — is this game already claimed, and what note did the claimant leave?
   - **Добавить** — claim it. If it is already claimed, you get a warning and the existing note,
     and **nothing is overwritten**.
   - **Удалить** — find the claim, see its note, confirm, and remove it.

So the database holds a list of digests and notes. Reading it tells you *that* eight games are
spoken for and *who* is buying them, but not *which* games.

A game appears at most once: `POST /api/entries` refuses a duplicate, and a unique index on
`game_hash` enforces it even if two people submit at the same moment.

### What this does and does not protect

The whole app sits behind one shared password, which is what actually keeps the person being gifted
out of it. The hashing is a second layer so that a glance at the database — or at the Cloudflare
dashboard — does not spoil the surprise.

It is deliberately *not* hardened against someone determined: the set of board game names is small
and public, so anyone with a copy of the database could hash a list of known games and match them
up. That is a fine trade for a family tool. If it ever matters, add a server-side pepper (hash the
client's digest again with a secret held only in a Worker secret) before the first entry is stored.

### Naming convention

Matching is exact after normalisation, so `Каркассон` and `Carcassonne` are two different games as
far as the register is concerned. Agree on one rule — **use the name printed on the box** — and the
false "nobody has it" answers go away. The page shows the normalised form as you type, so you can
see what will be matched.

## Stack

| Piece | Choice |
| --- | --- |
| Hosting | Cloudflare Workers (free tier) |
| Storage | Cloudflare D1 (SQLite) |
| Frontend | Static HTML/CSS/JS in `public/`, no build step |
| Backend | One Worker, `src/worker/index.ts` |

There is no bundler and no framework: `wrangler deploy` uploads `public/` as static assets and
compiles the Worker. Running costs are zero at this volume.

---

# Operations

## First-time deployment

Needs a free Cloudflare account. No GitHub repo, domain or credit card is required.

```bash
npm install
npx wrangler login

# Creates the database and prints a database_id.
npx wrangler d1 create board-game-guess
# Paste that id into wrangler.jsonc, replacing the database_id value.

npx wrangler secret put APP_PASSWORD  # the shared family password
npm run deploy                        # creates the schema, then uploads
```

On the first deploy Cloudflare asks you to pick a `workers.dev` subdomain. DNS for a brand-new
subdomain takes a few minutes to propagate — if the URL does not answer immediately, wait and retry
before assuming the deploy failed.

Share the URL with the password in the fragment so nobody has to type it:

```
https://board-game-guess.<your-subdomain>.workers.dev/#key=ПАРОЛЬ
```

The page stores the password in `localStorage` and strips it from the address bar, so it does not
end up in browser history or in a link someone copies afterwards.

## Deploying an update

```bash
npm run deploy
```

That is the whole release: it applies any pending migration first, then uploads. Running the
migration first matters, so the new code never meets the old schema — and if the migration fails,
the deploy is skipped rather than shipping code the database cannot serve.

Migrations are tracked, so a deploy with nothing new in `migrations/` just skips that step. To see
what would run:

```bash
npx wrangler d1 migrations list board-game-guess --remote
```

Rolling back a bad deploy is a dashboard operation: **Workers & Pages → board-game-guess →
Deployments → Rollback**, or `npx wrangler rollback`.

## Changing the password

```bash
npx wrangler secret put APP_PASSWORD
```

It prompts for the new value and takes effect within seconds — no redeploy needed. Everyone's
browser will show the login screen again on their next action, because the stored password stops
being accepted.

Give the new one out as a fresh link: `https://.../#key=НОВЫЙ-ПАРОЛЬ`.

To change the local development password instead, edit `.dev.vars` (gitignored, never deployed).

## Clearing the register

After the holidays, to empty it but keep the app:

```bash
npx wrangler d1 execute board-game-guess --remote --command "DELETE FROM entries"
```

To check what is in there first (you will only see hashes and notes, not game names):

```bash
npx wrangler d1 execute board-game-guess --remote --command "SELECT COUNT(*) FROM entries"
```

To remove one entry you cannot delete through the UI — because nobody remembers the exact name —
delete it by id:

```bash
npx wrangler d1 execute board-game-guess --remote --command "SELECT id, comment, created_at FROM entries ORDER BY id"
npx wrangler d1 execute board-game-guess --remote --command "DELETE FROM entries WHERE id = 7"
```

## Local development

```bash
echo 'APP_PASSWORD="local-test-password"' > .dev.vars
npm run db:migrate:local
npm run dev            # http://127.0.0.1:8787
```

With the dev server running, in a second terminal:

```bash
npm run smoke          # end-to-end check of the API
npm run typecheck
```

`wrangler dev` serves `public/` straight from disk, so a browser refresh picks up frontend edits.
The local database lives in `.wrangler/` and is completely separate from the deployed one.

## API

Every route needs `Authorization: Bearer <password>` and answers `401` without it.

| Route | Purpose |
| --- | --- |
| `POST /api/check` | `{ hash }` → `{ taken, entries }` |
| `POST /api/entries` | `{ hash, comment }` → `201 { entry }`, or `409 { error, entries }` if already claimed |
| `DELETE /api/entries` | `{ hash }` → `{ deleted }`, or `404` if not claimed |
| `GET /api/stats` | `{ count }` |

Error messages in responses are Russian, because the page displays them to the user unchanged.
