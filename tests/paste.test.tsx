import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import { mock } from 'claude-code/testing'

import { caption, extractImageIds, formatBytes, sameIds, thumbSize, tmpBases } from '../hooks/paste'

test('extractImageIds le os numeros unicos e em ordem', async () => {
  expect(extractImageIds('[Image #2] veja [Image #1] e [Image #2]')).toEqual([1, 2])
  expect(extractImageIds('sem imagem nenhuma')).toEqual([])
  expect(extractImageIds('[Image #10][Image #3]')).toEqual([3, 10])
})

test('sameIds compara listas pela ordem e pelo conteudo', async () => {
  expect(sameIds([1, 2], [1, 2])).toBe(true)
  expect(sameIds([1, 2], [1])).toBe(false)
  expect(sameIds([], [])).toBe(true)
})

test('formatBytes escreve B, KB e MB', async () => {
  expect(formatBytes(512)).toBe('512 B')
  expect(formatBytes(2048)).toBe('2 KB')
  expect(formatBytes(1_500_000)).toBe('1.4 MB')
})

test('thumbSize respeita os limites e desiste quando nao cabe', async () => {
  expect(thumbSize(100, 14, 1)).toEqual({ columns: 24, rows: 8 })
  expect(thumbSize(50, 14, 2)).toEqual({ columns: 24, rows: 8 })
  expect(thumbSize(40, 6, 2)).toEqual({ columns: 19, rows: 4 })
  expect(thumbSize(40, 14, 5)).toBeNull()
  expect(thumbSize(100, 4, 1)).toBeNull()
})

test('tmpBases poe a pasta do usuario primeiro e tira repeticoes', async () => {
  expect(tmpBases()).toEqual(['/private/tmp', '/tmp'])
  expect(tmpBases('/var/x/')).toEqual(['/var/x', '/private/tmp', '/tmp'])
  expect(tmpBases('/tmp')).toEqual(['/tmp', '/private/tmp'])
})

test('caption mostra o tamanho ou avisa que a previa nao existe', async () => {
  expect(caption({ id: 1, file: '/x/1.png', bytes: 1_500_000 })).toBe('[Image #1] · 1.4 MB')
  expect(caption({ id: 3 })).toBe('[Image #3] · prévia indisponível')
})

const DIR = '/private/tmp/claude-501/-Users-x-proj/sid/images'
const entry = (name: string) => ({ name, kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false })
const LISTING: Record<string, ReturnType<typeof entry>[]> = {
  '/private/tmp': [entry('claude-501'), entry('outra-coisa')],
  '/private/tmp/claude-501': [entry('-Users-x-proj')],
}

const band = (props: Partial<{ isWorking: boolean; hasSurvey: boolean; bodyColumns: number; maxRows: number }> = {}, surface: 'terminal' | 'desktop' = 'terminal') => ({
  plugin: 'neon-hud',
  surface,
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: false, maxRows: 14, bodyColumns: 100, scroll: { offset: 0, bodyRows: 14 }, view: {}, ...props },
})

// draft e o rascunho; files diz o tamanho de cada arquivo em DIR; hasDir controla se a pasta ja existe.
const pasted = (on: On, draft: string, files: Record<string, number> = { '1.png': 1_500_000 }, state = { hasDir: true }) => {
  on('session.id', () => ({ value: 'sid' }))
  mock.env(on, {})
  on('prompt.read', () => ({ value: { text: draft, cursor: draft.length } }))
  on('fs.list', (_, e) => ({ value: state.hasDir ? (LISTING[e.path] ?? []) : [] }))
  on('fs.exists', (_, e) => ({ value: state.hasDir && e.path === DIR }))
  on('fs.stat', (_, e) => {
    const name = e.path.slice(DIR.length + 1)
    const size = e.path.startsWith(`${DIR}/`) ? files[name] : undefined
    return size === undefined ? { deny: 'ENOENT' } : { value: { kind: 'file' as const, size, mtimeMs: 0, isLink: false } }
  })
  return state
}

