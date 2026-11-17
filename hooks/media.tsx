import type { ElementTable, RenderElement } from 'claude-code'

import { C } from './hud'

export type MediaKind = 'image' | 'video'

export type Candidate =
  | { kind: 'local'; path: string; media: MediaKind; always: boolean }
  | { kind: 'remote'; url: string; media: MediaKind }
  | { kind: 'embedded'; base64: string; ext: 'png' | 'jpg' | 'gif' | 'webp' }

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'heic', 'tiff'])
const VIDEO_EXTS = new Set(['mp4', 'mov', 'webm', 'm4v', 'mkv'])
// Folga para relogio e escrita atrasada em volta da chamada.
const SLACK_MS = 2000

export const mediaKindOf = (path: string): MediaKind | null => {
  const ext = /\.([A-Za-z0-9]+)$/.exec(path)?.[1]?.toLowerCase()
  if (ext === undefined) return null
  return IMAGE_EXTS.has(ext) ? 'image' : VIDEO_EXTS.has(ext) ? 'video' : null
}

export const isGenerated = (mtimeMs: number, window: { start: number; end: number } | undefined, always: boolean): boolean =>
  always || (window !== undefined && mtimeMs >= window.start - SLACK_MS && mtimeMs <= window.end + SLACK_MS)

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

const isWindowsPath = (p: string): boolean => /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\')
const isAbsolute = (p: string): boolean => p.startsWith('/') || isWindowsPath(p)

const resolvePath = (raw: string, cwd: string, home: string): string => {
  if (raw === '~' || raw.startsWith('~/') || raw.startsWith('~\\')) return home.replace(/[\\/]+$/, '') + raw.slice(1)
  if (isAbsolute(raw)) return raw
  const win = isWindowsPath(cwd)
  const rel = raw.replace(/^\.[\\/]/, '')
  const base = cwd.replace(/[\\/]+$/, '')
  return win ? `${base}\\${rel.replace(/\//g, '\\')}` : `${base}/${rel}`
}

