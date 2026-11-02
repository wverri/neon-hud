# Faixa de mídia gerada — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Desenhar, sob a linha da ferramenta que gerou ou entregou uma mídia, uma faixa de miniaturas com legenda clicável. A faixa precisa funcionar no Terminal do macOS e no cmd/PowerShell do Windows.

**Architecture:**
- Em `hooks/media.tsx`, código puro: extrair os candidatos de cada chamada, aplicar a regra de "gerou" pela janela de tempo, numerar as mídias, decodificar BMP e montar a árvore da faixa (`Raster` com meio-bloco, ou `Image` no Ghostty/kitty).
- Em `hooks/media-os.ts`, também puro: os argv por sistema (conversor, decodificador de base64, abrir arquivo).
- Em `hooks/register.tsx`, tudo que usa `$`. O `tool.call` mede a janela e guarda a entrada. Os hooks `ToolUse`/`ToolGroup` guardam a entrada. Os hooks `ToolResult`/`ToolGroup` anexam a faixa. Ficam ali também a conversão assíncrona com `invalidate`, o `onPress` e o `/neon-hud open`.

**Tech Stack:** TypeScript/TSX da API de mods do Claude Code (`claude-code`, `claude-code/testing`). Ferramentas do sistema: `sips`, `qlmanage`, `base64`, `certutil`, PowerShell `System.Drawing` e `ffmpeg` (opcional).

**Spec:** `docs/superpowers/specs/2026-11-02-media-strip-design.md`

## Global Constraints

- `$` não atravessa import: toda função que recebe `$` fica em `hooks/register.tsx`. `hooks/media.tsx` e `hooks/media-os.ts` são puros.
- O loader recusa ler `$.noun` como valor e guardar `$` em variável. Passe `$` como argumento a uma função de módulo.
- `hooks/hooks.json` continua `{ "modules": ["./register.tsx"] }`.
- A faixa nunca altera o resultado enviado ao modelo nem atrasa a chamada:
  - o `tool.call` só mede o tempo e devolve `ran` intacto;
  - a conversão roda fora do `tool.call`, sem `await` no caminho da chamada.
- Nenhuma rede. URLs remotas viram só `Link`, sem download.
- Programas externos só com argv (nunca string de shell montada com caminho):
  - conversão: `sips`, `qlmanage`, `ffmpeg`, `magick`, `powershell`;
  - decodificação de base64: `base64`, `certutil`;
  - abrir: `open`, `explorer.exe`, `xdg-open`.
- Timeouts: conversão e decodificação com `timeoutMs: 3000`; abrir com `timeoutMs: 5000`.
- Gravação só em `<TMPDIR>/neon-hud-media-<sessão>/`. `TMPDIR`, ou `TEMP` no Windows, ou `/tmp`.
- Extensões de imagem: `png jpg jpeg gif webp bmp heic tiff`. De vídeo: `mp4 mov webm m4v mkv`. SVG e PDF ficam fora.
- `Read` nunca gera faixa.
- Regra de "gerou":
  - `mtimeMs ∈ [início − 2000, fim + 2000]`;
  - sem janela, só `SendUserFile` e imagem embutida.
- Até 8 itens por faixa (`MAX_ITEMS = 8`); o resto vira `+N`.
- Miniatura:
  - largura `min(16, floor((colunas − 2·(n−1)) / n))`;
  - altura `THUMB_ROWS = 6` (12 pixels);
  - com largura < 6, só legenda empilhada.
- Cores de `C` em `hooks/hud.tsx`: `MEDIA` em `C.cyan` e negrito; contagem, `arquivo removido` e `carregando…` em `C.dim`; legenda em `C.text`.
- Textos visíveis exatos:
  - `MEDIA`, `1 arquivo` / `N arquivos`;
  - legenda `[N] nome.ext`, com `▶ ` antes em vídeo;
  - `[N] nome.ext · arquivo removido` e `carregando…`;
  - `↗ ` antes de URL remota, e `+N` quando passa do limite;
  - `/neon-hud open` lista `[N] nome` das últimas 10;
  - `/neon-hud open N` responde `Abrindo nome.ext` ou `Mídia N não existe nesta sessão.`, e na falha `não consegui abrir: <motivo>`.
