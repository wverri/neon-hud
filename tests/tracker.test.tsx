import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { step, world } from './turn-world'
import { settleCalls, startCalls } from '../hooks/tracker'

const PANE = {
  component: 'Pane',
  requestId: 'neon-hud',
  props: { title: 'NEON//HUD', isFocused: false, bodyColumns: 44, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const pane = ($: Engine) => $.ui.mount({ plugin: 'neon-hud', surface: 'terminal', ...PANE })

test('startCalls conta e poe a chamada rodando; settleCalls fecha com o erro do transcript', () => {
  const empty = { total: 0, counts: {}, recent: [] }
  const started = startCalls(empty, [{ id: 'a', tool: 'Bash' }, { id: 'b', tool: 'mcp__x__y' }])
  expect(started.total).toBe(2)
  expect(started.counts).toEqual({ Bash: 1, x__y: 1 })
  expect(started.recent.every(c => !c.isDone)).toBe(true)
  expect(startCalls(started, [{ id: 'a', tool: 'Bash' }])).toBe(started)
  const settled = settleCalls(started, [{ id: 'a', tool: 'Bash', isError: true, isInner: false }], new Set(['b']))
  expect(settled.total).toBe(2)
  expect(settled.recent).toEqual([
    { id: 'a', tool: 'Bash', isDone: true, isError: true },
    { id: 'b', tool: 'x__y', isDone: true, isError: false },
  ])
  expect(empty.recent).toEqual([])
})

test('settleCalls conta as chamadas de dentro de um script, que o fluxo nao mostrou', () => {
  const started = startCalls({ total: 0, counts: {}, recent: [] }, [{ id: 'r', tool: 'REPL' }])
  const settled = settleCalls(started, [
    { id: 'r', tool: 'REPL', isError: false, isInner: false },
    { id: 'repl_1', tool: 'Bash', isError: false, isInner: true },
    { id: 'repl_2', tool: 'Read', isError: true, isInner: true },
  ], new Set())
  expect(settled.total).toBe(3)
  expect(settled.counts).toEqual({ REPL: 1, Bash: 1, Read: 1 })
  expect(settled.recent.map(c => [c.tool, c.isDone, c.isError])).toEqual([['REPL', true, false], ['Bash', true, false], ['Read', true, true]])
})

test('o neon-hud nao registra hook de tool.call: o Code Mode recusaria as chamadas dos scripts', async ($, on) => {
  let reached = 0
  on('tool.call', () => {
    reached += 1
    return { result: { file: { content: '' } }, text: 'ok' } as never
  })
  await $.tool.call({ tool: 'Read', file_path: '/tmp/x.md' })
  expect(reached).toBe(1)
  const ui = await pane($)
  expect(await ui.find({ type: 'Text', text: /0 calls/ })).toBeDefined()
  await ui.unmount()
})

test('a chamada pedida no fluxo aparece rodando e fecha no passo seguinte', async ($, on) => {
  const w = world(on)
  w.next([{ id: 'c1', name: 'Read' }])
  await step($, 0)
  const ui = await pane($)
  expect(await ui.find({ type: 'Text', text: /1 calls/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /⟳Read/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /EXEC|RUNNING/ })).toBeDefined()
  w.transcript([{ tool_use_id: 'c1', tool: 'Read', text: 'ok' }])
  await step($, 1)
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /recent ✓Read/ })).toBeDefined()
  await ui.unmount()
})

test('um erro guardado no transcript marca a chamada com ✗', async ($, on) => {
  const w = world(on)
  w.next([{ id: 'c1', name: 'Bash' }])
  await step($, 0)
  w.transcript([{ tool_use_id: 'c1', tool: 'Bash', text: 'boom', isError: true }])
  await step($, 1)
  const ui = await pane($)
  expect(await ui.find({ type: 'Text', text: /✗Bash/ })).toBeDefined()
  await ui.unmount()
})

test('uma chamada respondida que o fluxo nao mostrou entra na contagem', async ($, on) => {
  const w = world(on)
  w.next([{ id: 'r1', name: 'REPL' }])
  await step($, 0)
  w.transcript([
    { tool_use_id: 'r1', tool: 'REPL', text: 'done' },
    { tool_use_id: 'repl_a', tool: 'Bash', text: 'ok' },
    { tool_use_id: 'repl_b', tool: 'Bash', text: 'ok' },
  ])
  await step($, 1)
  const ui = await pane($)
  expect(await ui.find({ type: 'Text', text: /3 calls/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /✓Bash×2/ })).toBeDefined()
  await ui.unmount()
})

test('a mesma chamada lida duas vezes no transcript conta uma vez', async ($, on) => {
  const w = world(on)
  w.next([{ id: 'c1', name: 'Read' }])
  await step($, 0)
  w.transcript([{ tool_use_id: 'c1', tool: 'Read', text: 'ok' }, { tool_use_id: 'repl_z', tool: 'Grep', text: 'ok' }])
  await step($, 1)
  await step($, 2)
  await $.turn.complete({ turnId: 't1', reason: 'end_turn', text: '', durationMs: 10 } as never)
  const ui = await pane($)
  expect(await ui.find({ type: 'Text', text: /2 calls/ })).toBeDefined()
  await ui.unmount()
})

test('sessao retomada: o que o transcript ja tinha antes do primeiro turno nao e recontado', async ($, on) => {
  const w = world(on)
  w.transcript([{ tool_use_id: 'old1', tool: 'Bash', text: 'ok' }, { tool_use_id: 'old2', tool: 'Read', text: 'ok' }])
  await $.turn.start({ turnId: 't1', text: 'oi' })
  await step($, 0)
  const ui = await pane($)
  expect(await ui.find({ type: 'Text', text: /0 calls/ })).toBeDefined()
  await ui.unmount()
})

test('o fim do turno fecha a ultima chamada', async ($, on) => {
  const w = world(on)
  w.next([{ id: 'c1', name: 'Write' }])
  await step($, 0)
  w.transcript([{ tool_use_id: 'c1', tool: 'Write', text: 'ok' }])
  await $.turn.complete({ turnId: 't1', reason: 'end_turn', text: '', durationMs: 10 } as never)
  const ui = await pane($)
  expect(await ui.find({ type: 'Text', text: /✓Write/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /⟳/ })).toBeUndefined()
  await ui.unmount()
})

test('Poll do Code Mode nao entra na contagem nem em recent', async ($, on) => {
  const w = world(on)
  w.next([{ id: 'r1', name: 'REPL' }])
  await step($, 0)
  w.next([{ id: 'p1', name: 'Poll' }])
  w.transcript([{ tool_use_id: 'r1', tool: 'REPL', text: 'dispatched' }])
  await step($, 1)
  w.transcript([{ tool_use_id: 'r1', tool: 'REPL', text: 'dispatched' }, { tool_use_id: 'p1', tool: 'Poll', text: 'done' }])
  await step($, 2)
  const ui = await pane($)
  expect(await ui.find({ type: 'Text', text: /1 calls/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Poll/ })).toBeUndefined()
  await ui.unmount()
})
