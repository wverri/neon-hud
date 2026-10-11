# Prévia de imagem colada — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar, na faixa acima do prompt, uma miniatura de cada imagem colada no rascunho antes do envio.

**Architecture:**
- O Claude Code grava cada imagem colada em `<base>/claude-<uid>/<projeto>/<sessão>/images/<N>.png`. A faixa `AbovePrompt` lê o rascunho com `$.prompt.read()`, acha os `[Image #N]`, localiza essa pasta e desenha cada arquivo com o elemento `Image` do terminal.
- Um hook `prompt.edit` só grava os números num atom quando eles mudam, para a faixa redesenhar na hora.
- A lógica pura fica em `hooks/paste.tsx`, e os hooks ficam em `hooks/register.tsx`.

**Tech Stack:** TypeScript/TSX da API de mods do Claude Code (`claude-code`, `claude-code/testing`).

**Spec:** `docs/superpowers/specs/2026-10-11-paste-preview-design.md`

## Global Constraints

- `$` não atravessa import: toda função que recebe `$` fica em `hooks/register.tsx`. `hooks/paste.tsx` é puro.
- O loader de mods recusa ler `$.noun` como valor e recusa guardar `$` numa variável. Pode passar `$` como argumento a uma função de nível de módulo, e cada chamada se escreve `$.noun.event(...)`.
- `hooks/hooks.json` continua `{ "modules": ["./register.tsx"] }`.
- Sem rede, sem programas externos, nada enviado ao modelo. A prévia só faz `fs.list`, `fs.exists` e `fs.stat` e lê o rascunho.
- Os handlers de `session.start` e de `turn.complete` não mudam.
- Opção nova `pastePreview` (boolean, padrão `true`), independente de `render`.
- Cores tiradas de `C` em `hooks/hud.tsx`: rótulo `PASTE` em `C.cyan` (`#00e5ff`) e negrito; contagem e "prévia indisponível" em `C.dim` (`#66708f`); legenda com arquivo em `C.text` (`#c9d4f2`).
- Textos visíveis exatos:
  - `PASTE`;
  - `1 imagem` / `N imagens`;
  - `[Image #N] · <tamanho>`;
  - `[Image #N] · prévia indisponível`.
- Miniatura:
  - largura `min(24, floor((bodyColumns − 2·(n−1)) / n))`;
  - altura `min(8, maxRows − 2)`;
  - sem `Image` quando a largura der menos de 8 ou a altura menos de 3.