- Opção nova `mediaStrip` (boolean, padrão `true`), independente de `render`, `toolRows` e prismantis.
- Gates antes de cada commit: `claude plugin validate . && claude plugin test . && npx -y -p typescript@5.6.3 tsc -p .`.
- Comentários em português sem acento, só onde explicam um porquê.
- **Commits sem nenhum trailer de atribuição** (`Co-Authored-By`, "Generated with…"), por regra global do usuário. O plano anterior tinha um trailer; não copie.
- Trabalho no branch `media-strip`.

## Review Focus

1. **Caminhos com espaço, acento ou entre aspas** (`'/Users/will/Data/Itens Custom/pose-prêmio.png'`, `` `saida final.mp4` ``): devem ser extraídos inteiros. Teste na Task 1.
2. **Caminhos Windows** (`C:\Users\me\out\shot.png`, `.\out\clip.mp4`) na saída do PowerShell: devem ser extraídos e resolvidos contra o cwd. Teste na Task 1.
3. **Resultado com erro** (`isErrored: true`): sem faixa, mesmo que cite mídia. Teste na Task 4.
4. **Conversor lento ou travado**: a primeira renderização não espera, mostra `carregando…` e, se der timeout, fica só legenda. Nunca aparece erro. Teste na Task 4.
5. **Sessão com centenas de prints**: o cache de pixels tem limite (LRU de 64 entradas) e o registro de numeração continua crescendo sem duplicar caminhos. Teste na Task 2.

---

### Task 1: Candidatos e regra de "gerou"

**Files:**
- Create: `hooks/media.tsx`
- Test: `tests/media.test.tsx`

**Interfaces:**
- Produces:
  - `type MediaKind = 'image' | 'video'`
  - `mediaKindOf(path: string): MediaKind | null`. Decide pela extensão, sem diferenciar maiúsculas; `foo.png.bak` dá `null`.
  - `type Candidate =`
    - `{ kind: 'local'; path: string; media: MediaKind; always: boolean }`
    - `| { kind: 'remote'; url: string; media: MediaKind }`
    - `| { kind: 'embedded'; base64: string; ext: 'png' | 'jpg' | 'gif' | 'webp' }`
  - `findCandidates(tool: string, input: unknown, output: unknown, cwd: string, home: string): Candidate[]`. Sem duplicatas, na ordem em que aparecem.
  - `isGenerated(mtimeMs: number, window: { start: number; end: number } | undefined, always: boolean): boolean`

- [ ] **Step 1: Write the failing tests** em `tests/media.test.tsx`:
  - `findCandidates('Read', { file_path: '/a/x.png' }, …)` → `[]`.
  - `findCandidates('SendUserFile', { files: ['/a/1.gif', '/a/2.gif', '/a/3.gif'] }, '3 files delivered', …)` → três `local` com `always: true`, na ordem.
  - Bash com `output: { stdout: 'salvo em /a/x.png\nver https://h/y.mp4' }` → um `local` `/a/x.png` com `always: false` e um `remote` `https://h/y.mp4` com `media: 'video'`.
  - `foo.png.bak` e `/icons/` sem extensão → nada.
  - Review Focus 1: `"'/Users/will/Data/Itens Custom/pose-prêmio.png'"` e `` "`saida final.mp4`" `` → os dois caminhos inteiros. O segundo é relativo e resolve para `<cwd>/saida final.mp4`.
  - Review Focus 2: PowerShell com stdout `C:\Users\me\out\shot.png` e `.\out\clip.mp4`, cwd `C:\proj` → `C:\Users\me\out\shot.png` e `C:\proj\out\clip.mp4`.
  - `~/x.png` com home `/Users/will` → `/Users/will/x.png`.
  - MCP com `output` em forma de blocos `[{ type: 'text', text: 'Successfully captured screenshot (735x387, jpeg)' }, { type: 'image', source: { data: 'AAAA', media_type: 'image/jpeg' } }]` → um `embedded` com `ext: 'jpg'`. Aceite também `{ type: 'image', data, mimeType }`: o formato exato será confirmado ao vivo (Task 6).
  - Write com `input: { file_path: '/a/out.webp' }` → `local` com `always: false`.
  - `isGenerated(10_000, { start: 9_000, end: 9_500 }, false)` → `true` (dentro dos 2000 ms de folga); `isGenerated(5_000, …)` → `false`; `isGenerated(5_000, undefined, false)` → `false`; `isGenerated(5_000, undefined, true)` → `true`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `claude plugin test .`
