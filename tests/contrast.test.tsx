import { expect, test } from 'claude-code/testing'

import { NEON, TOKENS } from '../hooks/render/theme'

const BACKGROUNDS = ['#000000', '#0b0e1a', '#1e1e2e']

const luminance = (hex: string) => {
  const channel = (i: number) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
}

const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

const FLOOR: Record<string, number> = { rule: 1.05, tableRule: 1.05, diagram: 1.05, codeComment: 1.5, bullet: 1.5, quote: 1.5 }

test('a paleta neon define todo token com uma cor hex valida', async () => {
  expect(Object.keys(NEON).sort()).toEqual([...TOKENS].sort())
  for (const value of Object.values(NEON)) expect(/^#[0-9a-f]{6}$/.test(value)).toBe(true)
})

test('a paleta neon fica legivel em fundos escuros', async () => {
  const failures: string[] = []
  for (const bg of BACKGROUNDS)
    for (const [token, color] of Object.entries(NEON)) {
      const ratio = contrast(color, bg)
      if (ratio < (FLOOR[token] ?? 2)) failures.push(`${bg} ${token} ${ratio.toFixed(2)}`)
    }
  expect(failures).toEqual([])
})
