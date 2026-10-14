import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelEffort } from 'claude-code'

import type { HudControl } from '../types'

export const EFFORTS: readonly ModelEffort[] = ['low', 'medium', 'high', 'xhigh', 'max']

// O card oferece so as familias; `opus[1m]`, `default` e afins continuam no /model.
export const MODEL_FAMILIES = ['opus', 'sonnet', 'haiku'] as const

export function familyOf(model: string): string | undefined {
  return MODEL_FAMILIES.find(f => model.includes(f))
}

// O /effort responde com texto mesmo quando recusa o ultracode (sem workflows, modelo sem suporte).
const ULTRACODE_REFUSED = /needs|isn't available|not available|invalid|failed|cannot/i

const control = atom({ plugin: 'neon-hud', key: 'control' } as const, {
  models: [],
  model: '',
  effort: '',
  ultracode: false,
  isLocked: false,
} as HudControl)

export function readControl($: EngineInterface): Promise<HudControl> {
  return read($, control)
}

const failure = (err: unknown) => (err instanceof Error ? err.message : String(err))

// A linha Model do /config e a lista que o /model oferece: os apelidos (opus, sonnet[1m]...) mudam a cada versao do CLI.
export async function refreshControl($: EngineInterface): Promise<void> {
  const row = (await $.config.list()).find(r => r.key === 'model' && r.kind === 'choice')
  await update($, control, (s): HudControl => ({
    ...s,
    models: [...(row?.options ?? [])],
    model: typeof row?.value === 'string' ? row.value : '',
    isLocked: row?.isLocked ?? false,
  }))
}

// O effort nao tem linha no /config: o painel mostra o que o ultimo pedido principal levou.
export async function noteEffort($: EngineInterface, effort: string | number | undefined): Promise<void> {
  if (typeof effort !== 'string') return
  const s = await read($, control)
  if (s.effort !== effort) await update($, control, (c): HudControl => ({ ...c, effort }))
}

// Grava como o /config faria; se a linha so muda pelo dialogo, o /model faz a troca.
export async function pickModel($: EngineInterface, value: string): Promise<void> {
  const s = await read($, control)
  if (!s.models.includes(value) || s.isLocked || value === s.model) return
  const set = await $.config.set({ key: 'model', value }).catch(err => ({ deny: failure(err) }))
  if (set.deny !== undefined) {
    const ran = await $.command.run({ command: 'model', args: value }).then(() => null, failure)
    if (ran !== null) {
      $.ui.toast(`Model not changed: ${ran}`)
      return
    }
  }
  await update($, control, (c): HudControl => ({ ...c, model: value }))
  $.ui.toast(`Model → ${value}`)
}

// O /effort espera a sessao ficar ociosa: escolhido no meio de um turno, vale a partir do proximo.
export async function pickEffort($: EngineInterface, value: string): Promise<void> {
  if (!EFFORTS.includes(value as ModelEffort)) return
  const ran = await $.command.run({ command: 'effort', args: value }).then(() => null, failure)
  if (ran !== null) {
    $.ui.toast(`Effort not changed: ${ran}`)
    return
  }
  // `/effort <nivel>` tambem desliga o ultracode.
  await update($, control, (c): HudControl => ({ ...c, effort: value, ultracode: false }))
  $.ui.toast(`Effort → ${value}`)
}

// Vale so para esta sessao, como o `/effort ultracode` digitado.
export async function pickUltracode($: EngineInterface, isOn: boolean): Promise<void> {
  const ran = await $.command.run({ command: 'effort', args: `ultracode ${isOn ? 'on' : 'off'}` }).then(
    r => (r.text !== undefined && ULTRACODE_REFUSED.test(r.text) ? r.text : null),
    failure,
  )
  if (ran !== null) {
    $.ui.toast(`Ultracode not changed: ${ran}`)
    return
  }
  await update($, control, (c): HudControl => ({ ...c, ultracode: isOn }))
  $.ui.toast(`Ultracode ${isOn ? 'on' : 'off'}`)
}
