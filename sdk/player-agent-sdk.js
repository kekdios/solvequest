export class SolveQuestAgentClient {
  constructor({
    baseUrl,
    agentName,
    apiKey = "",
    fetchImpl = globalThis.fetch,
  }) {
    if (!baseUrl) throw new Error("baseUrl is required")
    if (!agentName) throw new Error("agentName is required")
    if (!fetchImpl) throw new Error("fetch implementation is required")
    this.baseUrl = baseUrl.replace(/\/+$/, "")
    this.agentName = agentName
    this.apiKey = apiKey
    this.fetch = fetchImpl
  }

  _headers(extra = {}) {
    const h = { "Content-Type": "application/json", ...extra }
    if (this.apiKey) h["x-api-key"] = this.apiKey
    return h
  }

  async getPuzzle() {
    const r = await this.fetch(`${this.baseUrl}/puzzle`)
    if (!r.ok) throw new Error(`GET /puzzle ${r.status}`)
    return r.json()
  }

  async validateBatch(mnemonics) {
    const r = await this.fetch(`${this.baseUrl}/validate_batch`, {
      method: "POST",
      headers: this._headers(),
      body: JSON.stringify({ mnemonics }),
    })
    if (!r.ok) {
      const txt = await r.text()
      throw new Error(`POST /validate_batch ${r.status}: ${txt}`)
    }
    return r.json()
  }

  async submitPhrase(phrase) {
    const r = await this.fetch(`${this.baseUrl}/submit`, {
      method: "POST",
      headers: this._headers(),
      body: JSON.stringify({
        phrase,
        wallet: this.agentName,
      }),
    })
    if (!r.ok) {
      const txt = await r.text()
      throw new Error(`POST /submit ${r.status}: ${txt}`)
    }
    return r.json()
  }
}

export async function runSimpleBatchLoop({
  client,
  candidateGenerator,
  batchSize = 64,
  sleepMs = 50,
  onProgress = () => {},
}) {
  if (!client) throw new Error("client is required")
  if (typeof candidateGenerator !== "function") {
    throw new Error("candidateGenerator must be a function")
  }
  let totalChecked = 0
  while (true) {
    const batch = await candidateGenerator(batchSize)
    if (!Array.isArray(batch) || batch.length === 0) {
      throw new Error("candidateGenerator returned an empty batch")
    }
    const results = await client.validateBatch(batch)
    totalChecked += batch.length
    let matched = -1
    for (let i = 0; i < results.length; i++) {
      if (results[i]?.matches_target === true) {
        matched = i
        break
      }
    }
    onProgress({ totalChecked, matched, batchSize: batch.length })
    if (matched >= 0) {
      return client.submitPhrase(batch[matched])
    }
    if (sleepMs > 0) {
      await new Promise((r) => setTimeout(r, sleepMs))
    }
  }
}
