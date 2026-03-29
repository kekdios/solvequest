#!/usr/bin/env bash
# LOCAL ONLY — no SSH. Prints the block to merge into the droplet's backend/.env
# before running migrate/bootstrap on the server.
#
# Usage (from repo root):
#   ./scripts/droplet-vault-step0-env-hint.sh
#   APP_DIR=/opt/solvequest ./scripts/droplet-vault-step0-env-hint.sh

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/solvequest}"
SQLITE_FILE="${VAULT_SQLITE_FILE:-${APP_DIR}/data/puzzle-vault/vault.db}"

cat <<EOF
=== Add or merge these into:  ${APP_DIR}/backend/.env  (on the droplet) ===
# Or edit on the server from your Mac:  ./scripts/droplet-edit-env.sh

# Puzzle vault (SQLite) — after this, run step3 migrate + step4 bootstrap on the droplet
PUZZLE_SOURCE=sqlite
SQLITE_PATH=${SQLITE_FILE}
# Optional override; default is dirname(SQLITE_PATH)/puzzle-vault-backups
# SQLITE_BACKUP_DIR=${APP_DIR}/data/puzzle-vault/puzzle-vault-backups
SQLITE_BACKUP_KEEP=7

# QUEST (optional; set QUEST_AUTO_FUND=1 to send QUEST to TARGET_ADDRESS after bootstrap insert)
# QUEST_AUTO_FUND=1
# QUEST_OPERATOR_SECRET_KEY=<base58 or JSON secret — never commit>
# QUEST_OPERATOR_PUBLIC_KEY=<optional; must match pubkey from secret>
# QUEST_MINT=<SPL mint address (QUEST token; not SAUSD / PRIZE_SPL_MINT)>
# QUEST_FUND_AMOUNT_RAW=<positive integer, smallest units>
# SOLANA_RPC_URL=https://api.mainnet-beta.solana.com

# One-time bootstrap reads these (same as classic env puzzle) for the FIRST vault row only:
TARGET_ADDRESS=<...>
SOLUTION_HASH=<...>
PUZZLE_WORDS=word1,word2,...,word12
PUZZLE_ID=001
# PUZZLE_CONSTRAINTS_JSON={"fixed_positions":{"0":"word1","11":"word12"}}
# PUZZLE_DIFFICULTY=easy

=== Data directory (created by step2 on the droplet) ===
${APP_DIR}/data/puzzle-vault/

=== On your Mac (zsh-safe block: comments start with #; only ./ lines run) ===
# First: cd into your solvequest clone, e.g.
#   cd /Users/private/solana_agent/solvequest
# Default SSH user@host is root@152.42.168.173 (same as deploy.sh). Override:
#   DEPLOY_TARGET=root@other.host ./scripts/droplet-vault-step1-deploy.sh
#   or pass root@other.host as the first argument to any step script.

./scripts/droplet-vault-step1-deploy.sh
# After deploy: merge the env block above into ${APP_DIR}/backend/.env on the droplet, then:
./scripts/droplet-vault-step2-mkdir.sh
./scripts/droplet-vault-step3-migrate.sh
./scripts/droplet-vault-step4-bootstrap.sh
./scripts/droplet-vault-step5-restart-check.sh

# If anything fails, paste the full terminal output for that step.
EOF
