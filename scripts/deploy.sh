#!/usr/bin/env bash
set -euo pipefail

# Local deploy helper for SolveQuest.
# Runs from your Mac and executes safe deploy steps on the droplet over SSH.
#
# Usage:
#   ./scripts/deploy.sh
#   ./scripts/deploy.sh root@152.42.168.173
#   BRANCH=main APP_DIR=/opt/solvequest ./scripts/deploy.sh root@152.42.168.173

TARGET="${1:-${DEPLOY_TARGET:-root@152.42.168.173}}"
BRANCH="${BRANCH:-main}"
APP_DIR="${APP_DIR:-/opt/solvequest}"
SERVICE_NAME="${SERVICE_NAME:-solvequest}"
PUBLIC_HEALTH_URL="${PUBLIC_HEALTH_URL:-https://solvequest.io/health}"
SSH_BATCH_MODE="${SSH_BATCH_MODE:-yes}"

echo "==> Deploy target: ${TARGET}"
echo "==> App dir: ${APP_DIR}"
echo "==> Branch: ${BRANCH}"
echo "==> Service: ${SERVICE_NAME}"
echo "==> SSH batch mode: ${SSH_BATCH_MODE}"

ssh -o BatchMode="${SSH_BATCH_MODE}" "${TARGET}" "bash -s" <<EOF
set -euo pipefail

echo "==> Enter app directory"
cd "${APP_DIR}"

echo "==> Fetch + switch branch"
git fetch --all --prune
git checkout "${BRANCH}"

echo "==> Pull latest code"
git pull --ff-only origin "${BRANCH}"

echo "==> Install backend dependencies (prefer npm ci)"
cd "${APP_DIR}/backend"
if npm ci --omit=dev >/dev/null 2>&1; then
  echo "Backend dependencies installed via npm ci"
else
  echo "Backend npm ci failed, falling back to npm install"
  npm install --omit=dev >/dev/null 2>&1 || npm install
fi

echo "==> Install worker dependencies (prefer npm ci)"
cd "${APP_DIR}/worker"
if npm ci --omit=dev >/dev/null 2>&1; then
  echo "Worker dependencies installed via npm ci"
else
  echo "Worker npm ci failed, falling back to npm install"
  npm install --omit=dev >/dev/null 2>&1 || npm install
fi

echo "==> Restart service"
systemctl restart "${SERVICE_NAME}"
systemctl is-active --quiet "${SERVICE_NAME}"
echo "Service '${SERVICE_NAME}' is active."

echo "==> Local health check (retry up to 30s)"
ok=0
for i in \$(seq 1 30); do
  if curl -fsS http://127.0.0.1:3001/health >/dev/null; then
    ok=1
    break
  fi
  sleep 1
done

if [ "\$ok" -ne 1 ]; then
  echo "Local health FAILED after restart. Service diagnostics:"
  systemctl status "${SERVICE_NAME}" --no-pager || true
  journalctl -u "${SERVICE_NAME}" -n 80 --no-pager || true
  exit 1
fi

echo "Local health OK"
EOF

echo "==> Public health check: ${PUBLIC_HEALTH_URL}"
curl -fsS "${PUBLIC_HEALTH_URL}" >/dev/null
echo "Public health OK"

echo "==> Deploy completed successfully."
