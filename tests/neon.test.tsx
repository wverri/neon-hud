import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

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

test('um erro ao desenhar devolve a resposta ao engine', async ($, on) => {
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