- Bases da pasta, em ordem: `$CLAUDE_CODE_TMPDIR` (se definido), `/private/tmp`, `/tmp`.
- Gates antes de cada commit: `claude plugin validate . && claude plugin test . && npx -y -p typescript@5.6.3 tsc -p .`.
- Comentários em português sem acento, só onde explicam um porquê.
- Commits terminam com `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. **Colar não dispara `prompt.edit`:** a miniatura aparece na tecla seguinte. A faixa sempre lê o rascunho atual, então nunca mostra imagem errada. Só se confere ao vivo, na Task 3.
2. **Pasta de imagens ainda não existe ou não é achada:** a faixa mostra "prévia indisponível" sem guardar cache negativo, e acha a pasta quando ela aparecer. Teste na Task 2.
3. **Muitas imagens em terminal estreito:** só legendas, nenhum `Image` estoura a largura. Teste na Task 2.
4. **`[Image #N]` digitado à mão, sem arquivo:** "prévia indisponível", sem erro. Teste na Task 2.
5. **Faixa do engine ocupada por outra coisa:** com `hasSurvey`, a prévia cede. Sem pesquisa, o que o engine desenharia continua embaixo da prévia. Teste na Task 2.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
| --- | --- |
| `hooks/paste.tsx` (criar) | puro: `extractImageIds`, `sameIds`, `formatBytes`, `thumbSize`, `tmpBases`, `type PastedImage`, `drawPasteBand` |
| `hooks/register.tsx` (modificar) | atom `pasteIds`, `findImagesDir($)`, `pastedImage($, dir, id)`, hooks `prompt.edit` e `ui.render` `AbovePrompt` |
| `types/index.d.ts` (modificar) | chave `'paste-ids': number[]` no estado do mod |
| `.claude-plugin/plugin.json` (modificar) | opção `pastePreview`, versão 0.7.0 |
| `.claude-plugin/marketplace.json` (modificar) | versão 0.7.0 |
| `tests/paste.test.tsx` (criar) | testes da parte pura e da faixa |
| `README.md`, `README.en.md` (modificar) | seção da prévia, opção nova, limitação |

---

### Task 1: Lógica pura e desenho da faixa (`hooks/paste.tsx`)

**Files:**
- Create: `hooks/paste.tsx`
- Test: `tests/paste.test.tsx`

**Interfaces:**
- Produces (todos exportados de `hooks/paste.tsx`):
  - `extractImageIds(text: string): number[]`: únicos, em ordem crescente;
  - `sameIds(a: readonly number[], b: readonly number[]): boolean`;
  - `formatBytes(n: number): string`;
  - `thumbSize(bodyColumns: number, maxRows: number, count: number): { columns: number; rows: number } | null`;
  - `tmpBases(custom?: string): string[]`;
  - `type PastedImage = { id: number; file?: string; bytes?: number }`;
  - `caption(image: PastedImage): string`;
  - `drawPasteBand(el: ElementTable<'terminal'>, images: PastedImage[], bodyColumns: number, maxRows: number): RenderElement`.

- [ ] **Step 1: Escrever os testes da parte pura (falham)**

Crie `tests/paste.test.tsx`:

```tsx
import { expect, test } from 'claude-code/testing'

import { caption, extractImageIds, formatBytes, sameIds, thumbSize, tmpBases } from '../hooks/paste'

test('extractImageIds le os numeros unicos e em ordem', async () => {
  expect(extractImageIds('[Image #2] veja [Image #1] e [Image #2]')).toEqual([1, 2])
  expect(extractImageIds('sem imagem nenhuma')).toEqual([])
  expect(extractImageIds('[Image #10][Image #3]')).toEqual([3, 10])
})

test('sameIds compara listas pela ordem e pelo conteudo', async () => {
  expect(sameIds([1, 2], [1, 2])).toBe(true)
  expect(sameIds([1, 2], [1])).toBe(false)
  expect(sameIds([], [])).toBe(true)
})

test('formatBytes escreve B, KB e MB', async () => {
  expect(formatBytes(512)).toBe('512 B')
  expect(formatBytes(2048)).toBe('2 KB')
  expect(formatBytes(1_500_000)).toBe('1.4 MB')
})

test('thumbSize respeita os limites e desiste quando nao cabe', async () => {
  expect(thumbSize(100, 14, 1)).toEqual({ columns: 24, rows: 8 })
  expect(thumbSize(50, 14, 2)).toEqual({ columns: 24, rows: 8 })
  expect(thumbSize(40, 6, 2)).toEqual({ columns: 19, rows: 4 })
  expect(thumbSize(40, 14, 5)).toBeNull()
  expect(thumbSize(100, 4, 1)).toBeNull()
})

test('tmpBases poe a pasta do usuario primeiro e tira repeticoes', async () => {
  expect(tmpBases()).toEqual(['/private/tmp', '/tmp'])
  expect(tmpBases('/var/x/')).toEqual(['/var/x', '/private/tmp', '/tmp'])
  expect(tmpBases('/tmp')).toEqual(['/tmp', '/private/tmp'])
})

test('caption mostra o tamanho ou avisa que a previa nao existe', async () => {
  expect(caption({ id: 1, file: '/x/1.png', bytes: 1_500_000 })).toBe('[Image #1] · 1.4 MB')
  expect(caption({ id: 3 })).toBe('[Image #3] · prévia indisponível')
})
```

Conta para conferir `thumbSize(40, 14, 5)`: `floor((40 − 8) / 5) = 6`, e 6 < 8 dá `null`. Para `thumbSize(40, 6, 2)`: `floor((40 − 2) / 2) = 19` e `min(8, 6 − 2) = 4`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `claude plugin test .`
Expected: FAIL em `tests/paste.test.tsx`, porque `../hooks/paste` não existe. Os 243 testes anteriores continuam verdes.

- [ ] **Step 3: Implementar `hooks/paste.tsx`**

```tsx
import type { ElementTable, RenderElement } from 'claude-code'

import { C } from './hud'

export type PastedImage = { id: number; file?: string; bytes?: number }

const IMAGE_REF = /\[Image #(\d+)\]/g

export const extractImageIds = (text: string): number[] =>
  [...new Set([...text.matchAll(IMAGE_REF)].map(m => Number(m[1])))].sort((a, b) => a - b)

export const sameIds = (a: readonly number[], b: readonly number[]): boolean =>
  a.length === b.length && a.every((id, i) => id === b[i])

export const formatBytes = (n: number): string =>
  n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`

export const thumbSize = (bodyColumns: number, maxRows: number, count: number): { columns: number; rows: number } | null => {
  const columns = Math.min(24, Math.floor((bodyColumns - 2 * (count - 1)) / count))
  // Uma linha para o rotulo PASTE e uma para a legenda.
  const rows = Math.min(8, maxRows - 2)
  return columns < 8 || rows < 3 ? null : { columns, rows }
}

export const tmpBases = (custom?: string): string[] =>
  [...new Set([custom, '/private/tmp', '/tmp'].filter((b): b is string => !!b).map(b => b.replace(/\/+$/, '') || '/'))]

export const caption = (image: PastedImage): string =>
  image.file === undefined ? `[Image #${image.id}] · prévia indisponível` : `[Image #${image.id}] · ${formatBytes(image.bytes ?? 0)}`

export function drawPasteBand({ Box, Text, Image }: ElementTable<'terminal'>, images: PastedImage[], bodyColumns: number, maxRows: number): RenderElement {
  const size = thumbSize(bodyColumns, maxRows, images.length)
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between" width={bodyColumns}>
        <Text color={C.cyan} bold>
          PASTE
        </Text>
        <Text color={C.dim}>{images.length === 1 ? '1 imagem' : `${images.length} imagens`}</Text>
      </Box>
      <Box flexDirection="row" columnGap={2}>
        {images.map(image => (
          <Box flexDirection="column">
            {size && image.file !== undefined ? <Image source={{ file: image.file, format: 'png' }} columns={size.columns} rows={size.rows} alt={caption(image)} /> : null}
            <Text color={image.file === undefined ? C.dim : C.text}>{caption(image)}</Text>
          </Box>
        ))}
      </Box>
    </Box>
  )
}
```

Se o `tsc` reclamar do JSX (por exemplo, `null` como filho), siga a forma que `hooks/hud.tsx` usa para filhos opcionais. Não mude o comportamento.

- [ ] **Step 4: Rodar os testes**

Run: `claude plugin test .`
Expected: os 6 testes novos passam, os anteriores continuam verdes.

- [ ] **Step 5: Gates e commit**

Run: `claude plugin validate . && claude plugin test . && npx -y -p typescript@5.6.3 tsc -p .`

```bash
git add hooks/paste.tsx tests/paste.test.tsx
git commit -m "Previa de imagem colada: logica pura e desenho da faixa

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Hooks da prévia no `register.tsx` e opção `pastePreview`

