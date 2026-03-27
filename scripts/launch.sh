#!/usr/bin/env bash
# Start SolveQuest backend + static frontend (arena, /developers, puzzle-wizard, etc.)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$ROOT/backend"

cd "$BACKEND"

if [[ ! -f .env ]]; then
  if [[ -f .env.example ]]; then
    echo "[launch] No .env — copy and edit: cp .env.example .env" >&2
  else
    echo "[launch] No .env in backend/" >&2
  fi
fi

if [[ ! -d node_modules ]]; then
  echo "[launch] Installing backend dependencies..."
  npm install
fi

echo "[launch] Backend + frontend: http://127.0.0.1:${PORT:-3001}"
echo "[launch] Arena: http://127.0.0.1:${PORT:-3001}/index.html"
echo "[launch] Puzzle wizard: http://127.0.0.1:${PORT:-3001}/puzzle-wizard.html"
exec node server.js
