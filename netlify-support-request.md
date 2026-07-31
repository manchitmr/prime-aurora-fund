# Netlify support request — RESOLVED, kept as a troubleshooting record

> **Status: no longer needed as of 31 Jul 2026.** Push-triggered builds started
> succeeding again on their own — deploy `6a6c5cf4637a4d0008b6e1ba` (commit
> `a556e96`) built and published from a normal `git push`. The cause of the
> original block was never identified, so this is kept in case it returns.
>
> **Symptoms to match against:** a `git push` produces a deploy that fails
> immediately with "Build blocked: Unrecognized Git contributor", while builds
> triggered from the dashboard or by `netlify init` succeed on the *same*
> commit. If that happens again, send the request below.

Send via https://app.netlify.com/support (or the Help menu in the dashboard),
so it arrives attached to your account.

---

**Subject:** Builds blocked with "Unrecognized Git contributor" on my own commits — private repo, Free plan

Hello,

Every push-triggered build on my site is being blocked with:

> Build blocked: Unrecognized Git contributor. This plan allows only verified
> account members to push to private repos.

Details:

- **Team:** manchitmr's team (`manchitmr`)
- **Site:** prime-aurora-fund-2026 — `cc581ac4-0078-4648-83bf-74b61e049d40`
- **Repo:** github.com/manchitmr/prime-aurora-fund (private)
- **Plan:** Free (credit-free)
- **Blocked deploys:** `6a6b8dc03fb1e300085bb67e`, `6a6b995b7cde283106ef270d`

What I have already checked:

1. I am the account owner, and the commits are authored by my own address,
   `manchitmr@gmail.com`.
2. GitHub attributes the commits to my account — `GET /repos/manchitmr/prime-aurora-fund/commits/<sha>`
   returns `author.login: "manchitmr"`, so they are not unattributed commits.
3. The only build that has ever succeeded is the one `netlify init` triggered
   directly (deploy `6a6b8cc1d42ea23985fb876a`). Every build triggered by a
   *push* is blocked, with identical commit authorship.
4. It is not the commit message — I removed the `Co-Authored-By` trailer and
   pushed again, and the build was blocked with the same error.

My questions:

- What exactly makes a contributor "verified" here, and what do I need to do to
  become one on my own account?
- Is this a Free-plan limitation on private repositories? If so, which plan
  lifts it?

This is blocking all deploys. The site uses Netlify Database, and I have
confirmed that CLI deploys (`netlify deploy --build`, including with
`--context production`) do **not** receive `NETLIFY_DB_URL` — only
Netlify-run builds do. So a manual CLI deploy is not a workaround for me, and
I currently have no way to ship a change at all.

Thanks,
Manchit

---

## If support says it is a plan limit

Do **not** make the repository public to work around it. The seed migration in
`netlify/database/migrations/*_seed/migration.sql` lists 122 households by
name, along with their payment history.

Options in that case, best first:

1. Upgrade the plan (confirm with support that it actually lifts this specific
   check before paying).
2. Move the household names out of the repository entirely — keep the schema
   migrations in git, and load the name/plot seed separately as a one-off
   import. That would let the repo go public safely, but it is a real chunk of
   work and worth doing only if upgrading is off the table.
