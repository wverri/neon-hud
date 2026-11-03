import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { MediaRegistry, PixelCache, decodeBmp, drawMediaStrip, findCandidates, isGenerated, mediaKindOf, rasterCells, thumbColumns, toRgba, type MediaItem } from '../hooks/media'
import { runResult } from './clipboard-env'
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

test('resultado de MCP { content, isError } entra nos blocos', async () => {
  const output = { content: [{ type: 'text', text: 'salvo em /a/x.png' }, { type: 'image', data: 'CCCC', mimeType: 'image/png' }], isError: false }
  expect(findCandidates('mcp__x__shot', {}, output, cwd, home)).toEqual([
    { kind: 'local', path: '/a/x.png', media: 'image', always: false },
    { kind: 'embedded', base64: 'CCCC', ext: 'png' },
  ])
  const structured = { content: [], structuredContent: [{ type: 'image', data: 'DDDD', mimeType: 'image/webp' }], isError: false }
  expect(findCandidates('mcp__x__shot', {}, structured, cwd, home)).toEqual([{ kind: 'embedded', base64: 'DDDD', ext: 'webp' }])
})

test('caminho grudado em pontuacao sai inteiro', async () => {
  const one = (text: string, c = cwd) => findCandidates('Bash', {}, { stdout: text }, c, home).map(x => (x.kind === 'local' ? x.path : ''))
  expect(one('{"file":"/a/x.png"}')).toEqual(['/a/x.png'])
  expect(one('--out=x.png')).toEqual(['/proj/x.png'])
  expect(one('--out="x.png"')).toEqual(['/proj/x.png'])
  expect(one('2>out.png')).toEqual(['/proj/out.png'])
  expect(one('{"path":"C:\\out\\a.png"}', 'C:\\proj')).toEqual(['C:\\out\\a.png'])
  expect(one('--out=C:\\out\\b.png', 'C:\\proj')).toEqual(['C:\\out\\b.png'])
  expect(findCandidates('Bash', {}, { stdout: '{"url":"https://h/y.mp4"}' }, cwd, home)).toEqual([{ kind: 'remote', url: 'https://h/y.mp4', media: 'video' }])
})

test('repetido local herda always de qualquer ocorrencia', async () => {
  const out = findCandidates('SendUserFile', { message: 'veja /a/x.png', files: ['/a/x.png'] }, 'ok', cwd, home)
  expect(out).toEqual([{ kind: 'local', path: '/a/x.png', media: 'image', always: true }])
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
  expect(decodeBmp(bmp24(3))).toBe(null)
  expect(decodeBmp(new Uint8Array([1, 2, 3]))).toBe(null)
})

const fromB64 = (b64: string) => Uint8Array.from(atob(b64), c => c.charCodeAt(0))
// Saida real do `sips -s format bmp -z 2 2` no macOS 26 para um PNG 2x2 vermelho, verde / azul, branco.
// RGBA: 32 bits, BI_BITFIELDS (3), cabecalho V5 de 124 bytes, altura -2 (de cima para baixo).
const SIPS_RGBA_2X2 = 'Qk2aAAAAAAAAAIoAAAB8AAAAAgAAAP7///8BACAAAwAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/AAD/AAD/AAAAAAAA/0JHUnMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD//wD/AP//AAD//////w=='
// RGB sem alfa: 24 bits, sem compressao, cabecalho de 40 bytes, altura -2.
const SIPS_RGB_2X2 = 'Qk1GAAAAAAAAADYAAAAoAAAAAgAAAP7///8BABgAAAAAAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAD/AP8AAAD/AAD///8AAA=='
const RGBW = [255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]