// Aspas valem inteiras (caminho com espaco); fora delas o token vai ate o espaco.
const TOKEN = /(['"`])([^'"`\n]+?)\1|(\S+)/g
const LEAD = /^[(["'`=<,;]+/
const TRAIL = /[)\]"'`>,;:.]+$/

type Hit = { kind: 'local'; path: string } | { kind: 'remote'; url: string }

// Pedacos entre = : " ' { } > , mantendo a unidade do Windows (C:\) e o esquema de URL inteiros.
const PIECE = /(?:(?<![A-Za-z0-9])[A-Za-z]:[\\/]|https?:\/\/|[^="'{}>,:])+/gi
const isUrl = (s: string): boolean => /^https?:\/\//i.test(s)

const pushToken = (raw: string, cwd: string, home: string, out: Hit[]): void => {
  const token = raw.replace(LEAD, '').replace(TRAIL, '')
  if (isUrl(token)) {
    if (mediaKindOf(token.replace(/[?#].*$/, '')) !== null) out.push({ kind: 'remote', url: token })
  } else if (mediaKindOf(token) !== null) {
    out.push({ kind: 'local', path: resolvePath(token, cwd, home) })
  }
}

const scanText = (text: string, cwd: string, home: string, out: Hit[]): void => {
  for (const m of text.matchAll(TOKEN)) {
    const quoted = m[2]
    if (quoted !== undefined) {
      const inner = quoted.trim()
      if (!isUrl(inner) && mediaKindOf(inner) !== null) out.push({ kind: 'local', path: resolvePath(inner, cwd, home) })
      else scanText(inner, cwd, home, out)
      continue
    }
    const raw = m[3] ?? ''
    // URL inteira fica junta (a query tem = e :); o resto pode vir grudado em JSON, --out= ou 2>.
    if (isUrl(raw.replace(LEAD, ''))) pushToken(raw, cwd, home, out)
    else for (const piece of raw.match(PIECE) ?? []) pushToken(piece, cwd, home, out)
  }
}

const EMBED_EXT: Record<string, 'png' | 'jpg' | 'gif' | 'webp'> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }

const outputTexts = (output: unknown, texts: string[], embedded: Candidate[]): void => {
  if (typeof output === 'string') texts.push(output)
  else if (Array.isArray(output)) for (const block of output) outputTexts(block, texts, embedded)
  else if (isRecord(output)) {
    if (output.type === 'image') {
      const src = isRecord(output.source) ? output.source : output
      const data = src.data
      const mime = src.media_type ?? src.mimeType
      const ext = typeof mime === 'string' ? EMBED_EXT[mime.toLowerCase()] : undefined
      if (typeof data === 'string' && data !== '' && ext !== undefined) embedded.push({ kind: 'embedded', base64: data, ext })
      return
    }
    for (const key of ['text', 'stdout', 'stderr'] as const) if (typeof output[key] === 'string') texts.push(output[key])
    // Resultado do REPL: as imagens das chamadas de dentro do script, { base64, mediaType }.
    if (Array.isArray(output.images)) {
      for (const img of output.images) {
        if (!isRecord(img) || typeof img.base64 !== 'string' || img.base64 === '') continue
        const ext = typeof img.mediaType === 'string' ? EMBED_EXT[img.mediaType.toLowerCase()] : undefined
        if (ext !== undefined) embedded.push({ kind: 'embedded', base64: img.base64, ext })
      }
    }
    // Resultado de MCP: { content: McpContentBlock[], isError, structuredContent? }.
    for (const key of ['content', 'structuredContent'] as const) if (Array.isArray(output[key])) outputTexts(output[key], texts, embedded)
  }
}

export function findCandidates(tool: string, input: unknown, output: unknown, cwd: string, home: string): Candidate[] {
  if (tool === 'Read') return []
  const always = tool === 'SendUserFile'
  const result: Candidate[] = []
  const seen = new Map<string, Candidate>()
  const add = (c: Candidate, key: string): void => {
    const known = seen.get(key)
    if (known === undefined) {
      seen.set(key, c)
      result.push(c)
    } else if (known.kind === 'local' && c.kind === 'local' && c.always) known.always = true
  }
  const addHits = (hits: Hit[], alwaysLocal: boolean): void => {
    for (const hit of hits) {
      if (hit.kind === 'local') add({ kind: 'local', path: hit.path, media: mediaKindOf(hit.path) ?? 'image', always: alwaysLocal }, hit.path)
      else add({ kind: 'remote', url: hit.url, media: mediaKindOf(hit.url.replace(/[?#].*$/, '')) ?? 'image' }, hit.url)
    }
  }

  if (isRecord(input)) {
    // O codigo de um script do Code Mode cita caminhos sem gerar nada; o que ele gera sai na saida.
    for (const [key, value] of Object.entries(input)) {
      if (tool === 'REPL' && (key === 'code' || key === 'description')) continue
      if (typeof value === 'string') {
        const hits: Hit[] = []
        scanText(value, cwd, home, hits)
        addHits(hits, false)
      } else if (Array.isArray(value)) {
        // files[]: cada item e um caminho inteiro, mesmo com espaco.
        for (const item of value) {
          if (typeof item !== 'string') continue
          const hits: Hit[] = []
          if (always && mediaKindOf(item) !== null) hits.push({ kind: 'local', path: resolvePath(item, cwd, home) })
          else scanText(item, cwd, home, hits)
          addHits(hits, always)
        }
      }
    }
  }

  const texts: string[] = []
  const embedded: Candidate[] = []
  outputTexts(output, texts, embedded)
  for (const text of texts) {
    const hits: Hit[] = []
    scanText(text, cwd, home, hits)
    addHits(hits, false)
  }
  for (const e of embedded) if (e.kind === 'embedded') add(e, `embedded:${e.ext}:${e.base64}`)
  return result
}

type Entry = { path?: string; url?: string; name: string }

export class MediaRegistry {
  private next = 1
  private readonly seen = new Map<string, number>()
  private readonly entries = new Map<number, Entry>()

  // Numera de novo quando o arquivo foi reescrito (mtime muda); igual, ja foi mostrado.
  claim(key: string, mtimeMs: number): number | null {
    if (this.seen.get(key) === mtimeMs) return null
    this.seen.set(key, mtimeMs)
    return this.next++
  }

  claimRemote(url: string): number | null {
    const key = `remote:${url}`
    if (this.seen.has(key)) return null
    this.seen.set(key, 0)
    return this.next++
  }

  get(n: number): Entry | undefined {
    return this.entries.get(n)
  }

  remember(n: number, entry: Entry): void {
    this.entries.set(n, entry)
  }

  recent(k: number): { n: number; name: string }[] {
    return [...this.entries]
      .sort((a, b) => b[0] - a[0])
      .slice(0, k)
      .map(([n, e]) => ({ n, name: e.name }))
  }
}

export type Pixels = { width: number; height: number; rgb: Uint8Array }

const MAX_BMP_SIDE = 16384

// Mascara de canal vira deslocamento e largura; 8 bits e o caso comum, o resto escala para 0..255.
const channel = (mask: number): { mask: number; shift: number; max: number } | null => {
  if (mask === 0) return null
  let shift = 0
  while (((mask >>> shift) & 1) === 0) shift++
  return { mask, shift, max: (mask >>> shift) >>> 0 }
}

export function decodeBmp(bytes: Uint8Array): Pixels | null {
  if (bytes.length < 54 || bytes[0] !== 0x42 || bytes[1] !== 0x4d) return null
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const offset = v.getUint32(10, true)
  const width = v.getInt32(18, true)
  const rawHeight = v.getInt32(22, true)
  const bpp = v.getUint16(28, true)
  const compression = v.getUint32(30, true)
  const height = Math.abs(rawHeight)
  // O sips grava PNG com alfa como 32 bits BI_BITFIELDS (3) com cabecalho V5; 6 e o mesmo com mascara de alfa.
  const bitfields = bpp === 32 && (compression === 3 || compression === 6)
  if (!bitfields && (compression !== 0 || (bpp !== 24 && bpp !== 32))) return null
  if (width <= 0 || height === 0 || width > MAX_BMP_SIDE || height > MAX_BMP_SIDE) return null
  let masks: ReturnType<typeof channel>[] | null = null
  if (bitfields) {
    // Mascaras em 54..65: logo apos o BITMAPINFOHEADER ou dentro do cabecalho V4/V5, no mesmo lugar.
    if (bytes.length < 66) return null
    masks = [channel(v.getUint32(54, true)), channel(v.getUint32(58, true)), channel(v.getUint32(62, true))]
  }
  const stride = Math.floor((bpp * width + 31) / 32) * 4
  if (offset + stride * height > bytes.length) return null
  const step = bpp / 8
  const rgb = new Uint8Array(width * height * 3)
  const pick = (px: number, c: ReturnType<typeof channel>): number => (c === null ? 0 : c.max === 255 ? (px & c.mask) >>> c.shift : Math.round((((px & c.mask) >>> c.shift) * 255) / c.max))
  for (let y = 0; y < height; y++) {
    const src = offset + (rawHeight > 0 ? height - 1 - y : y) * stride
    for (let x = 0; x < width; x++) {
      const i = src + x * step
      const at = (y * width + x) * 3
      if (masks !== null) {
        const px = v.getUint32(i, true)
        rgb.set([pick(px, masks[0] ?? null), pick(px, masks[1] ?? null), pick(px, masks[2] ?? null)], at)
      } else rgb.set([bytes[i + 2] ?? 0, bytes[i + 1] ?? 0, bytes[i] ?? 0], at)
    }
  }
  return { width, height, rgb }
}

const CACHE_LIMIT = 64

export class PixelCache {
  private readonly map = new Map<string, Pixels>()

  get size(): number {
    return this.map.size
  }

  get(key: string): Pixels | undefined {
    const p = this.map.get(key)
    if (p !== undefined) {
      this.map.delete(key)
      this.map.set(key, p)
    }
    return p
  }

  set(key: string, p: Pixels): void {
    this.map.delete(key)
    this.map.set(key, p)
    if (this.map.size > CACHE_LIMIT) this.map.delete(this.map.keys().next().value as string)
  }
}

export const THUMB_ROWS = 6
export const MAX_ITEMS = 8

export const thumbColumns = (columns: number, count: number): number | null => {
  const width = Math.min(16, Math.floor((columns - 2 * (count - 1)) / count))
  return width < 6 ? null : width
}

const toBase64 = (bytes: Uint8Array): string => {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

export function rasterCells(p: Pixels, columns: number, rows: number): string {
  const out = new DataView(new ArrayBuffer(columns * rows * 12))
  const color = (x: number, y: number): number => {
    const sx = Math.min(p.width - 1, Math.floor((x * p.width) / columns))
    const sy = Math.min(p.height - 1, Math.floor((y * p.height) / (rows * 2)))
    const i = (sy * p.width + sx) * 3
    return ((p.rgb[i] ?? 0) << 16) | ((p.rgb[i + 1] ?? 0) << 8) | (p.rgb[i + 2] ?? 0)
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const at = (r * columns + c) * 12
      out.setUint32(at, 0x2580, true)
      out.setUint32(at + 4, color(c, 2 * r), true)
      out.setUint32(at + 8, color(c, 2 * r + 1), true)
    }
  }
  return toBase64(new Uint8Array(out.buffer))
}

export function toRgba(p: Pixels): string {
  const out = new Uint8Array(p.width * p.height * 4)
  for (let i = 0; i < p.width * p.height; i++) {
    out[i * 4] = p.rgb[i * 3] ?? 0
    out[i * 4 + 1] = p.rgb[i * 3 + 1] ?? 0
    out[i * 4 + 2] = p.rgb[i * 3 + 2] ?? 0
    out[i * 4 + 3] = 255
  }
  return toBase64(out)
}

export type MediaItem = {
  n: number
  name: string
  media: MediaKind
  state: 'ready' | 'loading' | 'missing' | 'nothumb'
  path?: string
  pngFile?: string
  pixels?: Pixels
  url?: string
}

const labelOf = (item: MediaItem): string => `${item.media === 'video' ? '▶ ' : ''}[${item.n}] ${item.name}`

export function drawMediaStrip({ Box, Text, Button, Link, Raster, Image }: ElementTable<'terminal'>, items: MediaItem[], columns: number, showImages: boolean, onOpen: (n: number) => void): RenderElement {
  const shown = items.slice(0, MAX_ITEMS)
  const extra = items.length - shown.length
  const locals = shown.filter(i => i.url === undefined)
  const remotes = shown.filter(i => i.url !== undefined)
  const width = locals.length === 0 ? null : thumbColumns(columns, locals.length)
  const thumb = (item: MediaItem) => {
    if (width === null || item.state !== 'ready') return null
    if (showImages) {
      if (item.pngFile !== undefined) return <Image key={`media-${item.n}`} source={{ file: item.pngFile, format: 'png' }} columns={width} rows={THUMB_ROWS} alt={labelOf(item)} />
      if (item.pixels !== undefined) return <Image key={`media-${item.n}`} source={{ rgba: toRgba(item.pixels), width: item.pixels.width, height: item.pixels.height }} columns={width} rows={THUMB_ROWS} alt={labelOf(item)} />
      return null
    }
    return item.pixels === undefined ? null : <Raster key={`media-${item.n}`} columns={width} rows={THUMB_ROWS} cells={rasterCells(item.pixels, width, THUMB_ROWS)} />
  }
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between" width={columns}>
        <Text color={C.cyan} bold>
          MEDIA
        </Text>
        <Text color={C.dim}>{items.length === 1 ? '1 arquivo' : `${items.length} arquivos`}</Text>
      </Box>
      {/* Sem miniatura as legendas empilham: lado a lado quebrariam em pedacos. */}
      <Box flexDirection={width === null ? 'column' : 'row'} columnGap={2}>
        {locals.map(item => (
          <Box key={`media-${item.n}`} flexDirection="column" width={width ?? undefined}>
            {thumb(item)}
            {item.state === 'missing' ? (
              <Text color={C.text} wrap="truncate-end">
                {`[${item.n}] ${item.name}`}
                <Text color={C.dim}>{' · arquivo removido'}</Text>
              </Text>
            ) : item.state === 'loading' ? (
              <>
                <Text color={C.text} wrap="truncate-end">{labelOf(item)}</Text>
                <Text color={C.dim}>carregando…</Text>
              </>
            ) : (
              <Button key={`open-${item.n}`} plain label={labelOf(item)} onPress={() => onOpen(item.n)} />
            )}
          </Box>
        ))}
      </Box>
      {remotes.map(item => (
        <Box key={`remote-${item.n}`} flexDirection="row">
          <Text color={C.dim}>{'↗ '}</Text>
          <Link href={item.url as string} label={labelOf(item)} />
        </Box>
      ))}
      {extra > 0 ? <Text color={C.dim}>{`+${extra}`}</Text> : null}
    </Box>
  )
}
