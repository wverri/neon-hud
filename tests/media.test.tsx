import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { MediaRegistry, PixelCache, decodeBmp, drawMediaStrip, findCandidates, isGenerated, mediaKindOf, rasterCells, thumbColumns, toRgba, type MediaItem } from '../hooks/media'
import { PS_THUMB, psThumbPath, decodeSteps, openArgv, platformOf, thumbBmpPath, thumbSteps } from '../hooks/media-os'

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

// --- Task 2: registro, BMP, raster e desenho ---

const b64u32 = (b64: string): number[] => {
  const bin = atob(b64)
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0))
  return [...new Uint32Array(bytes.buffer)]
}

test('MediaRegistry numera por chave e muda quando o mtime muda', async () => {
  const r = new MediaRegistry()
  expect(r.claim('/a.png', 1)).toBe(1)
  expect(r.claim('/a.png', 1)).toBe(null)
  expect(r.claim('/a.png', 2)).toBe(2)
  expect(r.claim('/b.png', 1)).toBe(3)
  r.remember(2, { path: '/a.png', name: 'a.png' })
  r.remember(3, { path: '/b.png', name: 'b.png' })
  expect(r.recent(2)).toEqual([
    { n: 3, name: 'b.png' },
    { n: 2, name: 'a.png' },
  ])
  expect(r.get(3)).toEqual({ path: '/b.png', name: 'b.png' })
  expect(r.get(99)).toBeUndefined()
})

test('MediaRegistry remoto nao repete a mesma URL', async () => {
  const r = new MediaRegistry()
  expect(r.claimRemote('https://h/y.mp4')).toBe(1)
  expect(r.claimRemote('https://h/y.mp4')).toBe(null)
})

test('centenas de prints numeram sem repetir e o cache de pixels e limitado', async () => {
  const r = new MediaRegistry()
  const ns = Array.from({ length: 500 }, (_, i) => r.claim(`/p/${i}.png`, 1))
  expect(ns).toEqual(Array.from({ length: 500 }, (_, i) => i + 1))
  const cache = new PixelCache()
  const px = { width: 1, height: 2, rgb: new Uint8Array(6) }
  for (let i = 0; i < 100; i++) cache.set(`k${i}`, px)
  expect(cache.size).toBe(64)
  expect(cache.get('k0')).toBeUndefined()
  expect(cache.get('k99')).toBe(px)
})

const bmp24 = (compression = 0): Uint8Array => {
  // 2x2, linhas de baixo para cima, 6 bytes de pixel + 2 de padding por linha.
  const b = new Uint8Array(54 + 16)
  const v = new DataView(b.buffer)
  b[0] = 0x42
  b[1] = 0x4d
  v.setUint32(2, b.length, true)
  v.setUint32(10, 54, true)
  v.setUint32(14, 40, true)
  v.setInt32(18, 2, true)
  v.setInt32(22, 2, true)
  v.setUint16(26, 1, true)
  v.setUint16(28, 24, true)
  v.setUint32(30, compression, true)
  // linha de baixo: azul, branco (BGR)
  b.set([255, 0, 0, 255, 255, 255], 54)
  // linha de cima: vermelho, verde
  b.set([0, 0, 255, 0, 255, 0], 54 + 8)
  return b
}

test('decodeBmp le 24 bits de baixo para cima', async () => {
  const p = decodeBmp(bmp24())
  expect(p?.width).toBe(2)
  expect(p?.height).toBe(2)
  expect([...(p?.rgb ?? [])]).toEqual([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255])
})

test('decodeBmp recusa compressao e lixo', async () => {
  expect(decodeBmp(bmp24(1))).toBe(null)
  expect(decodeBmp(new Uint8Array([1, 2, 3]))).toBe(null)
})

test('rasterCells usa meio bloco com a linha 2r em fg e 2r+1 em bg', async () => {
  // 2 de largura, 4 de altura; pixel (x,y) = [x*10, y*10, 7]
  const rgb = new Uint8Array(2 * 4 * 3)
  for (let y = 0; y < 4; y++) for (let x = 0; x < 2; x++) rgb.set([x * 10, y * 10, 7], (y * 2 + x) * 3)
  const words = b64u32(rasterCells({ width: 2, height: 4, rgb }, 2, 2))
  expect(words).toHaveLength(2 * 2 * 3)
  expect(words.slice(0, 3)).toEqual([0x2580, (0 << 16) | (0 << 8) | 7, (0 << 16) | (10 << 8) | 7])
  expect(words.slice(9, 12)).toEqual([0x2580, (10 << 16) | (20 << 8) | 7, (10 << 16) | (30 << 8) | 7])
})