Expected: FAIL em `tests/media.test.tsx` (`../hooks/media` não existe). O resto continua verde.

- [ ] **Step 3: Implement** `mediaKindOf`, `findCandidates` e `isGenerated` em `hooks/media.tsx`.
  - Texto examinado:
    - `input`: os campos string, `files[]` e `command`;
    - `output`: string, `stdout`/`stderr` e o `text` dos blocos;
    - blocos `image` viram `embedded`.
  - Caminhos entre aspas simples, duplas ou crases valem inteiros. Fora delas, o caminho termina no primeiro espaço.
  - `Read` sempre devolve `[]`.
  - Use um `Set` para descartar caminhos e URLs repetidos.

- [ ] **Step 4: Run tests to verify they pass**

Run: `claude plugin test .`
Expected: os testes novos passam; os anteriores continuam verdes.

- [ ] **Step 5: Commit**

```bash
git add hooks/media.tsx tests/media.test.tsx
git commit -m "Faixa de midia: candidatos e regra de gerou"
```

### Task 2: Registro, BMP, Raster e desenho da faixa

**Files:**
- Modify: `hooks/media.tsx`
- Test: `tests/media.test.tsx`

**Interfaces:**
- Consumes: `MediaKind` (Task 1).
- Produces:
  - `class MediaRegistry`:
    - `claim(key: string, mtimeMs: number): number | null`. Devolve um novo `N` (a partir de 1) na primeira vez e também quando o mtime muda; com a mesma chave e o mesmo mtime, devolve `null`.
    - `claimRemote(url: string): number | null`
    - `get(n: number): { path?: string; url?: string; name: string } | undefined`
    - `recent(k: number): { n: number; name: string }[]`. As mais novas primeiro.
    - `remember(n: number, entry: { path?: string; url?: string; name: string }): void`
  - `type Pixels = { width: number; height: number; rgb: Uint8Array }`
  - `decodeBmp(bytes: Uint8Array): Pixels | null`. 24 ou 32 bits, sem compressão, altura positiva (linhas de baixo para cima) ou negativa; qualquer outra coisa dá `null`.
  - `class PixelCache`: LRU de 64 entradas, com `get(key)`, `set(key, p)` e `size`.
  - `THUMB_ROWS = 6`, `MAX_ITEMS = 8`
  - `thumbColumns(columns: number, count: number): number | null`
  - `rasterCells(p: Pixels, columns: number, rows: number): string`. É o base64 de `columns·rows` triplas u32 LE `[0x2580, fg, bg]`, com amostragem por vizinho mais próximo. A linha de pixels `2r` vai para `fg` e a `2r+1` para `bg`.
  - `toRgba(p: Pixels): string`. Base64 RGBA, com alfa 255.
  - `type MediaItem = { n: number; name: string; media: MediaKind; state: 'ready' | 'loading' | 'missing' | 'nothumb'; path?: string; pngFile?: string; pixels?: Pixels; url?: string }`
  - `drawMediaStrip(el: ElementTable<'terminal'>, items: MediaItem[], columns: number, showImages: boolean, onOpen: (n: number) => void): RenderElement`

