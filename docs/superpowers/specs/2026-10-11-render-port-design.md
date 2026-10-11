# Port do renderizador do prismantis para o neon-hud

Data: 2026-10-11
Origem: [NahumLitvin/prismantis](https://github.com/NahumLitvin/prismantis) v0.15.1 (MIT)

## Objetivo

Trazer para o neon-hud o redesenho das respostas do Claude Code feito pelo prismantis, com a identidade visual neon do HUD, num plugin único. O usuário instala só o neon-hud e ganha o painel e as respostas renderizadas.

### Funcionalidades incluídas

| Funcionalidade | O que entra |
| --- | --- |
| Tables | cabeçalho colorido, réguas, alinhamento `:---:`/`---:`, números coloridos, colunas que encolhem para caber; `tableStyle` = `box` (padrão), `rules`, `grid`, `minimal` |
| Code | cabeçalho com linguagem e botão de copiar, Prism nas 24 linguagens do prismantis, shell colorido como prompt, numeração e dobra de blocos longos |
| Diagrams and charts | blocos `mermaid`: flowchart, sequence, state, class, ER, `xychart-beta`; fallback para código quando largo demais ou acima de 80 linhas; `mermaidAscii` |
| LaTeX math | `$$…$$` e ` ```math ` como imagem via `ratex-render` em kitty e Ghostty, fora do tmux; texto nos demais casos; `$…$` inline em itálico com símbolos comuns |
| Layout | tabelas e diagramas consecutivos lado a lado, quebrando quando falta largura |
| Copy buttons | `⧉ md`, `⧉ art`, `⧉ html` em tabelas; `[ ⧉ copy ]` em código, listas e quotes; `⧉ source`/`⧉ art` em diagramas; `⧉ copy reply`; `/neon-hud copy` e `/neon-hud copy code` |
| Tool rows | uma linha por chamada (`Ran …`, `Read …`, `Edited …`) com ponto de status; grupos resumidos (`Ran 3 commands, read 2 files · last: …`); diff cards; `toolStyle` = `chat` (padrão), `tree-dim`, `tree-bold`, `classic`; `toolOutput` = `full` (padrão), `quiet` |
| Turn footer | `✻ Baked for 6m 20s` com a duração em cor de número; `clock` = `off` (padrão), `24h`, `12h` acrescenta a hora de término |
| Text | negrito, itálico, tachado, código inline, links e URLs clicáveis, números/versões/durações/tamanhos/percentuais e caminhos com cor própria, notas de rodapé |

### Fora do escopo

Sistema de 16 temas e overrides `<token>Color`; opções `headingStyle` e `taskStyle`; prompts do usuário em bolha/barra/chevron (e o `clock` neles); RTL; redesenho da saída de slash commands; diagram hints enviadas ao modelo; API `$.prismantis.markdown` para outros mods; `/prismantis setup`, `demo` e tela de help.

Headings, listas, task lists, quotes e GitHub alerts **continuam sendo desenhados**, porque o mod assume a resposta inteira; usam um estilo fixo (o padrão do prismantis: `banner` para headings, `checks` para tarefas).

## Abordagem

Copiar os módulos puros do prismantis e enxugá-los (abordagem A). A licença MIT é respeitada com o aviso de copyright do prismantis e dos dois vendors em `docs/THIRD_PARTY_NOTICES.md`. A sincronização com o upstream é manual; o commit de origem fica registrado no aviso.

## Arquitetura

```
hooks/
  register.tsx        único arquivo que usa $: hooks do HUD + hooks do renderizador
  hud.tsx             lógica pura do painel (formatação, atoms, árvore do Pane) extraída do register atual
  render/
    palette.ts        paleta neon fixa → tokens do renderizador
    style.ts          resolveStyle(options) só com as opções mantidas
    markdown.ts       parser (do prismantis)
    render.tsx        desenho dos blocos, tool rows, turn footer (do prismantis, sem RTL e sem prompts)
    mermaid.tsx       mermaid → texto colorido
    latex.ts          LaTeX via ratex-render
    clipboard.ts      backend do ⧉ html (osascript / CopyQ)
    html.ts           tabela → HTML para o clipboard
    clock.ts          hora do fim do turno
    vendor/           prism.js e mermaid-text.js, cópia dos artefatos gerados pelo prismantis
```

Restrição da API de mods: `$` não atravessa import. Toda função que recebe `$` fica em `register.tsx`; os demais arquivos são puros. `hooks/hooks.json` continua com `{ "modules": ["./register.tsx"] }`.

A extração de `hud.tsx` é feita antes do port, sem mudar comportamento, e é coberta pelos testes atuais do HUD.

## Hooks novos

| Hook | Papel |
| --- | --- |
| `ui.render` `AssistantMessage` | parse + `renderBlocks`; copy buttons; LaTeX; layout |
| `ui.render` `ToolUse`, `ToolResult`, `ToolGroup` | tool rows, grupos, diff cards, `toolOutput: quiet` |
| `ui.render` `TurnDuration` | turn footer, com hora quando `clock` ≠ `off` |
| `turn.complete` | registra a hora de término para o `clock` (ao lado do hook já existente do HUD, no mesmo handler) |
| `session.start` | detecção do backend de clipboard e teste do `ratex-render` quando `latex` está ligado (junto ao handler atual do HUD) |
| `command.run` `neon-hud` | `copy` e `copy code` |

`/hud` continua igual. Os hooks que o HUD já registra (`session.start`, `turn.complete`) ganham a lógica nova no mesmo handler, sem registrar duas vezes.

### Coexistência com o prismantis

Se o prismantis estiver instalado, ele e o neon-hud disputariam os mesmos `ui.render`. O neon-hud detecta a presença do noun `$.prismantis` e, quando ele existe, chama `next(e)` em todos os hooks de renderização, deixando o prismantis desenhar. O HUD não é afetado. Se a detecção não for possível pela API, a alternativa é documentar no README que os dois não devem ficar ativos juntos e a opção `render: false` resolve.

## Paleta neon

Derivada de `C` do HUD:

| Token | Cor |
| --- | --- |
| accent, heading | `#00e5ff` (ciano) |
| strong, codeFlag | `#ff3ea5` (rosa) |
| emphasis, link, codeCommand | `#a77bff` (violeta) |
| number, codeString | `#3dff9a` (verde) |
| path, inlineCode | `#ffcc33` (âmbar) |
| codeText, quote, diagramText | `#c9d4f2` (texto) |
| codeComment, bullet | `#66708f` (dim) |
| rule, tableRule, diagram | `#343c5c` (linha) |
| tableHeader | `#00e5ff` (ciano) |

Os alerts mantêm as cores semânticas do prismantis. O teste de contraste do prismantis é portado para garantir legibilidade sobre fundo escuro.

## Configuração

Em `userConfig` do `plugin.json`:

| Opção | Valores | Padrão |
| --- | --- | --- |
| `render` | `true`, `false` | `true` (desliga todo o redesenho; o HUD continua) |
| `tableStyle` | `box`, `rules`, `grid`, `minimal` | `box` |
| `toolRows` | `true`, `false` | `true` |
| `toolStyle` | `chat`, `tree-dim`, `tree-bold`, `classic` | `chat` |
| `toolOutput` | `full`, `quiet` | `full` |
| `copyButtons` | `true`, `false` | `true` |
| `mermaid` | `true`, `false` | `true` |
| `mermaidAscii` | `true`, `false` | `false` |
| `latex` | `true`, `false` | `false` |
| `clock` | `off`, `24h`, `12h` | `off` |
| `highlightNumbers` | `true`, `false` | `true` |
| `highlightPaths` | `true`, `false` | `true` |

## Efeitos colaterais

Sem rede. Programas externos: `osascript` (macOS) ou `copyq` (Linux) só ao clicar em `⧉ html`, com timeout de 5 s; `ratex-render` só com `latex` ligado. O mod continua sem enviar nada ao modelo.

## Tratamento de erros

Mantém o comportamento do prismantis: qualquer exceção ao desenhar uma resposta cai para `next(e)` (render nativo do Claude Code); diagramas inválidos ou largos voltam a ser código com uma nota; LaTeX que falha vira bloco `math`; árvores perto do limite de 20.000 nós do Claude Code continuam limitadas como no original.

## Testes

- Testes atuais do HUD seguem passando após a extração de `hud.tsx`.
- Portar de `tests/` do prismantis os que cobrem funcionalidades mantidas: `render`, `features`, `latex`, `clipboard`, `caches`, `contrast`, e a parte de `regressions` que não trata de RTL, temas, prompts, help ou hints. Ajustar nomes (`prismantis` → `neon-hud`) e cores esperadas.
- Gates: `claude plugin validate .`, `claude plugin test .`, `tsc -p .`.
- Verificação visual numa sessão real com um texto de amostra contendo tabela, código, mermaid, LaTeX e tool calls.

## Entrega

- README em português: nova seção "Respostas renderizadas" com as funcionalidades e opções, crédito ao prismantis.
- `docs/THIRD_PARTY_NOTICES.md` com prismantis, beautiful-mermaid e Prism.
- Versão 0.6.0 em `plugin.json` e `marketplace.json`; descrição do plugin atualizada.
