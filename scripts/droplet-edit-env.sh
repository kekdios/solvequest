#!/usr/bin/env bash
# Open backend/.env on the droplet in an editor (interactive — needs a real terminal).
#
# Usage:
#   ./scripts/droplet-edit-env.sh
#   ./scripts/droplet-edit-env.sh root@other.host
#   EDITOR=vim APP_DIR=/opt/solvequest ./scripts/droplet-edit-env.sh
#
# Uses DROPLET_ENV_EDITOR if set, else EDITOR, else nano on the remote shell.
# SSH uses -t (TTY) and BatchMode=no so passphrase prompts work if needed.

set -euo pipefail

TARGET="${1:-${DEPLOY_TARGET:-root@152.42.168.173}}"
APP_DIR="${APP_DIR:-/opt/solvequest}"
REMOTE_ED="${DROPLET_ENV_EDITOR:-${EDITOR:-nano}}"

echo "==> Edit ${APP_DIR}/backend/.env on ${TARGET}"
echo "    Remote editor: ${REMOTE_ED}"
echo "    (Save and exit the editor to return.)"

ssh -t -o BatchMode=no "${TARGET}" \
  "env APP_DIR=$(printf %q "${APP_DIR}") EDITOR=$(printf %q "${REMOTE_ED}") bash -s" <<'REMOTE'
set -euo pipefail
f="${APP_DIR}/backend/.env"
dir="${APP_DIR}/backend"
if [[ ! -d "$dir" ]]; then
  echo "error: directory not found: $dir" >&2
  exit 1
fi
if [[ ! -f "$f" ]]; then
  echo "warning: creating empty $f" >&2
  touch "$f"
fi
exec "$EDITOR" "$f"
REMOTE

echo "==> SSH session ended."
