import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import type { HudSaved } from '../types'
import { STORE_PREFIX } from '../hooks/hud'
import { startSession } from './clipboard-env'

const reply = (text: string, columns = 120) => ({
  plugin: 'neon-hud',
  component: 'AssistantMessage' as const,
  props: { text, isFirstOfReply: true },
  viewport: { columns, rows: 40 },
  surface: 'terminal' as const,
})

const PANE = {
  plugin: 'neon-hud',
  surface: 'terminal' as const,
  component: 'Pane' as const,
  requestId: 'neon-hud',
  props: { title: 'NEON//HUD', isFocused: false, bodyColumns: 44, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
}

const countNative = (on: On) => {
  const hits = { n: 0 }
  on('ui.render', { component: 'AssistantMessage' }, async ($, e) => {
    hits.n++
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  return hits
}

test('render false devolve a resposta ao engine e o painel continua', { options: { render: false } }, async ($, on) => {
  const native = countNative(on)
  const ui = await $.ui.mount(reply('| a | b |\n|---|---|\n| 1 | 2 |'))
  expect(native.n).toBe(1)
  await ui.unmount()
  const pane = await $.ui.mount(PANE as never)
  expect(await pane.find({ type: 'Text', text: /STANDBY/ })).toBeDefined()
  await pane.unmount()
})

test('com o prismantis instalado, o neon-hud deixa ele desenhar', async ($, on) => {
  on('engine.create', async (_$, e, next) => ({ ...(await next(e)), prismantis: { markdown: async () => undefined } }) as never)
  const native = countNative(on)
  await startSession($, on)
  const ui = await $.ui.mount(reply('| a |\n|---|\n| 1 |'))
  expect(native.n).toBe(1)
  await ui.unmount()
})

test('sem o prismantis, o neon-hud desenha a resposta', async ($, on) => {
  const native = countNative(on)
  await startSession($, on)
  const ui = await $.ui.mount(reply('| a |\n|---|\n| 1 |'))
  expect(native.n).toBe(0)
  await ui.unmount()
})

test('uma resposta so com espacos fica com o engine', async ($, on) => {
  const native = countNative(on)
  const ui = await $.ui.mount(reply('   \n  '))
  expect(native.n).toBe(1)
  await ui.unmount()
})

test('se o /neon-hud nao registra, o /hud ainda registra e o painel abre', async ($, on) => {
  const names: string[] = []
  on('command.register', async (_, e) => {
    if (e.name === 'neon-hud') throw new Error('recusado')
    names.push(e.name)
    return { value: undefined } as never
  })
  await startSession($, on)
  expect(names).toContain('hud')
  const pane = await $.ui.mount(PANE as never)
  expect(await pane.find({ type: 'Text', text: /NEON/ })).toBeDefined()
  await pane.unmount()
})

const SAVED: HudSaved = {
  savedAt: 1,
  live: { phase: 'IDLE', detail: '', model: '', liveTps: 0, lastTps: 0, peakTps: 0, tpsHistory: [] },
  tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, steps: 3, turns: 1 },
  tools: { total: 7, counts: { Read: 7 }, recent: [] },
  turn: { startedAt: 0, costAtStart: 0, lastMs: 0, lastCostUsd: 0 },
}

// O painel so mostra 7 calls se o session.start passou da restauracao: e o que prova que nada antes dela abortou.
const savedSession = (on: On) => {
  on('session.id', () => ({ value: 'sid' }))
  mock.store(on, { [`${STORE_PREFIX}sid`]: SAVED })
  mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
}

const restoredPane = async ($: Engine) => {
  const pane = await $.ui.mount(PANE as never)
  const found = await pane.find({ type: 'Text', text: /7 calls/ })
  await pane.unmount()
  return found
}

test('um /neon-hud recusado nao impede o painel de restaurar os contadores', async ($, on) => {
  savedSession(on)
  mock.env(on, {})
  on('command.register', async (_, e) => {
    if (e.name === 'neon-hud') throw new Error('recusado')
    return { value: undefined } as never
  })
  await startSession($, on)
  expect(await restoredPane($)).toBeDefined()
})

test('uma sonda de copia que falha nao impede a restauracao e tenta de novo no proximo inicio', async ($, on) => {
  savedSession(on)
  let broken = true
  on('env.get', () => (broken ? { deny: 'sem ambiente' } : { value: undefined }))
  on('fs.stat', (_, e, next) => (e.path.endsWith('/usr/bin/osascript') ? { value: { kind: 'file' as const, size: 0, mtimeMs: 0, isLink: false } } : next(e)))
  await startSession($, on)
  expect(await restoredPane($)).toBeDefined()
  broken = false
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(reply('| a | b |\n|---|---|\n| 1 | 2 |'))
  expect((await ui.findAll({ type: 'Button' })).map(b => b.props.label)).toContain('⧉ html')
  await ui.unmount()
})

// O kit de testes tambem pula um hook que lanca e chama o de baixo, entao isto confere o comportamento, nao o try/catch.
test('uma resposta que quebra o renderizador ainda chega ao engine', async ($, on) => {
  const native = countNative(on)
  const ui = await $.ui.mount({ ...reply(''), props: { text: undefined as never, isFirstOfReply: true } })
  expect(native.n).toBe(1)
  await ui.unmount()
})

test('uma tabela desenha o cabecalho em ciano neon', async $ => {
  const ui = await $.ui.mount(reply('| Nome | Valor |\n|---|---:|\n| api | 2 |'))
  expect((await ui.find({ type: 'Text', text: 'Nome' }))?.props.color).toBe('#00e5ff')
  await ui.unmount()
})

test('o rodape do turno usa o verde neon na duracao', async $ => {
  const ui = await $.ui.mount({
    plugin: 'neon-hud',
    surface: 'terminal',
    component: 'TurnDuration',
    props: { word: 'Baked', durationMs: 380_000 },
  } as never)
  expect((await ui.find({ type: 'Text', text: /^6m 20s$/ }))?.props.color).toBe('#3dff9a')
  await ui.unmount()
})
