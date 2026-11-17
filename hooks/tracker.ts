import type { EngineInterface, SessionMessage } from 'claude-code'
import type { HudTools } from '../types'

// Sem tool.call: o Code Mode recusa as chamadas internas de um script quando um mod pode
// checar chamadas. As ferramentas sao lidas do fluxo do turn.step (o pedido de cada chamada)
// e do transcript ($.session.messages), que so observam.

export const RECENT_KEEP = 24
const SEEN_KEEP = 4000
const MESSAGES_READ = 60
const PRIME_READ = 400

export type StartedCall = { id: string; tool: string }
export type SettledCall = { id: string; tool: string; isError: boolean; isInner: boolean }
export type CallWindow = { start: number; end?: number }

export const toolKey = (name: string): string => name.replace(/^mcp__/, '')

// Poll so espera o resultado de um script do Code Mode: nao e trabalho, nao entra na contagem.
const UNCOUNTED = new Set(['Poll'])
export const isCounted = (name: string): boolean => !UNCOUNTED.has(name)

/** As chamadas que o modelo pediu entram rodando: contadas, em recent como ⟳. */
export const startCalls = (t: HudTools, calls: readonly StartedCall[]): HudTools => {
  const known = new Set(t.recent.map(c => c.id))
  const fresh = calls.filter(c => !known.has(c.id))
  if (fresh.length === 0) return t
  const counts = { ...t.counts }
  for (const c of fresh) counts[toolKey(c.tool)] = (counts[toolKey(c.tool)] ?? 0) + 1
  return {
    total: t.total + fresh.length,
    counts,
    recent: [...t.recent, ...fresh.map(c => ({ id: c.id, tool: toolKey(c.tool), isDone: false, isError: false }))].slice(-RECENT_KEEP),
  }
}

/**
 * Fecha o que o transcript ja respondeu e as que closed fecha sem erro. Uma chamada que o fluxo nao
 * mostrou (isInner: as de dentro de um script do Code Mode) entra pronta e e contada.
 */
export const settleCalls = (t: HudTools, settled: readonly SettledCall[], closed: ReadonlySet<string>): HudTools => {
  const byId = new Map(settled.map(c => [c.id, c]))
  let changed = false
  const recent = t.recent.map(c => {
    if (c.isDone) return c
    const hit = byId.get(c.id)
    if (!hit && !closed.has(c.id)) return c
    changed = true
    return { ...c, isDone: true, isError: hit?.isError ?? false }
  })
  const inner = settled.filter(c => c.isInner)
  if (inner.length === 0) return changed ? { ...t, recent } : t
  const counts = { ...t.counts }
  for (const c of inner) counts[toolKey(c.tool)] = (counts[toolKey(c.tool)] ?? 0) + 1
  return {
    total: t.total + inner.length,
    counts,
    recent: [...recent, ...inner.map(c => ({ id: c.id, tool: toolKey(c.tool), isDone: true, isError: c.isError }))].slice(-RECENT_KEEP),
  }
}

export type Settlement = {
  settled: SettledCall[]
  inputs: Map<string, { tool: string; input: unknown }>
  /** As que ficaram sem resposta e closeRest fechou. */
  closed: Set<string>
  /** Quando terminou o fluxo do passo que pediu as chamadas: o inicio da janela de cada uma. */
  stepEnd: number
}

type Loop = { pending: Set<string>; stepEnd: number }

/** O que o rastreador guarda entre eventos; vive no modulo, recomeca num reload. */
export type ToolTracker = { loops: Map<string, Loop>; seen: Set<string>; primed: boolean }

export const newToolTracker = (): ToolTracker => ({ loops: new Map(), seen: new Set(), primed: false })

// Um { deny } (um hook acima recusou a leitura) vale como transcript vazio.
async function readRows($: EngineInterface, agentId: string | undefined, last: number): Promise<SessionMessage[]> {
  const res = await $.session.messages(agentId === undefined ? { last } : { agentId, last }).catch(() => [])
  return Array.isArray(res) ? res : []
}

function rememberId(seen: Set<string>, id: string): void {
  seen.add(id)
  if (seen.size > SEEN_KEEP) seen.delete(seen.values().next().value!)
}

function loopOf(tracker: ToolTracker, agentId: string | undefined): Loop {
  const key = agentId ?? ''
  const found = tracker.loops.get(key)
  if (found) return found
  const loop: Loop = { pending: new Set(), stepEnd: 0 }
  tracker.loops.set(key, loop)
  return loop
}

/** O primeiro turno marca o que o transcript ja tinha: uma sessao retomada nao reconta. */
export async function primeTools($: EngineInterface, tracker: ToolTracker): Promise<void> {
  if (tracker.primed) return
  tracker.primed = true
  const rows = await readRows($, undefined, PRIME_READ)
  for (const row of rows) for (const use of row.toolUses ?? []) rememberId(tracker.seen, use.tool_use_id)
}

/** O pedido do modelo, visto no fluxo de um passo; devolve so as chamadas novas. */
export function requestCalls(tracker: ToolTracker, agentId: string | undefined, calls: readonly StartedCall[], at: number): StartedCall[] {
  const loop = loopOf(tracker, agentId)
  const fresh = calls.filter(c => isCounted(c.tool) && !tracker.seen.has(c.id))
  for (const c of fresh) {
    rememberId(tracker.seen, c.id)
    loop.pending.add(c.id)
  }
  loop.stepEnd = at
  return fresh
}

/** Le o transcript do loop e devolve o que fechou desde a ultima leitura. */
export async function settleLoop($: EngineInterface, tracker: ToolTracker, agentId: string | undefined, closeRest: boolean): Promise<Settlement> {
  const loop = loopOf(tracker, agentId)
  const rows = await readRows($, agentId, MESSAGES_READ)
  const settled: SettledCall[] = []
  const inputs = new Map<string, { tool: string; input: unknown }>()
  for (const row of rows) {
    for (const use of row.toolUses ?? []) {
      if (use.text === undefined && use.result === undefined) continue
      if (!isCounted(use.tool)) continue
      const id = use.tool_use_id
      const isPending = loop.pending.has(id)
      if (!isPending && tracker.seen.has(id)) continue
      rememberId(tracker.seen, id)
      loop.pending.delete(id)
      settled.push({ id, tool: use.tool, isError: use.isError === true, isInner: !isPending })
      inputs.set(id, { tool: use.tool, input: use.input })
    }
  }
  const closed = closeRest ? new Set(loop.pending) : new Set<string>()
  if (closeRest) loop.pending.clear()
  return { settled, inputs, closed, stepEnd: loop.stepEnd }
}