test('decodeBmp le a saida real do sips: V5, bitfields, de cima para baixo', async () => {
  const bytes = fromB64(SIPS_RGBA_2X2)
  const v = new DataView(bytes.buffer)
  expect([v.getUint32(14, true), v.getInt32(22, true), v.getUint16(28, true), v.getUint32(30, true)]).toEqual([124, -2, 32, 3])
  expect([v.getUint32(54, true), v.getUint32(58, true), v.getUint32(62, true), v.getUint32(66, true)]).toEqual([0x00ff0000, 0x0000ff00, 0x000000ff, 0xff000000])
  const p = decodeBmp(bytes)
  expect([p?.width, p?.height]).toEqual([2, 2])
  expect([...(p?.rgb ?? [])]).toEqual(RGBW)
  expect([...(decodeBmp(fromB64(SIPS_RGB_2X2))?.rgb ?? [])]).toEqual(RGBW)
})

test('decodeBmp segue as mascaras de BITMAPINFOHEADER + bitfields', async () => {
  // 1x1, 32 bits, compressao 3, mascaras logo apos o cabecalho de 40 bytes em ordem RGBA nos bytes.
  for (const compression of [3, 6]) {
    const b = new Uint8Array(54 + 16 + 4)
    const v = new DataView(b.buffer)
    b[0] = 0x42
    b[1] = 0x4d
    v.setUint32(10, 70, true)
    v.setUint32(14, 40, true)
    v.setInt32(18, 1, true)
    v.setInt32(22, 1, true)
    v.setUint16(28, 32, true)
    v.setUint32(30, compression, true)
    v.setUint32(54, 0x000000ff, true)
    v.setUint32(58, 0x0000ff00, true)
    v.setUint32(62, 0x00ff0000, true)
    v.setUint32(66, 0xff000000, true)
    b.set([10, 20, 30, 255], 70)
    expect([...(decodeBmp(b)?.rgb ?? [])]).toEqual([10, 20, 30])
  }
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
  const texts = await ui.findAll({ type: 'Text' })
  expect(texts.some(t => t.props.color === '#c9d4f2' && t.text.startsWith('[2] x.png'))).toBe(true)
  expect(texts.some(t => t.props.color === '#66708f' && t.text === ' · arquivo removido')).toBe(true)
  expect(await ui.find({ type: 'Box', key: 'media-3' })).toBeDefined()
  expect(await ui.find({ type: 'Box', key: 'media-2' })).toBeDefined()
  expect(await ui.find({ type: 'Box', key: 'remote-5' })).toBeDefined()
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
const FF = '/opt/homebrew/bin/ffmpeg'
const bmpOf = (f: string) => thumbBmpPath(od, f, 0)

test('thumbSteps macos imagem usa sips', async () => {
  expect(thumbSteps('macos', 'image', '/a/x.png', od, 16, 12, null)).toEqual([['sips', '-s', 'format', 'bmp', '-z', '12', '16', '/a/x.png', '--out', bmpOf('/a/x.png')]])
})

test('thumbSteps macos video: qlmanage e sips, sem ffmpeg alternativo', async () => {
  const want = [
    ['qlmanage', '-t', '-s', '128', '-o', od, '/a/v.mp4'],
    ['sips', '-s', 'format', 'bmp', '-z', '12', '16', `${od}/v.mp4.png`, '--out', bmpOf('/a/v.mp4')],
  ]
  expect(thumbSteps('macos', 'video', '/a/v.mp4', od, 16, 12, null)).toEqual(want)
  expect(thumbSteps('macos', 'video', '/a/v.mp4', od, 16, 12, FF)).toEqual(want)
})

test('thumbSteps windows', async () => {
  const b = bmpOf('/a/x.png')
  expect(thumbSteps('windows', 'image', '/a/x.png', od, 16, 12, null)).toEqual([['powershell', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', '/tmp/o/neon-thumb.ps1', '/a/x.png', b, '16', '12']])
  expect(thumbSteps('windows', 'video', '/a/v.mp4', od, 16, 12, null)).toEqual([])
  expect(thumbSteps('windows', 'video', '/a/v.mp4', od, 16, 12, FF)).toEqual([[FF, '-y', '-loglevel', 'error', '-i', '/a/v.mp4', '-frames:v', '1', '-vf', 'scale=16:12', bmpOf('/a/v.mp4')]])
})

test('thumbSteps linux', async () => {
  expect(thumbSteps('linux', 'image', '/a/x.png', od, 16, 12, null)).toEqual([['magick', '/a/x.png[0]', '-resize', '16x12!', bmpOf('/a/x.png')]])
  expect(thumbSteps('linux', 'video', '/a/v.mp4', od, 16, 12, null)).toEqual([])
  expect(thumbSteps('linux', 'video', '/a/v.mp4', od, 16, 12, FF)).toEqual(thumbSteps('windows', 'video', '/a/v.mp4', od, 16, 12, FF))
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
  // Com separador, arquivo e mtime nao se confundem: "/a/x1" + 23 vs "/a/x" + 123.
  expect(thumbBmpPath(od, '/a/x1', 23)).not.toBe(thumbBmpPath(od, '/a/x', 123))
})

// --- Task 4: faixa ligada nos hooks ---

const MDIR = '/tmp/neon-hud-media-sid'
const NOW = 1_000_000

// BMP 16x12 de 24 bits, o que o sips simulado "grava".
const thumbBmp = (): string => {
  const w = 16
  const h = 12
  const stride = w * 3
  const b = new Uint8Array(54 + stride * h)
  const v = new DataView(b.buffer)
  b[0] = 0x42
  b[1] = 0x4d
  v.setUint32(2, b.length, true)
  v.setUint32(10, 54, true)
  v.setUint32(14, 40, true)
  v.setInt32(18, w, true)
  v.setInt32(22, h, true)
  v.setUint16(26, 1, true)
  v.setUint16(28, 24, true)
  b.fill(0x80, 54)
  return btoa(String.fromCharCode(...b))
}

type World = { runs: string[][]; timeouts: (number | undefined)[]; stats: string[]; writes: { path: string; text: string }[] }

// files: caminho -> mtime; o resto nega com ENOENT. run decide a resposta de cada process.run.
const world = (on: On, files: Record<string, number> = {}, env: Record<string, string> = {}, run?: (argv: readonly string[]) => unknown): World => {
  const w: World = { runs: [], timeouts: [], stats: [], writes: [] }
  on('session.id', () => ({ value: 'sid' }))
  mock.env(on, { TMPDIR: '/tmp', HOME: '/Users/will', TERM_PROGRAM: 'Apple_Terminal', ...env })
  on('fs.stat', (_, e) => {
    w.stats.push(e.path)
    if (e.path === '/usr/bin/sips') return { value: { kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false } }
    // O harness resolve caminho Windows contra o cwd do host: a chave vale tambem como sufixo.
    const m = files[e.path] ?? Object.entries(files).find(([k]) => !k.startsWith('/') && e.path.endsWith(`/${k}`))?.[1]
    return m === undefined ? { deny: 'ENOENT' } : { value: { kind: 'file' as const, size: 10, mtimeMs: m, isLink: false } }
  })
  on('fs.write', (_, e) => {
    w.writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('fs.read', (_, e) => (e.path.endsWith('.bmp') && w.runs.some(a => a.includes(e.path)) ? { value: { base64: thumbBmp() } } : { deny: 'ENOENT' }) as never)
  on('process.run', (_, e) => {
    w.runs.push([...e.argv])
    w.timeouts.push(e.init?.timeoutMs)
    return (run?.(e.argv) ?? runResult(0)) as never
  })
  return w
}

const engineText = (on: On) =>
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })

const use = (tool: string, input: unknown, id: string) => ({ plugin: 'neon-hud', surface: 'terminal' as const, component: 'ToolUse' as const, props: { tool_use_id: id, tool, input, isRunning: false, isErrored: false, isInterrupted: false } })
const res = (tool: string, output: unknown, id: string, isErrored = false) => ({ plugin: 'neon-hud', surface: 'terminal' as const, component: 'ToolResult' as const, props: { tool_use_id: id, tool, output, isErrored }, viewport: { columns: 100, rows: 40 } })

const labels = async (ui: { findAll: (q: { type: string }) => Promise<{ props: Record<string, unknown> }[]> }) => (await ui.findAll({ type: 'Button' })).map(b => b.props.label)

test('faixa: print do Chrome decodifica o base64 e vira Raster', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  engineText(on)
  const w = world(on)
  const output = [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } }]
  const row = await $.ui.mount(use('mcp__claude-in-chrome__computer', { action: 'screenshot' }, 'c-1'))
  const ui = await $.ui.mount(res('mcp__claude-in-chrome__computer', output, 'c-1'))
  expect(await ui.find({ type: 'Text', text: 'carregando…' })).toBeDefined()
  expect(w.writes).toContainEqual({ path: `${MDIR}/emb-1.b64`, text: 'AAAA' })
  await clock.settle()
  expect(w.runs).toContainEqual(['base64', '-D', '-i', `${MDIR}/emb-1.b64`, '-o', `${MDIR}/emb-1.jpg`])
  expect(w.runs.some(a => a[0] === 'sips' && a.includes(`${MDIR}/emb-1.jpg`))).toBe(true)
  expect(await ui.find({ type: 'Raster' })).toBeDefined()
  expect(await labels(ui)).toEqual(['[1] emb-1.jpg'])
  expect(await ui.find({ type: 'Text', text: 'engine' })).toBeDefined()
  await ui.unmount()
  await row.unmount()
})

test('faixa: SendUserFile com tres GIFs numera de 1 a 3', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  engineText(on)
  world(on, { '/a/1.gif': 1, '/a/2.gif': 1, '/a/3.gif': 1 })
  const row = await $.ui.mount(use('SendUserFile', { files: ['/a/1.gif', '/a/2.gif', '/a/3.gif'] }, 's-1'))
  const ui = await $.ui.mount(res('SendUserFile', '3 files delivered', 's-1'))
  await clock.settle()
  expect(await labels(ui)).toEqual(['[1] 1.gif', '[2] 2.gif', '[3] 3.gif'])
  expect(await ui.find({ type: 'Text', text: '3 arquivos' })).toBeDefined()
  await ui.unmount()
  await row.unmount()
})

test('faixa: Bash mostra so o arquivo com mtime dentro da janela do tool.call', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  engineText(on)
  world(on, { '/a/novo.png': NOW, '/a/velho.png': 1 })
  let id = ''
  on('tool.call', (_, e) => {
    id = e.tool_use_id
    return { result: { stdout: '/a/novo.png /a/velho.png', stderr: '' }, text: 'ok' } as never
  })
  await $.tool.call({ tool: 'Bash', command: 'python gerar.py' } as never)
  expect(id).not.toBe('')
  const ui = await $.ui.mount(res('Bash', { stdout: '/a/novo.png /a/velho.png', stderr: '' }, id))
  await clock.settle()
  expect(await labels(ui)).toEqual(['[1] novo.png'])
  await ui.unmount()
})

