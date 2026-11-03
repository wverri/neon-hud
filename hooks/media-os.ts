import type { MediaKind } from './media'

export type Platform = 'macos' | 'windows' | 'linux'

export function platformOf(env: { OS?: string; HOME?: string; USERPROFILE?: string; OSTYPE?: string }, hasSips: boolean): Platform {
  if (env.OS === 'Windows_NT') return 'windows'
  return hasSips ? 'macos' : 'linux'
}

// FNV-1a de 32 bits em hex: estavel entre execucoes, sem depender de crypto.
function fnv1a(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/** Junta com o separador que a pasta ja usa: \\ no Windows, / no resto. */
export function joinPath(dir: string, name: string): string {
  return `${dir}${dir.includes('\\') ? '\\' : '/'}${name}`
}

export function thumbBmpPath(outDir: string, file: string, mtimeMs: number): string {
  return joinPath(outDir, `thumb-${fnv1a(file + '\0' + mtimeMs)}.bmp`)
}

// Conteudo do .ps1 rodado com -File: os caminhos chegam como parametros, nunca
// como codigo (com -Command o PowerShell re-tokeniza e executa o nome do arquivo).
export const PS_THUMB = [
  'param([string]$in, [string]$out, [int]$w, [int]$h)',
  '$src = $null; $bmp = $null; $g = $null',
  'try {',
  '  Add-Type -AssemblyName System.Drawing',
  '  $src = [System.Drawing.Image]::FromFile($in)',
  '  $bmp = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)',
  '  $g = [System.Drawing.Graphics]::FromImage($bmp)',
  '  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic',
  '  $g.DrawImage($src, 0, 0, $w, $h)',
  '  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Bmp)',
  '} finally {',
  '  if ($g) { $g.Dispose() }',
  '  if ($bmp) { $bmp.Dispose() }',
  '  if ($src) { $src.Dispose() }',
  '}',
  '',
].join('\n')

/** Onde o chamador grava PS_THUMB (com $.fs.write) antes de rodar o passo do Windows. */
export function psThumbPath(outDir: string): string {
  return joinPath(outDir, 'neon-thumb.ps1')
}

function baseName(p: string): string {
  return p.split(/[\\/]/).pop() || p
}

/**
 * Argv a rodar em sequencia; o ultimo deixa thumbBmpPath(outDir, file, mtimeMs).
 * `mtimeMs` e opcional (0): o chamador deve passar o mesmo valor que usa para
 * localizar o bmp. [] significa sem conversor: fica so a legenda.
 * `ffmpeg` e o caminho detectado do executavel, ou null sem ffmpeg.
 * No macOS, video usa qlmanage + sips e ignora ffmpeg: se o qlmanage falhar,
 * o chamador tenta thumbSteps('linux', 'video', ..., ffmpeg).
 * No Windows, o chamador deve gravar PS_THUMB em psThumbPath(outDir) antes do passo.
 * No Linux e no Windows, video so converte com ffmpeg.
 */
export function thumbSteps(platform: Platform, media: MediaKind, file: string, outDir: string, width: number, height: number, ffmpeg: string | null, mtimeMs = 0): string[][] {
  const bmp = thumbBmpPath(outDir, file, mtimeMs)
  const w = String(width)
  const h = String(height)
  if (media === 'video') {
    if (platform === 'macos') {
      const png = joinPath(outDir, `${baseName(file)}.png`)
      return [
        ['qlmanage', '-t', '-s', '128', '-o', outDir, file],
        ['sips', '-s', 'format', 'bmp', '-z', h, w, png, '--out', bmp],
      ]
    }
    if (ffmpeg === null) return []
    return [[ffmpeg, '-y', '-loglevel', 'error', '-i', file, '-frames:v', '1', '-vf', `scale=${w}:${h}`, bmp]]
  }
  if (platform === 'macos') return [['sips', '-s', 'format', 'bmp', '-z', h, w, file, '--out', bmp]]
  if (platform === 'windows') return [['powershell', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psThumbPath(outDir), file, bmp, w, h]]
  return [['magick', `${file}[0]`, '-resize', `${w}x${h}!`, bmp]]
}

export function decodeSteps(platform: Platform, b64File: string, outFile: string): string[][] {
  if (platform === 'macos') return [['base64', '-D', '-i', b64File, '-o', outFile]]
  if (platform === 'windows') return [['certutil', '-f', '-decode', b64File, outFile]]
  return [['sh', '-c', 'base64 -d < "$1" > "$2"', 'sh', b64File, outFile]]
}

export function openArgv(platform: Platform, target: string): string[] {
  if (platform === 'macos') return ['open', target]
  // O explorer.exe nao entende C:/a/b: caminho local vai com barras invertidas.
  if (platform === 'windows') return ['explorer.exe', /^https?:\/\//i.test(target) ? target : target.replace(/\//g, '\\')]
  return ['xdg-open', target]
}
