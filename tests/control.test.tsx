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

const MODEL_ROW = {
  key: 'model',
  label: 'Model',
  kind: 'choice',
  value: 'opus',
  options: ['default', 'sonnet', 'opus', 'haiku', 'opus[1m]'],
  provider: { plugin: 'engine', tier: 'core' },
  isLocked: false,
}

const START = { cwd: '/tmp', surface: 'terminal', isInteractive: true } as const

type Found = { props: Record<string, unknown> } | undefined
const textOf = (b: Found) => JSON.stringify(b?.props.children ?? b?.props.label ?? '')

test('o card MODEL mostra opus, sonnet e haiku como opcoes, com a atual marcada', async ($, on) => {
  on('config.list', () => ({ value: [MODEL_ROW] }) as never)
  on('session.start', () => ({ cwd: '/tmp' }))
  on('session.id', () => ({ value: 'control-test' }) as never)
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'neon-hud', surface: 'terminal', ...PANE })
  for (const m of ['opus', 'sonnet', 'haiku']) expect(await ui.find({ type: 'Button', key: `model:${m}` })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'model:default' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'model:opus[1m]' })).toBeUndefined()
  expect(textOf(await ui.find({ type: 'Button', key: 'model:opus' }))).toContain('●')
  expect(textOf(await ui.find({ type: 'Button', key: 'model:sonnet' }))).toContain('○')
  await ui.unmount()
})

test('um modelo com sufixo marca a familia dele', async ($, on) => {
  on('config.list', () => ({ value: [{ ...MODEL_ROW, value: 'opus[1m]' }] }) as never)
  on('session.start', () => ({ cwd: '/tmp' }))
  on('session.id', () => ({ value: 'control-test' }) as never)
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'neon-hud', surface: 'terminal', ...PANE })
  expect(textOf(await ui.find({ type: 'Button', key: 'model:opus' }))).toContain('●')
  await ui.unmount()
})

test('escolher um modelo grava a linha model do /config', async ($, on) => {
  const sets: unknown[] = []
  on('config.list', () => ({ value: [MODEL_ROW] }) as never)
  on('config.set', (_, e) => {
    sets.push({ key: e.key, value: e.value })
    return { value: e.value }
  })
  on('session.start', () => ({ cwd: '/tmp' }))
  on('session.id', () => ({ value: 'control-test' }) as never)
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'neon-hud', surface: 'terminal', ...PANE })
  await ui.press({ key: 'model:sonnet' })
  expect(sets).toEqual([{ key: 'model', value: 'sonnet' }])
  await ui.unmount()
  const again = await $.ui.mount({ plugin: 'neon-hud', surface: 'terminal', ...PANE })
  expect(textOf(await again.find({ type: 'Button', key: 'model:sonnet' }))).toContain('●')
  await again.unmount()
})

test('um /config recusado cai no comando /model', async ($, on) => {
  const runs: string[] = []
  on('config.list', () => ({ value: [MODEL_ROW] }) as never)
  on('config.set', () => ({ deny: 'only its dialog changes it' }))
  on('command.run', (_, e) => {
    runs.push(`${e.command} ${e.args}`)
    return { text: 'ok' }
  })
  on('session.start', () => ({ cwd: '/tmp' }))
  on('session.id', () => ({ value: 'control-test' }) as never)
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'neon-hud', surface: 'terminal', ...PANE })
  await ui.press({ key: 'model:haiku' })
  expect(runs).toContain('model haiku')
  await ui.unmount()
})

test('a barra de effort tem um ponto por nivel e cada ponto roda /effort', async ($, on) => {
  const runs: string[] = []
  on('config.list', () => ({ value: [MODEL_ROW] }) as never)
  on('command.run', (_, e) => {
    runs.push(`${e.command} ${e.args}`)
    return { text: 'ok' }
  })
  on('session.start', () => ({ cwd: '/tmp' }))
  on('session.id', () => ({ value: 'control-test' }) as never)
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'neon-hud', surface: 'terminal', ...PANE })
  for (const e of ['low', 'medium', 'high', 'xhigh', 'max']) expect(await ui.find({ type: 'Button', key: `effort:${e}` })).toBeDefined()
  await ui.press({ key: 'effort:high' })
  expect(runs).toContain('effort high')
  await ui.unmount()
  const again = await $.ui.mount({ plugin: 'neon-hud', surface: 'terminal', ...PANE })
  expect(textOf(await again.find({ type: 'Button', key: 'effort:high' }))).toContain('●')
  expect(textOf(await again.find({ type: 'Button', key: 'effort:xhigh' }))).toContain('○')
  expect(await again.find({ type: 'Text', text: /high/ })).toBeDefined()
  await again.unmount()
})

