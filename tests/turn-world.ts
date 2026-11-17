import { mock } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

// Um turno simulado sem tool.call: o que cada passo pede no fluxo do turn.step e o que o
// transcript ($.session.messages) guarda, como o neon-hud le as ferramentas.

export type Call = { id: string; name: string }
export type Use = { tool_use_id: string; tool: string; input?: Record<string, unknown>; text?: string; isError?: true }

// O mundo de um turno: o que cada passo pede no fluxo e o que o transcript guarda.
export const world = (on: On, opts: { clock?: boolean } = {}) => {
  if (opts.clock !== false) mock.clock(on, { now: 1_000 })
  on('session.usage', () => ({ value: { cost: { usd: 0 } } }) as never)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  const steps: Call[][] = []
  let rows: Use[] = []
  on('turn.step', async function* (_$, e) {
    const calls = steps.shift() ?? []
    for (const [index, c] of calls.entries()) yield { kind: 'tool', index, id: c.id, name: c.name }
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: calls.map(c => ({ name: c.name, input: {} })), stopReason: calls.length ? 'tool_use' : 'end_turn', usage: null }
  })
  on('session.messages', () => ({ value: [{ role: 'assistant', text: '', toolUses: rows.map(u => ({ input: {}, ...u })) }] }) as never)
  return {
    next: (calls: Call[]) => steps.push(calls),
    transcript: (uses: Use[]) => {
      rows = uses
    },
  }
}

export const step = async ($: Engine, index: number): Promise<void> => {
  for await (const _ of $.turn.step({ turnId: 't1', index, model: 'claude-x', messageCount: 1 })) {
    // so le o fluxo ate o fim
  }
}


/** Um passo que pede as chamadas e o seguinte, que as acha respondidas no transcript. */
export const runCalls = async ($: Engine, w: ReturnType<typeof world>, calls: { id: string; name: string; text?: string }[], from = 0): Promise<void> => {
  w.next(calls.map(c => ({ id: c.id, name: c.name })))
  await step($, from)
  w.transcript(calls.map(c => ({ tool_use_id: c.id, tool: c.name, text: c.text ?? 'ok' })))
  await step($, from + 1)
}
