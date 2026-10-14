import type { ElementTable, RenderChildren, RenderElement } from 'claude-code'

import type { HudContext, HudControl, HudLive, HudPhase, HudSlice, HudTokens, HudTools, HudTurn, HudVitals } from '../types'
import { EFFORTS } from './control'

export const PANE = 'neon-hud'
export const TITLE = 'NEON//HUD'
export const WIDTH = 46

export const C = {
  text: '#c9d4f2',
  dim: '#66708f',
  line: '#343c5c',
  label: '#8b95b8',
  glow: '#1d5a66',
  cyan: '#00e5ff',
  pink: '#ff3ea5',
  violet: '#a77bff',
  green: '#3dff9a',
  amber: '#ffcc33',
  red: '#ff4d6d',
}

// O /context da varias linhas no mesmo cinza: cada categoria usada ganha a sua cor, em ordem.
const SLICE_COLORS = [C.cyan, C.violet, C.green, C.amber, '#4d8dff', '#7dfff0', '#ff9e3d', C.text]
const SLICE_GLYPH = { used: '█', free: '─', buffer: '░' } as const

export const STORE_PREFIX = 'session:'
export const STORE_KEEP = 30

const SPARK = '▁▂▃▄▅▆▇█'

function fmt(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`
  return `${Math.round(n)}`
}

function meter(pct: number, width: number): [string, string] {
  const cells = Math.max(1, width)
  const full = Math.round((Math.min(100, Math.max(0, pct)) / 100) * cells)
  return ['━'.repeat(full), '─'.repeat(cells - full)]
}

export function toContext(b: {
  categories: { name: string; tokens: number; kind: string }[]
  totalTokens: number
  rawMaxTokens: number
  percentage: number
  autoCompactThreshold?: number
  isAutoCompactEnabled: boolean
}): HudContext {
  const order = { used: 0, free: 1, buffer: 2 }
  const slices: HudSlice[] = b.categories
    .filter(c => c.kind !== 'deferred' && c.tokens > 0)
    .map(c => ({ name: c.name.toLowerCase(), tokens: c.tokens, color: '', kind: c.kind as HudSlice['kind'] }))
    .sort((x, y) => order[x.kind] - order[y.kind])
  let next = 0
  for (const s of slices) {
    s.color = s.kind === 'free' ? C.line : s.kind === 'buffer' ? C.dim : s.name === 'messages' ? C.pink : SLICE_COLORS[next++ % SLICE_COLORS.length]!
  }
  return {
    slices,
    total: b.totalTokens,
    window: b.rawMaxTokens,
    percent: b.percentage,
    compactsAt: b.isAutoCompactEnabled ? b.autoCompactThreshold : undefined,
  }
}


// A barra em trechos: cada fatia leva sua parte de `width`, uma usada ao menos uma celula.
export function ctxCells(r: HudContext, width: number) {
  const sizes = r.slices.map(s => Math.max(s.kind === 'used' ? 1 : 0, Math.round((s.tokens / r.window) * width)))
  // O arredondamento erra por poucas celulas: o espaco livre absorve primeiro, depois as maiores fatias.
  let diff = width - sizes.reduce((a, n) => a + n, 0)
  const isUsed = (i: number) => r.slices[i]!.kind === 'used'
  const order = r.slices.map((_, i) => i).sort((a, b) => Number(isUsed(a)) - Number(isUsed(b)) || sizes[b]! - sizes[a]!)
  for (const i of order) {
    if (diff === 0) break
    const size = Math.max(isUsed(i) ? 1 : 0, sizes[i]! + diff)
    diff -= size - sizes[i]!
    sizes[i] = size
  }
  return r.slices.map((s, i) => ({ color: s.color, kind: s.kind, text: SLICE_GLYPH[s.kind].repeat(sizes[i]!) })).filter(c => c.text !== '')
}

export function ktok(n: number): string {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
  if (n >= 10_000) return `${Math.round(n / 1000)}k`
  if (n >= 1000) return `${+(n / 1000).toFixed(1)}k`
  return String(Math.round(n))
}

export function share(n: number, window: number): string {
  const p = (n / window) * 100
  if (p > 0 && p < 0.1) return '<0.1%'
  return `${p >= 10 ? Math.round(p) : +p.toFixed(1)}%`
}

function heat(pct: number): string {
  if (pct >= 85) return C.red
  if (pct >= 60) return C.amber
  return C.green
}

function spark(values: number[], width: number): [string, string] {
  const tail = values.slice(-width)
  const lo = Math.min(...tail)
  const hi = Math.max(...tail)
  const range = hi - lo
  const level = (v: number) => (range < 1 ? 4 : 1 + Math.round(((v - lo) / range) * 6))
  return ['▁'.repeat(width - tail.length), tail.map(v => SPARK[level(v)]).join('')]
}

function seconds(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return s >= 60 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s` : `${s}s`
}

