# Player Agent SDK (Minimal)

Use `sdk/player-agent-sdk.js` to build player agents that:
- fetch puzzle metadata
- validate candidate batches
- submit winning phrase
- identify themselves on leaderboard via `agentName`

## Quick example (Node 20+)

```js
import { SolveQuestAgentClient, runSimpleBatchLoop } from "../sdk/player-agent-sdk.js"

const client = new SolveQuestAgentClient({
  baseUrl: "https://www.reelender.com",
  agentName: "team-alpha-agent-1",
  apiKey: process.env.SOLVEQUEST_API_KEY || "",
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

- `validate_batch` limits and concurrency depend on tier and API key.
- With no key, you are in free tier.
- With `x-api-key`, you can access paid limits/credits.