test('faixa: Bash sem janela (sessao retomada) nao mostra nada', async ($, on) => {
  mock.clock(on, { now: NOW })
  engineText(on)
  world(on, { '/a/novo.png': NOW })
  const row = await $.ui.mount(use('Bash', { command: 'python gerar.py' }, 'b-0'))
  const ui = await $.ui.mount(res('Bash', { stdout: '/a/novo.png', stderr: '' }, 'b-0'))
  expect(await ui.find({ type: 'Text', text: 'MEDIA' })).toBeUndefined()
  await ui.unmount()
  await row.unmount()
})

test('faixa: Read de imagem nunca desenha faixa', async ($, on) => {
  mock.clock(on, { now: NOW })
  engineText(on)
  world(on, { '/a/x.png': NOW })
  const row = await $.ui.mount(use('Read', { file_path: '/a/x.png' }, 'r-1'))
  const ui = await $.ui.mount(res('Read', [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }], 'r-1'))
  expect(await ui.find({ type: 'Text', text: 'MEDIA' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'engine' })).toBeDefined()
  await ui.unmount()
  await row.unmount()
})

test('faixa: arquivo removido mostra a legenda apagada', async ($, on) => {
  mock.clock(on, { now: NOW })
  engineText(on)
  world(on)
  const row = await $.ui.mount(use('SendUserFile', { files: ['/a/x.gif'] }, 'm-1'))
  const ui = await $.ui.mount(res('SendUserFile', 'delivered', 'm-1'))
  expect((await ui.findAll({ type: 'Text' })).some(t => t.props.color === '#66708f' && t.text === ' · arquivo removido')).toBe(true)
  expect(await ui.find({ type: 'Text', text: '[1] x.gif' })).toBeDefined()
  await ui.unmount()
  await row.unmount()
})

