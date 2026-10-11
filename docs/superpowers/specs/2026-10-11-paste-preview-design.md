# Prévia de imagem colada

Data: 2026-10-11

## Objetivo

Quando o usuário cola uma imagem no prompt do Claude Code, o rascunho mostra só `[Image #N]`. Ele não tem como confirmar que colou a imagem certa antes de enviar. O neon-hud passa a mostrar uma miniatura de cada imagem colada na faixa acima do prompt, enquanto ela está no rascunho.

### Critérios de sucesso

- Ao colar uma imagem, a miniatura aparece acima do prompt antes do envio.
- Com várias imagens coladas, aparece uma miniatura por `[Image #N]` presente no rascunho, na ordem dos números.
- Apagar `[Image #N]` do rascunho tira a miniatura dela. Enviar o prompt limpa a faixa.
- Nada do que a prévia faz bloqueia, altera ou atrasa o prompt, nem afeta o painel ou o renderizador.

### Fora do escopo

- Prévia depois do envio, na linha da mensagem do usuário no transcript.
- Prévia dentro do painel NEON//HUD.
- Prévia de outros anexos (áudio, documentos).
- Redimensionar ou recodificar a imagem no mod: o terminal escala.
- Dimensões em pixels na legenda.

## Abordagem

A API de mods não entrega os bytes de uma imagem antes do envio: o rascunho (`PromptBox`) só tem texto, e `prompt.submit` traz só o tipo e o MIME dos anexos. Mas o Claude Code grava cada imagem colada em disco no momento da colagem:

```
<base>/claude-<uid>/<projeto>/<id da sessão>/images/<N>.png
```

Por exemplo, `/private/tmp/claude-501/-Users-will-Github-neon-hud/<sessão>/images/1.png`. O mod lê o número `N` do rascunho e desenha esse arquivo com o elemento `Image`, que o terminal decodifica sozinho (`source: { file, format: 'png' }`). Nenhum byte passa pelo `$`.

**Risco aceito:** esse caminho é interno do Claude Code, não faz parte da API documentada e pode mudar entre versões. Se mudar, a prévia mostra "prévia indisponível" e nada mais quebra. O README registra essa limitação.

## Arquitetura

```
hooks/
  register.tsx   hooks novos: prompt.edit (aviso de mudanca) e ui.render AbovePrompt
  paste.tsx      puro: extrair os números do rascunho, candidatos de pasta, árvore da faixa
```

`paste.tsx` segue a regra do projeto: não usa `$`. Tudo que chama `$` (ler o rascunho, `fs`, `session.id`, desenhar) fica em `register.tsx`.

### Estado

Um atom novo, `{ plugin: 'neon-hud', key: 'paste-ids' }`, com `number[]`, declarado em `types/index.d.ts`. Ele só serve para avisar a faixa: o `prompt.edit` grava nele os números do rascunho quando eles mudam, e a faixa lê o atom para redesenhar nessa hora. O conteúdo que a faixa mostra vem sempre do rascunho atual, lido com `$.prompt.read()`. A pasta de imagens encontrada fica num cache no nível do módulo, por id de sessão.

## Fluxo

1. **`prompt.edit`:** o hook chama `next(e)`, pega o texto resultante e extrai os números de `[Image #N]` com `/\[Image #(\d+)\]/g`. Eles ficam únicos e em ordem crescente. Só escreve no atom quando a lista muda. Se a colagem em si não passar por `prompt.edit`, a próxima tecla atualiza a lista. Devolve sempre o resultado de `next(e)`, sem mudar nada.
2. **Envio:** não precisa de hook. Ao enviar, `isWorking` vira verdadeiro e a faixa some. Quando o turno acaba, a faixa redesenha, lê o rascunho já vazio e continua sem nada.
3. **Localizar a pasta** (na primeira renderização com ids, depois em cache):
   - bases candidatas, em ordem: `$CLAUDE_CODE_TMPDIR` (se definido), `/private/tmp` e `/tmp`;
   - em cada base, as entradas `claude-<dígitos>`;
   - dentro de cada uma, a subpasta de projeto que contém `<id da sessão>/images`.

   A primeira pasta encontrada vale. Não encontrar nenhuma não vira cache negativo: a próxima colagem tenta de novo, porque a pasta pode só nascer na primeira colagem.
