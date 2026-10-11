import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register, RenderElement, RenderSurface } from 'claude-code'

import type { HudAgent, HudContext, HudLive, HudPhase, HudSaved, HudTokens, HudTools, HudTurn, HudVitals } from '../types'
import { PANE, STORE_KEEP, STORE_PREFIX, TITLE, WIDTH, drawPane, toContext } from './hud'
import type { ClipboardBackend } from './render/clipboard'
import { clipboardCommand } from './render/clipboard'
import type { Formula } from './render/latex'
import { pickFormula } from './render/latex'
import { parse } from './render/markdown'
import { boxArt, mermaidText, shortenEdgeLabels, unsupportedKind } from './render/mermaid'
import type { Drawn, Fold } from './render/render'
import { remember, renderBlocks, width } from './render/render'
import { hasRtl } from './render/rtl'
import type { Style } from './render/theme'
import { resolveStyle } from './render/theme'

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

const turn = atom({ plugin: 'neon-hud', key: 'turn' } as const, {
  startedAt: 0,
  costAtStart: 0,
  lastMs: 0,
  lastCostUsd: 0,
} as HudTurn)

const context = atom({ plugin: 'neon-hud', key: 'context' } as const, null as HudContext | null)


async function refreshContext($: EngineInterface) {
  const usage = await $.session.usage({ breakdown: 'summary' })
  const b = usage.context.breakdown
  if (b && b.rawMaxTokens > 0) await update($, context, () => toContext(b))
}

const columnsOf = (viewport?: { columns?: number }) => Math.max(20, (viewport?.columns ?? 100) - 4)

const unfolded = atom({ plugin: 'neon-hud', key: 'render-unfolded' } as const, [] as string[])

type Typeset = Exclude<Formula, { error: true }> & { tex: string }

const locate = async ($: EngineInterface, style: Style) => {
  style.cwd = await $.session.root().catch(() => style.cwd)
  style.home ||= (await $.env.get('HOME').catch(() => undefined)) ?? (await $.env.get('USERPROFILE').catch(() => undefined)) ?? ''
}

const htmlBackend = async ($: EngineInterface): Promise<ClipboardBackend | null> => {
  if (await $.env.get('SSH_CONNECTION') || await $.env.get('SSH_TTY')) return null
  const helper = await $.fs.stat('/usr/bin/osascript').catch(() => null)
  if (helper?.kind === 'file') return 'macos'
  return await $.env.get('WAYLAND_DISPLAY') || await $.env.get('DISPLAY') ? 'linux' : null
}

const copyTable = async ($: EngineInterface, backend: ClipboardBackend, html: string, text: string): Promise<string | null> => {
  const command = clipboardCommand(backend, html, text)
  const result = await $.process.run(command.argv, { stdin: command.stdin, timeoutMs: 5000 }).catch(() => null)
  if (!result) return command.failure
  return result.exitCode === 0 ? null : result.stderr.trim() || command.failure
}

const folder = ($: EngineInterface, el: ReturnType<EngineInterface['ui']['resolve']>, open?: string[]): Fold => (id, hidden, key) => {
  if (!open) return null
  const folded = !open.includes(id)
  return { folded, element: <el.Button key={key} variant="secondary" label={folded ? `+${hidden} more lines` : 'show less'} onPress={() => update($, unfolded, ids => (folded ? [...ids, id].slice(-500) : ids.filter(x => x !== id)))} /> }
}

