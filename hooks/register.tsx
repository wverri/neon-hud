import { atom, read, update } from 'claude-code'
import type { Register, RenderChildren } from 'claude-code'

import type { HudAgent, HudLive, HudPhase, HudTokens, HudTools, HudVitals } from '../types'

const PANE = 'neon-hud'
const TITLE = 'NEON//HUD'
const WIDTH = 46

const C = {
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

const live = atom({ plugin: 'neon-hud', key: 'live' } as const, {
  phase: 'IDLE',
  detail: '',
  model: '',
  liveTps: 0,
  lastTps: 0,
  peakTps: 0,
  tpsHistory: [],
} as HudLive)

const tokens = atom({ plugin: 'neon-hud', key: 'tokens' } as const, {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  steps: 0,
  turns: 0,
} as HudTokens)

const tools = atom({ plugin: 'neon-hud', key: 'tools' } as const, {
  total: 0,
  counts: {},
  recent: [],
} as HudTools)

const vitals = atom({ plugin: 'neon-hud', key: 'vitals' } as const, {
  now: 0,
  model: '',
  turns: 0,
  startedAt: 0,
  contextTokens: 0,
  contextWindow: 0,
  contextPercent: 0,
  costUsd: 0,
  rateLimits: [],
  agents: [],
} as HudVitals)

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

function heat(pct: number): string {
  if (pct >= 85) return C.red
  if (pct >= 60) return C.amber
  return C.green
}

function spark(values: number[], width: number): [string, string] {
  const tail = values.slice(-width)
  const max = Math.max(1, ...tail)
  const bars = tail.map(v => SPARK[Math.min(7, Math.max(1, Math.round((v / max) * 7)))]).join('')
  return ['▁'.repeat(width - tail.length), bars]
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

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'hud',
      description: 'Abre o painel NEON//HUD com o status da sessao',
    })

    $.clock.every(1500, async () => {
      const [usage, agents, now, model, turns] = await Promise.all([
        $.session.usage(),
        $.agent.list(),
        $.clock.now(),
        $.session.model(),
        $.session.turns(),
      ])
      const roster: HudAgent[] = agents
        .slice(-8)
        .map(a => ({ id: a.id, type: a.type, description: a.description, status: a.status }))
      await update($, vitals, () => ({
        now,
        model,
        turns,
        startedAt: usage.startedAt,
        contextTokens: usage.context.tokens ?? 0,
        contextWindow: usage.context.window,
        contextPercent: usage.context.percent ?? 0,
        costUsd: usage.cost?.usd ?? 0,
        rateLimits: usage.rateLimits.map(r => ({ kind: r.kind, percentUsed: r.percentUsed, resetsAt: r.resetsAt })),
        agents: roster,
      }))
    })

    void $.ui.open({ id: PANE, title: TITLE, columns: WIDTH })

    return next(e)
  })

  on('command.run', { command: 'hud' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE, columns: WIDTH })

    return { text: 'NEON//HUD online.' }
  })

  on('turn.start', async ($, e, next) => {
    await update($, live, (s): HudLive => ({ ...s, phase: 'UPLINK', detail: '', liveTps: 0 }))
    await update($, tokens, t => ({ ...t, turns: t.turns + 1 }))

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const isMain = e.agentId === undefined
    if (isMain) {
      await update($, live, (s): HudLive => ({ ...s, model: e.model, phase: 'UPLINK' }))
    }

    let firstAt = 0
    let chars = 0
    let chunks = 0
    let phase: HudPhase = 'UPLINK'

    for await (const chunk of next(e)) {
      yield chunk

      if (chunk.kind === 'text' || chunk.kind === 'thinking' || chunk.kind === 'input') {
        chars += chunk.kind === 'input' ? chunk.json.length : chunk.text.length
        chunks += 1
        const want: HudPhase = chunk.kind === 'thinking' ? 'THINK' : 'STREAM'
        if (firstAt === 0) firstAt = await $.clock.now()
        if (isMain && (want !== phase || chunks % 24 === 0)) {
          phase = want
          const seconds = ((await $.clock.now()) - firstAt) / 1000
          const tps = seconds > 0.25 ? chars / 4 / seconds : 0
          await update($, live, (s): HudLive => ({ ...s, phase, liveTps: tps }))
        }
      }

      if (chunk.kind === 'stop' && chunk.usage) {
        const usage = chunk.usage
        const seconds = firstAt === 0 ? 0 : ((await $.clock.now()) - firstAt) / 1000
        const tps = seconds > 0.25 ? usage.output_tokens / seconds : 0
        await update($, tokens, t => ({
          ...t,
          input: t.input + usage.input_tokens,
          output: t.output + usage.output_tokens,
          cacheRead: t.cacheRead + usage.cache_read_input_tokens,
          cacheWrite: t.cacheWrite + usage.cache_creation_input_tokens,
          steps: t.steps + 1,
        }))
        if (tps > 0) {
          await update($, live, (s): HudLive => ({
            ...s,
            model: isMain ? usage.model : s.model,
            liveTps: isMain ? tps : s.liveTps,
            lastTps: tps,
            peakTps: Math.max(s.peakTps, tps),
            tpsHistory: [...s.tpsHistory, tps].slice(-60),
          }))
        }
      }
    }
  })

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool).replace(/^mcp__/, '')
    const id = e.tool_use_id
    await update($, tools, t => ({
      total: t.total + 1,
      counts: { ...t.counts, [tool]: (t.counts[tool] ?? 0) + 1 },
      recent: [...t.recent, { id, tool, isDone: false, isError: false }].slice(-6),
    }))
    if (e.agentId === undefined) {
      await update($, live, (s): HudLive => ({ ...s, phase: 'EXEC', detail: tool }))
    }

    const ran = await next(e)
    const isError = 'isError' in ran && ran.isError === true
    await update($, tools, t => ({
      ...t,
      recent: t.recent.map(c => (c.id === id ? { ...c, isDone: true, isError } : c)),
    }))

    return ran
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      await update($, live, (s): HudLive => ({ ...s, phase: 'IDLE', detail: '', liveTps: 0 }))
    }

    return next(e)
  })


  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const [l, t, tl, v] = await Promise.all([read($, live), read($, tokens), read($, tools), read($, vitals)])
    const w = Math.max(28, e.props.bodyColumns)
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
    const avgTps = l.tpsHistory.length ? l.tpsHistory.reduce((a, b) => a + b, 0) / l.tpsHistory.length : 0
    const [sparkPad, sparkBars] = spark(l.tpsHistory, iw)
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
        <Text color={C.amber} wrap="truncate-end">
          {l.phase === 'EXEC' && l.detail ? `› ${l.detail}` : ' '}
        </Text>

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
          <Text color={heat(v.contextPercent)} bold>
            {v.contextPercent}%
          </Text>,
          <Box flexDirection="column">
            <Text>
              <Text color={heat(v.contextPercent)}>{ctxOn}</Text>
              <Text color={C.line}>{ctxOff}</Text>
            </Text>
            <Text color={C.dim}>
              <Text color={C.text}>{fmt(v.contextTokens)}</Text> of {fmt(v.contextWindow)} tokens
            </Text>
          </Box>,
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
          <Text color={C.dim}>this session</Text>,
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
                {tl.recent
                  .slice()
                  .reverse()
                  .map(c => (
                    <Text color={!c.isDone ? C.amber : c.isError ? C.red : C.dim}>
                      {!c.isDone ? '⟳' : c.isError ? '✗' : '✓'}
                      {c.tool.split('__').pop()}{' '}
                    </Text>
                  ))}
              </Text>
            )}
          </Box>,
        )}
      </Box>
    )
  })
}
