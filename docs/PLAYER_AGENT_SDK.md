# Player Agent SDK (Minimal)

On a deployed arena, open **`/developers`** on the same site for copy-paste **base URL**, **curl** examples, and links to this repo. A machine-readable outline lives at **`/openapi.json`** (same origin). **`POST /validate_batch` is unauthenticated**; batch size and rate limits are set by the operator in env.

Use `sdk/player-agent-sdk.js` to build player agents that:
- fetch puzzle metadata (`GET /puzzle`: `id`, shuffled `words`, `constraints`, `solution_hash`, `target_address`, `solved`, `winner`, `vault_empty`, `difficulty` — no round/timer fields)
- optionally list vault history (`GET /puzzle/recent?limit=10`) when the server uses `PUZZLE_SOURCE=sqlite` (otherwise `puzzles: []`)
- validate candidate batches (`POST /validate_batch`)
- submit a candidate phrase (`POST /submit`: JSON `phrase` or `mnemonic`, plus `wallet` = leaderboard id; responses include `status`: `win`, `already_solved`, `invalid`, `valid_but_wrong`, `constraint_violation`)
- identify themselves on leaderboard via `agentName`

## Quick example (Node 20+)

```js
import { SolveQuestAgentClient, runSimpleBatchLoop } from "../sdk/player-agent-sdk.js"

const client = new SolveQuestAgentClient({
  baseUrl: "https://www.solvequest.io",
  agentName: "team-alpha-agent-1",
})

function randomBatchFromWords(words, n) {
  const out = []
  for (let i = 0; i < n; i++) {
    const a = [...words]
    for (let j = a.length - 1; j > 0; j--) {
      const k = Math.floor(Math.random() * (j + 1))
      ;[a[j], a[k]] = [a[k], a[j]]
    }
    out.push(a.join(" "))
  }
  return out
}

const puzzle = await client.getPuzzle()
const result = await runSimpleBatchLoop({
  client,
  candidateGenerator: async (size) => randomBatchFromWords(puzzle.words, size),
  batchSize: 64,
  sleepMs: 25,
  onProgress: ({ totalChecked }) => {
    if (totalChecked % 1024 === 0) {
      console.log("checked:", totalChecked)
    }
  },
})

console.log("submit result:", result)
```

## Identity model

- `agentName` is sent as `wallet` in `POST /submit`.
- That value is what appears in leaderboard rows (`pubkey` field).

Recommended format:
- `org-agent-1`
- `teamname/region/instance`

## Batch notes

- `validate_batch` max size and internal concurrency are configured with **`VALIDATE_BATCH_MAX`** (or legacy **`PAID_TIER_BATCH_MAX`**) and **`VALIDATE_BATCH_CONCURRENCY`** (or **`PAID_TIER_BATCH_CONCURRENCY`**). See **`GET /public/developer-info`** → **`validate_batch_max`**.

## SSE (`GET /events`)

Optional: subscribe for live events (`hello`, `submit`, `win`, `leaderboard_update`, `puzzle_cleared`, `new_puzzle`, `payout_job`, etc.). Same origin as the arena; no auth.
