import { describe, expect, it } from 'vitest'
import { foldSessionUsage, type FoldableEvent } from '../src/fold.ts'

const header = (time: number, provider: string, model: string): FoldableEvent => ({
  type: 'request/header',
  time,
  data: { header: { config: { provider, model } } },
})

const context = (time: number, provider: string, model: string): FoldableEvent => ({
  type: 'request/context',
  time,
  data: { provider, model },
})

const chunk = (
  time: number,
  turn: number,
  step: number,
  usage: { inputTokens: number, outputTokens: number, cacheReadTokens?: number },
): FoldableEvent => ({
  type: 'assistant/chunk',
  time,
  data: {
    turn,
    step,
    chunk: { type: 'usage', usage },
  },
})

const message = (
  time: number,
  turn: number,
  step: number,
  usage: { inputTokens: number, outputTokens: number, cacheReadTokens?: number },
): FoldableEvent => ({
  type: 'assistant/message',
  time,
  data: { turn, step, usage },
})

const stamp = {
  sessionId: 's1',
  workspaceId: 'w1',
  workspaceTitle: 'Repo',
}

describe('foldSessionUsage', () => {
  it('replaces the same turn/step instead of double-counting', () => {
    const events = foldSessionUsage({
      ...stamp,
      events: [
        header(1, 'openai-codex', 'gpt-5.6-sol'),
        chunk(2, 1, 1, { inputTokens: 10, outputTokens: 2, cacheReadTokens: 100 }),
        message(3, 1, 1, { inputTokens: 12, outputTokens: 4, cacheReadTokens: 100 }),
      ],
    })
    expect(events).toEqual([{
      time: 3,
      sessionId: 's1',
      workspaceId: 'w1',
      workspaceTitle: 'Repo',
      provider: 'openai-codex',
      model: 'gpt-5.6-sol',
      uncachedInputTokens: 12,
      outputTokens: 4,
      cacheReadTokens: 100,
      cacheWriteTokens: 0,
    }])
  })

  it('emits a new sample when the step changes', () => {
    const events = foldSessionUsage({
      ...stamp,
      events: [
        header(1, 'kimi-coding', 'k3'),
        message(2, 1, 1, { inputTokens: 8, outputTokens: 1 }),
        message(3, 1, 2, { inputTokens: 9, outputTokens: 2 }),
      ],
    })
    expect(events).toHaveLength(2)
    expect(events[0]?.uncachedInputTokens).toBe(8)
    expect(events[1]?.uncachedInputTokens).toBe(9)
  })

  it('follows request/context when the route changes mid-session', () => {
    const events = foldSessionUsage({
      ...stamp,
      events: [
        header(1, 'openai-codex', 'gpt-5.6-sol'),
        message(2, 1, 1, { inputTokens: 1, outputTokens: 1 }),
        context(3, 'kimi-coding', 'k3'),
        message(4, 2, 1, { inputTokens: 5, outputTokens: 2 }),
      ],
    })
    expect(events[0]?.provider).toBe('openai-codex')
    expect(events[1]).toMatchObject({ provider: 'kimi-coding', model: 'k3', uncachedInputTokens: 5 })
  })

  it('skips events that carry no usage', () => {
    const events = foldSessionUsage({
      ...stamp,
      events: [
        header(1, 'ollama', 'glm-5.2'),
        { type: 'turn/start', time: 2, data: { turn: 1 } },
        { type: 'assistant/chunk', time: 3, data: { turn: 1, step: 1, chunk: { type: 'text', text: 'hi' } } },
      ],
    })
    expect(events).toEqual([])
  })
})
