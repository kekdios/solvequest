#!/usr/bin/env bash
# Hot-backup SQLite (default: data/solvequest.db) and prune backups older than RETENTION_DAYS.
#
# Defaults match production: repo root is inferred from this script’s location.
# Optional: set SOLVEQUEST_ROOT, SOLVEQUEST_DB_PATH, SOLVEQUEST_BACKUP_DIR,
# SOLVEQUEST_BACKUP_RETENTION_DAYS (default 7).
#
# Cron (user crontab): daily at 03:15 — adjust TZ as needed
#   15 3 * * * /opt/solvequest/scripts/backup-db.sh >> /var/log/solvequest-backup.log 2>&1
#
# Or system cron (/etc/cron.d/solvequest-backup — note user field):
#   15 3 * * * root /opt/solvequest/scripts/backup-db.sh >> /var/log/solvequest-backup.log 2>&1
#
# Requires: sqlite3 (package sqlite3 on Debian/Ubuntu)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -n "${SOLVEQUEST_ROOT:-}" ]]; then
  ROOT="${SOLVEQUEST_ROOT}"
fi

if [[ -f "${ROOT}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${ROOT}/.env"
  set +a
fi

DB_PATH="${SOLVEQUEST_DB_PATH:-${ROOT}/data/solvequest.db}"
BACKUP_DIR="${SOLVEQUEST_BACKUP_DIR:-${ROOT}/data/backups}"
RETENTION_DAYS="${SOLVEQUEST_BACKUP_RETENTION_DAYS:-7}"

sql_escape_single() {
  printf '%s' "$1" | sed "s/'/''/g"
}

mkdir -p "${BACKUP_DIR}"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="${BACKUP_DIR}/solvequest-${STAMP}.db"

if [[ ! -f "${DB_PATH}" ]]; then
  echo "error: database not found: ${DB_PATH}" >&2
  exit 1
fi

ESC_OUT="$(sql_escape_single "${OUT}")"
sqlite3 "${DB_PATH}" ".backup '${ESC_OUT}'"

echo "backup OK: ${OUT}"

find "${BACKUP_DIR}" -maxdepth 1 -type f -name 'solvequest-*.db' -mtime "+${RETENTION_DAYS}" -delete

echo "pruned backups older than ${RETENTION_DAYS} days under ${BACKUP_DIR}"