- [ ] **Step 1: Write the failing tests:**
  - **Registro:** `claim('/a.png', 1)` → `1`; de novo `('/a.png', 1)` → `null`; `('/a.png', 2)` → `2`; `('/b.png', 1)` → `3`. `recent(2)` → `[{n:3,…},{n:2,…}]`.
  - **Review Focus 5:** 500 `claim` distintos numeram de 1 a 500 sem repetir. `PixelCache` com 100 `set` fica com `size === 64` e perde as primeiras.
  - **BMP:** um BMP 2×2 de 24 bits feito à mão, com linhas de baixo para cima e padding de 2 bytes por linha, decodifica para `rgb` `[vermelho, verde, azul, branco]` na ordem de cima para baixo. Um cabeçalho com `biCompression = 1` dá `null`.
  - **Blocos:** uma matriz 2×4 com `rasterCells(p, 2, 2)` → 2·2·3 u32. A célula (0,0) tem `[0x2580, cor(0,0), cor(0,1)]`.
  - **Largura:** `thumbColumns(100, 1)` → `16`; `thumbColumns(40, 3)` → `12`; `thumbColumns(20, 4)` → `null`.
  - **Desenho**, montando com `$.ui.mount` num componente de teste que chama `drawMediaStrip` (o mesmo jeito dos testes de `drawPasteBand`):
    - item `ready` com `pixels` e `showImages: false` → um `Raster` e um `Button` com `label` `[1] print.png`;
    - `showImages: true` e `pngFile` → `Image` com `source.file`;
    - `showImages: true` sem `pngFile` → `Image` com `source.rgba`;
    - vídeo → label `▶ [3] clipe.mp4`; `missing` → texto `[2] x.png · arquivo removido`, sem `Button`;
    - `loading` → `carregando…`; remoto → texto `↗ ` mais `Link` com `href` igual à URL;
    - 10 itens → 8 desenhados mais `+2`; `columns: 20` com 4 itens → nenhum `Raster`, só as legendas.

- [ ] **Step 2: Run tests to verify they fail**

Run: `claude plugin test .`
Expected: FAIL nos testes novos da Task 2; os da Task 1 continuam verdes.

- [ ] **Step 3: Implement** os tipos e as funções acima em `hooks/media.tsx`.
  - O cabeçalho mostra `MEDIA` mais a contagem, alinhado como o `PASTE` em `paste.tsx`.
  - Cada miniatura é uma coluna: o `Raster` ou `Image` (`key` `media-<N>`) e, embaixo, o `Button` `plain` com `onPress={() => onOpen(n)}`.
  - Os remotos vêm depois, uma linha cada.

- [ ] **Step 4: Run tests to verify they pass**