const drawMarkdown = ($: EngineInterface, el: ReturnType<EngineInterface['ui']['resolve']>, style: Style, blocks: ReturnType<typeof parse>, columns: number, math: Map<number, Typeset> = new Map(), reply?: string, open?: string[]): RenderElement[] => {
  const { Button } = el
  const copy = (text: string | (() => string), key: string, label = '⧉ copy', html?: () => string) => {
    const copied = async (surface: RenderSurface): Promise<string> => {
      const content = typeof text === 'function' ? text() : text
      const backend = style.htmlCopy
      const failure = html && backend ? await copyTable($, backend, html(), content) : undefined
      if (failure === null) return 'Copied formatted table'
      const result = await $.ui.copy({ text: content, surface })
      if (!result.isCopied) return `Copy failed: ${result.reason}`
      return failure ? `Copied as plain text (${failure})` : 'Copied'
    }
    return style.copyButtons && (!html || style.htmlCopy) ? (
      <Button
        key={key}
        variant="primary"
        label={label}
        onPress={async press => $.ui.toast(await copied(press.surface).catch(() => 'Copy failed'))}
      />
    ) : null
  }
  const drawn: Drawn = new Map()
  if (style.mermaid) {
    for (const [i, block] of blocks.entries()) {
      if (block.kind !== 'code' || block.lang.toLowerCase() !== 'mermaid') continue
      const source = block.lines.join('\n')
      let narrowest = Infinity
      for (const max of [Infinity, 24, 12]) {
        const art = mermaidText(max === Infinity ? source : shortenEdgeLabels(source, max), style.mermaidAscii, columns)
        const wide = art === null ? Infinity : Math.max(...art.split('\n').map(width))
        narrowest = Math.min(narrowest, wide)
        if (art === null || wide > columns - 2) continue
        drawn.set(i, { element: boxArt(el, style, art, `b${i}`), art })
        break
      }
      if (!drawn.has(i) && !block.isOpen) {
        const kind = unsupportedKind(source)
        drawn.set(i, { note: kind ? `${kind} diagrams draw as source for now` : narrowest === Infinity ? 'diagram failed to render' : `diagram is ${narrowest} cols, terminal is ${columns}` })
      }
    }
  }
  const Image = 'Image' in el ? el.Image : null
  if (Image) {
    for (const [i, formula] of math) {
      const picked = pickFormula(formula, columns)
      if (picked) drawn.set(i, { element: <Image key={`b${i}`} source={{ png: picked.picture.png }} columns={picked.fit.columns} rows={picked.fit.rows} alt={formula.tex} /> })
    }
  }
  const elements = renderBlocks(el, style, blocks, columns, drawn, copy, folder($, el, open))
  const button = reply === undefined ? null : copy(reply, 'reply', '⧉ copy reply')
  return button ? [...elements, <el.Box key="reply" alignSelf="flex-end">{button}</el.Box>] : elements
}

type Probes = { htmlCopy?: Promise<ClipboardBackend | null> }

const probe = async ($: EngineInterface, style: Style, probes: Probes) => {
  probes.htmlCopy ??= htmlBackend($)
  style.htmlCopy = await probes.htmlCopy
}

// Preenchida na Task 7; por ora o neon-hud sempre desenha.
const prismantisActive = (_$: EngineInterface): boolean => false

