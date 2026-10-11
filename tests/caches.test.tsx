import { expect, mock, test } from 'claude-code/testing'

import { remember } from '../hooks/render/render'

const mount = (text: string, isFullscreen = false) => ({
  plugin: 'neon-hud',
  component: 'AssistantMessage' as const,
  props: { text, isFirstOfReply: true },
  viewport: { columns: 120, rows: 40, isFullscreen },
  surface: 'terminal' as const,
})

const drawn = (node: unknown): string =>
  typeof node === 'string' ? node : ((node as { children?: unknown[] }).children ?? []).map(drawn).join('')

test('a cached entry read again outlives newer ones', async () => {
  const cache = new Map<string, string>()
  remember(cache, 'old', () => 'old', 3)
  for (let i = 0; i < 112; i++) {
    remember(cache, `stream ${i}`, () => 'part', 3)
    remember(cache, 'old', () => 'parsed again', 3)
  }
  expect(cache.get('old')).toBe('old')
  expect(cache.size).toBe(3)
})

const call = (id: string) => ({ tool_use_id: id, tool: 'Read', input: { file_path: '/tmp/x' }, isRunning: false, isErrored: false, isInterrupted: false })