**Files:**
- Modify: `hooks/register.tsx`, `types/index.d.ts`, `.claude-plugin/plugin.json`
- Test: `tests/paste.test.tsx`

**Interfaces:**
- Consumes (Task 1): `extractImageIds`, `sameIds`, `tmpBases`, `type PastedImage`, `drawPasteBand` de `./paste`.
- Produces:
  - em `register.tsx`, o atom `pasteIds` (`{ plugin: 'neon-hud', key: 'paste-ids' }`, `number[]`);
  - `findImagesDir($: EngineInterface): Promise<string | undefined>`;
  - `pastedImage($: EngineInterface, dir: string | undefined, id: number): Promise<PastedImage>`.

- [ ] **Step 1: Escrever os testes da faixa (falham)**

Acrescente em `tests/paste.test.tsx`, juntando os imports com os do topo:

```tsx
import type { On } from 'claude-code'
import { mock } from 'claude-code/testing'

const DIR = '/private/tmp/claude-501/-Users-x-proj/sid/images'
const entry = (name: string) => ({ name, kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false })
const LISTING: Record<string, ReturnType<typeof entry>[]> = {
  '/private/tmp': [entry('claude-501'), entry('outra-coisa')],
  '/private/tmp/claude-501': [entry('-Users-x-proj')],
}

const band = (props: Partial<{ isWorking: boolean; hasSurvey: boolean; bodyColumns: number; maxRows: number }> = {}, surface: 'terminal' | 'desktop' = 'terminal') => ({
  plugin: 'neon-hud',
  surface,
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: false, maxRows: 14, bodyColumns: 100, scroll: { offset: 0, bodyRows: 14 }, view: {}, ...props },
})

// draft e o rascunho; files diz o tamanho de cada arquivo em DIR; hasDir controla se a pasta ja existe.
const pasted = (on: On, draft: string, files: Record<string, number> = { '1.png': 1_500_000 }, state = { hasDir: true }) => {
  on('session.id', () => ({ value: 'sid' }))
  mock.env(on, {})
  on('prompt.read', () => ({ value: { text: draft, cursor: draft.length } }))
  on('fs.list', (_, e) => ({ value: state.hasDir ? (LISTING[e.path] ?? []) : [] }))
  on('fs.exists', (_, e) => ({ value: state.hasDir && e.path === DIR }))
  on('fs.stat', (_, e) => {
    const name = e.path.slice(DIR.length + 1)
    const size = e.path.startsWith(`${DIR}/`) ? files[name] : undefined
    return size === undefined ? { deny: 'ENOENT' } : { value: { kind: 'file' as const, size, mtimeMs: 0, isLink: false } }
  })
  return state
}

const countEngineBand = (on: On) => {
  const hits = { n: 0 }
  on('ui.render', { component: 'AbovePrompt' }, async ($, e) => {
    hits.n++
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  return hits
}

test('uma imagem colada aparece como miniatura acima do prompt', async ($, on) => {
  pasted(on, 'olha isso [Image #1]')
  const ui = await $.ui.mount(band() as never)
  const image = await ui.find({ type: 'Image' })
  expect(image?.props.source).toEqual({ file: `${DIR}/1.png`, format: 'png' })
  expect(image?.props.columns).toBe(24)
  expect(image?.props.rows).toBe(8)
  expect((await ui.find({ type: 'Text', text: 'PASTE' }))?.props.color).toBe('#00e5ff')
  expect(await ui.find({ type: 'Text', text: '[Image #1] · 1.4 MB' })).toBeDefined()
  await ui.unmount()
})

test('sem imagem no rascunho a faixa fica com o engine', async ($, on) => {
  const engine = countEngineBand(on)
  pasted(on, 'so texto')
  const ui = await $.ui.mount(band() as never)
  expect(engine.n).toBe(1)
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  await ui.unmount()
})

test('a faixa do engine continua embaixo da previa', async ($, on) => {
  const engine = countEngineBand(on)
  pasted(on, '[Image #1]')
  const ui = await $.ui.mount(band() as never)
  expect(engine.n).toBe(1)
  expect(await ui.find({ type: 'Text', text: 'engine' })).toBeDefined()
  expect(await ui.find({ type: 'Image' })).toBeDefined()
  await ui.unmount()
})

test('um numero sem arquivo mostra previa indisponivel', async ($, on) => {
  pasted(on, '[Image #3]', {})
  const ui = await $.ui.mount(band() as never)
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: '[Image #3] · prévia indisponível' }))?.props.color).toBe('#66708f')
  await ui.unmount()
})

test('a pasta que ainda nao existe e procurada de novo depois', async ($, on) => {
  const state = pasted(on, '[Image #1]', { '1.png': 2048 }, { hasDir: false })
  const first = await $.ui.mount(band() as never)
  expect(await first.find({ type: 'Text', text: '[Image #1] · prévia indisponível' })).toBeDefined()
  await first.unmount()
  state.hasDir = true
  const second = await $.ui.mount(band() as never)
  expect(await second.find({ type: 'Text', text: '[Image #1] · 2 KB' })).toBeDefined()
  await second.unmount()
})

test('muitas imagens em pouca largura viram so legendas', async ($, on) => {
  pasted(on, '[Image #1][Image #2][Image #3][Image #4][Image #5]', { '1.png': 1, '2.png': 1, '3.png': 1, '4.png': 1, '5.png': 1 })
  const ui = await $.ui.mount(band({ bodyColumns: 40 }) as never)
  expect(await ui.findAll({ type: 'Image' })).toEqual([])
  expect(await ui.find({ type: 'Text', text: '5 imagens' })).toBeDefined()
  await ui.unmount()
})

test('com turno rodando ou pesquisa na faixa a previa cede', async ($, on) => {
  const engine = countEngineBand(on)
  pasted(on, '[Image #1]')
  for (const props of [{ isWorking: true }, { hasSurvey: true }]) {
    const ui = await $.ui.mount(band(props) as never)
    expect(await ui.find({ type: 'Image' })).toBeUndefined()
    await ui.unmount()
  }
  expect(engine.n).toBe(2)
})

test('fora do terminal a previa nao desenha', async ($, on) => {
  const engine = countEngineBand(on)
  pasted(on, '[Image #1]')
  const ui = await $.ui.mount(band({}, 'desktop') as never)
  expect(engine.n).toBe(1)
  await ui.unmount()
})

test('pastePreview false deixa a faixa com o engine', { options: { pastePreview: false } }, async ($, on) => {
  const engine = countEngineBand(on)
  pasted(on, '[Image #1]')
  const ui = await $.ui.mount(band() as never)
  expect(engine.n).toBe(1)
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  await ui.unmount()
})

test('a previa funciona com render false', { options: { render: false } }, async ($, on) => {
  pasted(on, '[Image #1]')
  const ui = await $.ui.mount(band() as never)
  expect(await ui.find({ type: 'Image' })).toBeDefined()
  await ui.unmount()
})
```

