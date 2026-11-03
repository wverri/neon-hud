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

export function thumbBmpPath(outDir: string, file: string, mtimeMs: number): string {
  return `${outDir}/thumb-${fnv1a(file + mtimeMs)}.bmp`
}

// Os caminhos entram so por $args: nada e interpolado no script.
export const PS_THUMB = [
  'Add-Type -AssemblyName System.Drawing;',
  '$src = [System.Drawing.Image]::FromFile($args[0]);',
  '$bmp = New-Object System.Drawing.Bitmap([int]$args[2], [int]$args[3], [System.Drawing.Imaging.PixelFormat]::Format24bppRgb);',
  '$g = [System.Drawing.Graphics]::FromImage($bmp);',
  '$g.DrawImage($src, 0, 0, [int]$args[2], [int]$args[3]);',
  '$bmp.Save($args[1], [System.Drawing.Imaging.ImageFormat]::Bmp);',
  '$g.Dispose(); $bmp.Dispose(); $src.Dispose()',
].join(' ')

function baseName(p: string): string {
  return p.split(/[\\/]/).pop() || p
}

/**
 * Argv a rodar em sequencia; o ultimo deixa thumbBmpPath(outDir, file, mtimeMs).
 * `mtimeMs` e opcional (0): o chamador deve passar o mesmo valor que usa para
 * localizar o bmp. [] significa sem conversor: fica so a legenda.
 * No macOS, video usa qlmanage + sips e ignora hasFfmpeg: se o qlmanage falhar,
 * o chamador (Task 4) tenta thumbSteps('linux', 'video', ..., true) para o ffmpeg.
 * No Linux e no Windows, video so converte com ffmpeg.
 */
export function thumbSteps(platform: Platform, media: MediaKind, file: string, outDir: string, width: number, height: number, hasFfmpeg: boolean, mtimeMs = 0): string[][] {
  const bmp = thumbBmpPath(outDir, file, mtimeMs)
  const w = String(width)
  const h = String(height)
  if (media === 'video') {
    if (platform === 'macos') {
      const png = `${outDir}/${baseName(file)}.png`
      return [
        ['qlmanage', '-t', '-s', '128', '-o', outDir, file],
        ['sips', '-s', 'format', 'bmp', '-z', h, w, png, '--out', bmp],
      ]
    }
    if (!hasFfmpeg) return []
    return [['ffmpeg', '-y', '-loglevel', 'error', '-i', file, '-frames:v', '1', '-vf', `scale=${w}:${h}`, bmp]]
  }
  if (platform === 'macos') return [['sips', '-s', 'format', 'bmp', '-z', h, w, file, '--out', bmp]]
  if (platform === 'windows') return [['powershell', '-NoProfile', '-NonInteractive', '-Command', PS_THUMB, file, bmp, w, h]]
  return [['magick', file, '-resize', `${w}x${h}!`, bmp]]
}

export function decodeSteps(platform: Platform, b64File: string, outFile: string): string[][] {
  if (platform === 'macos') return [['base64', '-D', '-i', b64File, '-o', outFile]]
  if (platform === 'windows') return [['certutil', '-f', '-decode', b64File, outFile]]
  return [['sh', '-c', 'base64 -d < "$1" > "$2"', 'sh', b64File, outFile]]
}

export function openArgv(platform: Platform, target: string): string[] {
  if (platform === 'macos') return ['open', target]
  if (platform === 'windows') return ['explorer.exe', target]
  return ['xdg-open', target]
}
