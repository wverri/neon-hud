# Port do renderizador do prismantis — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O neon-hud passa a redesenhar as respostas do Claude Code (tabelas, código, diagramas, LaTeX, layout, copy buttons, tool rows, turn footer, texto) com a paleta neon, portando o renderizador do prismantis.

**Architecture:** Os módulos puros do prismantis são copiados para `hooks/render/` quase sem alterações; só `theme.ts` é reescrito (paleta neon fixa, opções reduzidas). Todos os hooks continuam em `hooks/register.tsx`, porque `$` não atravessa import. A lógica pura do painel sai antes para `hooks/hud.tsx`.

**Tech Stack:** TypeScript/TSX da API de mods do Claude Code (`claude-code`, `claude-code/testing`), Prism 1.30.0 e beautiful-mermaid 1.1.3 já empacotados pelo prismantis em `hooks/vendor/`.

**Spec:** `docs/superpowers/specs/2026-10-11-render-port-design.md`

## Global Constraints

- Origem fixa: prismantis commit `922bfaa32c838bc0fd02a9d91570f7fb9823dc47` (v0.15.1, MIT). Todo "upstream" neste plano se refere a esse commit; números de linha citados são desse commit.
- `$` não atravessa import: toda função que recebe `$` fica em `hooks/register.tsx`. Os arquivos em `hooks/render/` e `hooks/hud.tsx` são puros.
- `hooks/hooks.json` continua `{ "modules": ["./register.tsx"] }`.
- Sem rede. Programas externos permitidos: `/usr/bin/osascript` ou `copyq` (só ao clicar em `⧉ html`, timeout 5000 ms) e `ratex-render` (só com `latex: true`).
- Nada é enviado ao modelo: nenhum `prompt.submit` que adiciona contexto.
- Paleta neon fixa, sem opção de tema nem `<token>Color`.
- Fora do escopo: temas, `headingStyle`, `taskStyle`, prompts do usuário, RTL ativo, redesenho de slash commands, diagram hints, `$.prismantis.markdown`, `demo`, help.
- Opções de `userConfig` (exatamente estas): `render`, `tableStyle`, `toolRows`, `toolStyle`, `toolOutput`, `copyButtons`, `mermaid`, `mermaidAscii`, `latex`, `clock`, `highlightNumbers`, `highlightPaths`.
- Comando novo: `/neon-hud` (subcomandos `copy`, `copy code`). `/hud` continua igual.
- Os handlers de `session.start` e de `turn.complete` são únicos: a lógica nova entra no handler existente.
- Gates antes de cada commit: `claude plugin validate .`, `claude plugin test .`, `tsc -p .`. O `tsc` precisa de `.claude-plugin/types/`, que aparece depois de rodar `claude --plugin-dir .` uma vez.
- Comentários em português e sem acento, no estilo do `register.tsx` atual, só onde explicam um porquê. Código copiado do upstream fica sem comentários, como no original.
- Commits terminam com `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

### Ajuste em relação à spec

A spec previa `render.tsx` "sem RTL" e dois arquivos, `palette.ts` e `style.ts`. O RTL está entrelaçado em todo o `render.tsx` do upstream (tabelas, listas, quotes, headings, código). Por isso o plano **mantém `rtl.ts` copiado e o desliga para sempre** em `theme.ts` (`rtl: 'off'`, `reorder: false`, `shape: 'visual'`). Do mesmo jeito, `headingStyle` fica fixo em `banner`, `taskStyle` em `checks` e `promptStyle` em `off`. O comportamento é o da spec, mas o diff contra o upstream fica pequeno, o que facilita sincronizar depois. Paleta e estilo ficam juntos em `hooks/render/theme.ts`, o mesmo nome de arquivo do upstream.

## Review Focus

1. **`render: false`**: o HUD (painel, `/hud`, contadores) segue funcionando, e todos os `ui.render` de resposta, tool rows e footer devolvem `next(e)`. Teste na Task 3.
2. **Prismantis instalado junto**: o neon-hud não desenha por cima. Todo hook de renderização chama `next(e)` quando `$.prismantis` existe. Teste na Task 7.
3. **Resposta vazia ou só espaços** (comum no início do streaming): cai para `next(e)`, sem um `●` solto. Teste na Task 3.
4. **Falha ao registrar `/neon-hud`**: o `$.command.register` pode rejeitar. `/hud`, o restauro de contadores e os timers do HUD rodam mesmo assim. Teste na Task 3.
5. **Exceção dentro do renderizador** (markdown que quebra o parser ou o mermaid): a resposta cai para o render nativo em vez de sumir. Teste na Task 3.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
| --- | --- |
| `hooks/register.tsx` (modificar) | todos os hooks: HUD + renderizador |
| `hooks/hud.tsx` (criar) | constantes, formatadores e árvore do painel do HUD, puros |
| `hooks/render/theme.ts` (criar, reescrito) | `TOKENS`, `Theme`, `Style`, `Clock`, `NEON`, `isColor`, `resolveStyle` |
| `hooks/render/markdown.ts` (copiar) | parser |
| `hooks/render/render.tsx` (copiar, sem `renderUserPrompt`) | desenho dos blocos, tool rows, diff cards, turn footer |
| `hooks/render/mermaid.tsx` (copiar) | mermaid → arte colorida |
| `hooks/render/latex.ts` (copiar) | tamanho, padding e cache de fórmulas |
| `hooks/render/clipboard.ts` (copiar) | comando do `⧉ html` |
| `hooks/render/html.ts` (copiar) | tabela → HTML/TSV |
| `hooks/render/clock.ts` (copiar) | hora dos turnos |
| `hooks/render/rtl.ts` (copiar, desligado) | dependência interna do `render.tsx` |
| `hooks/render/vendor/*` (copiar) | `prism.js`, `prism.d.ts`, `mermaid-text.js`, `mermaid-text.d.ts` |
| `.claude-plugin/plugin.json` (modificar) | `userConfig`, versão 0.6.0, descrição |
| `.claude-plugin/marketplace.json` (modificar) | versão e descrição |
| `tests/{render,features,regressions,latex,clipboard,caches,contrast}.test.tsx`, `tests/clipboard-env.ts` (criar a partir do upstream) | testes do renderizador |
| `tests/neon.test.tsx` (criar) | testes próprios: Review Focus e convivência |
| `docs/THIRD_PARTY_NOTICES.md` (criar) | avisos MIT |
| `README.md` (modificar) | seção "Respostas renderizadas" |

---

### Task 0: Baixar o upstream fixado

**Files:** nenhum no repo.

- [ ] **Step 1: Clonar o prismantis no commit fixado, fora do repo**

```bash
UP=/private/tmp/claude-501/-Users-will-Github-neon-hud/b381702e-5457-4ca6-a7a5-b157849c57fc/scratchpad/prismantis-src
[ -d "$UP/.git" ] || git clone https://github.com/NahumLitvin/prismantis.git "$UP"
git -C "$UP" fetch --depth 1 origin 922bfaa32c838bc0fd02a9d91570f7fb9823dc47 2>/dev/null; git -C "$UP" checkout -q 922bfaa32c838bc0fd02a9d91570f7fb9823dc47
git -C "$UP" rev-parse HEAD
```

Expected: `922bfaa32c838bc0fd02a9d91570f7fb9823dc47`. Nas tasks seguintes, `$UP` é esse diretório.

- [ ] **Step 2: Gerar os tipos do Claude Code para o `tsc`**

Rode `claude --plugin-dir .` na raiz do neon-hud e saia com `/exit`. Confira que `.claude-plugin/types/tsconfig.json` existe e que `tsc -p .` passa no estado atual.

---

### Task 1: Extrair a lógica pura do HUD para `hooks/hud.tsx`

Refatoração sem mudar comportamento: os 5 testes de `tests/hud.test.tsx` são a rede de segurança.

**Files:**
- Create: `hooks/hud.tsx`
- Modify: `hooks/register.tsx`

**Interfaces:**
- Produces (exportados de `hooks/hud.tsx`): `PANE`, `TITLE`, `WIDTH`, `C`, `STORE_PREFIX`, `STORE_KEEP`, `toContext`, e `drawPane(el: ElementTable, s: PaneState, bodyColumns: number): RenderElement`, com `type PaneState = { l: HudLive; t: HudTokens; tl: HudTools; v: HudVitals; tn: HudTurn; cx: HudContext | null }`. Continuam exportados `ctxCells`, `ktok`, `share`, que hoje já são `export`.
- Ficam em `register.tsx`: os atoms (`live`, `tokens`, `tools`, `vitals`, `turn`, `context`), `refreshContext($)` e todos os `on(...)`.

- [ ] **Step 1: Rodar os testes atuais e registrar o baseline**

Run: `claude plugin test .`
Expected: os 5 testes de `tests/hud.test.tsx` passam.

- [ ] **Step 2: Criar `hooks/hud.tsx`**

Mova de `hooks/register.tsx` para `hooks/hud.tsx`, sem mudar o corpo:
- as constantes `PANE`, `TITLE`, `WIDTH`, `C`, `SLICE_COLORS`, `SLICE_GLYPH`, `STORE_PREFIX`, `STORE_KEEP`, `SPARK`, `PHASE`, `AGENT` (linhas 6–22, 71–78 e 220–236 atuais);
- as funções `fmt` até `clip` (linhas 80–218), incluindo o `type Recent`.

Exporte as que o `register.tsx` continua usando.

Depois, mova o corpo do `ui.render` do Pane (linhas 435–699: de `const { Box, Text } = $.ui.resolve(e)` até o JSX final) para:

```tsx
import type { ElementTable, RenderChildren, RenderElement } from 'claude-code'

import type { HudContext, HudLive, HudTokens, HudTools, HudTurn, HudVitals } from '../types'

export type PaneState = { l: HudLive; t: HudTokens; tl: HudTools; v: HudVitals; tn: HudTurn; cx: HudContext | null }

export function drawPane({ Box, Text }: ElementTable, { l, t, tl, v, tn, cx }: PaneState, bodyColumns: number): RenderElement {
  const w = Math.max(28, bodyColumns)
  // ...resto do corpo original, inalterado, a partir de `const iw = w - 6`
}
```

O corpo original não usa `$` depois dos `read(...)`. Se aparecer algum `$.`, ele fica no `register.tsx` e o valor entra em `PaneState`.

- [ ] **Step 3: Reduzir o hook do Pane no `register.tsx`**

```tsx
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
```

Ajuste os imports do `register.tsx` para trazer de `./hud` o que ele usa.

- [ ] **Step 4: Rodar os gates**

Run: `claude plugin validate . && claude plugin test . && tsc -p .`
Expected: os 5 testes passam, sem erros de tipo.

- [ ] **Step 5: Commit**

```bash
git add hooks/hud.tsx hooks/register.tsx
git commit -m "Extrai a logica pura do painel para hooks/hud.tsx

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Copiar os módulos puros e criar a paleta neon

**Files:**
- Create: `hooks/render/{markdown.ts,render.tsx,mermaid.tsx,latex.ts,clipboard.ts,html.ts,clock.ts,rtl.ts,theme.ts}`, `hooks/render/vendor/{prism.js,prism.d.ts,mermaid-text.js,mermaid-text.d.ts}`
- Create: `docs/THIRD_PARTY_NOTICES.md`
- Test: `tests/contrast.test.tsx`

**Interfaces:**
- Produces (`hooks/render/theme.ts`): `TOKENS`, `type Theme`, `type Clock`, `type Style` (idêntico ao upstream), `NEON: Record<(typeof TOKENS)[number], string>`, `isColor(value): value is string`, `resolveStyle(options: PluginOptions): Style`.
- Produces (sem mudança de assinatura em relação ao upstream): `parse` (markdown); `renderBlocks`, `renderToolRow`, `renderToolGroup`, `renderExpandedShell`, `renderDiffCard`, `renderFailure`, `renderShellResult`, `renderTurnDuration`, `isReadOnlyCall`, `remember`, `rememberCall`, `width`, `type Drawn`, `type Fold` (render); `boxArt`, `mermaidText`, `shortenEdgeLabels`, `unsupportedKind` (mermaid); `LATEX_DPR`, `LATEX_FONT_PX`, `fitsImage`, `keepFormulas`, `mathOf`, `padFor`, `pickFormula`, `pngSize`, `ratexColor`, `renderedOf`, `type Formula` (latex); `clipboardCommand`, `type ClipboardBackend` (clipboard); `clockText`, `endedAt`, `withRecord` (clock); `hasRtl` (rtl).

- [ ] **Step 1: Escrever o teste de contraste da paleta (falha)**

`tests/contrast.test.tsx`:

```tsx
import { expect, test } from 'claude-code/testing'

import { NEON, TOKENS } from '../hooks/render/theme'

const BACKGROUNDS = ['#000000', '#0b0e1a', '#1e1e2e']

const luminance = (hex: string) => {
  const channel = (i: number) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
}

const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

const FLOOR: Record<string, number> = { rule: 1.05, tableRule: 1.05, diagram: 1.05, codeComment: 1.5, bullet: 1.5, quote: 1.5 }

test('a paleta neon define todo token com uma cor hex valida', async () => {
  expect(Object.keys(NEON).sort()).toEqual([...TOKENS].sort())
  for (const value of Object.values(NEON)) expect(/^#[0-9a-f]{6}$/.test(value)).toBe(true)
})

test('a paleta neon fica legivel em fundos escuros', async () => {
  const failures: string[] = []
  for (const bg of BACKGROUNDS)
    for (const [token, color] of Object.entries(NEON)) {
      const ratio = contrast(color, bg)
      if (ratio < (FLOOR[token] ?? 2)) failures.push(`${bg} ${token} ${ratio.toFixed(2)}`)
    }
  expect(failures).toEqual([])
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `claude plugin test .`
Expected: FAIL, não acha `../hooks/render/theme`.

- [ ] **Step 3: Copiar os arquivos do upstream**

```bash
mkdir -p hooks/render/vendor
cp $UP/hooks/{markdown.ts,render.tsx,mermaid.tsx,latex.ts,clipboard.ts,html.ts,clock.ts,rtl.ts} hooks/render/
cp $UP/hooks/vendor/{prism.js,prism.d.ts,mermaid-text.js,mermaid-text.d.ts} hooks/render/vendor/
```

- [ ] **Step 4: Tirar `renderUserPrompt` de `hooks/render/render.tsx`**

Apague `export const renderUserPrompt = ...`, que vai da linha 1258 até o fim do arquivo (1279). Não mexa no resto.

- [ ] **Step 5: Escrever `hooks/render/theme.ts`**

```ts
import type { PluginOptions } from 'claude-code'

import type { ClipboardBackend } from './clipboard'
import type { Shape, Terminal } from './rtl'

export const TOKENS = [
  'accent', 'heading', 'strong', 'emphasis', 'inlineCode', 'codeText', 'codeCommand', 'codeFlag', 'codeString', 'codeComment',
  'link', 'path', 'number', 'quote', 'rule', 'tableHeader', 'tableRule', 'bullet', 'diagram', 'diagramText',
] as const

export type Theme = Partial<Record<(typeof TOKENS)[number], string>>

export type Clock = 'off' | '24h' | '12h'

export type Style = {
  theme: Theme
  headingStyle: 'bold' | 'underline' | 'uppercase' | 'banner'
  tableStyle: 'box' | 'rules' | 'grid' | 'minimal'
  taskStyle: 'checks' | 'ticks' | 'box' | 'progress'
  promptStyle: 'bubble' | 'bar' | 'chevron' | 'off'
  clock: Clock
  toolStyle: 'chat' | 'tree-dim' | 'tree-bold' | 'classic'
  toolOutput: 'full' | 'quiet'
  narration?: boolean
  highlightNumbers: boolean
  highlightPaths: boolean
  mermaid: boolean
  mermaidAscii: boolean
  copyButtons: boolean
  htmlCopy: ClipboardBackend | null
  diagramHints: boolean
  rtl: 'auto' | Terminal | 'off'
  reorder: boolean
  shape: Shape
  latex: boolean
  cwd: string
  home: string
}

// As mesmas cores do painel (C em hud.tsx), para a resposta e o HUD falarem a mesma lingua.
export const NEON: Record<(typeof TOKENS)[number], string> = {
  accent: '#00e5ff', heading: '#00e5ff', tableHeader: '#00e5ff', strong: '#ff3ea5', emphasis: '#a77bff',
  inlineCode: '#ffcc33', codeText: '#c9d4f2', codeCommand: '#a77bff', codeFlag: '#ff3ea5', codeString: '#3dff9a',
  codeComment: '#66708f', link: '#a77bff', path: '#ffcc33', number: '#3dff9a', quote: '#c9d4f2',
  rule: '#343c5c', tableRule: '#343c5c', bullet: '#66708f', diagram: '#343c5c', diagramText: '#c9d4f2',
}

const COLOR = /^(#[0-9a-f]{3}|#[0-9a-f]{6}|rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)|ansi256\(\d{1,3}\)|(black|red|green|yellow|blue|magenta|cyan|white|gray|grey)(Bright)?)$/i

export const isColor = (value: unknown): value is string => typeof value === 'string' && COLOR.test(value.trim())

const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback

// RTL, heading, tarefas e prompts ficam fixos: o render.tsx do prismantis ainda le esses campos.
export const resolveStyle = (options: PluginOptions): Style => ({
  theme: { ...NEON },
  headingStyle: 'banner',
  tableStyle: pick(options.tableStyle, ['box', 'rules', 'grid', 'minimal'] as const, 'box'),
  taskStyle: 'checks',
  promptStyle: 'off',
  clock: pick(options.clock, ['off', '24h', '12h'] as const, 'off'),
  toolStyle: pick(options.toolStyle, ['chat', 'tree-dim', 'tree-bold', 'classic'] as const, 'chat'),
  toolOutput: pick(options.toolOutput, ['full', 'quiet'] as const, 'full'),
  highlightNumbers: options.highlightNumbers !== false,
  highlightPaths: options.highlightPaths !== false,
  mermaid: options.mermaid !== false,
  mermaidAscii: options.mermaidAscii === true,
  copyButtons: options.copyButtons !== false,
  htmlCopy: null,
  diagramHints: false,
  rtl: 'off',
  reorder: false,
  shape: 'visual',
  latex: options.latex === true,
  cwd: '',
  home: '',
})
```

Confira com `grep -n "from './theme'" hooks/render/*.ts*` que tudo o que os arquivos copiados importam de `./theme` existe aqui. Se faltar algum nome, copie a definição do `theme.ts` do upstream.

- [ ] **Step 6: Escrever `docs/THIRD_PARTY_NOTICES.md`**

Comece com:

```markdown
# Avisos de terceiros

`hooks/render/` vem do [prismantis](https://github.com/NahumLitvin/prismantis), commit `922bfaa32c838bc0fd02a9d91570f7fb9823dc47` (v0.15.1). `theme.ts` foi reescrito com a paleta neon e `render.tsx` perdeu `renderUserPrompt`; os demais arquivos estão como no original.
```

Logo abaixo, cole o texto completo de `$UP/LICENSE` (MIT, com a linha de copyright de Nahum Litvin) num bloco de código. Depois, cole o conteúdo inteiro de `$UP/docs/THIRD_PARTY_NOTICES.md` (beautiful-mermaid e Prism, com as licenças), trocando `hooks/vendor/` por `hooks/render/vendor/`.

- [ ] **Step 7: Rodar os gates**

Run: `claude plugin validate . && claude plugin test . && tsc -p .`
Expected: os 2 testes de contraste passam, os 5 do HUD seguem verdes, `tsc` sem erros.

Se o teste de contraste falhar em algum token, **não abaixe o piso**: troque a cor em `NEON` pela cor de `C` mais próxima que passe e anote a troca no commit.

- [ ] **Step 8: Commit**

```bash
git add hooks/render docs/THIRD_PARTY_NOTICES.md tests/contrast.test.tsx
git commit -m "Copia o renderizador do prismantis e cria a paleta neon

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Respostas renderizadas (tabelas, código, diagramas, layout, texto, copy)

**Files:**
- Modify: `hooks/register.tsx`, `.claude-plugin/plugin.json`
- Create: `tests/render.test.tsx`, `tests/regressions.test.tsx`, `tests/clipboard.test.tsx`, `tests/clipboard-env.ts`, `tests/caches.test.tsx`, `tests/neon.test.tsx`

**Interfaces:**
- Consumes: tudo o que a Task 2 produz.
- Produces (dentro de `register.tsx`, usado pelas Tasks 4–7): `rendering: boolean` (`options.render !== false`), `style: Style`, `parseCached(text)`, `columnsOf(viewport)`, `locate($, style)`, `folder($, el, open)`, `unfolded` (atom), `type Typeset`, `drawMarkdown($, el, style, blocks, columns, math?, reply?, open?)` (igual ao upstream), `forSurface(style, surface)`, `prismantisActive($): boolean` (nesta task sempre `false`; implementada na Task 7).

- [ ] **Step 1: Declarar `userConfig` no `plugin.json`**

Acrescente em `.claude-plugin/plugin.json`, depois de `"types"`, um bloco `"userConfig"` com as 12 opções. Copie o formato de cada entrada (`type`, `title`, `description`, `default` e `enum` quando houver) do `userConfig` de `$UP/.claude-plugin/plugin.json`, com estas diferenças:
- `render` substitui o `enabled` do upstream: `{ "type": "boolean", "title": "Render", "description": "Redesenha respostas, ferramentas e o rodape do turno com a paleta neon. Desligado, o painel continua.", "default": true }`;
- descrições em português;
- não inclua `theme`, `<token>Color`, `headingStyle`, `taskStyle`, `promptStyle`, `diagramHints`, `rtl` nem `enabled`.

Run: `claude plugin validate .`
Expected: válido.

- [ ] **Step 2: Portar os testes do upstream**

```bash
for f in render regressions clipboard caches; do cp $UP/tests/$f.test.tsx tests/; done
cp $UP/tests/clipboard-env.ts tests/
sed -i '' \
  -e "s#'\.\./hooks/\([a-z-]*\)'#'../hooks/render/\1'#g" \
  -e "s#plugin: 'prismantis'#plugin: 'neon-hud'#g" \
  -e "s#command: 'prismantis'#command: 'neon-hud'#g" \
  -e "s#/prismantis#/neon-hud#g" \
  -e "s#{ enabled: false }#{ render: false }#g" \
  -e "s#PRESETS\['catppuccin-mocha'\]#NEON#g" \
  -e "s#import { PRESETS } from '../hooks/render/presets'#import { NEON } from '../hooks/render/theme'#" \
  tests/render.test.tsx tests/regressions.test.tsx tests/clipboard.test.tsx tests/caches.test.tsx tests/clipboard-env.ts
```

Depois, apague destes arquivos os testes abaixo. São os nomes exatos do upstream, e cobrem coisas fora do escopo ou de outras tasks.

`tests/render.test.tsx`:
- `user colors override the theme, bad colors are ignored`
- `every preset defines every token with a valid color`
- `picks a named theme and falls back on unknown names`
- `rgb() and ansi256() colors reach the drawing`
- `tool rows read like Ran <command> with shell colors`, `file tools show the path in the path color and failures say so`, `toolRows off leaves tool rows to the engine`: voltam na Task 4
- `options reach the drawing`: substitua pelo teste abaixo, porque não há mais `tableHeaderColor`

```tsx
test('options reach the drawing', { options: { highlightNumbers: false } }, async $ => {
  const ui = await $.ui.mount({ ...draw(TABLE), surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: 'Service' }))?.props.color).toBe(NEON.tableHeader)
  expect((await ui.find({ type: 'Text', text: /^1\.8\.3$/ }))?.props.color).not.toBe(NEON.number)
  await ui.unmount()
})
```

(`draw` e `TABLE` estão no topo do arquivo. Se o original montava de outro jeito, siga a forma dele e mude só as asserções de cor.)

`tests/regressions.test.tsx`:
- `highlight colors follow the theme in use: red`, `highlight colors follow the theme in use: green`, `presets stay intact`
- `the help screen shows every element prismantis draws`, `every diagram on the help screen draws as art`, `the help screen fits one screen: few blocks, two alerts, a table, a list and two drawn charts`, `the help screen draws as command output`
- `copy reply copies the whole reply as written, Hebrew in reading order`
- os imports de `help` e `presets` que ficarem sem uso

`tests/caches.test.tsx`:
- `highlighted code keeps each right-to-left shape apart under one theme`
- `the terminal is looked up once, not on every prompt` (depende de `prompt.submit`, que não portamos)
- `only the 500 most recently expanded tool calls stay expanded`: volta na Task 4

`tests/clipboard.test.tsx`:
- `the HTML check runs once, on session start or on the first prompt after a reload`: mantenha só a metade do `session.start`, apagando do corpo a parte que dispara `prompt.submit` e a asserção que depende dela.

- [ ] **Step 3: Escrever os testes próprios (Review Focus 1, 3, 4, 5)**

`tests/neon.test.tsx`:

```tsx
import { expect, test } from 'claude-code/testing'

const reply = (text: string, columns = 120) => ({
  plugin: 'neon-hud',
  component: 'AssistantMessage' as const,
  props: { text, isFirstOfReply: true },
  viewport: { columns, rows: 40 },
  surface: 'terminal' as const,
})

const PANE = {
  plugin: 'neon-hud',
  surface: 'terminal' as const,
  component: 'Pane' as const,
  requestId: 'neon-hud',
  props: { title: 'NEON//HUD', isFocused: false, bodyColumns: 44, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
}

const countNative = (on: Parameters<Parameters<typeof test>[1]>[1]) => {
  const hits = { n: 0 }
  on('ui.render', { component: 'AssistantMessage' }, async () => {
    hits.n++
    return undefined as never
  })
  return hits
}

test('render false devolve a resposta ao engine e o painel continua', { options: { render: false } }, async ($, on) => {
  const native = countNative(on)
  const ui = await $.ui.mount(reply('| a | b |\n|---|---|\n| 1 | 2 |'))
  expect(native.n).toBe(1)
  await ui.unmount()
  const pane = await $.ui.mount(PANE as never)
  expect(await pane.find({ type: 'Text', text: /STANDBY/ })).toBeDefined()
  await pane.unmount()
})

test('uma resposta so com espacos fica com o engine', async ($, on) => {
  const native = countNative(on)
  const ui = await $.ui.mount(reply('   \n  '))
  expect(native.n).toBe(1)
  await ui.unmount()
})

test('se o /neon-hud nao registra, o /hud ainda registra e o painel abre', async ($, on) => {
  const names: string[] = []
  on('command.register', async (_, e) => {
    if (e.name === 'neon-hud') throw new Error('recusado')
    names.push(e.name)
    return { value: undefined } as never
  })
  await $.session.start({ source: 'startup' } as never)
  expect(names).toContain('hud')
  const pane = await $.ui.mount(PANE as never)
  expect(await pane.find({ type: 'Text', text: /NEON/ })).toBeDefined()
  await pane.unmount()
})

test('um erro ao desenhar devolve a resposta ao engine', async ($, on) => {
  const native = countNative(on)
  const ui = await $.ui.mount(reply('texto **qualquer**', Number.NaN))
  expect(native.n).toBe(1)
  await ui.unmount()
})

test('uma tabela desenha o cabecalho em ciano neon', async $ => {
  const ui = await $.ui.mount(reply('| Nome | Valor |\n|---|---:|\n| api | 2 |'))
  expect((await ui.find({ type: 'Text', text: 'Nome' }))?.props.color).toBe('#00e5ff')
  await ui.unmount()
})
```

Notas para o implementador:
- O tipo de `on` em `countNative` é o de `claude-code/testing`. Se a expressão `Parameters<...>` não compilar, importe `type On` de `'claude-code'`, como faz o `tests/latex.test.tsx` do upstream.
- A assinatura de `on('command.register', ...)` e de `$.session.start(...)` está em `.claude-plugin/types/`. Se algum nome não existir na API de testes, use o helper `startSession` de `tests/clipboard-env.ts`.
- O teste do erro ao desenhar usa `columns: NaN` para quebrar o renderizador. Antes de implementar, confirme com um `console.log` temporário no `catch` que ele realmente lança. Se não lançar, troque a entrada por outra que lance (por exemplo, `props.text` como `undefined as never`) e mantenha a asserção `native.n === 1`.

- [ ] **Step 4: Rodar e ver falhar**

Run: `claude plugin test .`
Expected: os testes portados e os novos falham, porque nada ainda desenha `AssistantMessage`. Contraste e HUD seguem verdes.

- [ ] **Step 5: Implementar no `register.tsx`**

Imports novos no topo (junte com os existentes de `claude-code`):

```tsx
import type { EngineInterface, PluginOptions, RenderElement, RenderSurface } from 'claude-code'

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
```

Copie do `register.tsx` do upstream, para o nível do módulo e acima de `export const register`, os blocos abaixo, com as edições indicadas:

| Bloco no upstream | Edições |
| --- | --- |
| `columnsOf` (linha 67) | nenhuma |
| `unfolded` (linha 71) | `plugin: 'neon-hud'`, `key: 'render-unfolded'` |
| `type Typeset` (linha 84) | nenhuma |
| `locate` (linhas 207–210) | nenhuma |
| `htmlBackend` (linhas 212–217) | nenhuma |
| `copyTable` (linhas 229–234) | nenhuma |
| `folder` (linhas 236–240) | nenhuma |
| `drawMarkdown` (linhas 242–296) | nenhuma |

`Probes`, `probe`, `applyRtl` e `detectTerminal` **não** são copiados. No lugar deles:

```tsx
type Probes = { htmlCopy?: Promise<ClipboardBackend | null> }

const probe = async ($: EngineInterface, style: Style, probes: Probes) => {
  probes.htmlCopy ??= htmlBackend($)
  style.htmlCopy = await probes.htmlCopy
}

// Preenchida na Task 7; por ora o neon-hud sempre desenha.
const prismantisActive = (_$: EngineInterface): boolean => false
```

Troque a assinatura do register e monte o estado no começo dele:

```tsx
export const register: Register = (on, options: PluginOptions) => {
  const rendering = options.render !== false
  const style = resolveStyle(options)
  const parsed = new Map<string, ReturnType<typeof parse>>()
  const parseCached = (text: string) => remember(parsed, text, () => parse(text, { numbers: style.highlightNumbers, paths: style.highlightPaths }))
  const forSurface = (base: Style, surface: RenderSurface): Style => (surface === 'terminal' || !base.htmlCopy ? base : { ...base, htmlCopy: null })
  const probes: Probes = {}
```

No handler **existente** de `session.start`:
1. troque o `await $.command.register({ name: 'hud', ... })` do começo por `await $.command.register({ ... }).catch(() => undefined)`, com o mesmo objeto;
2. logo antes do `return next(e)`, acrescente:

```tsx
    if (rendering) {
      await probe($, style, probes)
      // Falhar aqui nao pode derrubar o painel: o /hud e os timers ja foram montados acima.
      await $.command
        .register({ name: 'neon-hud', description: 'Copia a ultima resposta ou o ultimo bloco de codigo', argumentHint: '[copy [code]]' })
        .catch(() => undefined)
    }
```

Depois do último `on(...)` do HUD (o do Pane), acrescente:

```tsx
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
```

As mensagens de `/neon-hud copy` ficam em inglês, iguais ao upstream, porque os testes portados conferem esse texto.

- [ ] **Step 6: Rodar os testes e corrigir as falhas restantes**

Run: `claude plugin test .`
Expected: tudo verde. Para cada falha restante, siga esta regra:
- a asserção espera uma cor de tema do upstream (hex de catppuccin): troque pelo token equivalente de `NEON`;
- o teste depende de algo fora do escopo (tema, prompt, help, hint, RTL ativo): apague o teste e cite o nome dele no commit;
- qualquer outra falha é bug do port: investigue antes de mexer no teste.

- [ ] **Step 7: Gates e commit**

Run: `claude plugin validate . && claude plugin test . && tsc -p .`

```bash
git add hooks/register.tsx .claude-plugin/plugin.json tests
git commit -m "Desenha as respostas com o renderizador neon: tabelas, codigo, diagramas, layout, texto e copia

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Tool rows

**Files:**
- Modify: `hooks/register.tsx`, `tests/render.test.tsx`, `tests/caches.test.tsx`
- Create: `tests/features.test.tsx`

**Interfaces:**
- Consumes: `style`, `locate`, `folder`, `unfolded`, `prismantisActive`, `rendering` (Task 3).

- [ ] **Step 1: Portar os testes**

```bash
cp $UP/tests/features.test.tsx tests/
sed -i '' \
  -e "s#'\.\./hooks/\([a-z-]*\)'#'../hooks/render/\1'#g" \
  -e "s#plugin: 'prismantis'#plugin: 'neon-hud'#g" \
  -e "s#command: 'prismantis'#command: 'neon-hud'#g" \
  -e "s#/prismantis#/neon-hud#g" \
  -e "s#PRESETS\['catppuccin-mocha'\]#NEON#g" \
  tests/features.test.tsx
```

Troque os imports das linhas 7–8 (de `presets`, e de `RANDOM_THEMES`/`pickTheme`) por `import { NEON } from '../hooks/render/theme'`.

Em `tests/features.test.tsx`, apague estes testes:
- `slash command output renders as markdown, errors stay native`
- `your prompts carry the render hint as model-only context`
- `no render hint when diagramHints is off`
- `headless runs get no render hint`
- os 6 testes de tema: `/prismantis theme <name> and /prismantis <name> switch the theme through config`, `/prismantis random re-rolls on every call once the setting is random`, `/prismantis rejects unknown themes and lists the real ones`, `theme random can pick every dark color preset, never mono or a light one, and falls back on junk`, `/prismantis theme reports the random pick and how to keep it`, `/prismantis theme reports a fixed theme without the random note` (depois do `sed`, com `/neon-hud` no nome)
- `/prismantis random redraws replies in the new pick`
- `your prompts draw in a rounded accent bubble by default`
- `promptStyle bar draws an accent bar`
- `promptStyle chevron draws a bold accent prompt`
- `promptStyle off and task notifications keep the engine look`
- `clock puts the send time before your prompt`
- `an old prompt row that redraws after a resume never takes a later send time`
- `clock with promptStyle off stamps the engine row`
- `task notifications are not drawn as your prompt`
- `a Hebrew prompt bubble sits on the right`
- `an unstamped prompt is yours, a teammate message is not`
- `slash command output with terminal escape codes is left to the engine`
- `taskStyle progress draws ticks under a done-count bar`
- `taskStyle box draws a box and a tick`

Os 7 testes de turn footer e clock (de `turn footer formats durations` até `an old turn line that redraws never takes a later end with a close duration`) só passam na Task 5. Recorte-os para `tests/footer.pending.txt` (um arquivo que o `claude plugin test` ignora, por não terminar em `.test.tsx`) e não faça commit dele.

Devolva para `tests/render.test.tsx` os 3 testes de tool rows (`tool rows read like Ran <command> with shell colors`, `file tools show the path in the path color and failures say so`, `toolRows off leaves tool rows to the engine`), e para `tests/caches.test.tsx` o `only the 500 most recently expanded tool calls stay expanded`. Copie-os de `$UP/tests/` e aplique as mesmas substituições do `sed`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `claude plugin test .`
Expected: os testes de tool rows falham.

- [ ] **Step 3: Implementar**

Acrescente ao import de `./render/render`: `isReadOnlyCall, rememberCall, renderDiffCard, renderExpandedShell, renderFailure, renderShellResult, renderToolGroup, renderToolRow`.

No nível do módulo, copie do upstream `expandedCalls` e `readOnlyCalls` (linhas 57–58) e `markExpanded` (linhas 60–64).

Dentro de `register`, logo depois de `if (!rendering) return`, copie do upstream a linha `const quiet = style.toolOutput === 'quiet'` e o bloco `if (options.toolRows !== false) { ... }` (linhas 292–325), com duas edições:
- toda chamada `fit(e.viewport)` vira `style`, já que sem RTL não há ajuste por viewport;
- cada um dos 3 handlers ganha `if (prismantisActive($)) return next(e)` como primeira linha.

- [ ] **Step 4: Rodar os testes**

Run: `claude plugin test .`
Expected: tool rows verdes. Para falhas restantes, use a mesma regra do Step 6 da Task 3.

- [ ] **Step 5: Gates e commit**

Run: `claude plugin validate . && claude plugin test . && tsc -p .`

```bash
git add hooks/register.tsx tests/render.test.tsx tests/caches.test.tsx tests/features.test.tsx
git commit -m "Tool rows: uma linha por chamada, grupos resumidos, diff cards e toolOutput quiet

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Turn footer e clock

**Files:**
- Modify: `hooks/register.tsx`, `tests/features.test.tsx`, `tests/neon.test.tsx`

**Interfaces:**
- Consumes: `style`, `prismantisActive`, `rendering`.

- [ ] **Step 1: Devolver os testes de footer e clock**

Cole o conteúdo de `tests/footer.pending.txt` de volta no fim de `tests/features.test.tsx` e apague o `.txt`.

Acrescente em `tests/neon.test.tsx`:

```tsx
test('o rodape do turno usa o verde neon na duracao', async $ => {
  const ui = await $.ui.mount({
    plugin: 'neon-hud',
    surface: 'terminal',
    component: 'TurnDuration',
    props: { word: 'Baked', durationMs: 380_000 },
  } as never)
  expect((await ui.find({ type: 'Text', text: /6m 20s/ }))?.props.color).toBe('#3dff9a')
  await ui.unmount()
})
```

(Use as mesmas props de `TurnDuration` do teste `turn footer keeps the word and colors the duration` do upstream. Se ele montar com mais campos, copie todos.)

- [ ] **Step 2: Rodar e ver falhar**

Run: `claude plugin test .`
Expected: os testes de footer e clock falham.

- [ ] **Step 3: Implementar**

Imports:

```tsx
import { clockText, endedAt, withRecord } from './render/clock'
```

Acrescente também `renderTurnDuration` ao import de `./render/render`.

No nível do módulo, copie do upstream:
- `turnEnds` (linha 73), com `plugin: 'neon-hud'` e `key: 'render-turnEnds'`;
- `firstDrawn` (linhas 75–82), com `plugin: 'neon-hud'` e `key: 'render-drawn'` no `ref`.

No handler **existente** de `turn.complete`, dentro do `if (e.agentId === undefined) { ... }`, depois das duas chamadas `update` que já estão lá, acrescente:

```tsx
      if (rendering && style.clock !== 'off') {
        const at = await $.clock.now()
        await update($, turnEnds, list => withRecord(list, { durationMs: e.durationMs, at }))
      }
```

Depois de `if (!rendering) return`:

```tsx
  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    if (prismantisActive($)) return next(e)
    const at = style.clock === 'off' ? undefined : endedAt(await read($, turnEnds), e.props.durationMs, await firstDrawn($, e.requestId))
    const time = at === undefined ? undefined : clockText(at, await $.clock.now(), style.clock)
    return renderTurnDuration($.ui.resolve(e), style, e.props.word, e.props.durationMs, time)
  })
```

- [ ] **Step 4: Rodar os testes**

Run: `claude plugin test .`
Expected: tudo verde.

- [ ] **Step 5: Gates e commit**

Run: `claude plugin validate . && claude plugin test . && tsc -p .`

```bash
git add hooks/register.tsx tests/features.test.tsx tests/neon.test.tsx
git commit -m "Rodape do turno com a duracao em verde neon e hora opcional (clock)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: LaTeX

**Files:**
- Modify: `hooks/register.tsx`
- Create: `tests/latex.test.tsx`

**Interfaces:**
- Consumes: `drawMarkdown`, `type Typeset`, `style`, `rendering`.
- Produces: `latex: LatexSession`, `mathOfBlocks($, latex, surface, blocks)`.

- [ ] **Step 1: Portar os testes**

```bash
cp $UP/tests/latex.test.tsx tests/
sed -i '' \
  -e "s#'\.\./hooks/\([a-z-]*\)'#'../hooks/render/\1'#g" \
  -e "s#plugin: 'prismantis'#plugin: 'neon-hud'#g" \
  -e "s#prismantis-latex-#neon-hud-latex-#g" \
  tests/latex.test.tsx
```

Apague:
- `the prompt hint says display math renders when the renderer works`;
- `a prompt sent while the renderer check is still running is not held up and carries no LaTeX hint`;
- o loop `the diagram text color ${color} reaches the renderer as ${hex}, a color it accepts`, porque não há `diagramTextColor`.

Em `without the renderer installed, math stays text and no LaTeX hint is sent`, remova só a parte que envia o prompt e verifica a hint. Mantenha a verificação de que a fórmula fica como texto.

Acrescente em `tests/latex.test.tsx`:

```tsx
test('a formula vai para o renderer na cor de texto neon', async ($, on) => {
  const runs = ratex(on)
  on('env.get', (_, e) => ({ value: (KITTY as Record<string, string>)[e.name] }))
  await $.session.start({ source: 'startup' } as never)
  const ui = await $.ui.mount({ plugin: 'neon-hud', surface: 'terminal', component: 'AssistantMessage', props: { text: REPLY, isFirstOfReply: true }, viewport: { columns: 120, rows: 40 } })
  await ui.unmount()
  const argv = runs[0]?.argv ?? []
  expect(String(argv[argv.indexOf('--color') + 1]).toLowerCase()).toContain('c9d4f2')
})
```

(`ratex`, `KITTY` e `REPLY` são helpers do topo do arquivo. Se o upstream prepara o ambiente kitty com outro helper, use esse helper no lugar do `on('env.get', ...)`. Se `ratexColor` converter a cor para outro formato, como `rgb(...)`, troque a asserção pelo valor que ela gera para `#c9d4f2`.)

- [ ] **Step 2: Rodar e ver falhar**

Run: `claude plugin test .`
Expected: os testes de LaTeX falham.

- [ ] **Step 3: Implementar**

Troque o import de `./render/latex` da Task 3 por:

```tsx
import type { Formula } from './render/latex'
import { LATEX_DPR, LATEX_FONT_PX, fitsImage, keepFormulas, mathOf, padFor, pickFormula, pngSize, ratexColor, renderedOf } from './render/latex'
import type { Block } from './render/markdown'
```

No nível do módulo, copie do upstream `formulas` e `latexDir` (linhas 69–70), com `plugin: 'neon-hud'` e as chaves `render-formulas` e `render-dir`.

Sem `detectTerminal`, escreva:

```tsx
const showsImages = async ($: EngineInterface): Promise<boolean> => {
  if (await $.env.get('TMUX')) return false
  if ((await $.env.get('KITTY_WINDOW_ID')) || (await $.env.get('TERM')) === 'xterm-kitty') return true
  return (await $.env.get('TERM_PROGRAM')) === 'ghostty'
}
```

Depois, copie as linhas 92–205 do upstream: `Latex`, `LatexSession`, `formulaKey`, `typeset`, `withPadding`, `startLatex`, `latexEngine`, `stopLatex`, `typesetLater` e `mathOfBlocks`. A única edição é em `startLatex`: o diretório `prismantis-latex-` vira `neon-hud-latex-`.

Dentro de `register`, logo depois de `const style = ...`:

```tsx
  const latex: LatexSession = { style, color: ratexColor(style.theme.diagramText ?? '#c9d4f2'), pending: new Set(), wanted: new Set(), batch: [], queue: Promise.resolve() }
```

No `session.start` existente, dentro do `if (rendering)` da Task 3, acrescente `void latexEngine($, latex)` logo depois de `await probe(...)`.

No `AssistantMessage`, troque o `new Map()` passado a `drawMarkdown` por `await mathOfBlocks($, latex, e.surface, blocks)`.

- [ ] **Step 4: Rodar os testes**

Run: `claude plugin test .`
Expected: tudo verde.

- [ ] **Step 5: Gates e commit**

Run: `claude plugin validate . && claude plugin test . && tsc -p .`

```bash
git add hooks/register.tsx tests/latex.test.tsx
git commit -m "LaTeX: formulas em display como imagem via ratex-render em kitty e Ghostty

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Convivência com o prismantis

**Files:**
- Modify: `hooks/register.tsx`, `tests/neon.test.tsx`

- [ ] **Step 1: Escrever o teste (Review Focus 2)**

Em `tests/neon.test.tsx`:

```tsx
test('com o prismantis instalado, o neon-hud deixa ele desenhar', async ($, on) => {
  on('engine.create', async (_$, e, next) => ({ ...(await next(e)), prismantis: { markdown: async () => undefined } }) as never)
  const native = countNative(on)
  const ui = await $.ui.mount(reply('| a |\n|---|\n| 1 |'))
  expect(native.n).toBe(1)
  await ui.unmount()
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `claude plugin test .`

Se o teste **falhar porque o neon-hud desenhou** (`native.n` igual a 0), siga para o Step 3.

Se o teste **falhar porque não dá para registrar `engine.create`** dentro de um teste, a API não deixa simular o noun. Nesse caso:
1. apague o teste;
2. implemente o Step 3 do mesmo jeito;
3. confira à mão no Step 3 da Task 8, com os dois plugins instalados;
4. mantenha a seção de convivência no README, que é o fallback da spec.

- [ ] **Step 3: Implementar**

Troque o stub da Task 3:

```tsx
// O prismantis publica $.prismantis; com ele presente, as respostas sao dele e o neon-hud fica so com o painel.
const prismantisActive = ($: EngineInterface): boolean => ($ as unknown as { prismantis?: unknown }).prismantis !== undefined
```

- [ ] **Step 4: Rodar os testes**

Run: `claude plugin test .`
Expected: tudo verde.

- [ ] **Step 5: Gates e commit**

Run: `claude plugin validate . && claude plugin test . && tsc -p .`

```bash
git add hooks/register.tsx tests/neon.test.tsx
git commit -m "Cede a renderizacao ao prismantis quando ele esta instalado

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Documentação, versão e verificação ao vivo

**Files:**
- Modify: `README.md`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`
- Create: `docs/render.png`

- [ ] **Step 1: Versão e descrição**

Nos dois manifestos, `"version": "0.6.0"`. A descrição nos dois passa a ser:

`Painel lateral cyberpunk para o Claude Code (tokens/s, contexto, custo, agentes e ferramentas) e respostas renderizadas em neon: tabelas, codigo, diagramas, LaTeX e tool rows`

Acrescente `"markdown"`, `"tables"` e `"mermaid"` em `keywords` do `plugin.json`.

- [ ] **Step 2: README**

Depois da tabela "O que ele mostra", acrescente uma seção `## Respostas renderizadas` com:
- um parágrafo dizendo que o neon-hud redesenha as respostas, as chamadas de ferramenta e o rodapé do turno com a paleta do painel, e que o renderizador vem do [prismantis](https://github.com/NahumLitvin/prismantis) (MIT, ver `docs/THIRD_PARTY_NOTICES.md`);
- o print `docs/render.png` (Step 3);
- uma tabela com as funcionalidades (Tabelas, Código, Diagramas e gráficos, LaTeX, Layout, Botões de cópia, Linhas de ferramenta, Rodapé do turno, Texto), uma linha de descrição cada, tiradas da tabela da spec;
- uma subseção `### LaTeX` com os 4 comandos de instalação do `ratex-render` do README do upstream, e a observação de que só funciona em kitty e Ghostty, fora do tmux, com `latex: true`;
- uma subseção `### Configuração` com o JSON de exemplo usando `"pluginConfigs": { "neon-hud@neon-hud": { "options": { "tableStyle": "grid", "clock": "24h" } } }` e a tabela das 12 opções da spec;
- uma subseção `### Junto com o prismantis` dizendo que, se ele estiver instalado, as respostas ficam com ele e o neon-hud mostra só o painel; e que `render: false` desliga o redesenho sem afetar o painel.

Em "Observações", troque "O mod só observa a sessão: nunca bloqueia nem altera prompts ou chamadas de ferramenta." por "O mod nunca bloqueia nem altera prompts ou chamadas de ferramenta e não envia nada ao modelo; ele só muda como a sessão aparece na tela." Acrescente uma linha sobre os programas externos: `osascript`/`copyq` ao clicar em `⧉ html`, e `ratex-render` com `latex` ligado.

- [ ] **Step 3: Verificação ao vivo**

Rode `claude --plugin-dir .` num terminal com pelo menos 144 colunas e peça ao Claude:

> Responda só com: uma tabela de 3 linhas com uma coluna numérica, um bloco ```ts de 12 linhas, um ```mermaid graph LR de 4 nós, um ```mermaid xychart-beta com 4 barras, a fórmula $$\int_0^1 x^2\,dx$$ e um > [!WARNING]. Depois rode `ls` e leia o README.md.

Confira na tela:
1. a tabela tem cabeçalho ciano e números verdes;
2. o código mostra o rótulo `ts`, `[ ⧉ copy ]` e numeração;
3. o diagrama e o gráfico aparecem como arte, lado a lado se couberem;
4. a fórmula aparece como imagem (kitty/Ghostty com `latex: true`) ou como bloco `math` nos demais terminais;
5. as tool rows mostram `Ran ls` e `Read README.md`;
6. o rodapé `✻ … for Xs` tem a duração em verde;
7. o painel NEON//HUD segue atualizando;
8. `/neon-hud copy code` copia o bloco de código.

Tire um print e salve em `docs/render.png`. Se algum item falhar, corrija antes de seguir e cite a correção no commit.

Se o prismantis estiver disponível, instale os dois e confira que as respostas ficam no tema dele, com o painel funcionando.

- [ ] **Step 4: Gates finais e commit**

Run: `claude plugin validate . && claude plugin test . && tsc -p .`

```bash
git add README.md .claude-plugin docs/render.png
git commit -m "v0.6.0: respostas renderizadas em neon (port do prismantis)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```