Notas para o implementador:
- **Formato dos mocks:** os mocks de `session.id`, `prompt.read`, `fs.*` e `env` seguem o formato de `tests/neon.test.tsx` e `tests/clipboard-env.ts`: `{ value }` para responder e `{ deny }` para rejeitar.
- **Testes que não compilam:**
  - Se `findAll` não existir com esse nome, use o que `tests/neon.test.tsx` usa (`ui.findAll`).
  - Se a forma `{ options }` do teste for diferente, siga `tests/neon.test.tsx`.
- **Cache de pasta entre testes:** o cache de `findImagesDir` é por id de sessão no nível do módulo, e todos os testes usam `'sid'`. Por isso o teste da pasta que nasce depois exige que o cache só guarde acertos. Se um teste anterior deixar `sid` em cache e mascarar esse teste, a correção é no código: guardar só acertos e conferir com `fs.exists` que a pasta em cache ainda existe. O teste não muda.
- **`prompt.edit`:** o kit de testes não dispara `prompt.edit`, porque `$.prompt` não tem `edit`. O hook de edição fica coberto por `extractImageIds`/`sameIds` da Task 1 e pela verificação ao vivo da Task 3.

- [ ] **Step 2: Rodar e ver falhar**

Run: `claude plugin test .`
Expected: FAIL nos testes da faixa, porque nada desenha `AbovePrompt`. Os da Task 1 e os anteriores continuam verdes.

