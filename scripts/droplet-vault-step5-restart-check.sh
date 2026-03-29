#!/usr/bin/env bash
# Step 5 — Restart systemd service and verify /health + /puzzle (sqlite mode must load vault row).
#
# Usage:
#   ./scripts/droplet-vault-step5-restart-check.sh
#   ./scripts/droplet-vault-step5-restart-check.sh root@your-droplet

set -euo pipefail

TARGET="${1:-${DEPLOY_TARGET:-root@152.42.168.173}}"
APP_DIR="${APP_DIR:-/opt/solvequest}"
SERVICE_NAME="${SERVICE_NAME:-solvequest}"
PUBLIC_HEALTH_URL="${PUBLIC_HEALTH_URL:-https://solvequest.io/health}"
PUBLIC_BASE="${PUBLIC_HEALTH_URL%/health}"
PUBLIC_BASE="${PUBLIC_BASE%/}"
SSH_BATCH_MODE="${SSH_BATCH_MODE:-yes}"

echo "==> Step 5: restart ${SERVICE_NAME} on ${TARGET} and smoke-check"

ssh -o BatchMode="${SSH_BATCH_MODE}" "${TARGET}" "bash -s" <<EOF
set -euo pipefail
systemctl restart "${SERVICE_NAME}"
systemctl is-active --quiet "${SERVICE_NAME}"
echo "Service active."

ok=0
for i in \$(seq 1 30); do
  if curl -fsS http://127.0.0.1:3001/health >/dev/null 2>&1; then
    ok=1
    break
  fi
  sleep 1
done
if [ "\$ok" -ne 1 ]; then
  echo "LOCAL health FAILED"
  journalctl -u "${SERVICE_NAME}" -n 60 --no-pager || true
  exit 1
fi

echo "==> GET /version"
curl -fsS http://127.0.0.1:3001/version
echo ""

echo "==> GET /puzzle (first 400 chars)"
curl -fsS http://127.0.0.1:3001/puzzle | head -c 400
echo ""
echo "(truncated)"
EOF

echo ""
echo "==> Public health: ${PUBLIC_HEALTH_URL}"
curl -fsS "${PUBLIC_HEALTH_URL}"
echo ""
echo "Public OK"

echo "==> Public /puzzle (truncated)"
curl -fsS "${PUBLIC_BASE}/puzzle" | head -c 400
echo ""
echo "==> Step 5 completed."
