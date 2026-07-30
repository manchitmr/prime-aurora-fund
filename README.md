# Prime Aurora Welfare Society — fund dashboard

A public, anonymised dashboard of the society's 2026 finances, plus a committee-only
editor for the ledger, goals, settings and monthly collections.

- **Public dashboard:** https://prime-aurora-fund-2026.netlify.app
- **Committee editor:** `/editor` on the same site (sign-in required)

> **This repository must stay private.** `netlify/database/migrations/*_seed/migration.sql`
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

`buildPublic()` in `netlify/functions/_shared/shape.ts` assembles the public payload
from plot numbers only. It never reads the `owner` column — this is deliberately not
a "delete the field before sending" filter, because that pattern leaks the moment a
new field is added.

Ledger descriptions *are* public. The editor warns against putting household names
in them; one seeded row had to be generalised for exactly this reason.

## Architecture

- **Netlify Database** (Postgres) via Drizzle — all dynamic data. Blobs is for files only.
- **Netlify Identity** — invite-only, per-person logins. Writes additionally require
  an `editor` role, so an accidentally-open registration still grants nobody write access.
- **Netlify Functions** — the API. Every change is written to `audit_log` with the
  editor's email.

### Two platform gotchas encoded here

1. **A path-routed Function must never return 404.** The platform treats the route as
   unhandled and falls through to static-file candidates, re-entering the function with
   a mangled path and a misleading error. Use `400` (bad input) or `409` (row vanished).
2. **Identity and Database settings are dashboard-only.** There is no API. Changing them
   is always a human step.

## Local development

```bash
npm install
netlify database migrations apply   # local dev DB only — never a hosted one
netlify dev
```

Hosted databases (production and deploy previews) get their migrations applied by the
deploy. Never run `drizzle-kit migrate` or `push` against `NETLIFY_DB_URL`.

Schema changes:

```bash
# edit db/schema.ts, then
npx drizzle-kit generate --name <slug>
```

Data-only changes use a hand-written migration:

```bash
netlify database migrations new -d "what it does"
```

Once a migration has been applied anywhere, never edit it — roll forward.

## First-time setup checklist

In the Netlify dashboard at
`app.netlify.com/projects/prime-aurora-fund-2026/configuration/identity`:

- [ ] Identity → **Enable**
- [ ] Registration → **Invite only**
- [ ] Autoconfirm → **Off** (members confirm by email)
- [ ] Invite each committee member
- [ ] For each user → Edit roles → add **`editor`**

Members open `/editor`, accept the invite and set a password.

## Keeping the numbers honest

`months_completed` in **Settings** drives every forecast on the dashboard. It must be
increased at the end of each month or the year-end projection keeps extrapolating from
a stale average. It is range-checked (0–12) but nothing can tell it is *stale*.
