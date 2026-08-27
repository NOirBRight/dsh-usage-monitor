import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { UsageProjection } from '../lib/index.js'

const SESSION_COUNT = 1_346
const STEP_COUNT = 83_883
const BASE_STEPS = Math.floor(STEP_COUNT / SESSION_COUNT)
const EXTRA_STEPS = STEP_COUNT % SESSION_COUNT

const sessions = Array.from({ length: SESSION_COUNT }, (_, index) => ({
  id: `synthetic-${index}`,
  revision: 'r1',
  createdAt: 1,
}))

let sourceReads = 0
let activeReads = 0
let peakReadConcurrency = 0
const corpus = {
  async listSessions() {
    return sessions
  },
  async readEvents(sessionId) {
    sourceReads += 1
    activeReads += 1
    peakReadConcurrency = Math.max(peakReadConcurrency, activeReads)
    try {
      const index = Number(sessionId.slice('synthetic-'.length))
      const count = BASE_STEPS + (index < EXTRA_STEPS ? 1 : 0)
      const events = [{
        type: 'request/header',
        time: 1,
        data: { header: { config: { provider: 'synthetic', model: 'bounded' } } },
      }]
      for (let step = 0; step < count; step += 1) {
        events.push({
          type: 'assistant/message',
          time: 2 + step,
          data: { turn: 1, step, usage: { inputTokens: 2, outputTokens: 1 } },
        })
      }
      return events
    } finally {
      activeReads -= 1
    }
  },
}
const workspaces = { list: () => [] }
const query = { start: 0, end: 1_000 }
const dir = await mkdtemp(join(tmpdir(), 'dsh-usage-benchmark-'))
const projection = new UsageProjection(join(dir, 'usage.sqlite'))

try {
  const heapBefore = process.memoryUsage().heapUsed
  const coldStarted = performance.now()
  const cold = await projection.query({
    corpus,
    workspaces,
    query,
    readConcurrency: 1,
    transactionBatchSize: 8,
  })
  const coldMs = performance.now() - coldStarted
  const coldReads = sourceReads
  const heapAfterCold = process.memoryUsage().heapUsed

  const warmStarted = performance.now()
  const warm = await projection.query({
    corpus,
    workspaces,
    query,
    readConcurrency: 1,
    transactionBatchSize: 8,
  })
  const warmMs = performance.now() - warmStarted

  const metrics = {
    synthetic: { sessions: SESSION_COUNT, steps: STEP_COUNT },
    cold: {
      requests: cold.summary.requests,
      sourceReads: coldReads,
      milliseconds: Number(coldMs.toFixed(1)),
      heapDeltaMiB: Number(((heapAfterCold - heapBefore) / 1024 / 1024).toFixed(1)),
    },
    warm: {
      requests: warm.summary.requests,
      sourceReads: sourceReads - coldReads,
      milliseconds: Number(warmMs.toFixed(1)),
    },
    peakReadConcurrency,
  }
  console.log(JSON.stringify(metrics, null, 2))
  if (
    cold.summary.requests !== STEP_COUNT
    || warm.summary.requests !== STEP_COUNT
    || coldReads !== SESSION_COUNT
    || sourceReads !== coldReads
    || peakReadConcurrency > 1
  ) {
    process.exitCode = 1
  }
} finally {
  await projection.close()
  await rm(dir, { recursive: true, force: true })
}
