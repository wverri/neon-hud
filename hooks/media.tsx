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

const scanText = (text: string, cwd: string, home: string, out: Hit[]): void => {
  for (const m of text.matchAll(TOKEN)) {
    const quoted = m[2]
    if (quoted !== undefined) {
      const inner = quoted.trim()
      if (!/^https?:\/\//i.test(inner) && mediaKindOf(inner) !== null) out.push({ kind: 'local', path: resolvePath(inner, cwd, home) })
      else scanText(inner, cwd, home, out)
      continue
    }
    const token = (m[3] ?? '').replace(LEAD, '').replace(TRAIL, '')
    if (/^https?:\/\//i.test(token)) {
      if (mediaKindOf(token.replace(/[?#].*$/, '')) !== null) out.push({ kind: 'remote', url: token })
    } else if (mediaKindOf(token) !== null) {
      out.push({ kind: 'local', path: resolvePath(token, cwd, home) })
    }
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
  }
}

export function findCandidates(tool: string, input: unknown, output: unknown, cwd: string, home: string): Candidate[] {
  if (tool === 'Read') return []
  const always = tool === 'SendUserFile'
  const result: Candidate[] = []
  const seen = new Set<string>()
  const add = (c: Candidate, key: string): void => {
    if (seen.has(key)) return
    seen.add(key)
    result.push(c)
  }
  const addHits = (hits: Hit[], alwaysLocal: boolean): void => {
    for (const hit of hits) {
      if (hit.kind === 'local') add({ kind: 'local', path: hit.path, media: mediaKindOf(hit.path) ?? 'image', always: alwaysLocal }, hit.path)
      else add({ kind: 'remote', url: hit.url, media: mediaKindOf(hit.url.replace(/[?#].*$/, '')) ?? 'image' }, hit.url)
    }
  }

  if (isRecord(input)) {
    for (const value of Object.values(input)) {
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
