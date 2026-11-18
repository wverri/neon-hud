import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { countCardLines, headerHint, isMemCard, toggleOpen } from '../hooks/memcard'

const ID = 'session-start-1793000000000'

const placed = (plugin = 'claude-mem', id = ID) => ({
  plugin: 'neon-hud',
  surface: 'terminal' as const,
  component: 'Placed' as const,
  props: { plugin, id },
})

// Faz o papel do claude-mem, abaixo do neon-hud na cadeia: desenha o card com o titulo e tres linhas.
const memCard = (on: On) => {
  const hits = { n: 0 }
  on('ui.render', { component: 'Placed' }, async ($, e) => {
    hits.n++
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column" borderStyle="round">
        <Text>claude-mem</Text>
        {[<Text>linha um</Text>, <Text>linha dois</Text>, <Text>linha tres</Text>]}
      </Box>
    )
  })
  return hits
}

test('isMemCard so reconhece o card de inicio do claude-mem', async () => {
  expect(isMemCard({ plugin: 'claude-mem', id: ID })).toBe(true)
  expect(isMemCard({ plugin: 'claude-mem', id: 'outra' })).toBe(false)
  expect(isMemCard({ plugin: 'outro', id: ID })).toBe(false)
})

test('toggleOpen abre e fecha sem mexer na lista original', async () => {
  const open = ['a']
  expect(toggleOpen(open, 'b')).toEqual(['a', 'b'])
  expect(toggleOpen(open, 'a')).toEqual([])
  expect(open).toEqual(['a'])
})

test('headerHint diz a contagem e a acao', async () => {
  expect(headerHint(false, 27)).toBe(' · 27 linhas · clique para expandir')
  expect(headerHint(true, 1)).toBe(' · 1 linha · clique para recolher')
  expect(headerHint(false, undefined)).toBe(' · clique para expandir')
})

test('countCardLines desiste de um formato desconhecido', async () => {
  expect(countCardLines(null)).toBeUndefined()
  expect(countCardLines({ type: 'Text', props: {} })).toBeUndefined()
})

test('o card do claude-mem vira uma linha CLAUDE-MEM recolhida', async ($, on) => {
  const engine = memCard(on)
  const ui = await $.ui.mount(placed() as never)
  expect(engine.n).toBe(1)
  expect(await ui.find({ type: 'Text', text: '▸ CLAUDE-MEM' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' · 3 linhas · clique para expandir' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'linha um' })).toBeUndefined()
  await ui.unmount()
})

test('o clique expande o card e o segundo recolhe', async ($, on) => {
  memCard(on)
  const ui = await $.ui.mount(placed() as never)
  const key = `mem-claude-mem:${ID}`
  await ui.press({ key })
  expect(await ui.find({ type: 'Text', text: '▾ CLAUDE-MEM' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'linha dois' })).toBeDefined()
  await ui.press({ key })
  expect(await ui.find({ type: 'Text', text: 'linha dois' })).toBeUndefined()
  await ui.unmount()
})

test('rows de outros plugins passam intactas', async ($, on) => {
  memCard(on)
  const ui = await $.ui.mount(placed('outro', 'build') as never)
  expect(await ui.find({ type: 'Text', text: 'linha um' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '▸ CLAUDE-MEM' })).toBeUndefined()
  await ui.unmount()
})

test('memCard desligado deixa o card inteiro', { options: { memCard: false } }, async ($, on) => {
  memCard(on)
  const ui = await $.ui.mount(placed() as never)
  expect(await ui.find({ type: 'Text', text: 'linha um' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '▸ CLAUDE-MEM' })).toBeUndefined()
  await ui.unmount()
})