export const register: Register = (on, options: PluginOptions) => {
  const rendering = options.render !== false
  const style = resolveStyle(options)
  const parsed = new Map<string, ReturnType<typeof parse>>()
  const parseCached = (text: string) => remember(parsed, text, () => parse(text, { numbers: style.highlightNumbers, paths: style.highlightPaths }))
  const forSurface = (base: Style, surface: RenderSurface): Style => (surface === 'terminal' || !base.htmlCopy ? base : { ...base, htmlCopy: null })
  const probes: Probes = {}

  on('session.start', async ($, e, next) => {
    await $.command
      .register({
        name: 'hud',
        description: 'Abre o painel NEON//HUD com o status da sessao',
      })
      .catch(() => undefined)

    // Antes do resto do painel: se algo la embaixo falhar, a copia em HTML ja foi detectada.
    // E o /neon-hud recusado nao derruba o painel, por isso o catch.
    if (rendering) {
      await probe($, style, probes)
      await $.command
        .register({ name: 'neon-hud', description: 'Copia a ultima resposta ou o ultimo bloco de codigo', argumentHint: '[copy [code]]' })
        .catch(() => undefined)
    }

    const restored = await $.store.get(`${STORE_PREFIX}${await $.session.id()}`)
    const held = await read($, tokens)
    if (restored && held.steps === 0) {
      const saved = restored as HudSaved
      await update($, live, (): HudLive => ({ ...saved.live, phase: 'IDLE', detail: '', liveTps: 0 }))
      await update($, tokens, () => saved.tokens)
      await update($, tools, () => ({ ...saved.tools, recent: saved.tools.recent.filter(c => c.isDone) }))
      await update($, turn, () => ({ ...saved.turn, startedAt: 0 }))
    }

    let lastSaved = ''
    $.clock.every(1500, async () => {
      const [id, l, t, tl, tn] = await Promise.all([$.session.id(), read($, live), read($, tokens), read($, tools), read($, turn)])
      const body = JSON.stringify([l.tpsHistory, t, tl, tn.lastMs])
      if (t.steps > 0 && body !== lastSaved) {
        lastSaved = body
        const saved: HudSaved = { savedAt: await $.clock.now(), live: l, tokens: t, tools: tl, turn: tn }
        await $.store.set(`${STORE_PREFIX}${id}`, saved)
        const keys = (await $.store.keys()).filter(k => k.startsWith(STORE_PREFIX))
        if (keys.length > STORE_KEEP) {
          const aged = await Promise.all(keys.map(async k => ({ k, at: ((await $.store.get(k)) as HudSaved | undefined)?.savedAt ?? 0 })))
          aged.sort((a, b) => a.at - b.at)
          await Promise.all(aged.slice(0, keys.length - STORE_KEEP).map(a => $.store.delete(a.k)))
        }
      }
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
    void refreshContext($).catch(() => {})

    return next(e)
  })

  // Depois de cada turno principal o engine mede a sessao: e a hora de recontar o contexto.
  on('session.measure', async ($, e, next) => {
    const r = await next(e)
    await refreshContext($).catch(() => {})
    return r
  })

  // Um /compact esvazia a janela sem fechar turno.
  on('session.compact', async ($, e, next) => {
    const r = await next(e)
    if (!e.agentId && 'messages' in r) void refreshContext($).catch(() => {})
    return r
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await update($, live, (s): HudLive => ({ ...s, phase: 'IDLE', detail: '', liveTps: 0, lastTps: 0, peakTps: 0, tpsHistory: [] }))
      await update($, tokens, () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, steps: 0, turns: 0 }))
      await update($, tools, () => ({ total: 0, counts: {}, recent: [] }))
      await update($, turn, () => ({ startedAt: 0, costAtStart: 0, lastMs: 0, lastCostUsd: 0 }))
      await update($, context, () => null)
    }

    return next(e)
  })

  on('command.run', { command: 'hud' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE, columns: WIDTH })

    return { text: 'NEON//HUD online.' }
  })

  on('turn.start', async ($, e, next) => {
    const [now, usage] = await Promise.all([$.clock.now(), $.session.usage()])
    await update($, turn, s => ({ ...s, startedAt: now, costAtStart: usage.cost?.usd ?? 0 }))
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
      recent: [...t.recent, { id, tool, isDone: false, isError: false }].slice(-24),
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
      const usage = await $.session.usage()
      await update($, turn, s => ({
        startedAt: 0,
        costAtStart: s.costAtStart,
        lastMs: e.durationMs,
        lastCostUsd: Math.max(0, (usage.cost?.usd ?? 0) - s.costAtStart),
      }))
      await update($, live, (s): HudLive => ({ ...s, phase: 'IDLE', detail: '', liveTps: 0 }))
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const [l, t, tl, v, tn, cx] = await Promise.all([
      read($, live),
      read($, tokens),
      read($, tools),
      read($, vitals),
      read($, turn),
      read($, context),
    ])
    return drawPane($.ui.resolve(e), { l, t, tl, v, tn, cx }, e.props.bodyColumns)
  })

  if (!rendering) return

  on('command.run', { command: 'neon-hud' }, async ($, e) => {
    const [sub, arg] = e.args.trim().split(/\s+/)
    if (sub !== 'copy') return { text: 'Uso: /neon-hud copy [code]' }
    const reply = (await $.session.messages()).findLast(m => m.role === 'assistant' && m.text.trim())
    if (!reply) return { text: 'Nothing to copy yet.' }
    const code = arg === 'code' ? parseCached(reply.text).flatMap(b => (b.kind === 'list' ? b.items.flatMap(it => it.blocks ?? []) : [b])).findLast(b => b.kind === 'code') : undefined
    if (arg === 'code' && code?.kind !== 'code') return { text: 'The last reply has no code block.' }
    const result = await $.ui.copy({ text: code?.kind === 'code' ? code.lines.join('\n') : reply.text })
    return { text: result.isCopied ? `Copied the last ${code ? 'code block' : 'reply'}.` : `Copy failed: ${result.reason}` }
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (prismantisActive($)) return next(e)
    try {
      const blocks = parseCached(e.props.text)
      if (blocks.length === 0) return next(e)
      const el = $.ui.resolve(e)
      const { Box, Text } = el
      const narration = style.toolStyle === 'tree-bold' && blocks.length === 1 && blocks[0]!.kind === 'paragraph'
      const surfaceStyle = forSurface(style, e.surface)
      const open = await read($, unfolded)
      return (
        <Box flexDirection="row">
          <Box width={2} flexShrink={0}>
            <Text color={style.theme.accent}>{e.props.isFirstOfReply ? '●' : ' '}</Text>
          </Box>
          <Box flexDirection="column" rowGap={1} flexGrow={1}>
            {drawMarkdown($, el, narration ? { ...surfaceStyle, narration } : surfaceStyle, blocks, columnsOf(e.viewport), new Map(), blocks.length > 1 || hasRtl(e.props.text) ? e.props.text : undefined, open)}
          </Box>
        </Box>
      )
    } catch {
      return next(e)
    }
  })
}