- [ ] **Step 3: Declarar o estado e a opção**

Em `types/index.d.ts`, dentro de `'neon-hud': { ... }`, depois de `'render-dir': string`:

```ts
      'paste-ids': number[]
```

Em `.claude-plugin/plugin.json`, dentro de `"userConfig"`, depois de `"highlightPaths"`:

```json
    "pastePreview": {
      "type": "boolean",
      "title": "Paste preview",
      "description": "Mostra acima do prompt uma miniatura de cada imagem colada, antes do envio. A imagem aparece no kitty e no Ghostty; nos outros terminais, so o nome e o tamanho.",
      "default": true
    }
```

Run: `claude plugin validate .`
Expected: válido.

- [ ] **Step 4: Implementar no `register.tsx`**

Imports: acrescente `ElementTable` ao `import type { ... } from 'claude-code'` existente e a linha:

```tsx
import type { PastedImage } from './paste'
import { drawPasteBand, extractImageIds, sameIds, tmpBases } from './paste'
```

No nível do módulo, junto dos outros atoms (depois de `latexDir`):

```tsx
const pasteIds = atom({ plugin: 'neon-hud', key: 'paste-ids' } as const, [] as number[])

// O Claude Code grava cada imagem colada em <base>/claude-<uid>/<projeto>/<sessao>/images/<N>.png.
// O caminho nao faz parte da API de mods: se mudar, a previa mostra so "previa indisponivel".
const imagesDirs = new Map<string, string>()

const findImagesDir = async ($: EngineInterface): Promise<string | undefined> => {
  const sid = await $.session.id()
  const known = imagesDirs.get(sid)
  if (known !== undefined && (await $.fs.exists(known).catch(() => false))) return known
  const custom = await $.env.get('CLAUDE_CODE_TMPDIR').catch(() => undefined)
  for (const base of tmpBases(custom ?? undefined)) {
    for (const root of await $.fs.list(base).catch(() => [])) {
      if (!/^claude-\d+$/.test(root.name)) continue
      for (const project of await $.fs.list(`${base}/${root.name}`).catch(() => [])) {
        if (project.kind === 'file') continue
        const dir = `${base}/${root.name}/${project.name}/${sid}/images`
        if (await $.fs.exists(dir).catch(() => false)) {
          imagesDirs.set(sid, dir)
          return dir
        }
      }
    }
  }
  // Sem cache negativo: a pasta so nasce na primeira colagem da sessao.
  return undefined
}

const pastedImage = async ($: EngineInterface, dir: string | undefined, id: number): Promise<PastedImage> => {
  if (dir === undefined) return { id }
  const file = `${dir}/${id}.png`
  const stat = await $.fs.stat(file).catch(() => undefined)
  return stat?.kind === 'file' ? { id, file, bytes: stat.size } : { id }
}
```

