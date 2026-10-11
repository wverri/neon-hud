import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { HudAgent, HudContext, HudLive, HudPhase, HudSaved, HudTokens, HudTools, HudTurn, HudVitals } from '../types'
import { PANE, STORE_KEEP, STORE_PREFIX, TITLE, WIDTH, drawPane, toContext } from './hud'

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

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'hud',
      description: 'Abre o painel NEON//HUD com o status da sessao',
    })

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
}
