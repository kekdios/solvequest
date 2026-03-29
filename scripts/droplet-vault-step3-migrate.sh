#!/usr/bin/env bash
# Step 3 — On the droplet: npm run vault-init -- migrate
# Requires PUZZLE_SOURCE=sqlite and full vault env in backend/.env (see step0).
#
# Usage:
#   ./scripts/droplet-vault-step3-migrate.sh
#   ./scripts/droplet-vault-step3-migrate.sh root@your-droplet

set -euo pipefail

TARGET="${1:-${DEPLOY_TARGET:-root@152.42.168.173}}"
APP_DIR="${APP_DIR:-/opt/solvequest}"
SSH_BATCH_MODE="${SSH_BATCH_MODE:-yes}"

echo "==> Step 3: vault migrate on ${TARGET} (${APP_DIR}/backend)"

ssh -o BatchMode="${SSH_BATCH_MODE}" "${TARGET}" "bash -s" <<EOF
set -euo pipefail
cd "${APP_DIR}/backend"
echo "==> PUZZLE_SOURCE check (non-fatal if empty):"
grep -E '^PUZZLE_SOURCE=' .env 2>/dev/null || echo "(no PUZZLE_SOURCE in .env — step will fail until set)"
echo ""
echo "==> npm run vault-init -- migrate"
npm run vault-init -- migrate
EOF

echo "==> Step 3 completed."