test('as setas da barra sobem e descem um nivel', async ($, on) => {
  const runs: string[] = []
  on('config.list', () => ({ value: [MODEL_ROW] }) as never)
  on('command.run', (_, e) => {
    runs.push(`${e.command} ${e.args}`)
    return { text: 'ok' }
  })
  on('session.start', () => ({ cwd: '/tmp' }))
  on('session.id', () => ({ value: 'control-test' }) as never)
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'neon-hud', surface: 'terminal', ...PANE })
  await ui.press({ key: 'effort:medium' })
  await ui.unmount()
  const up = await $.ui.mount({ plugin: 'neon-hud', surface: 'terminal', ...PANE })
  await up.press({ key: 'effort:up' })
  await up.unmount()
  const down = await $.ui.mount({ plugin: 'neon-hud', surface: 'terminal', ...PANE })
  await down.press({ key: 'effort:down' })
  await down.unmount()
  expect(runs).toEqual(['effort medium', 'effort high', 'effort medium'])
})

test('a chave ultracode liga e desliga pelo /effort', async ($, on) => {
  const runs: string[] = []
  on('config.list', () => ({ value: [MODEL_ROW] }) as never)
  on('command.run', (_, e) => {
    runs.push(`${e.command} ${e.args}`)
    return { text: 'Ultracode on' }
  })
  on('session.start', () => ({ cwd: '/tmp' }))
  on('session.id', () => ({ value: 'control-test' }) as never)
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'neon-hud', surface: 'terminal', ...PANE })
  expect(textOf(await ui.find({ type: 'Button', key: 'ultracode' }))).toContain('off')
  await ui.press({ key: 'ultracode' })
  await ui.unmount()
  const again = await $.ui.mount({ plugin: 'neon-hud', surface: 'terminal', ...PANE })
  expect(textOf(await again.find({ type: 'Button', key: 'ultracode' }))).toContain('on')
  await again.press({ key: 'ultracode' })
  await again.unmount()
  expect(runs).toEqual(['effort ultracode on', 'effort ultracode off'])
})

test('ultracode indisponivel fica desligado', async ($, on) => {
  on('config.list', () => ({ value: [MODEL_ROW] }) as never)
  on('command.run', () => ({ text: 'Ultracode needs dynamic workflows enabled (see /config).' }))
  on('session.start', () => ({ cwd: '/tmp' }))
  on('session.id', () => ({ value: 'control-test' }) as never)
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'neon-hud', surface: 'terminal', ...PANE })
  await ui.press({ key: 'ultracode' })
  await ui.unmount()
  const again = await $.ui.mount({ plugin: 'neon-hud', surface: 'terminal', ...PANE })
  expect(textOf(await again.find({ type: 'Button', key: 'ultracode' }))).toContain('off')
  await again.unmount()
})

test('escolher um nivel de effort desliga o ultracode, como o /effort faz', async ($, on) => {
  on('config.list', () => ({ value: [MODEL_ROW] }) as never)
  on('command.run', () => ({ text: 'ok' }))
  on('session.start', () => ({ cwd: '/tmp' }))
  on('session.id', () => ({ value: 'control-test' }) as never)
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'neon-hud', surface: 'terminal', ...PANE })
  await ui.press({ key: 'ultracode' })
  await ui.unmount()
  const mid = await $.ui.mount({ plugin: 'neon-hud', surface: 'terminal', ...PANE })
  await mid.press({ key: 'effort:low' })
  await mid.unmount()
  const again = await $.ui.mount({ plugin: 'neon-hud', surface: 'terminal', ...PANE })
  expect(textOf(await again.find({ type: 'Button', key: 'ultracode' }))).toContain('off')
  await again.unmount()
})

test('sem linha model no /config o card mostra so o effort', async ($, on) => {
  on('config.list', () => ({ value: [] }) as never)
  on('session.start', () => ({ cwd: '/tmp' }))
  on('session.id', () => ({ value: 'control-test' }) as never)
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'neon-hud', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Button', key: 'model:opus' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'effort:low' })).toBeDefined()
  await ui.unmount()
})

test('no mobile os controles tambem aparecem', async ($, on) => {
  on('config.list', () => ({ value: [MODEL_ROW] }) as never)
  on('session.start', () => ({ cwd: '/tmp' }))
  on('session.id', () => ({ value: 'control-test' }) as never)
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'neon-hud', surface: 'mobile', ...PANE })
  expect(await ui.find({ type: 'Button', key: 'model:opus' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'effort:max' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'ultracode' })).toBeDefined()
  await ui.unmount()
})
