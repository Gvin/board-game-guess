# Board Game Gift Register

A tiny web app for a family or friend group buying board games as presents: **check whether someone
has already claimed a game before you buy it**, without the register ever revealing which games
those are.

No copy-pasting a JSON blob in and out of a Google Doc — everyone opens the same link, types a name,
and gets an instant answer.

## How it works

1. You type a game name into the page.
2. The browser normalises it (lower case, no accents, no punctuation) and hashes it with SHA-256.
3. **Only the hash leaves your browser.** The API compares it against the stored hashes and answers
   "free" or "already registered", along with any note the registrant left.
4. Registering stores the hash plus that free-text note (e.g. `from Ivan, for Dad`).

So the database holds a list of digests and notes. Reading it tells you *that* eight games are
spoken for and *who* is buying them, but not *which* games.

### What this does and does not protect

The whole app sits behind one shared passphrase, which is what actually keeps the family member
being gifted out of it. The hashing is a second layer so that a glance at the database — or at the
Cloudflare dashboard — does not spoil the surprise.

It is deliberately *not* hardened against someone determined: the set of board game names is small
and public, so anyone with a copy of the database could hash a list of known games and match them
up. That is a fine trade for a family tool. If it ever matters, add a server-side pepper (hash the
client's digest again with a secret held only in a Worker secret) before the first entry is stored.

### Naming convention

Matching is exact after normalisation, so `Catan` and `Settlers of Catan` are two different games as
far as the register is concerned. Agree on one rule — **use the name printed on the box, in
English** — and the false "nobody has it" answers go away. The page shows you the normalised form as
you type so you can see what will be matched.

## Stack

| Piece | Choice |
| --- | --- |
| Hosting | Cloudflare Workers (free tier) |
| Storage | Cloudflare D1 (SQLite) |
| Frontend | Static HTML/CSS/JS in `public/`, no build step |
| Backend | One Worker, `src/worker/index.ts` |

There is no bundler and no framework: `wrangler deploy` uploads `public/` as static assets and
compiles the Worker. Running costs are zero at this volume.

## First-time setup

```bash
npm install
npx wrangler login

# Create the database, then paste the printed database_id into wrangler.jsonc.
npx wrangler d1 create board-game-guess

npm run db:migrate                  # create the table in the real database
npx wrangler secret put APP_PASSWORD  # the shared family passphrase
npm run deploy
```

Share the deployed URL with the passphrase in the fragment so nobody has to type it:

```
https://board-game-guess.<your-subdomain>.workers.dev/#key=the-passphrase
```

The page stores the passphrase in `localStorage` and strips it from the address bar, so it does not
end up in browser history or in a link someone copies afterwards.

## Local development

```bash
echo 'APP_PASSWORD="local-test-passphrase"' > .dev.vars
npm run db:migrate:local
npm run dev            # http://127.0.0.1:8787
```

With the dev server running, in a second terminal:

```bash
npm run smoke          # end-to-end check of the API
npm run typecheck
```

`wrangler dev` serves `public/` straight from disk, so a browser refresh picks up frontend edits.

## API

Every route needs `Authorization: Bearer <passphrase>` and answers `401` without it.

| Route | Purpose |
| --- | --- |
| `POST /api/check` | `{ hash }` → `{ taken, entries }` |
| `POST /api/entries` | `{ hash, comment }` → `{ entry, duplicates }`, `201` |
| `DELETE /api/entries/:id` | Remove a registration |
| `GET /api/stats` | `{ count }` |

`POST /api/entries` always stores the entry and reports any existing ones in `duplicates`, which is
what lets the page offer "register anyway" for a game two people are legitimately buying for
different recipients.

## Resetting after the holidays

```bash
npx wrangler d1 execute board-game-guess --remote --command "DELETE FROM entries"
```