test('toRgba poe alfa 255', async () => {
  const bytes = Uint8Array.from(atob(toRgba({ width: 1, height: 1, rgb: Uint8Array.of(1, 2, 3) })), c => c.charCodeAt(0))
  expect([...bytes]).toEqual([1, 2, 3, 255])
})

test('thumbColumns divide a largura e desiste quando nao cabe', async () => {
  expect(thumbColumns(100, 1)).toBe(16)
  expect(thumbColumns(40, 3)).toBe(12)
  expect(thumbColumns(20, 4)).toBe(null)
})

const PX = { width: 2, height: 2, rgb: new Uint8Array(12) }
const item = (o: Partial<MediaItem> & { n: number; name: string }): MediaItem => ({ media: 'image', state: 'ready', ...o })

const strip = (items: MediaItem[], columns = 100, showImages = false, opened: number[] = []) => ({
  plugin: 'neon-hud',
  surface: 'terminal' as const,
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: false, maxRows: 14, bodyColumns: 100, scroll: { offset: 0, bodyRows: 14 }, view: {}, items, columns, showImages, opened },
})

const mountStrip = async ($: Parameters<TestBody>[0], on: On, items: MediaItem[], columns = 100, showImages = false) => {
  on('ui.render', { component: 'AbovePrompt' }, async ($$, e) => drawMediaStrip($$.ui.resolve(e) as never, items, columns, showImages, () => {}))
  return $.ui.mount(strip(items, columns, showImages) as never)
}

test('faixa: ready com pixels vira Raster e Button com a legenda', async ($, on) => {
  const ui = await mountStrip($, on, [item({ n: 1, name: 'print.png', pixels: PX })])
  expect(await ui.find({ type: 'Raster' })).toBeDefined()
  expect((await ui.find({ type: 'Button' }))?.props.label).toBe('[1] print.png')
  expect((await ui.find({ type: 'Text', text: 'MEDIA' }))?.props.color).toBe('#00e5ff')
  expect(await ui.find({ type: 'Text', text: '1 arquivo' })).toBeDefined()
  await ui.unmount()
})

test('faixa: showImages com pngFile usa source.file', async ($, on) => {
  const ui = await mountStrip($, on, [item({ n: 1, name: 'a.png', pngFile: '/t/a.png', pixels: PX })], 100, true)
  const image = await ui.find({ type: 'Image' })
  expect((image?.props.source as { file?: string }).file).toBe('/t/a.png')
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  await ui.unmount()
})

test('faixa: showImages sem pngFile usa source.rgba', async ($, on) => {
  const ui = await mountStrip($, on, [item({ n: 1, name: 'a.png', pixels: PX })], 100, true)
  const image = await ui.find({ type: 'Image' })
  expect((image?.props.source as { rgba?: string }).rgba).toBe(toRgba(PX))
  await ui.unmount()
})

test('faixa: video, removido, carregando e remoto', async ($, on) => {
  const ui = await mountStrip($, on, [
    item({ n: 3, name: 'clipe.mp4', media: 'video', pixels: PX }),
    item({ n: 2, name: 'x.png', state: 'missing' }),
    item({ n: 4, name: 'l.png', state: 'loading' }),
    item({ n: 5, name: 'y.mp4', media: 'video', url: 'https://h/y.mp4' }),
  ])
  const labels = (await ui.findAll({ type: 'Button' })).map(b => b.props.label)
  expect(labels).toContain('▶ [3] clipe.mp4')
  expect(labels).not.toContain('[2] x.png')
  expect(await ui.find({ type: 'Text', text: '[2] x.png · arquivo removido' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'carregando…' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '↗ ' })).toBeDefined()
  expect((await ui.find({ type: 'Link' }))?.props.href).toBe('https://h/y.mp4')
  await ui.unmount()
})

test('faixa: passa de 8 itens vira +N', async ($, on) => {
  const items = Array.from({ length: 10 }, (_, i) => item({ n: i + 1, name: `p${i}.png`, pixels: PX }))
  const ui = await mountStrip($, on, items, 200)
  expect(await ui.findAll({ type: 'Button' })).toHaveLength(8)
  expect(await ui.find({ type: 'Text', text: '+2' })).toBeDefined()
  await ui.unmount()
})

test('faixa: estreita demais deixa so as legendas', async ($, on) => {
  const items = Array.from({ length: 4 }, (_, i) => item({ n: i + 1, name: `p${i}.png`, pixels: PX }))
  const ui = await mountStrip($, on, items, 20)
  expect(await ui.findAll({ type: 'Raster' })).toEqual([])
  expect(await ui.findAll({ type: 'Button' })).toHaveLength(4)
  await ui.unmount()
})