const countEngineBand = (on: On) => {
  const hits = { n: 0 }
  on('ui.render', { component: 'AbovePrompt' }, async ($, e) => {
    hits.n++
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  return hits
}

test('uma imagem colada aparece como miniatura acima do prompt', async ($, on) => {
  pasted(on, 'olha isso [Image #1]')
  const ui = await $.ui.mount(band() as never)
  const image = await ui.find({ type: 'Image' })
  expect(image?.props.source).toEqual({ file: `${DIR}/1.png`, format: 'png' })
  expect(image?.props.columns).toBe(24)
  expect(image?.props.rows).toBe(8)
  expect((await ui.find({ type: 'Text', text: 'PASTE' }))?.props.color).toBe('#00e5ff')
  expect(await ui.find({ type: 'Text', text: '[Image #1] · 1.4 MB' })).toBeDefined()
  await ui.unmount()
})

test('sem imagem no rascunho a faixa fica com o engine', async ($, on) => {
  const engine = countEngineBand(on)
  pasted(on, 'so texto')
  const ui = await $.ui.mount(band() as never)
  expect(engine.n).toBe(1)
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  await ui.unmount()
})

test('a faixa do engine continua embaixo da previa', async ($, on) => {
  const engine = countEngineBand(on)
  pasted(on, '[Image #1]')
  const ui = await $.ui.mount(band() as never)
  expect(engine.n).toBe(1)
  expect(await ui.find({ type: 'Text', text: 'engine' })).toBeDefined()
  expect(await ui.find({ type: 'Image' })).toBeDefined()
  await ui.unmount()
})

test('um numero sem arquivo mostra previa indisponivel', async ($, on) => {
  pasted(on, '[Image #3]', {})
  const ui = await $.ui.mount(band() as never)
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: '[Image #3] · prévia indisponível' }))?.props.color).toBe('#66708f')
  await ui.unmount()
})

test('a pasta que ainda nao existe e procurada de novo depois', async ($, on) => {
  const state = pasted(on, '[Image #1]', { '1.png': 2048 }, { hasDir: false })
  const first = await $.ui.mount(band() as never)
  expect(await first.find({ type: 'Text', text: '[Image #1] · prévia indisponível' })).toBeDefined()
  await first.unmount()
  state.hasDir = true
  const second = await $.ui.mount(band() as never)
  expect(await second.find({ type: 'Text', text: '[Image #1] · 2 KB' })).toBeDefined()
  await second.unmount()
})

test('muitas imagens em pouca largura viram so legendas', async ($, on) => {
  pasted(on, '[Image #1][Image #2][Image #3][Image #4][Image #5]', { '1.png': 1, '2.png': 1, '3.png': 1, '4.png': 1, '5.png': 1 })
  const ui = await $.ui.mount(band({ bodyColumns: 40 }) as never)
  expect(await ui.findAll({ type: 'Image' })).toEqual([])
  expect(await ui.find({ type: 'Text', text: '5 imagens' })).toBeDefined()
  await ui.unmount()
})

test('com turno rodando ou pesquisa na faixa a previa cede', async ($, on) => {
  const engine = countEngineBand(on)
  pasted(on, '[Image #1]')
  for (const props of [{ isWorking: true }, { hasSurvey: true }]) {
    const ui = await $.ui.mount(band(props) as never)
    expect(await ui.find({ type: 'Image' })).toBeUndefined()
    await ui.unmount()
  }
  expect(engine.n).toBe(2)
})

test('fora do terminal a previa nao desenha', async ($, on) => {
  const engine = countEngineBand(on)
  pasted(on, '[Image #1]')
  const ui = await $.ui.mount(band({}, 'desktop') as never)
  expect(engine.n).toBe(1)
  await ui.unmount()
})

test('pastePreview false deixa a faixa com o engine', { options: { pastePreview: false } }, async ($, on) => {
  const engine = countEngineBand(on)
  pasted(on, '[Image #1]')
  const ui = await $.ui.mount(band() as never)
  expect(engine.n).toBe(1)
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  await ui.unmount()
})

test('a previa funciona com render false', { options: { render: false } }, async ($, on) => {
  pasted(on, '[Image #1]')
  const ui = await $.ui.mount(band() as never)
  expect(await ui.find({ type: 'Image' })).toBeDefined()
  await ui.unmount()
})
