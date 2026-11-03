import { expect, test } from 'claude-code/testing'

import { findCandidates, isGenerated, mediaKindOf } from '../hooks/media'

const cwd = '/proj'
const home = '/Users/will'

test('mediaKindOf decide pela extensao sem diferenciar maiusculas', async () => {
  expect(mediaKindOf('/a/x.PNG')).toBe('image')
  expect(mediaKindOf('/a/x.mov')).toBe('video')
  expect(mediaKindOf('/a/x.png.bak')).toBe(null)
  expect(mediaKindOf('/a/x.svg')).toBe(null)
  expect(mediaKindOf('/icons/')).toBe(null)
})

test('Read nunca gera candidato', async () => {
  expect(findCandidates('Read', { file_path: '/a/x.png' }, 'ok /a/y.png', cwd, home)).toEqual([])
})

test('SendUserFile entrega todos os arquivos, sempre', async () => {
  const out = findCandidates('SendUserFile', { files: ['/a/1.gif', '/a/2.gif', '/a/3.gif'] }, '3 files delivered', cwd, home)
  expect(out).toEqual([
    { kind: 'local', path: '/a/1.gif', media: 'image', always: true },
    { kind: 'local', path: '/a/2.gif', media: 'image', always: true },
    { kind: 'local', path: '/a/3.gif', media: 'image', always: true },
  ])
})

test('Bash separa caminho local e URL remota', async () => {
  const out = findCandidates('Bash', { command: 'ls' }, { stdout: 'salvo em /a/x.png\nver https://h/y.mp4' }, cwd, home)
  expect(out).toEqual([
    { kind: 'local', path: '/a/x.png', media: 'image', always: false },
    { kind: 'remote', url: 'https://h/y.mp4', media: 'video' },
  ])
})

test('extensao falsa ou ausente nao vira candidato', async () => {
  expect(findCandidates('Bash', {}, { stdout: 'foo.png.bak e /icons/' }, cwd, home)).toEqual([])
})

test('caminhos com espaco, acento e aspas saem inteiros', async () => {
  const a = findCandidates('Bash', {}, { stdout: "'/Users/will/Data/Itens Custom/pose-prêmio.png'" }, cwd, home)
  expect(a).toEqual([{ kind: 'local', path: '/Users/will/Data/Itens Custom/pose-prêmio.png', media: 'image', always: false }])
  const b = findCandidates('Bash', {}, { stdout: '`saida final.mp4`' }, cwd, home)
  expect(b).toEqual([{ kind: 'local', path: '/proj/saida final.mp4', media: 'video', always: false }])
})

test('caminhos Windows resolvem contra o cwd', async () => {
  const out = findCandidates('PowerShell', {}, { stdout: 'C:\\Users\\me\\out\\shot.png\n.\\out\\clip.mp4' }, 'C:\\proj', home)
  expect(out.map(c => (c.kind === 'local' ? c.path : ''))).toEqual(['C:\\Users\\me\\out\\shot.png', 'C:\\proj\\out\\clip.mp4'])
})

test('til expande para o home', async () => {
  const out = findCandidates('Bash', {}, 'gerou ~/x.png', cwd, home)
  expect(out).toEqual([{ kind: 'local', path: '/Users/will/x.png', media: 'image', always: false }])
})

test('bloco de imagem de MCP vira embutido', async () => {
  const blocks = [
    { type: 'text', text: 'Successfully captured screenshot (735x387, jpeg)' },
    { type: 'image', source: { data: 'AAAA', media_type: 'image/jpeg' } },
  ]
  expect(findCandidates('mcp__x__shot', {}, blocks, cwd, home)).toEqual([{ kind: 'embedded', base64: 'AAAA', ext: 'jpg' }])
  const alt = [{ type: 'image', data: 'BBBB', mimeType: 'image/png' }]
  expect(findCandidates('mcp__x__shot', {}, alt, cwd, home)).toEqual([{ kind: 'embedded', base64: 'BBBB', ext: 'png' }])
})

test('Write de imagem vira candidato local', async () => {
  const out = findCandidates('Write', { file_path: '/a/out.webp' }, 'ok', cwd, home)
  expect(out).toEqual([{ kind: 'local', path: '/a/out.webp', media: 'image', always: false }])
})

test('repetidos sao descartados', async () => {
  const out = findCandidates('Bash', { command: 'cp /a/x.png /a/x.png' }, { stdout: '/a/x.png' }, cwd, home)
  expect(out).toHaveLength(1)
})

test('isGenerated usa a janela com folga de 2000 ms', async () => {
  expect(isGenerated(10_000, { start: 9_000, end: 9_500 }, false)).toBe(true)
  expect(isGenerated(5_000, { start: 9_000, end: 9_500 }, false)).toBe(false)
  expect(isGenerated(5_000, undefined, false)).toBe(false)
  expect(isGenerated(5_000, undefined, true)).toBe(true)
})
