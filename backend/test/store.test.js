import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { initStore, closeStore, recordVisitor, listVisitors } from "../store.js"

before(async () => {
  await initStore()
})

after(async () => {
  await closeStore()
})

test("recordVisitor and listVisitors (in-memory)", async () => {
  await recordVisitor({ ts: 1, ip: "203.0.113.1", path: "/", country: "ZZ" })
  await recordVisitor({ ts: 2, ip: "203.0.113.2", path: "/developers" })
  const { visitors, total } = await listVisitors({ limit: 10, offset: 0 })
  assert.equal(total, 2)
  assert.equal(visitors.length, 2)
  assert.equal(visitors[0].ip, "203.0.113.2")
  assert.equal(visitors[1].country, "ZZ")
})
