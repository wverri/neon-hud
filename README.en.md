# NEON//HUD

[Português](README.md) · **English**

A cyberpunk mod for [Claude Code](https://claude.com/claude-code) with two parts:

- **Side pane:** shows, live, what the session is doing and what it costs.
- **Rendered replies:** redraws Claude's replies, tool calls and the turn footer in the same neon palette as the pane: tables, highlighted code, mermaid diagrams and LaTeX formulas.

<p align="center">
  <img src="docs/screenshot.png" alt="NEON//HUD pane while streaming: throughput, context, tokens, spend, agents and tools" width="420">
</p>

## What the pane shows

| Section | Contents |
| --- | --- |
| Header | Current phase (`STANDBY`, `SENDING`, `THINKING`, `STREAMING`, `RUNNING`), model, session time, turns and requests. During a turn it shows a stopwatch and the running tool. Afterwards it shows the last turn's duration and cost. |
| **Throughput** | Tokens per second (estimated while streaming, exact at the end of each request), average, peak, and a history of the last 60 requests |
| **Context** | The context window as a stacked bar, one color per `/context` category (system prompt, tools, MCP, memory, skills, messages in pink), with free space and the autocompact buffer. Below it are the total, the point where autocompact runs, and a legend with each category's tokens and share. The % badge turns green, yellow or red as the window approaches the compaction point. Updates every turn and after `/compact`. |
| **Tokens** | Input, output, cache read and cache write, summed across the main session and subagents, plus the cache hit rate |
| **Spend** | Session cost in US$ (the same value as `/cost`), average cost per turn and per hour, and the plan's 5h and 7d limits with the time until each reset |
| **Agents** | The session's subagents, with type, status and description |
| **Tools** | Total calls, the most used tools, and the latest calls grouped (`✓Bash×5`; `✓` ok, `✗` error, `⟳` running) |

The active card lights up in cyan: Throughput while streaming, Agents while an agent runs, Tools while a tool runs.

## Rendered replies

neon-hud also redraws Claude's replies, tool calls and the turn footer in the pane's palette. The renderer comes from [prismantis](https://github.com/NahumLitvin/prismantis) (MIT, see `docs/THIRD_PARTY_NOTICES.md`), with a fixed neon palette.

<p align="center">
  <img src="docs/render.png" alt="A reply rendered in neon: table, code block, mermaid diagram, bar chart, formula and warning, with the NEON//HUD pane alongside" width="820">
</p>

| Feature | What changes |
| --- | --- |
| Tables | Colored header, rules, `:---:`/`---:` alignment, colored numbers, and columns that shrink to fit the terminal |
| Code | Header with the language and a copy button, Prism highlighting in 24 languages, shell lines colored like a prompt, line numbers, and folding for long blocks |
| Diagrams and charts | `mermaid` blocks (flowchart, sequence, state, class, ER and `xychart-beta`) become colored art. Diagrams too wide for the terminal fall back to code. |
| LaTeX | `$$…$$` and ` ```math ` render as images in kitty and Ghostty. Elsewhere they stay as text. |
| Layout | Consecutive tables and diagrams sit side by side, and wrap when there is not enough width |
| Copy buttons | `⧉ md`, `⧉ art` and `⧉ html` on tables, and `[ ⧉ copy ]` on code, lists and quotes. `/neon-hud copy` and `/neon-hud copy code` copy without the mouse. |
| Tool rows | One line per call (`Ran gh pr view 12`, `Read ~/src/app.ts`, `Edited README.md`) with a status dot, grouped summaries, and diffs shown as cards |
| Turn footer | `✻ Baked for 6m 20s` with the duration in neon green. The end time is optional (`clock`). |
| Text | Bold, italic, strikethrough, inline code, links, versions, durations, percentages and paths each get their own color |

### LaTeX

Formulas are drawn as images by [RaTeX](https://github.com/erweixin/RaTeX). Install `ratex-render`, swapping the archive for your platform (for example `x86_64-apple-darwin` or `x86_64-unknown-linux-musl`):

```bash
gh release download -R erweixin/RaTeX -p 'ratex-cli-*-aarch64-apple-darwin.tar.gz'
tar -xzf ratex-cli-*.tar.gz
mkdir -p ~/.local/bin
install ratex-cli-*/render ~/.local/bin/ratex-render
```

This only works in kitty and Ghostty, outside tmux, with `latex: true`. Otherwise the formula shows as a `math` block.

### Configuration

All options live in `~/.claude/settings.json` (or in `/config`). Run `/reload` after changing them:

```json
{
  "pluginConfigs": {
    "neon-hud@neon-hud": {
      "options": { "tableStyle": "grid", "clock": "24h" }
    }
  }
}
```

| Option | Values | Default | What it does |
| --- | --- | --- | --- |
| `render` | `true`, `false` | `true` | Turns on the redrawing of replies, tool rows and the footer. When off, only the pane remains. |
| `tableStyle` | `box`, `rules`, `grid`, `minimal` | `box` | Table style. `box` puts each cell in a box. `rules` draws a line between rows. `grid` uses a heavier header line and wider spacing. `minimal` keeps only the header line. |
| `toolRows` | `true`, `false` | `true` | Draws each tool call as one compact line. |
| `toolStyle` | `chat`, `tree-dim`, `tree-bold`, `classic` | `chat` | How tool rows sit next to Claude's text. `chat` shows dimmed rows on the right. `tree-dim` shows dimmed rows under the sentence, with `⎿`. `tree-bold` is `tree-dim` plus one-line sentences in bold. `classic` keeps the original look. |
| `toolOutput` | `full`, `quiet` | `full` | `quiet` sums up each call in plain words, keeps diffs, and shows only the last line of an error. Requires `toolRows`. |
| `copyButtons` | `true`, `false` | `true` | Copy buttons on code, tables, diagrams, lists and quotes. |
| `mermaid` | `true`, `false` | `true` | Draws `mermaid` blocks as art. When off, the code stays as written. |
| `mermaidAscii` | `true`, `false` | `false` | Draws diagrams with `+ - \| >`, for fonts without box-drawing characters. |
| `latex` | `true`, `false` | `false` | Renders formulas as images through `ratex-render`, in kitty and Ghostty outside tmux. |
| `clock` | `off`, `24h`, `12h` | `off` | Shows when each turn ended. |
| `highlightNumbers` | `true`, `false` | `true` | Colors versions, IDs, counts and durations. |
| `highlightPaths` | `true`, `false` | `true` | Colors paths such as `~/src/app.ts`. |

### Alongside prismantis

If prismantis is installed and enabled, it draws the replies and neon-hud shows only the pane. If prismantis is installed but disabled, neon-hud draws the replies as usual. neon-hud checks again whenever the mod reloads. `render: false` turns off the redrawing without affecting the pane.

## Commands

| Command | What it does |
| --- | --- |
| `/hud` | Opens the pane, or reopens it after you close it with `×`. |
| `/neon-hud copy` | Copies Claude's last reply, as written. |
| `/neon-hud copy code` | Copies the last code block of the last reply. |

`/neon-hud` only exists while `render` is on.

## Requirements

A Claude Code version that supports *function hooks* mods (tested on 2.1.293). This API is still in early access and may change between versions.

## Installation

At the prompt of a Claude Code session in the terminal, type:

```
/plugin install neon-hud --marketplace wverri/neon-hud
```

Then:

1. Answer `y` to add the `github:wverri/neon-hud` marketplace.
2. Pick the scope with Enter. The **user** scope (first in the list) keeps the pane active in all your sessions.
3. You'll see `Installed neon-hud. Plugin is now active.`

From the command line, outside a session, the equivalent is:

```bash
claude plugin marketplace add wverri/neon-hud
claude plugin install neon-hud@neon-hud
```

## Activation

The mod takes effect **immediately**, without restarting the session, and in every new session from then on.

- **Automatic pane:** in the terminal's full-screen layout, with at least 144 columns, the pane opens on the right when the session starts.
- **Open it manually:** at any size, type **`/hud`**. In a narrow terminal the pane appears above the prompt.
- **Close it:** click the pane's `×`. Type `/hud` to reopen it.
- **Width:** the pane asks for 46 columns. If you drag its border, your width is kept.

The Claude Code desktop app (Code tab) also loads the mod when it was installed from the terminal in the user scope.

## Update and remove

```bash
claude plugin update neon-hud@neon-hud      # then /reload-plugins in the session
claude plugin uninstall neon-hud@neon-hud
```

## Notes

- Counters for tokens, requests and tok/s are saved per session. They survive a mod reload, a Claude Code restart and `--resume`, and reset on `/clear`. If you install in the middle of a session, they count from that point. Cost, context, model and turns always show the real value since the session began.
- The 5h and 7d limits only appear on subscription plans that report them.
- The mod never blocks or changes prompts or tool calls, and sends nothing to the model. It only changes how the session looks on screen.
- External programs: `osascript` (macOS) or `copyq` (Linux), only when you click `⧉ html`, and `ratex-render` when `latex` is on. No network access.

## Development

```bash
git clone https://github.com/wverri/neon-hud
claude --plugin-dir ./neon-hud      # loads the local copy; saving a file reloads the mod
claude plugin validate ./neon-hud   # checks the manifest and the hooks module
claude plugin test ./neon-hud       # runs tests/*.test.tsx
```

Layout:

```
.claude-plugin/plugin.json        mod manifest and options (userConfig)
.claude-plugin/marketplace.json   turns the repo into a one-plugin marketplace
hooks/hooks.json                  points to the hooks module
hooks/register.tsx                every hook: session, turn, tool, pane and renderer
hooks/hud.tsx                     pane drawing and formatting (pure, no $)
hooks/render/                     renderer ported from prismantis (pure, no $)
hooks/render/theme.ts             neon palette and option parsing
hooks/render/vendor/              bundled Prism and beautiful-mermaid
types/index.d.ts                  contract for the mod's state ($.state)
tests/hud.test.tsx                pane tests, including the width check
tests/neon.test.tsx               neon renderer's own tests
tests/*.test.tsx                  the other tests, ported from prismantis
docs/THIRD_PARTY_NOTICES.md       licenses for prismantis, Prism and beautiful-mermaid
```

Claude Code's `$` does not cross an `import`, so all code that uses `$` lives in `hooks/register.tsx`.

## License

[MIT](LICENSE). The renderer comes from [prismantis](https://github.com/NahumLitvin/prismantis), also MIT; see `docs/THIRD_PARTY_NOTICES.md`.