Dentro de `register`, depois do hook do Pane (`on('ui.render', { component: 'Pane', requestId: PANE }, ...)`) e **antes** de `if (!rendering) return`, porque a prévia não depende de `render`:

```tsx
  if (options.pastePreview !== false) {
    on('prompt.edit', async ($, e, next) => {
      const result = await next(e)
      try {
        const ids = extractImageIds(result.text)
        if (!sameIds(await read($, pasteIds), ids)) await update($, pasteIds, () => ids)
      } catch {
        // A previa nunca pode atrapalhar a digitacao.
      }
      return result
    })

    on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
      if (e.surface !== 'terminal' || e.props.isWorking || e.props.hasSurvey) return next(e)
      try {
        // Ler o atom faz a faixa redesenhar quando o prompt.edit muda os numeros.
        await read($, pasteIds)
        const ids = extractImageIds((await $.prompt.read()).text)
        if (ids.length === 0) return next(e)
        const dir = await findImagesDir($)
        const images = await Promise.all(ids.map(id => pastedImage($, dir, id)))
        const el = $.ui.resolve(e) as ElementTable<'terminal'>
        const { Box } = el
        const below = await next(e)
        return (
          <Box flexDirection="column">
            {drawPasteBand(el, images, e.props.bodyColumns, e.props.maxRows)}
            {below}
          </Box>
        )
      } catch {
        return next(e)
      }
    })
  }
```

Notas para o implementador:
- **`custom ?? undefined`:** existe porque `$.env.get` pode resolver `undefined`. Se o tipo for `string | undefined`, simplifique para `custom`.
- **Tipo de `next(e)`:** se `next(e)` em `AbovePrompt` resolver para um tipo que não cabe como filho de `Box` (por exemplo `RenderElement | undefined`), ajuste com o mínimo necessário, como `below ?? null`, seguindo o que o `tsc` aceitar.
- **Erros do loader:** se o loader recusar alguma forma (`HooksError ... $ is used as a value`), siga o padrão de `prismantisActive` neste arquivo: `$` só como argumento de função de nível de módulo e chamadas `$.noun.event(...)` inline.

- [ ] **Step 5: Rodar os testes**

Run: `claude plugin test .`
Expected: tudo verde. Os 243 anteriores somados aos 6 da Task 1 e aos 10 desta task dão 259.

- [ ] **Step 6: Gates e commit**

Run: `claude plugin validate . && claude plugin test . && npx -y -p typescript@5.6.3 tsc -p .`

```bash
git add hooks/register.tsx types/index.d.ts .claude-plugin/plugin.json tests/paste.test.tsx
git commit -m "Previa de imagem colada acima do prompt (pastePreview)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Documentação, versão 0.7.0 e verificação ao vivo

**Files:**
- Modify: `README.md`, `README.en.md`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`

- [ ] **Step 1: Versão**

Nos dois manifestos, `"version": "0.7.0"`. Acrescente `"paste"` e `"images"` em `keywords` do `plugin.json`.

- [ ] **Step 2: README em português**

Em `README.md`, depois da seção `## Respostas renderizadas` e das subseções dela, antes de `## Comandos`, acrescente:

