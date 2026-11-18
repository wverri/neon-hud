import type { ElementTable, RenderElement } from 'claude-code'

import { C } from './hud'

// O claude-mem (>= 16) poe o banner de inicio de sessao e de compactacao num card do transcript:
// $.ui.place({ id: 'session-start-<ms>' }) desenhado pelo hook Placed dele. O neon-hud envolve esse card.
export const MEM_PLUGIN = 'claude-mem'
export const MEM_CARD_PREFIX = 'session-start-'
export const MEM_OPEN_KEEP = 50

export const isMemCard = (props: { plugin: string; id: string }): boolean =>
  props.plugin === MEM_PLUGIN && props.id.startsWith(MEM_CARD_PREFIX)

/** Chave de estado de um card: o mesmo id volta a cada compactacao fora do fullscreen. */
export const memCardKey = (id: string): string => `${MEM_PLUGIN}:${id}`

export const toggleOpen = (open: readonly string[], key: string): string[] =>
  open.includes(key) ? open.filter(k => k !== key) : [...open, key].slice(-MEM_OPEN_KEEP)

// A arvore que next(e) devolve guarda os filhos em children, ao lado de props.
type Node = { type?: unknown; children?: unknown; props?: { children?: unknown } }

const flat = (children: unknown): unknown[] =>
  Array.isArray(children) ? children.flatMap(flat) : children === undefined || children === null || children === false ? [] : [children]

/**
 * Quantas linhas o card do claude-mem desenha: os Text filhos da caixa, menos o titulo.
 * undefined quando o formato nao e o esperado: a linha recolhida so deixa de mostrar a contagem.
 */
export const countCardLines = (tree: unknown): number | undefined => {
  const box = tree as Node | null
  if (!box || typeof box !== 'object' || box.type !== 'Box') return undefined
  const texts = flat(box.children ?? box.props?.children).filter(c => (c as Node)?.type === 'Text')
  return texts.length > 1 ? texts.length - 1 : undefined
}

export const headerHint = (isOpen: boolean, lines: number | undefined): string => {
  const count = lines === undefined ? '' : ` · ${lines} ${lines === 1 ? 'linha' : 'linhas'}`
  return `${count} · ${isOpen ? 'clique para recolher' : 'clique para expandir'}`
}

/** A linha destacada que substitui o card: um Button so, alcancavel por clique ou ctrl+x tab e Enter. */
export function drawMemHeader(el: ElementTable<'terminal'>, key: string, isOpen: boolean, lines: number | undefined, onPress: () => void): RenderElement {
  const { Button, Text } = el
  return (
    <Button key={`mem-${key}`} label="CLAUDE-MEM" plain onPress={onPress}>
      <Text color={C.pink} bold>
        {isOpen ? '▾' : '▸'} CLAUDE-MEM
      </Text>
      <Text color={C.dim}>{headerHint(isOpen, lines)}</Text>
    </Button>
  )
}
