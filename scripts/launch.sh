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

# Same as server.js: env PORT wins; else .env; default 3001 (avoids wrong URLs when PORT is only in .env)
effective_port="$(
  node --input-type=module -e "import 'dotenv/config'; console.log(Number(process.env.PORT) || 3001)" 2>/dev/null || echo 3001
)"

echo "[launch] Backend + frontend: http://127.0.0.1:${effective_port}"
echo "[launch] Arena: http://127.0.0.1:${effective_port}/index.html"
echo "[launch] Developers: http://127.0.0.1:${effective_port}/developers"
echo "[launch] OpenAPI: http://127.0.0.1:${effective_port}/openapi.json"
echo "[launch] Puzzle wizard: http://127.0.0.1:${effective_port}/puzzle-wizard.html"
echo "[launch] Health: http://127.0.0.1:${effective_port}/health"
exec node server.js