```markdown
## Prévia de imagem colada

Quando você cola uma imagem no prompt, o rascunho mostra só `[Image #1]`. O neon-hud desenha, na faixa acima do prompt, uma miniatura de cada imagem colada, com o tamanho do arquivo, para você conferir se é a imagem certa antes de enviar. Apagar o `[Image #N]` do rascunho tira a miniatura, e enviar o prompt limpa a faixa.

- A miniatura aparece no kitty e no Ghostty. Nos outros terminais aparece só `[Image #N] · 1.4 MB`.
- Com muitas imagens ou pouca largura, ficam só as legendas.
- `pastePreview: false` desliga a prévia. Ela não depende de `render`.
- O neon-hud lê a imagem do arquivo que o Claude Code grava ao colar (`/tmp/claude-<uid>/…/images/N.png`). Esse caminho não faz parte da API de mods: se uma versão nova do Claude Code mudar o caminho, a prévia passa a mostrar `prévia indisponível`.
```

Na tabela de opções de `### Configuração`, acrescente a linha:

```markdown
| `pastePreview` | `true`, `false` | `true` | Miniatura de cada imagem colada acima do prompt, antes do envio. |
```

Em `## Observações`, troque a linha dos programas externos por:

```markdown
- Programas externos: `osascript` (macOS) ou `copyq` (Linux) só ao clicar em `⧉ html`, e `ratex-render` com `latex` ligado. Sem rede. A prévia de imagem só lista pastas e lê o tamanho dos arquivos de imagem colados; quem lê a imagem é o terminal.
```

Na árvore de `## Desenvolvimento`, depois de `hooks/hud.tsx`, acrescente:

```
hooks/paste.tsx                   prévia de imagem colada (puro, sem $)
```

- [ ] **Step 3: README em inglês**

Em `README.en.md`, as mesmas mudanças, no mesmo lugar (depois de `## Rendered replies`, antes de `## Commands`):

```markdown
## Pasted image preview

When you paste an image into the prompt, the draft only shows `[Image #1]`. neon-hud draws a thumbnail of each pasted image, with its file size, in the band above the prompt, so you can check it is the right image before sending. Deleting `[Image #N]` from the draft removes its thumbnail, and sending the prompt clears the band.

- Thumbnails show in kitty and Ghostty. Other terminals show only `[Image #N] · 1.4 MB`.
- With many images or a narrow terminal, only the captions remain.
- `pastePreview: false` turns the preview off. It does not depend on `render`.
- neon-hud reads the image from the file Claude Code writes when you paste (`/tmp/claude-<uid>/…/images/N.png`). That path is not part of the mods API: if a new Claude Code version moves it, the preview shows `prévia indisponível`.
```

Linha da tabela de opções:

```markdown
| `pastePreview` | `true`, `false` | `true` | A thumbnail of each pasted image above the prompt, before sending. |
```

Linha de programas externos em `## Notes`:

```markdown
- External programs: `osascript` (macOS) or `copyq` (Linux), only when you click `⧉ html`, and `ratex-render` when `latex` is on. No network access. The image preview only lists folders and reads the size of pasted image files; the terminal reads the image itself.
```

Árvore de `## Development`:

```
hooks/paste.tsx                   pasted image preview (pure, no $)
```

- [ ] **Step 4: Verificação ao vivo (humano)**

Rode `claude --plugin-dir .` no kitty ou no Ghostty e:
1. cole uma imagem e confira a miniatura acima do prompt, com `PASTE`, `1 imagem` e a legenda. Se ela só aparecer depois de digitar uma tecla, está dentro do previsto (Review Focus 1);
2. cole uma segunda imagem e confira as duas miniaturas;
3. apague `[Image #1]` e confira que a primeira some;
4. envie e confira que a faixa some e não volta depois do turno;
5. desligue `pastePreview` em `/config`, rode `/reload` e confira que nada aparece.

Se o item 1 mostrar `prévia indisponível`, a pasta das imagens está em outro lugar. Rode `ls /private/tmp/claude-$(id -u)/*/*/images` e anote o caminho real antes de mexer no código.

- [ ] **Step 5: Gates finais e commit**

Run: `claude plugin validate . && claude plugin test . && npx -y -p typescript@5.6.3 tsc -p .`

```bash
git add README.md README.en.md .claude-plugin
git commit -m "v0.7.0: previa de imagem colada acima do prompt

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```