test('faixa: o mesmo arquivo em duas chamadas aparece so na primeira', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  engineText(on)
  world(on, { '/a/x.gif': 5 })
  const r1 = await $.ui.mount(use('SendUserFile', { files: ['/a/x.gif'] }, 'd-1'))
  const u1 = await $.ui.mount(res('SendUserFile', 'ok', 'd-1'))
  const r2 = await $.ui.mount(use('SendUserFile', { files: ['/a/x.gif'] }, 'd-2'))
  const u2 = await $.ui.mount(res('SendUserFile', 'ok', 'd-2'))
  await clock.settle()
  expect(await labels(u1)).toEqual(['[1] x.gif'])
  expect(await u2.find({ type: 'Text', text: 'MEDIA' })).toBeUndefined()
  // Redesenhar a primeira nao repete o claim nem muda o numero.
  await u1.redraw()
  expect(await labels(u1)).toEqual(['[1] x.gif'])
  for (const ui of [u1, r1, u2, r2]) await ui.unmount()
})

test('faixa: resultado com erro nao desenha faixa (Review Focus 3)', async ($, on) => {
  mock.clock(on, { now: NOW })
  engineText(on)
  world(on, { '/a/novo.png': NOW })
  let id = ''
  on('tool.call', (_, e) => {
    id = e.tool_use_id
    return { result: { stdout: '/a/novo.png', stderr: '' }, text: 'ok' } as never
  })
  await $.tool.call({ tool: 'Bash', command: 'gerar' } as never)
  const ui = await $.ui.mount(res('Bash', { stdout: '/a/novo.png', stderr: 'boom' }, id, true))
  expect(await ui.find({ type: 'Text', text: 'MEDIA' })).toBeUndefined()
  await ui.unmount()
})

