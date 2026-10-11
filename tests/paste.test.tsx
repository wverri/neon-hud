import { expect, test } from 'claude-code/testing'

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