function money(usd: number): string {
  return usd >= 10 ? `$${usd.toFixed(1)}` : `$${usd.toFixed(2)}`
}

type Recent = HudTools['recent'][number]

function grouped(recent: Recent[]): { tool: string; mark: string; color: string; n: number }[] {
  const out: { tool: string; mark: string; color: string; n: number }[] = []
  for (const c of recent.slice().reverse()) {
    const tool = c.tool.split('__').pop() ?? c.tool
    const mark = !c.isDone ? '⟳' : c.isError ? '✗' : '✓'
    const color = !c.isDone ? C.amber : c.isError ? C.red : C.dim
    const last = out[out.length - 1]
    if (last && last.tool === tool && last.mark === mark) last.n += 1
    else out.push({ tool, mark, color, n: 1 })
  }
  return out
}

function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`
}

function span(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60000))
  if (m >= 1440) return `${Math.floor(m / 1440)}d${Math.floor((m % 1440) / 60)}h`
  if (m >= 60) return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
  return `${m}m`
}

function shortModel(model: string): string {
  return model.replace(/^claude-/, '').replace(/\[.*\]$/, '') || '—'
}

function windowName(kind: string): string {
  if (kind === 'five_hour') return '5H'
  if (kind === 'seven_day') return '7D'
  if (kind === 'spend_limit') return 'CAP'
  return kind.slice(0, 3).toUpperCase()
}

function clip(text: string, width: number): string {
  return text.length > width ? `${text.slice(0, Math.max(1, width - 1))}…` : text
}

const PHASE: Record<HudPhase, { label: string; color: string }> = {
  IDLE: { label: 'STANDBY', color: C.dim },
  UPLINK: { label: 'SENDING', color: C.violet },
  THINK: { label: 'THINKING', color: C.pink },
  STREAM: { label: 'STREAMING', color: C.cyan },
  EXEC: { label: 'RUNNING', color: C.amber },
}

const AGENT: Record<string, { glyph: string; color: string }> = {
  running: { glyph: '▶', color: C.cyan },
  pending: { glyph: '◌', color: C.violet },
  waiting: { glyph: '◍', color: C.amber },
  idle: { glyph: '○', color: C.dim },
  completed: { glyph: '✓', color: C.green },
  failed: { glyph: '✗', color: C.red },
  killed: { glyph: '✗', color: C.red },
}

// `canSelect` e falso no app mobile, que ainda nao desenha Select.
export type PaneActions = { model: (value: string) => void; effort: (value: string) => void; canSelect: boolean }

export type PaneState = { l: HudLive; t: HudTokens; tl: HudTools; v: HudVitals; tn: HudTurn; cx: HudContext | null; ctl: HudControl }

export function drawPane(el: ElementTable, { l, t, tl, v, tn, cx, ctl }: PaneState, bodyColumns: number, pick: PaneActions): RenderElement {
  const { Box, Text } = el
  const Select = pick.canSelect && 'Select' in el ? el.Select : undefined
  const w = Math.max(28, bodyColumns)
  const iw = w - 6
  const half = Math.floor(iw / 2)

  const card = (title: string, isLive: boolean, aside: RenderChildren, body: RenderChildren) => (
    <Box flexDirection="column" borderStyle="round" borderColor={isLive ? C.glow : C.line} paddingX={1}>
      <Box justifyContent="space-between">
        <Text color={isLive ? C.cyan : C.label} bold>
          {isLive ? '◆ ' : ''}
          {title}
        </Text>
        {aside}
      </Box>
      {body}
    </Box>
  )

  const metric = (label: string, value: string, color: string) => (
    <Box flexDirection="column" width={half}>
      <Text color={C.dim}>{label}</Text>
      <Text color={color} bold>
        {value}
      </Text>
    </Box>
  )

  const phase = PHASE[l.phase]
  const pulse = l.phase !== 'IDLE' && Math.floor(v.now / 1500) % 2 === 1
  const model = shortModel(v.model || l.model)
  const tps = l.phase === 'IDLE' ? l.lastTps : l.liveTps || l.lastTps
  const promptIn = t.input + t.cacheRead + t.cacheWrite
  const hitRate = promptIn > 0 ? Math.round((t.cacheRead / promptIn) * 100) : 0
  const [ctxOn, ctxOff] = meter(v.contextPercent, iw)
  const ctxHeat = cx ? heat(cx.compactsAt ? (cx.total / cx.compactsAt) * 100 : cx.percent) : heat(v.contextPercent)
  const ctxNameW = Math.max(6, iw - 14)
  const avgTps = l.tpsHistory.length ? l.tpsHistory.reduce((a, b) => a + b, 0) / l.tpsHistory.length : 0
  const [sparkPad, sparkBars] = spark(l.tpsHistory, iw)
  const hours = (v.now - v.startedAt) / 3_600_000
  const perHour = hours > 0.02 ? v.costUsd / hours : 0
  const perTurn = v.turns > 0 ? v.costUsd / v.turns : 0
  const topTools = Object.entries(tl.counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
  const topMax = Math.max(1, ...topTools.map(([, n]) => n))
  const nameW = Math.min(14, Math.max(8, Math.floor(iw * 0.35)))
  const toolBarW = Math.max(4, iw - nameW - 5)
  const active = v.agents.filter(a => a.status === 'running' || a.status === 'pending' || a.status === 'waiting')
  const shown = [...active, ...v.agents.filter(a => !active.includes(a))].slice(0, 5)

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box justifyContent="space-between">
        <Text bold>
          <Text color={C.cyan}>◢◤ NEON</Text>
          <Text color={C.pink}>//</Text>
          <Text color={C.cyan}>HUD</Text>
        </Text>
        <Text color={phase.color} bold>
          {pulse ? '○' : '●'} {phase.label}
        </Text>
      </Box>
      <Text color={C.dim} wrap="truncate-end">
        <Text color={C.text}>{model}</Text>
        {'  ·  '}
        {clock(v.now - v.startedAt)}
        {'  ·  '}
        {v.turns} turns
        {'  ·  '}
        {t.steps} req
      </Text>
      {tn.startedAt > 0 ? (
        <Text color={C.dim} wrap="truncate-end">
          turn <Text color={C.text}>{seconds(v.now - tn.startedAt)}</Text>
          <Text color={C.amber}>{l.phase === 'EXEC' && l.detail ? `  › ${l.detail}` : ''}</Text>
        </Text>
      ) : (
        <Text color={C.dim} wrap="truncate-end">
          {tn.lastMs > 0 ? (
            <Text>
              last turn <Text color={C.text}>{seconds(tn.lastMs)}</Text> · <Text color={C.text}>{money(tn.lastCostUsd)}</Text>
            </Text>
          ) : (
            ' '
          )}
        </Text>
      )}

      {card(
        'MODEL',
        false,
        <Text color={C.dim}>{ctl.isLocked ? 'locked by policy' : ''}</Text>,
        Select ? (
          <Box flexDirection="column">
            {ctl.models.length > 0 && !ctl.isLocked && (
              <Select
                key="model"
                label="model  "
                options={ctl.models.map(m => ({ value: m }))}
                value={ctl.models.includes(ctl.model) ? ctl.model : undefined}
                onSelect={(value: string) => pick.model(value)}
              />
            )}
            <Select
              key="effort"
              label="effort "
              options={EFFORTS.map(e => ({ value: e }))}
              value={(EFFORTS as readonly string[]).includes(ctl.effort) ? ctl.effort : undefined}
              onSelect={(value: string) => pick.effort(value)}
            />
          </Box>
        ) : (
          <Text color={C.dim} wrap="truncate-end">
            <Text color={C.text}>{ctl.model || '—'}</Text>
            {'  ·  effort '}
            <Text color={C.text}>{ctl.effort || '—'}</Text>
          </Text>
        ),
      )}

      {card(
        'THROUGHPUT',
        l.phase === 'STREAM' || l.phase === 'THINK',
        <Text color={C.dim}>
          avg <Text color={C.text}>{avgTps.toFixed(0)}</Text> · peak <Text color={C.text}>{l.peakTps.toFixed(0)}</Text>
        </Text>,
        <Box flexDirection="column">
          <Text>
            <Text color={C.cyan} bold>
              {tps.toFixed(1)}
            </Text>
            <Text color={C.dim}> tok/s</Text>
          </Text>
          <Text>
            <Text color={C.line}>{sparkPad}</Text>
            <Text color={C.cyan}>{sparkBars}</Text>
          </Text>
        </Box>,
      )}

      {card(
        'CONTEXT',
        false,
        <Text color="#0b0e1a" backgroundColor={ctxHeat} bold>
          {` ${cx ? cx.percent : v.contextPercent}% `}
        </Text>,
        cx ? (
          <Box flexDirection="column">
            <Text>
              {ctxCells(cx, iw).map(c => (
                <Text color={c.color}>{c.text}</Text>
              ))}
            </Text>
            <Text color={C.dim} wrap="truncate-end">
              <Text color={C.text}>{ktok(cx.total)}</Text> of {ktok(cx.window)}
              {cx.compactsAt ? (
                <Text>
                  {' · compacts at '}
                  <Text color={C.text}>{ktok(cx.compactsAt)}</Text>
                </Text>
              ) : (
                ''
              )}
            </Text>
            {cx.slices.map(s => (
              <Text>
                <Text color={s.color}>{s.kind === 'used' ? '■ ' : `${SLICE_GLYPH[s.kind]} `}</Text>
                <Text color={s.kind === 'used' ? C.text : C.dim}>{clip(s.name, ctxNameW - 1).padEnd(ctxNameW)}</Text>
                <Text color={s.kind === 'used' ? C.text : C.dim} bold={s.kind === 'used'}>
                  {ktok(s.tokens).padStart(6)}
                </Text>
                <Text color={C.dim}>{(s.kind === 'used' ? share(s.tokens, cx.window) : '').padStart(6)}</Text>
              </Text>
            ))}
          </Box>
        ) : (
          <Box flexDirection="column">
            <Text>
              <Text color={ctxHeat}>{ctxOn}</Text>
              <Text color={C.line}>{ctxOff}</Text>
            </Text>
            <Text color={C.dim}>
              <Text color={C.text}>{fmt(v.contextTokens)}</Text> of {fmt(v.contextWindow)} tokens
            </Text>
          </Box>
        ),
      )}

      {card(
        'TOKENS',
        false,
        <Text color={C.dim}>
          cache hit <Text color={C.text}>{hitRate}%</Text>
        </Text>,
        <Box flexDirection="column">
          <Box>
            {metric('INPUT', fmt(t.input), C.green)}
            {metric('OUTPUT', fmt(t.output), C.pink)}
          </Box>
          <Box>
            {metric('CACHE READ', fmt(t.cacheRead), C.cyan)}
            {metric('CACHE WRITE', fmt(t.cacheWrite), C.violet)}
          </Box>
        </Box>,
      )}

      {card(
        'SPEND',
        false,
        <Text color={C.dim}>
          <Text color={C.text}>{money(perTurn)}</Text>/turn · <Text color={C.text}>{money(perHour)}</Text>/h
        </Text>,
        <Box flexDirection="column">
          <Text>
            <Text color={C.amber} bold>
              ${v.costUsd.toFixed(2)}
            </Text>
            <Text color={C.dim}> USD</Text>
          </Text>
          {v.rateLimits.map(r => {
            const reset = r.resetsAt ? `↻${span(Date.parse(r.resetsAt) - v.now)}` : ''
            const [fill, rest] = meter(r.percentUsed, Math.max(4, iw - 4 - 5 - (reset ? reset.length + 1 : 0)))
            return (
              <Text>
                <Text color={C.dim}>{windowName(r.kind).padEnd(4)}</Text>
                <Text color={heat(r.percentUsed)}>{fill}</Text>
                <Text color={C.line}>{rest}</Text>
                <Text color={C.text}>{`${Math.round(r.percentUsed)}%`.padStart(5)}</Text>
                <Text color={C.dim}>{reset ? ` ${reset}` : ''}</Text>
              </Text>
            )
          })}
        </Box>,
      )}

      {card(
        'AGENTS',
        active.length > 0,
        <Text color={active.length ? C.cyan : C.dim}>{active.length} active</Text>,
        <Box flexDirection="column">
          {shown.length === 0 && <Text color={C.dim}>No agents running</Text>}
          {shown.map(a => {
            const look = AGENT[a.status] ?? { glyph: '·', color: C.dim }
            return (
              <Text wrap="truncate-end">
                <Text color={look.color}>{look.glyph} </Text>
                <Text color={C.text}>{a.type}</Text>
                <Text color={C.dim}> {a.description}</Text>
              </Text>
            )
          })}
        </Box>,
      )}

      {card(
        'TOOLS',
        tl.recent.some(c => !c.isDone),
        <Text color={C.dim}>
          <Text color={C.text}>{tl.total}</Text> calls
        </Text>,
        <Box flexDirection="column">
          {topTools.length === 0 && <Text color={C.dim}>No tool calls yet</Text>}
          {topTools.map(([name, n]) => {
            const len = Math.max(1, Math.round((n / topMax) * toolBarW))
            return (
              <Text>
                <Text color={C.text}>{clip(name.split('__').pop() ?? name, nameW - 1).padEnd(nameW)}</Text>
                <Text color={C.cyan}>{'━'.repeat(len)}</Text>
                <Text color={C.line}>{'─'.repeat(toolBarW - len)}</Text>
                <Text color={C.dim}>{String(n).padStart(5)}</Text>
              </Text>
            )
          })}
          {tl.recent.length > 0 && (
            <Text wrap="truncate-end">
              <Text color={C.dim}>recent </Text>
              {grouped(tl.recent).map(g => (
                <Text color={g.color}>
                  {g.mark}
                  {g.tool}
                  {g.n > 1 ? <Text color={C.line}>×{g.n}</Text> : ''}{' '}
                </Text>
              ))}
            </Text>
          )}
        </Box>,
      )}
    </Box>
  )
}