test('faixa: conversor travado fica so na legenda, sem erro (Review Focus 4)', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  engineText(on)
  world(on, { '/a/a.gif': 1 }, {}, () => ({ deny: 'Process timed out' }))
  const row = await $.ui.mount(use('SendUserFile', { files: ['/a/a.gif'] }, 't-1'))
  const ui = await $.ui.mount(res('SendUserFile', 'ok', 't-1'))
  expect(await ui.find({ type: 'Text', text: 'carregando…' })).toBeDefined()
  await clock.settle()
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'carregando…' })).toBeUndefined()
  expect(await labels(ui)).toEqual(['[1] a.gif'])
  expect(await ui.find({ type: 'Text', text: 'engine' })).toBeDefined()
  await ui.unmount()
  await row.unmount()
})

test('faixa: no Ghostty um PNG local usa o arquivo direto, sem conversor', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  engineText(on)
  const w = world(on, { '/a/p.png': 1 }, { TERM_PROGRAM: 'ghostty' })
  const row = await $.ui.mount(use('SendUserFile', { files: ['/a/p.png'] }, 'g-1'))
  const ui = await $.ui.mount(res('SendUserFile', 'ok', 'g-1'))
  await clock.settle()
  expect((await ui.find({ type: 'Image' }))?.props.source).toMatchObject({ file: '/a/p.png' })
  expect(w.runs).toEqual([])
  await ui.unmount()
  await row.unmount()
})

test('faixa: mediaStrip desligado deixa o desenho como hoje', { options: { mediaStrip: false } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  engineText(on)
  const w = world(on, { '/a/1.gif': 1 })
  const row = await $.ui.mount(use('SendUserFile', { files: ['/a/1.gif'] }, 'o-1'))
  const ui = await $.ui.mount(res('SendUserFile', 'ok', 'o-1'))
  await clock.settle()
  expect(await ui.find({ type: 'Text', text: 'MEDIA' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'engine' })).toBeDefined()
  expect(w.writes).toEqual([])
  expect(w.runs).toEqual([])
  await ui.unmount()
  await row.unmount()
})