Run: `claude plugin test .`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add hooks/media.tsx tests/media.test.tsx
git commit -m "Faixa de midia: registro, BMP, raster e desenho"
```

### Task 3: Comandos por sistema

**Files:**
- Create: `hooks/media-os.ts`
- Test: `tests/media.test.tsx`

**Interfaces:**
- Consumes: `MediaKind` (Task 1).
- Produces:
  - `type Platform = 'macos' | 'windows' | 'linux'`
  - `platformOf(env: { OS?: string; HOME?: string; USERPROFILE?: string; OSTYPE?: string }, hasSips: boolean): Platform`. `OS === 'Windows_NT'` dá `windows`; `hasSips` dá `macos`; o resto, `linux`.
  - `thumbSteps(platform: Platform, media: MediaKind, file: string, outDir: string, width: number, height: number, hasFfmpeg: boolean): string[][]`. Os argv a rodar em sequência. O último passo deixa `${outDir}/thumb-<hash>.bmp`, com `width × height` pixels. Pode devolver `[]`: sem conversor possível, fica só a legenda.
  - `thumbBmpPath(outDir: string, file: string, mtimeMs: number): string`. Hash estável (FNV-1a de 32 bits em hex) de `file + mtime`.
  - `decodeSteps(platform: Platform, b64File: string, outFile: string): string[][]`
  - `openArgv(platform: Platform, target: string): string[]`
  - `PS_THUMB`: script PowerShell fixo que lê `$args[0..3]` (in, out, w, h) e grava BMP de 24 bits com `System.Drawing.Bitmap`.

- [ ] **Step 1: Write the failing tests:**
  - **macOS, imagem:** um passo `['sips', '-s', 'format', 'bmp', '-z', '12', '16', '/a/x.png', '--out', bmp]`.
  - **macOS, vídeo:**
    - `['qlmanage', '-t', '-s', '128', '-o', outDir, '/a/v.mp4']`, depois `sips` sobre `${outDir}/v.mp4.png`;
    - com `hasFfmpeg`, um terceiro conjunto alternativo não entra. O fallback é responsabilidade do chamador: documente no JSDoc que a Task 4 tenta `ffmpeg` se o `qlmanage` falhar.
  - **Windows, imagem:** `['powershell', '-NoProfile', '-NonInteractive', '-Command', PS_THUMB, '/a/x.png', bmp, '16', '12']`.
  - **Windows, vídeo:** sem `ffmpeg` → `[]`; com `ffmpeg` → `['ffmpeg', '-y', '-loglevel', 'error', '-i', file, '-frames:v', '1', '-vf', 'scale=16:12', bmp]`.
  - **Linux, imagem:** `['magick', file, '-resize', '16x12!', bmp]`.
  - **Decodificar:** macOS `[['base64', '-D', '-i', inF, '-o', outF]]`; Windows `[['certutil', '-f', '-decode', inF, outF]]`; Linux `[['base64', '-d', '-i', inF]]` não serve porque escreve no stdout. Use `[['sh', '-c', 'base64 -d < "$1" > "$2"', 'sh', inF, outF]]`: o caminho entra como argumento posicional, sem interpolação.
  - **Abrir:** `openArgv('macos', p)` → `['open', p]`; `windows` → `['explorer.exe', p]`; `linux` → `['xdg-open', p]`. URL remota usa o mesmo argv.
  - **Plataforma:** `platformOf({ OS: 'Windows_NT' }, false)` → `windows`; `platformOf({ HOME: '/Users/x' }, true)` → `macos`.
  - **BMP:** `thumbBmpPath` é igual para a mesma entrada e muda com o mtime.

- [ ] **Step 2: Run tests to verify they fail** — `claude plugin test .`, FAIL em `../hooks/media-os`.

- [ ] **Step 3: Implement** em `hooks/media-os.ts`.

- [ ] **Step 4: Run tests to verify they pass** — `claude plugin test .`, PASS.

- [ ] **Step 5: Commit**

```bash
git add hooks/media-os.ts tests/media.test.tsx
git commit -m "Faixa de midia: comandos por sistema"
```

### Task 4: Ligar a faixa nos hooks

**Files:**
- Modify: `hooks/register.tsx`. Mexe no `tool.call` (~linha 538) e nos hooks `ToolUse`/`ToolGroup`/`ToolResult` (~linhas 654–690); o bloco novo fica fora do `if (options.toolRows !== false)` e fora do `if (!rendering) return`.
- Modify: `.claude-plugin/plugin.json`. Opção `mediaStrip` em `userConfig`: `type` boolean, `title` `"Media strip"`, `default` true. `description` exata: `"Mostra miniaturas clicaveis da midia gerada ou entregue (prints, imagens, GIFs, videos) sob a ferramenta que a gerou. Funciona no Terminal do macOS e no Windows com blocos coloridos."`
- Test: `tests/media.test.tsx`

**Interfaces:**
- Consumes: tudo das Tasks 1 a 3.
- Produces:
  - Estado do módulo dentro de `register`:
    - `windows: Map<string, { start: number; end?: number }>`
    - `inputs: Map<string, { tool: string; input: unknown }>`, os dois com limite de 500 (mesmo padrão de `markExpanded`)
    - `registry: MediaRegistry`, `pixels: PixelCache`
    - `items: Map<string, MediaItem[]>`, por `tool_use_id`, para que um redesenho não repita o `claim`
  - `mediaFor($, toolUseId: string, tool: string, input: unknown, output: unknown, isErrored: boolean): Promise<MediaItem[]>`
  - `openMedia($, n: number): Promise<string>`. Devolve o texto da resposta.

Ligações a fazer:

- **`tool.call`:** antes do `next(e)`, grava `windows.set(id, { start: await $.clock.now() })` e `inputs.set(id, { tool: e.tool, input: e.input })`. Depois do `next(e)`, completa `end`. Envolva os dois em try/catch e devolva `ran` intacto em qualquer caso.
- **`ToolUse` e `ToolGroup`:** gravam `inputs` a partir de `e.props.input` e de `e.props.calls[].input`, também quando o prismantis está ativo. Hoje esses hooks só existem com `toolRows`; registre um gravador próprio, que chama `next(e)` e não desenha nada, quando `toolRows` estiver desligado ou o prismantis ativo.
- **`ToolResult`:**
  - calcula `const strip = await mediaFor(...)`;
  - com itens, devolve `<Box flexDirection="column">{desenhoAtual}{drawMediaStrip(...)}</Box>`, em que `desenhoAtual` é o que o hook já desenharia (`renderShellResult`, `<el.Box />` do quiet, `next(e)` etc.);
  - sem itens, comportamento idêntico ao de hoje.
- **`ToolGroup` recolhido:** junta os itens das chamadas do grupo numa faixa só, sob `renderToolGroup`.
- **Dentro de `mediaFor`:**
  - `isErrored` → `[]`;
  - local → `$.fs.stat`, `isGenerated`, depois `registry.claim(path, mtime)`;
  - embedded → `claim('embedded:' + id + ':' + i, 0)`, grava `<dir>/emb-<N>.b64` com `$.fs.write`, roda `decodeSteps` para `<dir>/emb-<N>.<ext>` e trata o resultado como local `always`;
  - remoto → `claimRemote`.
- **Conversão:** fica numa fila por módulo, iniciada com `$.clock.after(0, …)`. Ela roda `thumbSteps` com `$.process.run(argv, { timeoutMs: 3000 })`, lê o BMP com `$.fs.read(…, { as: 'bytes' })`, usa `decodeBmp`, guarda em `pixels` e chama `$.ui.invalidate('ui.render')`. Se algum passo falhar, `state: 'nothumb'`.
  - No macOS, vídeo: se o `qlmanage` falhar e houver `ffmpeg` (`$.fs.stat` em `/opt/homebrew/bin/ffmpeg` ou `/usr/local/bin/ffmpeg`, ou `which ffmpeg` uma vez por sessão), tenta os passos `ffmpeg` da plataforma `windows`/`linux`.
- **Ghostty/kitty:** com `showsImages($)`, um PNG local usa `pngFile` direto e dispensa a conversão.
- **`onPress`:** chama `openMedia($, n)` e mostra `$.ui.toast` só em caso de falha.

- [ ] **Step 1: Write the failing tests**, montando `ToolUse` + `ToolResult` como em `tests/features.test.tsx:190-200`, com `fs.stat`, `fs.read`, `fs.write`, `process.run`, `env` e `session.id` simulados:
  - **Print do Chrome:** `ToolResult` de `mcp__claude-in-chrome__computer` com bloco `image` JPEG.
    - Na primeira renderização: `carregando…` e um `fs.write` de `.b64`.
    - Depois do `process.run` simulado (`base64 -D` e `sips`, este gravando um BMP 16×12 fixo que o `fs.read` devolve), a segunda renderização tem `Raster` e `Button` `[1] …jpg`.
  - **`SendUserFile`:** três GIFs → três `Button`, de `[1]` a `[3]`.
  - **Bash:** `stdout` com `/a/novo.png` (mtime dentro da janela) e `/a/velho.png` (mtime antigo) → só `[1] novo.png`. Para a janela existir, dispare `tool.call` pelo kit, ou injete `inputs`/`windows` chamando antes o hook do `ToolUse`. Se o kit não disparar `tool.call`, o teste cobre o caso "sem janela": nenhum item. Registre essa limitação no teste.
  - **`Read` de imagem:** nenhuma faixa.
  - **Review Focus 3:** `isErrored: true` com `/a/novo.png` → sem faixa.
  - **Review Focus 4:** `process.run` responde `{ deny: 'Process timed out' }` → legenda sem `Raster`, sem exceção, e o resultado original continua desenhado.
  - **Ghostty:** com `TERM_PROGRAM=ghostty`, PNG local → `Image` com `source.file`, sem `process.run`.
  - **Opção desligada:** `{ options: { mediaStrip: false } }` → desenho idêntico ao de hoje.
  - **Resultado inalterado:** a faixa não remove o desenho original; o `Text` do resultado continua presente.

- [ ] **Step 2: Run tests to verify they fail** — `claude plugin test .`, FAIL nos testes da Task 4.

- [ ] **Step 3: Implement** as ligações acima em `hooks/register.tsx` e a opção em `plugin.json`.

- [ ] **Step 4: Run all gates**

Run: `claude plugin validate . && claude plugin test . && npx -y -p typescript@5.6.3 tsc -p .`
Expected: tudo verde.

- [ ] **Step 5: Commit**

```bash
git add hooks/register.tsx .claude-plugin/plugin.json tests/media.test.tsx
git commit -m "Faixa de midia sob as ferramentas (mediaStrip)"
```

### Task 5: `/neon-hud open`

**Files:**
- Modify: `hooks/register.tsx` (`command.run` do `neon-hud`, ~linha 693)
- Test: `tests/media.test.tsx`

**Interfaces:**
- Consumes: `openMedia` e `registry` (Task 4), `openArgv` e `platformOf` (Task 3).

- [ ] **Step 1: Write the failing tests:**
  - depois de uma faixa com `[1]` e `[2]`, `/neon-hud open 2` → `process.run` com `['open', '/a/2.png']` (macOS simulado: `fs.stat('/usr/bin/sips')` existe) e resposta `Abrindo 2.png`;
  - com `env OS=Windows_NT` → `['explorer.exe', …]`;
  - `/neon-hud open 9` → `Mídia 9 não existe nesta sessão.`;
  - `/neon-hud open` sem número → linhas `[2] 2.png` e `[1] 1.png`;
  - `process.run` com `exitCode` 1 e stderr `boom` → `não consegui abrir: boom`;
  - `/neon-hud copy` continua funcionando.
  - A mensagem de uso passa a ser `Uso: /neon-hud copy [code] | open [N]`.

- [ ] **Step 2: Run** `claude plugin test .` — FAIL.
- [ ] **Step 3: Implement** o subcomando `open` no handler existente.
- [ ] **Step 4: Run all gates** (os mesmos da Task 4) — verde.
- [ ] **Step 5: Commit**

```bash
git add hooks/register.tsx tests/media.test.tsx
git commit -m "Faixa de midia: /neon-hud open"
```

### Task 6: Verificação ao vivo, README e versão

**Files:**
- Modify: `README.md` e `README.en.md`:
  - nova seção "Mídia gerada" / "Generated media" depois de "Respostas renderizadas";
  - linha `mediaStrip` na tabela de opções;
  - `/neon-hud open [N]` na seção de comandos;
  - as dependências opcionais: `ffmpeg` para vídeo no Windows e no Linux, e `magick` no Linux.
- Modify: `.claude-plugin/plugin.json` (`version` `0.8.0`, keyword `media`) e `.claude-plugin/marketplace.json`, se ele repetir a versão.
- Modify: `hooks/register.tsx` / `hooks/media.tsx`, só se a verificação mostrar um formato diferente do esperado.

- [ ] **Step 1: Verificação ao vivo no Terminal do macOS**, com `claude --plugin-dir .`, seguindo os passos 1 a 6 de "Verificação ao vivo" na spec:
  - Chrome;
  - PNG + MP4 via Bash (`ffmpeg -f lavfi -i testsrc=size=320x240:rate=1 -frames:v 1 /tmp/t.png` e `-t 2 /tmp/t.mp4`);
  - `SendUserFile` de dois GIFs;
  - clique abre o Preview;
  - `/neon-hud open 1`;
  - `Read` sem faixa.

  Anote as três respostas abertas da spec:
  - o formato do bloco `image` no `output`;
  - se o `SendUserFile` desenha `ToolResult` (se não desenhar, aplique o fallback da spec: faixa sob o `ToolUse`, com teste);
  - se o clique chega.
- [ ] **Step 2: Repita** os passos 2, 4 e 5 no Ghostty.
- [ ] **Step 3: Atualize** os READMEs, a versão e o marketplace.
- [ ] **Step 4: Run all gates** — verde.
- [ ] **Step 5: Commit**

```bash
git add README.md README.en.md .claude-plugin/plugin.json .claude-plugin/marketplace.json hooks tests
git commit -m "v0.8.0: faixa de midia gerada sob as ferramentas"
```
