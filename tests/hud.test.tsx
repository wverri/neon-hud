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

test('chamadas repetidas aparecem agrupadas em recent', async ($, on) => {
  on('tool.call', () => ({ result: { file: { content: '' } }, text: 'ok' }) as never)
  for (let i = 0; i < 3; i++) await $.tool.call({ tool: 'Read', file_path: '/tmp/x.md' })
  const ui = await $.ui.mount({ plugin: 'neon-hud', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /recent ✓Read×3/ })).toBeDefined()
  await ui.unmount()
})

const BREAKDOWN = {
  categories: [
    { name: 'System prompt', tokens: 2_200, color: 'promptBorder', kind: 'used', isDeferred: false },
    { name: 'System tools', tokens: 21_000, color: 'inactive', kind: 'used', isDeferred: false },
    { name: 'MCP tools (deferred)', tokens: 40_000, color: 'inactive', kind: 'deferred', isDeferred: true },
    { name: 'Skills', tokens: 0, color: 'warning', kind: 'used', isDeferred: false },
    { name: 'Messages', tokens: 233_000, color: 'purple_FOR_SUBAGENTS_ONLY', kind: 'used', isDeferred: false },
    { name: 'Autocompact buffer', tokens: 33_000, color: 'inactive', kind: 'buffer', isDeferred: false },
    { name: 'Free space', tokens: 710_800, color: 'promptBorder', kind: 'free', isDeferred: false },
  ],
  totalTokens: 256_200,
  maxTokens: 1_000_000,
  rawMaxTokens: 1_000_000,
  percentage: 26,
  autoCompactThreshold: 967_000,
  isAutoCompactEnabled: true,
  gridRows: [],
  memoryFiles: [],
  mcpTools: [],
  agents: [],
  model: 'opus',
  apiUsage: null,
  autocompactSource: 'model-default',
}

test('CONTEXT desenha a barra empilhada e a legenda por categoria', async ($, on) => {
  on('session.usage', () => ({
    value: { startedAt: 0, context: { tokens: 256_200, window: 1_000_000, percent: 26, breakdown: BREAKDOWN }, rateLimits: [], cost: { usd: 0 } },
  }) as never)
  on('session.measure', () => ({ changed: [] }) as never)
  await $.session.measure({ context: { tokens: 256_200, window: 1_000_000, percent: 26 }, rateLimits: [], changed: [] } as never)
  for (const bodyColumns of [32, 44, 60]) {
    const ui = await $.ui.mount({ plugin: 'neon-hud', surface: 'terminal', ...PANE, props: { ...PANE.props, bodyColumns } })
    expect(await ui.find({ type: 'Text', text: /256k of 1M · compacts at 967k/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: / 26% / })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^■ messages\s+233k\s+23%$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /deferred/ })).toBeUndefined()
    const bar = await ui.find({ type: 'Text', text: /^█+.*─+░+$/ })
    expect(bar?.text.length).toBe(bodyColumns - 6)
    await ui.unmount()
  }
})