test('faixa: ToolGroup recolhido junta as midias das chamadas sob o grupo', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  engineText(on)
  world(on, { '/a/1.gif': 1, '/a/2.gif': 1 })
  const calls = [
    { tool_use_id: 'gr-1', tool: 'SendUserFile', input: { files: ['/a/1.gif'] }, isRunning: false, isErrored: false, isInterrupted: false, output: 'ok' },
    { tool_use_id: 'gr-2', tool: 'SendUserFile', input: { files: ['/a/2.gif'] }, isRunning: false, isErrored: false, isInterrupted: false, output: 'ok' },
  ]
  const ui = await $.ui.mount({ plugin: 'neon-hud', surface: 'terminal', component: 'ToolGroup', props: { calls, isActive: false, isExpanded: false }, viewport: { columns: 100, rows: 40 } })
  await clock.settle()
  expect(await labels(ui)).toEqual(['[1] 1.gif', '[2] 2.gif'])
  expect(await ui.findAll({ type: 'Text', text: 'MEDIA' })).toHaveLength(1)
  await ui.unmount()
})

test('faixa: com toolRows desligado a faixa ainda envolve o desenho do engine', { options: { toolRows: false } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  engineText(on)
  world(on, { '/a/1.gif': 1 })
  const row = await $.ui.mount(use('SendUserFile', { files: ['/a/1.gif'] }, 'tr-1'))
  const ui = await $.ui.mount(res('SendUserFile', 'ok', 'tr-1'))
  await clock.settle()
  expect(await labels(ui)).toEqual(['[1] 1.gif'])
  expect(await ui.find({ type: 'Text', text: 'engine' })).toBeDefined()
  await ui.unmount()
  await row.unmount()
})

const cmd = (args: string) => ({ command: 'neon-hud', args, origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 120 } })

// Monta uma faixa com [1] e [2] para o registro da sessao ter o que abrir.
const withStrip = async ($: Parameters<TestBody>[0], on: On, env: Record<string, string> = {}, run?: (argv: readonly string[]) => unknown) => {
  const clock = mock.clock(on, { now: NOW })
  engineText(on)
  const w = world(on, { '/a/1.png': 1, '/a/2.png': 1 }, env, run)
  const row = await $.ui.mount(use('SendUserFile', { files: ['/a/1.png', '/a/2.png'] }, 'op-1'))
  const ui = await $.ui.mount(res('SendUserFile', 'ok', 'op-1'))
  await clock.settle()
  return { w, done: async () => { await ui.unmount(); await row.unmount() } }
}

test('open N: macOS abre pelo open e responde Abrindo', async ($, on) => {
  const { w, done } = await withStrip($, on)
  const r = await $.command.run(cmd('open 2'))
  expect(r.text).toBe('Abrindo 2.png')
  expect(w.runs).toContainEqual(['open', '/a/2.png'])
  await done()
})

test('open N: Windows usa explorer.exe e aceita exit 1', async ($, on) => {
  const { w, done } = await withStrip($, on, { OS: 'Windows_NT' }, argv => (argv[0] === 'explorer.exe' ? runResult(1) : undefined))
  const r = await $.command.run(cmd('open 2'))
  expect(w.runs.some(a => a[0] === 'explorer.exe')).toBe(true)
  expect(r.text).toBe('Abrindo 2.png')
  await done()
})

test('open N: numero inexistente', async ($, on) => {
  const { done } = await withStrip($, on)
  expect((await $.command.run(cmd('open 9'))).text).toBe('Mídia 9 não existe nesta sessão.')
  await done()
})

test('open sem numero lista as ultimas', async ($, on) => {
  const { done } = await withStrip($, on)
  expect((await $.command.run(cmd('open'))).text).toBe('[2] 2.png\n[1] 1.png')
  await done()
})