const od = '/tmp/o'
const bmpOf = (f: string) => thumbBmpPath(od, f, 0)

test('thumbSteps macos imagem usa sips', async () => {
  expect(thumbSteps('macos', 'image', '/a/x.png', od, 16, 12, false)).toEqual([['sips', '-s', 'format', 'bmp', '-z', '12', '16', '/a/x.png', '--out', bmpOf('/a/x.png')]])
})

test('thumbSteps macos video: qlmanage e sips, sem ffmpeg alternativo', async () => {
  const want = [
    ['qlmanage', '-t', '-s', '128', '-o', od, '/a/v.mp4'],
    ['sips', '-s', 'format', 'bmp', '-z', '12', '16', `${od}/v.mp4.png`, '--out', bmpOf('/a/v.mp4')],
  ]
  expect(thumbSteps('macos', 'video', '/a/v.mp4', od, 16, 12, false)).toEqual(want)
  expect(thumbSteps('macos', 'video', '/a/v.mp4', od, 16, 12, true)).toEqual(want)
})

test('thumbSteps windows', async () => {
  const b = bmpOf('/a/x.png')
  expect(thumbSteps('windows', 'image', '/a/x.png', od, 16, 12, false)).toEqual([['powershell', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', '/tmp/o/neon-thumb.ps1', '/a/x.png', b, '16', '12']])
  expect(thumbSteps('windows', 'video', '/a/v.mp4', od, 16, 12, false)).toEqual([])
  expect(thumbSteps('windows', 'video', '/a/v.mp4', od, 16, 12, true)).toEqual([['ffmpeg', '-y', '-loglevel', 'error', '-i', '/a/v.mp4', '-frames:v', '1', '-vf', 'scale=16:12', bmpOf('/a/v.mp4')]])
})

test('thumbSteps linux', async () => {
  expect(thumbSteps('linux', 'image', '/a/x.png', od, 16, 12, false)).toEqual([['magick', '/a/x.png[0]', '-resize', '16x12!', bmpOf('/a/x.png')]])
  expect(thumbSteps('linux', 'video', '/a/v.mp4', od, 16, 12, false)).toEqual([])
  expect(thumbSteps('linux', 'video', '/a/v.mp4', od, 16, 12, true)).toEqual(thumbSteps('windows', 'video', '/a/v.mp4', od, 16, 12, true))
})

test('PS_THUMB e um .ps1 com param, sem $args, e psThumbPath segue o separador', async () => {
  expect(PS_THUMB.startsWith('param([string]$in, [string]$out, [int]$w, [int]$h)')).toBe(true)
  expect(PS_THUMB).not.toContain('$args')
  expect(PS_THUMB).toContain('Format24bppRgb')
  expect(PS_THUMB).toContain('ImageFormat]::Bmp')
  expect(PS_THUMB).toContain('finally')
  expect(psThumbPath('C:\\t\\m')).toBe('C:\\t\\m\\neon-thumb.ps1')
  expect(psThumbPath('/tmp/m')).toBe('/tmp/m/neon-thumb.ps1')
})

test('decodeSteps por sistema', async () => {
  expect(decodeSteps('macos', '/i', '/o')).toEqual([['base64', '-D', '-i', '/i', '-o', '/o']])
  expect(decodeSteps('windows', '/i', '/o')).toEqual([['certutil', '-f', '-decode', '/i', '/o']])
  expect(decodeSteps('linux', '/i', '/o')).toEqual([['sh', '-c', 'base64 -d < "$1" > "$2"', 'sh', '/i', '/o']])
})

test('openArgv por sistema', async () => {
  expect(openArgv('macos', '/a b')).toEqual(['open', '/a b'])
  expect(openArgv('windows', 'C:\\x.png')).toEqual(['explorer.exe', 'C:\\x.png'])
  expect(openArgv('linux', 'https://x/y.png')).toEqual(['xdg-open', 'https://x/y.png'])
})

test('platformOf e thumbBmpPath', async () => {
  expect(platformOf({ OS: 'Windows_NT' }, false)).toBe('windows')
  expect(platformOf({ HOME: '/Users/x' }, true)).toBe('macos')
  expect(platformOf({ HOME: '/home/x' }, false)).toBe('linux')
  expect(thumbBmpPath(od, '/a/x.png', 1)).toBe(thumbBmpPath(od, '/a/x.png', 1))
  expect(thumbBmpPath(od, '/a/x.png', 1)).not.toBe(thumbBmpPath(od, '/a/x.png', 2))
  expect(thumbBmpPath(od, '/a/x.png', 1)).toMatch(/^\/tmp\/o\/thumb-[0-9a-f]{8}\.bmp$/)
})
