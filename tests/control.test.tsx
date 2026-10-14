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

test('o card MODEL lista os modelos do /config e os niveis de effort', async ($, on) => {
  on('config.list', () => ({ value: [MODEL_ROW] }) as never)
  on('session.start', () => ({ cwd: '/tmp' }))
  on('session.id', () => ({ value: 'control-test' }) as never)
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'neon-hud', surface: 'terminal', ...PANE })
  const model = await ui.find({ type: 'Select', key: 'model' })
  expect(model?.props.value).toBe('opus')
  expect((model?.props.options as { value: string }[]).map(o => o.value)).toEqual(MODEL_ROW.options)
  const effort = await ui.find({ type: 'Select', key: 'effort' })
  expect((effort?.props.options as { value: string }[]).map(o => o.value)).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
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
  await ui.select({ key: 'model', value: 'sonnet' })
  expect(sets).toEqual([{ key: 'model', value: 'sonnet' }])
  await ui.unmount()
  const again = await $.ui.mount({ plugin: 'neon-hud', surface: 'terminal', ...PANE })
  expect((await again.find({ type: 'Select', key: 'model' }))?.props.value).toBe('sonnet')
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
  await ui.select({ key: 'model', value: 'haiku' })
  expect(runs).toContain('model haiku')
  await ui.unmount()
})

test('escolher um effort roda /effort com o nivel', async ($, on) => {
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
  await ui.select({ key: 'effort', value: 'high' })
  expect(runs).toContain('effort high')
  await ui.unmount()
  const again = await $.ui.mount({ plugin: 'neon-hud', surface: 'terminal', ...PANE })
  expect((await again.find({ type: 'Select', key: 'effort' }))?.props.value).toBe('high')
  await again.unmount()
})

test('sem linha model no /config o card mostra so o effort', async ($, on) => {
  on('config.list', () => ({ value: [] }) as never)
  on('session.start', () => ({ cwd: '/tmp' }))
  on('session.id', () => ({ value: 'control-test' }) as never)
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'neon-hud', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Select', key: 'model' })).toBeUndefined()
  expect(await ui.find({ type: 'Select', key: 'effort' })).toBeDefined()
  await ui.unmount()
})

test('no mobile, sem Select, o card mostra modelo e effort como texto', async ($, on) => {
  on('config.list', () => ({ value: [MODEL_ROW] }) as never)
  on('session.start', () => ({ cwd: '/tmp' }))
  on('session.id', () => ({ value: 'control-test' }) as never)
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'neon-hud', surface: 'mobile', ...PANE })
  expect(await ui.find({ type: 'Select' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^opus {2}· {2}effort —$/ })).toBeDefined()
  await ui.unmount()
})