test('open N: falha do comando mostra o motivo', async ($, on) => {
  const { done } = await withStrip($, on, {}, argv => (argv[0] === 'open' ? runResult(1, 'boom') : undefined))
  expect((await $.command.run(cmd('open 1'))).text).toBe('não consegui abrir: boom')
  await done()
})

test('uso inclui open', async ($, on) => {
  on('session.id', () => ({ value: 'sid' }))
  expect((await $.command.run(cmd('x'))).text).toBe('Uso: /neon-hud copy [code] | open [N]')
})

// --- Revisao final ---

test('Windows: TEMP, separador \\ e explorer.exe com caminho de barras invertidas', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  engineText(on)
  const temp = 'C:\\Users\\me\\AppData\\Local\\Temp'
  const dir = `${temp}\\neon-hud-media-sid`
  const w = world(on, { 'C:/a/1.gif': 1 }, { OS: 'Windows_NT', TEMP: temp, TMPDIR: '' })
  const r1 = await $.ui.mount(use('SendUserFile', { files: ['C:/a/1.gif'] }, 'w-1'))
  const u1 = await $.ui.mount(res('SendUserFile', 'ok', 'w-1'))
  const r2 = await $.ui.mount(use('mcp__x__shot', {}, 'w-2'))
  const u2 = await $.ui.mount(res('mcp__x__shot', [{ type: 'image', data: 'AAAA', mimeType: 'image/jpeg' }], 'w-2'))
  await clock.settle()
  // fs.write chega resolvido contra o cwd do host; o argv dos processos chega como o mod montou.
  expect(w.writes.some(x => x.path.endsWith(`/${dir}\\emb-2.b64`) && x.text === 'AAAA')).toBe(true)
  expect(w.writes.some(x => x.path.endsWith(`/${dir}\\neon-thumb.ps1`))).toBe(true)
  const ps = w.runs.find(a => a[0] === 'powershell' && a.includes('C:/a/1.gif'))
  expect(ps?.[6]).toBe(`${dir}\\neon-thumb.ps1`)
  expect(ps?.[8]).toMatch(/^C:\\Users\\me\\AppData\\Local\\Temp\\neon-hud-media-sid\\thumb-[0-9a-f]{8}\.bmp$/)
  expect(w.runs).toContainEqual(['certutil', '-f', '-decode', `${dir}\\emb-2.b64`, `${dir}\\emb-2.jpg`])
  expect(w.runs.flat().some(a => a.includes('/neon-hud-media'))).toBe(false)
  expect((await $.command.run(cmd('open 1'))).text).toBe('Abrindo 1.gif')
  expect(w.runs).toContainEqual(['explorer.exe', 'C:\\a\\1.gif'])
  expect((await $.command.run(cmd('open 2'))).text).toBe('Abrindo emb-2.jpg')
  expect(w.runs).toContainEqual(['explorer.exe', `${dir}\\emb-2.jpg`])
  for (const ui of [u1, r1, u2, r2]) await ui.unmount()
})

test('mediaDir trata TMPDIR vazio como ausente', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  engineText(on)
  const w = world(on, {}, { TMPDIR: '' })
  const row = await $.ui.mount(use('mcp__x__shot', {}, 'e-1'))
  const ui = await $.ui.mount(res('mcp__x__shot', [{ type: 'image', data: 'AAAA', mimeType: 'image/jpeg' }], 'e-1'))
  await clock.settle()
  expect(w.writes).toContainEqual({ path: '/tmp/neon-hud-media-sid/emb-1.b64', text: 'AAAA' })
  await ui.unmount()
  await row.unmount()
})

test('timeout: PowerShell e qlmanage 10 s, o resto 3 s', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  engineText(on)
  const mac = world(on, { '/a/v.mp4': 1, '/a/i.gif': 1 })
  const row = await $.ui.mount(use('SendUserFile', { files: ['/a/v.mp4', '/a/i.gif'] }, 'to-1'))
  const ui = await $.ui.mount(res('SendUserFile', 'ok', 'to-1'))
  await clock.settle()
  const at = (name: string) => mac.timeouts[mac.runs.findIndex(a => a[0] === name)]
  expect(at('qlmanage')).toBe(10000)
  expect(at('sips')).toBe(3000)
  expect(mac.timeouts.every(t => t !== undefined)).toBe(true)
  await ui.unmount()
  await row.unmount()
})

