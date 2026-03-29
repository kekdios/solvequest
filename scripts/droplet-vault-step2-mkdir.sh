#!/usr/bin/env bash
# Step 2 — On the droplet: create SQLite data + backup directories (no secrets).
# Edit backend/.env on the server BEFORE step3 (see droplet-vault-step0-env-hint.sh).
#
# Usage:
#   ./scripts/droplet-vault-step2-mkdir.sh
#   ./scripts/droplet-vault-step2-mkdir.sh root@152.42.168.173

set -euo pipefail

TARGET="${1:-${DEPLOY_TARGET:-root@152.42.168.173}}"
APP_DIR="${APP_DIR:-/opt/solvequest}"
DATA_DIR="${VAULT_DATA_DIR:-${APP_DIR}/data/puzzle-vault}"
BACKUP_DIR="${VAULT_BACKUP_DIR:-${DATA_DIR}/puzzle-vault-backups}"
SSH_BATCH_MODE="${SSH_BATCH_MODE:-yes}"

echo "==> Step 2: mkdir on ${TARGET}"
echo "    DATA_DIR=${DATA_DIR}"
echo "    BACKUP_DIR=${BACKUP_DIR}"

ssh -o BatchMode="${SSH_BATCH_MODE}" "${TARGET}" "bash -s" <<EOF
set -euo pipefail
mkdir -p "${DATA_DIR}" "${BACKUP_DIR}"
chmod 700 "${DATA_DIR}" || true
ls -la "${DATA_DIR}"
echo ""
echo ">>> If you have not yet merged vault lines into ${APP_DIR}/backend/.env, do that now."
echo ">>> Then run: ./scripts/droplet-vault-step3-migrate.sh ${TARGET}"
EOF

echo "==> Step 2 completed."
