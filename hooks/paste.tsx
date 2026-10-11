import type { ElementTable, RenderElement } from 'claude-code'

import { C } from './hud'

export type PastedImage = { id: number; file?: string; bytes?: number }

const IMAGE_REF = /\[Image #(\d+)\]/g

export const extractImageIds = (text: string): number[] =>
  [...new Set([...text.matchAll(IMAGE_REF)].map(m => Number(m[1])))].sort((a, b) => a - b)

export const sameIds = (a: readonly number[], b: readonly number[]): boolean =>
  a.length === b.length && a.every((id, i) => id === b[i])

export const formatBytes = (n: number): string =>
  n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`

export const thumbSize = (bodyColumns: number, maxRows: number, count: number): { columns: number; rows: number } | null => {
  const columns = Math.min(24, Math.floor((bodyColumns - 2 * (count - 1)) / count))
  // Uma linha para o rotulo PASTE e uma para a legenda.
  const rows = Math.min(8, maxRows - 2)
  return columns < 8 || rows < 3 ? null : { columns, rows }
}

export const tmpBases = (custom?: string): string[] =>
  [...new Set([custom, '/private/tmp', '/tmp'].filter((b): b is string => !!b).map(b => b.replace(/\/+$/, '') || '/'))]

export const caption = (image: PastedImage): string =>
  image.file === undefined ? `[Image #${image.id}] · prévia indisponível` : `[Image #${image.id}] · ${formatBytes(image.bytes ?? 0)}`

export function drawPasteBand({ Box, Text, Image }: ElementTable<'terminal'>, images: PastedImage[], bodyColumns: number, maxRows: number): RenderElement {
  const size = thumbSize(bodyColumns, maxRows, images.length)
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between" width={bodyColumns}>
        <Text color={C.cyan} bold>
          PASTE
        </Text>
        <Text color={C.dim}>{images.length === 1 ? '1 imagem' : `${images.length} imagens`}</Text>
      </Box>
      <Box flexDirection="row" columnGap={2}>
        {images.map(image => (
          <Box flexDirection="column">
            {size && image.file !== undefined ? <Image source={{ file: image.file, format: 'png' }} columns={size.columns} rows={size.rows} alt={caption(image)} /> : null}
            <Text color={image.file === undefined ? C.dim : C.text}>{caption(image)}</Text>
          </Box>
        ))}
      </Box>
    </Box>
  )
}
