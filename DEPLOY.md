# Deploying to a new server

Anything that can run a long-lived Node process and reach a Postgres database
works — a cheap VPS (Hetzner, DigitalOcean, Linode, a spare machine) is enough.
This mirrors the exact setup used for local self-hosting, just on a fresh box.

Assumes Ubuntu/Debian. Adjust package manager commands for other distros.

## 1. Prerequisites on the server

```bash
sudo apt-get update
sudo apt-get install -y git curl postgresql postgresql-contrib ufw
```

Node 20+ (the DB driver needs it):

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v   # confirm >= 20
```

## 2. Database

```bash
sudo -u postgres createuser -P prime_aurora        # pick a strong password
sudo -u postgres createdb -O prime_aurora prime_aurora_fund
```

## 3. Get the code

Repo is **private** — the seed migration has 122 households by name, so it
must stay that way. Clone with a deploy key or a PAT:

```bash
git clone https://github.com/manchitmr/prime-aurora-fund.git
cd prime-aurora-fund
git checkout self-hosted   # or main, once merged
```

## 4. Configure

```bash
cp .env.example .env
```

Edit `.env`:

```
DATABASE_URL=postgresql://prime_aurora:YOUR_DB_PASSWORD@localhost:5432/prime_aurora_fund
SESSION_SECRET=<openssl rand -hex 32>
PORT=8888
```

`SESSION_SECRET` signs the login cookie — generate a fresh one per deployment,
never reuse the one from another environment.

## 5. Install, migrate, build

```bash
npm install
npm run migrate            # applies db/migrations/* — safe to re-run, skips what's applied
npm run build               # bundles src/editor.js and src/brand.js into dashboard/
npm run create-user -- you@example.com "a-strong-password" "Your Name" editor
```

## 6. Run it as a service

```bash
sudo tee /etc/systemd/system/prime-aurora-fund.service > /dev/null <<EOF
[Unit]
Description=Prime Aurora Fund dashboard
After=network.target postgresql.service

[Service]
Type=simple
User=$(whoami)
WorkingDirectory=$(pwd)
EnvironmentFile=$(pwd)/.env
ExecStart=$(pwd)/node_modules/.bin/tsx server/index.ts
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now prime-aurora-fund
sudo systemctl status prime-aurora-fund --no-pager
```

## 7. Open the port

```bash
sudo ufw allow 8888/tcp
```

Site should now answer at `http://SERVER_IP:8888`.

## 8. Put it behind a real domain + HTTPS (recommended)

The app itself only speaks plain HTTP on `PORT`. For a public site, put nginx
in front and let Certbot handle TLS, rather than exposing 8888 directly:

```bash
sudo apt-get install -y nginx certbot python3-certbot-nginx
```

`/etc/nginx/sites-available/prime-aurora-fund`:

```nginx
server {
    listen 80;
    server_name your-domain.example;

    location / {
        proxy_pass http://127.0.0.1:8888;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/prime-aurora-fund /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d your-domain.example
sudo ufw allow 'Nginx Full'
sudo ufw delete allow 8888/tcp   # no longer need this open directly
```

Once TLS is on, also set in `.env`:

```
NODE_ENV=production
```

so the session cookie gets `Secure` (server/auth.ts checks `NODE_ENV` for this) —
restart the service after changing it: `sudo systemctl restart prime-aurora-fund`.

## 9. Backups

Copy `scripts/backup-db.sh` over as-is — it reads `DATABASE_URL` from `.env`
in the repo root, dumps to `~/backups/prime-aurora-fund/`, and prunes anything
older than 14 days. Wire it into cron:

```bash
crontab -e
# add:
0 2 * * * /path/to/prime-aurora-fund/scripts/backup-db.sh >> ~/backups/prime-aurora-fund/backup.log 2>&1
```

To verify a backup restores cleanly, restore it into a throwaway database
rather than the live one:

```bash
sudo -u postgres createdb -O prime_aurora prime_aurora_fund_restore_test
gunzip -c ~/backups/prime-aurora-fund/<file>.sql.gz | psql "postgresql://prime_aurora:PW@localhost:5432/prime_aurora_fund_restore_test"
# spot-check row counts / checksums against the live DB, then:
sudo -u postgres dropdb prime_aurora_fund_restore_test
```

## 10. Day-to-day

- Deploy a change: `git pull`, `npm install` (if deps changed), `npm run build`
  (if `src/*.js` changed), `npm run migrate` (if `db/schema.ts` changed),
  `sudo systemctl restart prime-aurora-fund`.
- New editor / reset a password: `npm run create-user -- email pass "Name" editor`.
- Logs: `journalctl -u prime-aurora-fund -f`.
