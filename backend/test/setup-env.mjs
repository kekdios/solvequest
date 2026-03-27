/**
 * Loaded first via: node --import ./test/setup-env.mjs --test …
 * Ensures puzzle.js can load PUZZLE; disables Redis for in-memory store tests.
 */
process.env.TARGET_ADDRESS =
  process.env.TARGET_ADDRESS ||
  "6h4oTiusvVchVP67bjTLmuCxGjyPo2fSNTR1Pq4nwwGy"
process.env.SOLUTION_HASH =
  process.env.SOLUTION_HASH ||
  "51c2a6fd1a8541e22e77de993206a240a75356286427f53ae2a31ef38a30beca"
process.env.PUZZLE_WORDS =
  process.env.PUZZLE_WORDS ||
  "estate,refuse,glad,rare,only,faith,maximum,wide,army,hub,rent,wisdom"
process.env.PUZZLE_ID = process.env.PUZZLE_ID || "001"
delete process.env.REDIS_URL
process.env.API_KEYS_JSON = JSON.stringify({
  sk_test_fixture: { credits: 100, tier: "paid" },
})
