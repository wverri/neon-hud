export type HudPhase = 'IDLE' | 'UPLINK' | 'THINK' | 'STREAM' | 'EXEC'

export type HudLive = {
  phase: HudPhase
  detail: string
  model: string
  liveTps: number
  lastTps: number
  peakTps: number
  tpsHistory: number[]
}

export type HudTokens = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  steps: number
  turns: number
}

export type HudToolCall = { id: string; tool: string; isDone: boolean; isError: boolean }

export type HudTools = {
  total: number
  counts: Record<string, number>
  recent: HudToolCall[]
}

export type HudAgent = { id: string; type: string; description: string; status: string }

export type HudRateLimit = { kind: string; percentUsed: number; resetsAt?: string }

export type HudVitals = {
  now: number
  model: string
  turns: number
  startedAt: number
  contextTokens: number
  contextWindow: number
  contextPercent: number
  costUsd: number
  rateLimits: HudRateLimit[]
  agents: HudAgent[]
}

export type HudTurn = {
  startedAt: number
  costAtStart: number
  lastMs: number
  lastCostUsd: number
}

export type HudSlice = { name: string; tokens: number; color: string; kind: 'used' | 'free' | 'buffer' }

export type HudContext = {
  slices: HudSlice[]
  total: number
  window: number
  percent: number
  compactsAt?: number
}

export type HudControl = {
  models: string[]
  model: string
  effort: string
  isLocked: boolean
}

export type HudSaved = {
  savedAt: number
  live: HudLive
  tokens: HudTokens
  tools: HudTools
  turn: HudTurn
}

declare module 'claude-code' {
  interface PluginState {
    'neon-hud': {
      live: HudLive
      tokens: HudTokens
      tools: HudTools
      vitals: HudVitals
      turn: HudTurn
      context: HudContext | null
      control: HudControl
      'render-unfolded': string[]
      'render-turnEnds': { durationMs: number; at: number }[]
      'render-drawn': StateFamily<number>
      'render-formulas': Record<string, unknown>
      'render-dir': string
      'paste-ids': number[]
    }
  }
}