test('timeout: PowerShell no Windows tem 10 s', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  engineText(on)
  const w = world(on, { 'C:\\a\\i.gif': 1 }, { OS: 'Windows_NT', TEMP: 'C:\\T' })
  const row = await $.ui.mount(use('SendUserFile', { files: ['C:\\a\\i.gif'] }, 'tw-1'))
  const ui = await $.ui.mount(res('SendUserFile', 'ok', 'tw-1'))
  await clock.settle()
  expect(w.timeouts[w.runs.findIndex(a => a[0] === 'powershell')]).toBe(10000)
  await ui.unmount()
  await row.unmount()
})

test('saida com 200 caminhos examina no maximo 32', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  engineText(on)
  const w = world(on)
  const paths = Array.from({ length: 200 }, (_, i) => `/a/p${i}.png`)
  const row = await $.ui.mount(use('Bash', { command: 'ls' }, 'cap-1'))
  const ui = await $.ui.mount(res('Bash', { stdout: paths.join('\n'), stderr: '' }, 'cap-1'))
  await clock.settle()
  expect(w.stats.filter(p => p.startsWith('/a/p')).length).toBeLessThanOrEqual(32)
  expect(w.stats).toContain('/a/p31.png')
  expect(w.stats).not.toContain('/a/p32.png')
  await ui.unmount()
  await row.unmount()
})

test('ffmpeg roda pelo caminho absoluto detectado', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  engineText(on)
  const w = world(on, { '/a/v.mp4': 1, [FF]: 0 }, {}, argv => (argv[0] === 'qlmanage' ? runResult(1) : undefined))
  const row = await $.ui.mount(use('SendUserFile', { files: ['/a/v.mp4'] }, 'ff-1'))
  const ui = await $.ui.mount(res('SendUserFile', 'ok', 'ff-1'))
  await clock.settle()
  expect(w.runs.some(a => a[0] === FF && a.includes('/a/v.mp4'))).toBe(true)
  expect(w.runs.some(a => a[0] === 'ffmpeg')).toBe(false)
  await ui.unmount()
  await row.unmount()
})

test('ffmpeg achado pelo where.exe usa a primeira linha da saida', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  engineText(on)
  const exe = 'C:\\ffmpeg\\bin\\ffmpeg.exe'
  const w = world(on, { 'C:\\a\\v.mp4': 1 }, { OS: 'Windows_NT', TEMP: 'C:\\T' }, argv =>
    argv[0] === 'where.exe' ? { value: { exitCode: 0, stdout: `${exe}\r\nC:\\outro\\ffmpeg.exe\r\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } : undefined,
  )
  const row = await $.ui.mount(use('SendUserFile', { files: ['C:\\a\\v.mp4'] }, 'fw-1'))
  const ui = await $.ui.mount(res('SendUserFile', 'ok', 'fw-1'))
  await clock.settle()
  expect(w.runs.some(a => a[0] === exe && a.includes('C:\\a\\v.mp4'))).toBe(true)
  await ui.unmount()
  await row.unmount()
})

test('open N so aceita digitos', async ($, on) => {
  const { done } = await withStrip($, on)
  for (const arg of ['0x1', '1e0', '1.0', '+1']) expect((await $.command.run(cmd(`open ${arg}`))).text).toBe('Uso: /neon-hud copy [code] | open [N]')
  expect((await $.command.run(cmd('open 1'))).text).toBe('Abrindo 1.png')
  await done()
})

test('open funciona com render desligado e a faixa ligada', { options: { render: false } }, async ($, on) => {
  const { w, done } = await withStrip($, on)
  expect((await $.command.run(cmd('open 2'))).text).toBe('Abrindo 2.png')
  expect(w.runs).toContainEqual(['open', '/a/2.png'])
  expect((await $.command.run(cmd('open'))).text).toBe('[2] 2.png\n[1] 1.png')
  await done()
})
