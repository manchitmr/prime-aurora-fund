#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
set -a
source "$DIR/.env"
set +a

BACKUP_DIR="$HOME/backups/prime-aurora-fund"
mkdir -p "$BACKUP_DIR"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$BACKUP_DIR/prime-aurora-fund-$STAMP.sql.gz"

pg_dump "$DATABASE_URL" | gzip > "$FILE"

# Keep 14 days of daily backups.
find "$BACKUP_DIR" -name 'prime-aurora-fund-*.sql.gz' -mtime +14 -delete

echo "Backed up to $FILE"
