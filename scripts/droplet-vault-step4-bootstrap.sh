#!/usr/bin/env bash
# Step 4 — On the droplet: insert first unsolved row from env (TARGET_ADDRESS, SOLUTION_HASH, PUZZLE_WORDS, ...).
# Run only once unless you use --force (dangerous: two unsolved rows).
#
# Usage:
#   ./scripts/droplet-vault-step4-bootstrap.sh
#   ./scripts/droplet-vault-step4-bootstrap.sh root@your-droplet

set -euo pipefail

TARGET="${1:-${DEPLOY_TARGET:-root@152.42.168.173}}"
APP_DIR="${APP_DIR:-/opt/solvequest}"
SSH_BATCH_MODE="${SSH_BATCH_MODE:-yes}"

echo "==> Step 4: vault bootstrap-from-env on ${TARGET}"

ssh -o BatchMode="${SSH_BATCH_MODE}" "${TARGET}" "bash -s" <<EOF
set -euo pipefail
cd "${APP_DIR}/backend"
npm run vault-init -- bootstrap-from-env
echo ""
echo "==> status after bootstrap:"
npm run vault-init -- status
EOF

echo "==> Step 4 completed."
