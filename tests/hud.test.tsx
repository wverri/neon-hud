import { expect, test } from 'claude-code/testing'

const PANE = {
  component: 'Pane',
  requestId: 'neon-hud',
  props: {
    title: 'NEON//HUD',
    isFocused: false,
    bodyColumns: 44,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

test('o HUD desenha o cabecalho e o estado ocioso em toda superficie', async $ => {
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'neon-hud', surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /NEON/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /STANDBY/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /0 calls/ })).toBeDefined()
    await ui.unmount()
  }
})

test('uma chamada de ferramenta aparece na contagem de TOOLS', async ($, on) => {
  on('tool.call', () => ({ result: { file: { content: '' } }, text: 'ok' }) as never)
  await $.tool.call({ tool: 'Read', file_path: '/tmp/x.md' })
  const ui = await $.ui.mount({ plugin: 'neon-hud', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /1 calls/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Read/ })).toBeDefined()
  await ui.unmount()
})

test('nenhuma linha passa da largura util do painel', async ($, on) => {
  on('tool.call', () => ({ result: { file: { content: '' } }, text: 'ok' }) as never)
  for (let i = 0; i < 9; i++) await $.tool.call({ tool: 'Read', file_path: '/tmp/x.md' })
  await $.tool.call({ tool: 'Bash', command: 'true' } as never)
  for (const bodyColumns of [32, 44, 60]) {
    const ui = await $.ui.mount({
      plugin: 'neon-hud',
      surface: 'terminal',
      ...PANE,
      props: { ...PANE.props, bodyColumns },
    })
    const over = (await ui.findAll({ type: 'Text' }))
      .filter(el => el.props.wrap !== 'truncate-end')
      .filter(el => el.text.length > (/[━─▁▂▃▄▅▆▇█]/.test(el.text) ? bodyColumns - 6 : bodyColumns - 2))
      .map(el => `${bodyColumns}: ${el.text}`)
    expect(over).toEqual([])
    await ui.unmount()
  }
})
