# Prime Aurora Welfare Society — fund dashboard

A public, anonymised dashboard of the society's 2026 finances, plus a committee-only
editor for the ledger, goals, settings and monthly collections.

- **Committee editor:** `/editor` on the deployed site (sign-in required)

> **This repository must stay private.** `db/migrations/*_seed/migration.sql`
> contains the plot register — 122 households by name — and the migration that
> follows it references a name in a `WHERE` clause. Source workbooks are
> gitignored and are not in the history.

## Privacy model

There are two data shapes, and the split is enforced on the server:

| Endpoint | Auth | Contains names? |
|---|---|---|
| `GET /api/public-data` | none | **No** |
| `GET /api/admin/data` | editor | Yes |
| `POST/PUT/DELETE /api/edit/:entity[/:id]` | editor | — |

`buildPublic()` in `server/shape.ts` assembles the public payload from plot numbers
only. It never reads the `owner` column — this is deliberately not a "delete the
field before sending" filter, because that pattern leaks the moment a new field
is added.

Ledger descriptions *are* public. The editor warns against putting household names
in them; one seeded row had to be generalised for exactly this reason.

## Architecture

Self-hosted, no external platform dependency:

- **Postgres** via Drizzle — all dynamic data, run wherever you like.
- **Express** (`server/index.ts`) — serves the static dashboard and the API.
- **Sessions** — email + password, hashed with bcrypt, an httpOnly JWT cookie
  identifies the caller. Writes additionally require the `editor` role, so an
  account with no role still cannot write. There is no self-serve signup, invite,
  or password recovery flow — accounts are created/reset with
  `npm run create-user` (see below), which fits a small, known set of editors.

## Local development

```bash
npm install
cp .env.example .env   # fill in DATABASE_URL and a real SESSION_SECRET
npm run migrate         # applies db/migrations/* against DATABASE_URL
npm run build            # bundles src/editor.js and src/brand.js into dashboard/
npm run create-user -- you@example.com "a-strong-password" "Your Name" editor
npm run dev
```

Then open `http://localhost:8888` (public dashboard) and `http://localhost:8888/editor`
(sign in with the account you just created).

Schema changes:

```bash
# edit db/schema.ts, then
npm run db:generate -- --name <slug>
npm run migrate
```

Once a migration has been applied anywhere, never edit it — roll forward.

## Deploying

Any host that can run a long-lived Node process and reach a Postgres database
works: a VPS with `pm2`/`systemd`, a Docker container, etc. Build the frontend
bundle (`npm run build`), set `DATABASE_URL`, `SESSION_SECRET`, and `PORT` in
the environment, run `npm run migrate` once against the target database, then
`npm start`.

## Keeping the numbers honest

`months_completed` in **Settings** drives every forecast on the dashboard. It must be
increased at the end of each month or the year-end projection keeps extrapolating from
a stale average. It is range-checked (0–12) but nothing can tell it is *stale*.
