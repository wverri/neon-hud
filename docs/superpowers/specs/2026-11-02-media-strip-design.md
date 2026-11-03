# Faixa de mídia gerada

Data: 2026-11-02

## Objetivo

Quando o agente gera ou entrega uma mídia (print do navegador, imagem gerada, GIF, vídeo), o app do Claude mostra o anexo, mas o terminal deixa ele escondido dentro da linha recolhida da ferramenta. Hoje o usuário precisa ir até a pasta temporária ou abrir o app para ver o arquivo. O neon-hud passa a desenhar uma **faixa de miniaturas clicáveis logo abaixo da linha da ferramenta que gerou a mídia**, na ordem do chat.

O usuário trabalha principalmente no **Terminal do macOS** e no **cmd/PowerShell do Windows**, onde o Claude Code não desenha imagens. A faixa precisa funcionar nesses terminais. Ghostty e kitty são um bônus.

### Critérios de sucesso

- Num print do Chrome, a miniatura aparece sob a linha da chamada, no Terminal do macOS e no Windows Terminal/PowerShell.
- Num `SendUserFile` com três GIFs, aparecem três miniaturas sob a linha.
- Um script que salva `saida.mp4` via Bash produz um item de vídeo sob a linha do Bash.
- Clicar na miniatura, ou rodar `/neon-hud open N`, abre o arquivo no app padrão do sistema.
- Uma imagem que o agente só **leu** (`Read` em referência do usuário) não gera faixa.
- Um `ls` que lista ícones antigos não gera faixa.
- Nada disso bloqueia, atrasa ou altera a chamada da ferramenta nem o resultado enviado ao modelo.

### Fora do escopo (decidido pelo usuário)

- Galeria das mídias da sessão. Clicar abre só o arquivo.
- Imagens que o agente apenas leu (`Read` de imagem).
- Baixar URLs remotas. Mídia remota (Higgsfield, CDN do Discord) vira só um link clicável, sem miniatura.

### Fora do escopo (decisão minha)

- Prévia ampliada ao passar o mouse.
- GIF animado nos blocos: só o primeiro quadro.
- Vídeo tocando: só o primeiro quadro como miniatura.

## Prior art

Já existem mods com ideia parecida, todos MIT:

- [diegomarty/inline-images](https://github.com/diegomarty/inline-images): blocos coloridos em terminais sem protocolo de imagem e abertura de arquivo no Windows via PowerShell/`explorer`.
- [kbrianps/claude-inline-images](https://github.com/kbrianps/claude-inline-images): cobre `SendUserFile`.
- [gdyan2022/claude-code-image-view](https://github.com/gdyan2022/claude-code-image-view): cobre prints de MCP.

Nenhum cobre todas as fontes acima. Usá-los junto com o neon-hud brigaria pelas mesmas linhas de ferramenta, que o neon-hud já redesenha. A escolha é implementar no neon-hud. Se algum trecho do diegomarty for copiado, o crédito vai para o `docs/THIRD_PARTY_NOTICES.md`.

## O que entra na faixa

Cada resultado de ferramenta (`ToolResult`, e cada chamada dentro de um `ToolGroup`) é examinado. Os candidatos vêm destas fontes:

| Fonte | Como reconhecer | Regra de "gerou" |
| --- | --- | --- |
| `SendUserFile` | `input.files[]` | sempre entra: é uma entrega explícita |
| Prints do Chrome (`mcp__claude-in-chrome__computer`, `…__browser_batch`) e outros MCP com imagem | bloco `image` (base64, em geral JPEG) dentro de `output`. Nos transcripts do usuário, só 29 de 437 prints traziam também um caminho `.png` no texto. | sempre entra: a imagem nasceu na chamada |
| Bash / PowerShell | caminhos de mídia na saída e no comando | mtime dentro da janela da chamada |
| Write / Edit e outras ferramentas | caminhos de mídia na entrada (`file_path` etc.) | mtime dentro da janela da chamada |
| URLs `http(s)` de mídia em qualquer resultado | regex de URL terminando em extensão de mídia | entra como **link**, sem miniatura e sem download |

- **Extensões de mídia:** imagem `png jpg jpeg gif webp bmp heic tiff`; vídeo `mp4 mov webm m4v mkv`. SVG e PDF ficam fora nesta versão (decisão minha).
- **`Read` nunca entra**, nem quando o arquivo é imagem.
- **Entrada da chamada:** as props de `ToolResult` não trazem `input` (só `tool_use_id`, `tool`, `output`, `isErrored`, `onScreen`). A entrada vem de duas fontes, guardadas por `tool_use_id` num mapa do módulo: o hook `tool.call`, nas chamadas ao vivo, e as props de `ToolUse` e `ToolGroupCall`, que têm `input` e também cobrem sessão retomada. Na `ToolGroup`, entrada e saída já chegam juntas em cada `ToolGroupCall`.
- **Janela da chamada:** o hook `tool.call` registra o instante de início antes de chamar `next` e o de fim depois, por `tool_use_id`. Um arquivo local "foi gerado" se `mtimeMs ∈ [início − 2 s, fim + 2 s]`. Sem janela (sessão retomada, chamada anterior ao carregamento do mod), só entram as fontes que são geradas por natureza: `SendUserFile` e imagens embutidas no resultado. Caminhos soltos ficam de fora.
- **Imagem embutida (base64):** o neon-hud não grava bytes direto (`$.fs.write` só grava texto). Por isso grava o base64 num `.b64` em `<TMPDIR>/neon-hud-media-<sessão>/` e decodifica para `.jpg`/`.png` com uma ferramenta do sistema:
  - macOS: `base64 -D -i <in> -o <out>`;
  - Windows: `certutil -decode <in> <out>`.

  Esse arquivo é o que a miniatura usa e o que o clique abre. Se a imagem já trouxer o caminho `.png` no texto, usa o caminho direto. Decisão minha.
- **Caminhos relativos** resolvem contra o cwd da sessão. `~` expande para o home.
- **Deduplicação:** o mesmo caminho aparece só na primeira faixa da sessão que o cita, exceto quando o mtime mudou desde então (arquivo regravado).
- **Limite:** no máximo 8 itens por faixa. Passando disso, aparece `+N` no fim, e `/neon-hud open` continua aceitando todos.

## Desenho da faixa

Fica abaixo da linha da ferramenta, no mesmo recuo das linhas de ferramenta do neon-hud e na paleta dele.

```
  ✓ Ran python gerar.py
    ┊ MEDIA  3 arquivos
    ┊ ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀  ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀  ▶ ▀▀▀▀▀▀▀▀▀▀▀▀▀▀
    ┊ ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀  ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀  ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀
    ┊ [1] print.png      [2] icone.gif      [3] clipe.mp4
    ┊ ↗ https://cdn…/gerado.png
```

- **Rótulo:** `MEDIA` em ciano neon, mais a contagem em cinza (`C.dim`).
- **Miniatura:** largura `min(16, floor((colunas − 2·(n−1)) / n))` colunas e altura de 6 linhas (12 pixels de altura com meio-bloco). Se a largura ficar abaixo de 6, cai para a forma só de legenda, empilhada.
- **Legenda e clique:** a legenda é um `Button` `plain` com `label` `[N] nome.ext`, truncado. O `onPress` abre o arquivo (ver "Abrir"). `N` é o número global da mídia na sessão, o mesmo que `/neon-hud open N` usa.
  - Um `Button` só aceita texto. Por isso a miniatura fica fora dele, logo acima, e não recebe clique.
  - O clique de mouse só chega no layout fullscreen. O usuário usa `"tui": "fullscreen"` no `~/.claude/settings.json`, conferido. No modo de tela principal, sobra `/neon-hud open N`.
  - Arquivos locais **não** usam `Link`: num terminal sem OSC 8 ele desenha a URL `file://` inteira depois do texto e quebraria as colunas.
- **Vídeo:** prefixo `▶` na legenda. A miniatura é o primeiro quadro quando der para extrair; se não der, aparece uma caixa de 6 linhas com `▶ vídeo` e o tamanho.
- **Arquivo sumiu** (pasta temporária limpa): `[N] nome.ext · arquivo removido`, em cinza, sem miniatura e sem clique.
- **Links remotos:** uma linha por URL, `↗` mais o `Link`, truncado.

### Como os pixels chegam

- **Ghostty/kitty fora do tmux** (o `showsImages` que já existe):
  - PNG: `Image` com `source: { file, format: 'png' }`, como na prévia colada.
  - Outros formatos: `Image` com `source: { rgba, width, height }`, a partir da matriz decodificada abaixo. O `{ file }` só aceita PNG.
- **Demais terminais** (Terminal do macOS, Windows Terminal, conhost, VS Code, tmux): o `Image` só desenharia o `alt`. Por isso o neon-hud desenha os blocos ele mesmo com `Raster`, a grade de células da API. Cada célula vira um `▀` (`0x2580`) com cor de frente = pixel de cima e cor de fundo = pixel de baixo, empacotada como `[codePoint, fg, bg]` em u32. A paleta do Raster reduz as cores quando precisa.

A matriz de pixels (`largura × 2·altura`, RGB) sai de um conversor do sistema, rodado com `$.process.run` com timeout de 3 s:

| Sistema | Imagem | Vídeo (1º quadro) |
| --- | --- | --- |
| macOS | `sips -s format bmp -z H W <arq> --out <tmp>.bmp` | `qlmanage -t -s 128 -o <tmp> <arq>` → PNG → `sips` como imagem; se falhar, `ffmpeg` se existir |
| Windows | PowerShell + `System.Drawing` (`Bitmap` redimensionado, gravado como BMP de 24 bits) | `ffmpeg -frames:v 1` se existir; senão, a caixa `▶ vídeo` |
| Linux | `magick`/`convert` se existir | `ffmpeg` se existir |

- O neon-hud lê o BMP com `$.fs.read(…, { as: 'bytes' })` e decodifica num parser puro de BMP (24/32 bits, sem compressão, linhas de baixo para cima), em `hooks/media.tsx`.
- **Cache:** a matriz fica em memória por `caminho + mtime + tamanho alvo`. Os arquivos convertidos vão para `<TMPDIR>/neon-hud-media-<sessão>/`.
- **Assíncrono:** a primeira renderização mostra a legenda com `carregando…` no lugar da miniatura. Quando a conversão termina, `$.ui.invalidate('ui.render')`. A conversão nunca roda dentro do caminho crítico de uma chamada de ferramenta.
- **Conversor ausente ou com falha:** só legenda, sem erro visível.

## Abrir

`openMedia(path)`:

- macOS: `open <path>`.
- Windows (nativo, cmd/PowerShell, sem WSL, como o usuário descreveu): `explorer.exe <path>`, com o caminho como argumento. Nada de `cmd /c start`, que passaria o caminho de novo por um shell.
- Linux: `xdg-open <path>`.

O sistema é detectado pelo que o ambiente já entrega: `$.env` (`OS=Windows_NT`, `HOME` × `USERPROFILE`) ou o separador do cwd. Decisão de detalhe fica com quem implementar.

## Comando

`/neon-hud open N` abre a mídia `N` da sessão. `/neon-hud open` sem número lista as últimas 10 mídias, com número e nome. A numeração vive num registro do módulo por sessão (`N → caminho`), preenchido na ordem em que as faixas aparecem pela primeira vez. Mídias remotas recebem número também, e `open` passa a URL para o mesmo comando de sistema.

## Encaixe no código

```
hooks/
  media.tsx     puro: extrair candidatos de um ToolResult, regra de janela, parser BMP,
                tamanho da miniatura, árvore da faixa (blocos e Image)
  register.tsx  tool.call (janela), ToolResult/ToolGroup (anexa a faixa sob o resultado),
                conversão via $.process.run, openMedia, subcomando /neon-hud open
```

- `media.tsx` não usa `$`, seguindo a regra do projeto, como o `paste.tsx`.
- **Posição:** a faixa é anexada ao que o hook de `ToolResult` já desenha (`renderShellResult`, `next(e)` etc.), numa `Box` em coluna, com o resultado em cima e a faixa embaixo. A entrada vem do mapa por `tool_use_id`. Na `ToolGroup` recolhida ("Ran 3 commands"), as faixas das chamadas do grupo se juntam numa só, sob a linha do grupo.
- **Fallback de posição:** se a verificação ao vivo mostrar que uma ferramenta (o `SendUserFile` é a suspeita) não desenha `ToolResult` no terminal, a faixa dela vai sob a linha do `ToolUse`, que tem entrada e, depois de terminar, saída.
- **Modo `quiet`:** hoje um resultado de leitura vira `<el.Box />`. Se ele tiver mídia, a faixa aparece mesmo assim (a regra do `Read` já impede a maioria desses casos).
- **Prismantis ativo ou `toolRows: false`:** a faixa ainda aparece, envolvendo `next(e)`. Ela não depende do renderizador.
- **Expandido (ctrl+o):** a faixa aparece também, sob a saída completa.

## Configuração

| Opção | Valores | Padrão | O que faz |
| --- | --- | --- | --- |
| `mediaStrip` | `true`, `false` | `true` | Mostra miniaturas clicáveis da mídia gerada ou entregue, sob a ferramenta que a gerou. |

## Efeitos colaterais

- `stat` em caminhos citados nos resultados. Leitura de bytes só dos BMPs convertidos pelo próprio mod.
- Programas externos: `sips`, `qlmanage`, `ffmpeg`, `magick`, `powershell`, `open`/`explorer`/`xdg-open`, só com caminhos como argumentos.
- Gravação só em `<TMPDIR>/neon-hud-media-<sessão>/`.
- Nenhuma rede. Nada enviado ao modelo. O resultado da ferramenta não é alterado.

## Tratamento de erros

- O hook `tool.call` só mede o tempo: devolve `next(e)` intacto, inclusive quando dá exceção.
- Qualquer exceção ao montar a faixa leva ao desenho original, sem faixa.
- Falha de conversão: só legenda. Falha ao abrir: aviso curto (`não consegui abrir: <motivo>`) na resposta do comando, ou nada quando o clique foi por botão.

## Testes

Em `tests/media.test.tsx`, com `fs`, `process` e `env` simulados:

- **Extração:** saída de Bash com `/a/x.png` e `https://h/y.mp4` dá um local e um remoto. Texto com `foo.png.bak` não dá nada.
- **Janela:** arquivo com mtime dentro da janela entra; fora, não; sem janela, só `SendUserFile` e imagem embutida.
- **Imagem embutida:** um `output` de MCP com bloco `image` JPEG grava o `.b64`, chama o decodificador do sistema e usa o arquivo resultante.
- **`Read`:** nunca gera faixa.
- **`SendUserFile`:** três arquivos geram três itens na ordem.
- **Deduplicação:** o mesmo caminho em duas chamadas aparece só na primeira, a menos que o mtime mude.
- **BMP:** um BMP 2×2 de 24 bits feito à mão decodifica para as cores certas, incluindo o padding de linha e a ordem de baixo para cima.
- **Blocos:** uma matriz 2×4 vira um `Raster` de 2 colunas × 2 linhas de `▀` com frente e fundo certos nas células.
- **Terminal com imagem:** com `TERM_PROGRAM=ghostty`, um PNG usa `Image` com `source.file`.
- **Conversor falhou:** só legenda, sem exceção.
- **Arquivo sumiu:** legenda `arquivo removido`.
- **Comando:** `/neon-hud open 2` chama `open` (macOS) ou `explorer.exe` (Windows) com o caminho certo. Número inexistente dá mensagem de erro.
- **Opção desligada:** `mediaStrip: false` não muda nada.

## Verificação ao vivo

Rodar `claude --plugin-dir .` no Terminal do macOS e testar:

1. Tirar um print com o Chrome e conferir a miniatura sob a linha.
2. Gerar um PNG e um MP4 com Bash (`ffmpeg -f lavfi -i testsrc …`) e conferir as duas miniaturas.
3. Pedir um `SendUserFile` de dois GIFs.
4. Clicar numa miniatura e conferir que o Preview abre.
5. Rodar `/neon-hud open 1`.
6. Pedir um `Read` de uma imagem existente e conferir que não aparece faixa.

Depois, repetir os passos 2, 4 e 5 no Ghostty e, se houver máquina disponível, no Windows Terminal.

A verificação ao vivo também responde três perguntas que os tipos não respondem:

- se o `Button` recebe clique de mouse no Terminal do macOS em fullscreen;
- como o bloco `image` dos prints do Chrome aparece em `ToolResult.output`;
- se o `SendUserFile` desenha um `ToolResult` no terminal.

## Entrega

- Versão 0.8.0.
- README em português e em inglês: nova seção, a opção `mediaStrip`, o comando `/neon-hud open` e as dependências opcionais (`ffmpeg` no Windows para vídeo).
