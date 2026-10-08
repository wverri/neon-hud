# NEON//HUD

Painel lateral para o [Claude Code](https://claude.com/claude-code) que mostra, ao vivo, o que a sessão está fazendo e quanto está custando, com visual cyberpunk.

<p align="center">
  <img src="docs/screenshot.png" alt="Painel NEON//HUD durante o streaming: throughput, contexto, tokens, custo, agentes e ferramentas" width="420">
</p>

## O que ele mostra

| Seção | Conteúdo |
| --- | --- |
| Cabeçalho | Fase atual (`STANDBY`, `SENDING`, `THINKING`, `STREAMING`, `RUNNING`), modelo, tempo de sessão, turnos e requisições |
| **Throughput** | Tokens por segundo (estimado durante o streaming, exato ao fim de cada requisição), média, pico e histórico das últimas 60 requisições |
| **Context** | Ocupação da janela de contexto; a barra fica verde, amarela ou vermelha conforme enche |
| **Tokens** | Entrada, saída, leitura e escrita de cache, somando a sessão principal e os subagentes, mais a taxa de acerto de cache |
| **Spend** | Custo da sessão em US$ (o mesmo valor do `/cost`) e os limites de 5h e 7d do plano, com o tempo até cada reset |
| **Agents** | Subagentes da sessão, com tipo, status e descrição |
| **Tools** | Total de chamadas, as ferramentas mais usadas e as últimas chamadas (`✓` ok, `✗` erro, `⟳` rodando) |

O cartão que está em atividade acende em ciano: Throughput durante o streaming, Agents com agente rodando, Tools com ferramenta em execução.

## Requisitos

Uma versão do Claude Code com suporte a mods de *function hooks* (testado na 2.1.293). Essa API ainda é early access e pode mudar entre versões.

## Instalação

Na prompt de uma sessão do Claude Code no terminal, digite:

```
/plugin install neon-hud --marketplace wverri/neon-hud
```

Depois:

1. Responda `y` para adicionar o marketplace `github:wverri/neon-hud`.
2. Escolha o escopo com Enter. O escopo **user** (o primeiro da lista) deixa o painel ativo em todas as suas sessões.
3. Aparece `Installed neon-hud. Plugin is now active.`

Pela linha de comando, fora de uma sessão, o equivalente é:

```bash
claude plugin marketplace add wverri/neon-hud
claude plugin install neon-hud@neon-hud
```

## Ativação

O mod passa a valer **na mesma hora**, sem reiniciar a sessão, e em toda sessão nova a partir daí.

- **Painel automático:** no layout de tela cheia do terminal, com pelo menos 144 colunas, o painel abre sozinho na lateral direita quando a sessão começa.
- **Abrir manualmente:** em qualquer tamanho, digite **`/hud`**. Com o terminal estreito, o painel aparece acima da prompt.
- **Fechar:** clique no `×` do painel. Para reabrir, digite `/hud`.
- **Largura:** o painel pede 46 colunas. Se você arrastar a borda, o seu tamanho é mantido.

O app desktop do Claude Code (aba Code) também carrega o mod quando ele foi instalado pelo terminal no escopo user.

## Atualizar e remover

```bash
claude plugin update neon-hud@neon-hud      # depois, /reload-plugins na sessão
claude plugin uninstall neon-hud@neon-hud
```

## Observações

- Os contadores de tokens, requisições e tok/s começam quando o mod carrega. Se você instalar no meio de uma sessão, eles contam a partir dali. Custo, contexto, modelo e turnos sempre mostram o valor real desde o início da sessão.
- Os limites de 5h e 7d só aparecem em planos de assinatura que informam esses limites.
- O mod só observa a sessão: nunca bloqueia nem altera prompts ou chamadas de ferramenta.

## Desenvolvimento

```bash
git clone https://github.com/wverri/neon-hud
claude --plugin-dir ./neon-hud      # carrega a cópia local; salvar um arquivo recarrega o mod
claude plugin validate ./neon-hud   # confere o manifesto e o módulo de hooks
claude plugin test ./neon-hud       # roda tests/*.test.tsx
```

Estrutura:

```
.claude-plugin/plugin.json        manifesto do mod
.claude-plugin/marketplace.json   transforma o repositório num marketplace de um plugin
hooks/hooks.json                  aponta para o módulo de hooks
hooks/register.tsx                hooks de sessão, turno, ferramenta e o desenho do painel
types/index.d.ts                  contrato do estado ($.state) do mod
tests/hud.test.tsx                testes do painel, incluindo o de largura
```

## Licença

[MIT](LICENSE)
