import type { PluginOptions } from 'claude-code'

import type { ClipboardBackend } from './clipboard'
import type { Shape, Terminal } from './rtl'

export const TOKENS = [
  'accent', 'heading', 'strong', 'emphasis', 'inlineCode', 'codeText', 'codeCommand', 'codeFlag', 'codeString', 'codeComment',
  'link', 'path', 'number', 'quote', 'rule', 'tableHeader', 'tableRule', 'bullet', 'diagram', 'diagramText',
] as const

export type Theme = Partial<Record<(typeof TOKENS)[number], string>>

export type Clock = 'off' | '24h' | '12h'

export type Style = {
  theme: Theme
  headingStyle: 'bold' | 'underline' | 'uppercase' | 'banner'
  tableStyle: 'box' | 'rules' | 'grid' | 'minimal'
  taskStyle: 'checks' | 'ticks' | 'box' | 'progress'
  promptStyle: 'bubble' | 'bar' | 'chevron' | 'off'
  clock: Clock
  toolStyle: 'chat' | 'tree-dim' | 'tree-bold' | 'classic'
  toolOutput: 'full' | 'quiet'
  narration?: boolean
  highlightNumbers: boolean
  highlightPaths: boolean
  mermaid: boolean
  mermaidAscii: boolean
  copyButtons: boolean
  htmlCopy: ClipboardBackend | null
  diagramHints: boolean
  rtl: 'auto' | Terminal | 'off'
  reorder: boolean
  shape: Shape
  latex: boolean
  cwd: string
  home: string
}

// As mesmas cores do painel (C em hud.tsx), para a resposta e o HUD falarem a mesma lingua.
export const NEON: Record<(typeof TOKENS)[number], string> = {
  accent: '#00e5ff', heading: '#00e5ff', tableHeader: '#00e5ff', strong: '#00e5ff', emphasis: '#a77bff',
  inlineCode: '#ffcc33', codeText: '#c9d4f2', codeCommand: '#a77bff', codeFlag: '#ff3ea5', codeString: '#3dff9a',
  codeComment: '#66708f', link: '#a77bff', path: '#ffcc33', number: '#3dff9a', quote: '#c9d4f2',
  rule: '#343c5c', tableRule: '#343c5c', bullet: '#66708f', diagram: '#343c5c', diagramText: '#c9d4f2',
}

const COLOR = /^(#[0-9a-f]{3}|#[0-9a-f]{6}|rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)|ansi256\(\d{1,3}\)|(black|red|green|yellow|blue|magenta|cyan|white|gray|grey)(Bright)?)$/i

export const isColor = (value: unknown): value is string => typeof value === 'string' && COLOR.test(value.trim())

const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback

// RTL, heading, tarefas e prompts ficam fixos: o render.tsx do prismantis ainda le esses campos.
export const resolveStyle = (options: PluginOptions): Style => ({
  theme: { ...NEON },
  headingStyle: 'banner',
  tableStyle: pick(options.tableStyle, ['box', 'rules', 'grid', 'minimal'] as const, 'box'),
  taskStyle: 'checks',
  promptStyle: 'off',
  clock: pick(options.clock, ['off', '24h', '12h'] as const, 'off'),
  toolStyle: pick(options.toolStyle, ['chat', 'tree-dim', 'tree-bold', 'classic'] as const, 'chat'),
  toolOutput: pick(options.toolOutput, ['full', 'quiet'] as const, 'full'),
  highlightNumbers: options.highlightNumbers !== false,
  highlightPaths: options.highlightPaths !== false,
  mermaid: options.mermaid !== false,
  mermaidAscii: options.mermaidAscii === true,
  copyButtons: options.copyButtons !== false,
  htmlCopy: null,
  diagramHints: false,
  rtl: 'off',
  reorder: false,
  shape: 'visual',
  latex: options.latex === true,
  cwd: '',
  home: '',
})
