#!/usr/bin/env bash
set -euo pipefail

# Local deploy helper for SolveQuest (Express + Vite SPA).
# Runs from your machine and pulls + builds on the droplet over SSH.
#
# Droplet should run the app with systemd (e.g. solvequest.service):
#   WorkingDirectory=/opt/solvequest
#   Environment=NODE_ENV=production
#   Environment=PORT=3001
#   ExecStart=/usr/bin/npm start
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
# Port the Node process listens on (must match systemd Environment=PORT=…)
HEALTH_PORT="${HEALTH_PORT:-3001}"
SSH_BATCH_MODE="${SSH_BATCH_MODE:-yes}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCAL_VER="$(grep -m1 '"version"' "${ROOT}/package.json" | sed 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')"
PUBLIC_BASE="${PUBLIC_HEALTH_URL%/health}"
PUBLIC_BASE="${PUBLIC_BASE%/}"

echo "==> Deploy target: ${TARGET}"
echo "==> App dir: ${APP_DIR}"
echo "==> Branch: ${BRANCH}"
echo "==> Service: ${SERVICE_NAME}"
echo "==> Health port (droplet): ${HEALTH_PORT}"
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

echo "==> package.json version (after pull)"
grep -m1 '"version"' "${APP_DIR}/package.json" || true

echo "==> Install dependencies + production build"
cd "${APP_DIR}"
if npm ci >/dev/null 2>&1; then
  echo "Dependencies installed via npm ci"
else
  echo "npm ci failed, falling back to npm install"
  npm install
fi

npm run build

echo "==> Restart service"
systemctl restart "${SERVICE_NAME}"
systemctl is-active --quiet "${SERVICE_NAME}"
echo "Service '${SERVICE_NAME}' is active."

echo "==> Local health check (retry up to 30s)"
ok=0
for i in \$(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${HEALTH_PORT}/health" >/dev/null 2>&1; then
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

echo "==> Local /version (after restart)"
curl -fsS "http://127.0.0.1:${HEALTH_PORT}/version" || true
echo ""

echo "Local health OK"
EOF

echo "==> Public health check: ${PUBLIC_HEALTH_URL}"
curl -fsS "${PUBLIC_HEALTH_URL}" >/dev/null
echo "Public health OK"

echo "==> Public GET /version"
PUB_VER="$(curl -fsS "${PUBLIC_BASE}/version")"
echo "${PUB_VER}"
echo "==> Local repo version (this machine): ${LOCAL_VER}"
if echo "${PUB_VER}" | grep -q "\"version\":\"${LOCAL_VER}\""; then
  echo "Public /version matches local package.json — OK"
else
  echo "WARNING: Public /version does not match local package.json." >&2
  echo "  Push commits to origin, redeploy, or fix APP_DIR / branch on the server." >&2
fi

echo "==> Deploy completed successfully."
