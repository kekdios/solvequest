#!/usr/bin/env bash
# Step 1 — Deploy latest code + npm ci + restart (same as deploy.sh).
# Run from repo root on your Mac. Paste the full output if something fails.
#
# Usage:
#   ./scripts/droplet-vault-step1-deploy.sh
#   ./scripts/droplet-vault-step1-deploy.sh root@your-droplet
#   BRANCH=main APP_DIR=/opt/solvequest ./scripts/droplet-vault-step1-deploy.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec "${ROOT}/scripts/deploy.sh" "$@"