4. **`ui.render` `AbovePrompt`:** lê o atom, lê o rascunho com `$.prompt.read()` e extrai os números. Cai para `next(e)` quando:
   - `pastePreview` está desligado;
   - a lista está vazia;
   - `isWorking` (um turno está rodando);
   - `hasSurvey` (uma pesquisa ocupa a faixa);
   - a superfície não é o terminal (o `Image` só existe lá).

   Fora desses casos, desenha a faixa.

## Desenho da faixa

- **Primeira linha:** rótulo `PASTE` em ciano neon (`#00e5ff`) e, à direita, a contagem `N imagens`, em cinza (`#66708f`).
- **Miniaturas:** uma por id, lado a lado com 2 colunas de espaço entre elas.
  - Largura: `min(24, floor((bodyColumns − 2·(n−1)) / n))`.
  - Altura: `min(8, maxRows − 2)`.
  - Sem espaço suficiente (largura < 8 ou altura < 3), usa só a forma em texto.
- **Legenda** sob cada miniatura: `[Image #N] · 1.5 MB`, com o tamanho tirado de `fs.stat`.
- **Terminais sem suporte a imagem** (fora do kitty e do Ghostty): o `alt` do `Image` mostra a mesma legenda, então o usuário vê pelo menos quais imagens estão no rascunho e de que tamanho.
- **Arquivo ausente:** `[Image #N] · prévia indisponível`, em cinza, no lugar da miniatura.

## Configuração

Uma opção nova em `userConfig`:

| Opção | Valores | Padrão | O que faz |
| --- | --- | --- | --- |
| `pastePreview` | `true`, `false` | `true` | Mostra acima do prompt uma miniatura de cada imagem colada, antes do envio. |

`pastePreview` é independente de `render`: com o renderizador desligado, a prévia continua.

## Efeitos colaterais

- Leitura de pastas e arquivos sob `/tmp`, `/private/tmp` ou `$CLAUDE_CODE_TMPDIR`, só `list`, `exists` e `stat`. Os bytes da imagem quem lê é o terminal.
- Nenhum programa externo, nenhuma rede e nada enviado ao modelo.

## Tratamento de erros

- Qualquer exceção no `prompt.edit` devolve o resultado de `next(e)` intacto. A prévia nunca pode comer uma tecla. O envio do prompt não passa por nenhum hook da prévia.
- Qualquer exceção no `AbovePrompt` cai para `next(e)`.
- Falhas de `fs` ou de `session.id` levam a "prévia indisponível", nunca a erro visível.

## Testes

Em `tests/paste.test.tsx`:

- **Extração:** `extractImageIds` lê `[Image #2] texto [Image #1] [Image #2]` como `[1, 2]`.
- **Rascunho com imagem:** com o rascunho (`prompt.read`), `fs` e `session.id` simulados, o `AbovePrompt` desenha um `Image` com `source.file` igual a `<pasta>/images/1.png`, mais a legenda. O kit de testes não dispara `prompt.edit`, então o hook de edição é coberto só pela função pura que ele usa e pela verificação ao vivo.
- **Rascunho sem imagem:** a faixa cai para `next(e)`.
- **Pasta ainda não criada:** mostra `prévia indisponível` e, quando a pasta aparece, a próxima renderização acha a imagem.
- **Muitas imagens em pouca largura:** só legendas, sem `Image`.
- **Arquivo ausente:** mostra `prévia indisponível`.
- **Opção desligada:** `pastePreview: false` não desenha nada.
- **Turno rodando:** `isWorking: true` cai para `next(e)`.
- **Edição intacta:** o resultado de `prompt.edit` é o mesmo de `next(e)`.

## Verificação ao vivo

Na sessão `claude --plugin-dir .`, colar uma imagem e confirmar a miniatura acima do prompt. Depois:

- colar uma segunda imagem e ver as duas miniaturas;
- apagar `[Image #1]` e ver a primeira sumir;
- enviar e ver a faixa sumir.

Isso também confirma os dois pontos que só dá para ver ao vivo: se a colagem dispara `prompt.edit` e se o caminho da pasta é o esperado.

## Entrega

- Versão 0.7.0.
- README em português e em inglês com a nova seção, a opção nova e a limitação do caminho interno.
