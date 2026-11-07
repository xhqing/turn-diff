<div align="center">
  <img src="assets/logo.svg" alt="turn-diff" width="640">

  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow)](LICENSE.md)
  [![Version](https://img.shields.io/badge/Version-2.2.0-blue)](CHANGELOG.md)
  [![Type](https://img.shields.io/badge/Type-pi%20extension-6E56CF)](#)
  [![Platform](https://img.shields.io/badge/Platform-git-000000)](#)

  [简体中文](README_cn.md)
</div>

# turn-diff

> What did the agent change **in this turn**? A baseline is captured when your prompt is submitted, the delta is computed when the turn ends, and you can read it any time — from the session or from a terminal.

This is a pi extension with a single job: report the per-turn diff of a git repository. It does not render panels, does not compare branches, and does not need any other app running.

## Why

- "Show me what you just changed" is the question you ask most often, and `git diff` answers the wrong one: everything uncommitted, including yesterday's leftovers.
- One report per turn keeps it honest: only what changed between your prompt and the end of that turn.
- It costs nothing at runtime: the baseline is a `git stash create` commit (no refs written, working tree untouched) and the report is a custom session entry that never enters the LLM context.

## Install

```bash
./install.sh
```

The script deploys two things:

- `turn-diff.ts` → `~/.pi/agent/extensions/turn-diff.ts` (new sessions pick it up; run `/reload` in open ones)
- `scripts/turn-diff` → `~/.local/bin/turn-diff` (the CLI)

## Usage

### In a pi session

```
/turn-diff              paste the previous turn's changes (stats + files)
/turn-diff list         just the changed files, numbered
/turn-diff file         the unified diff of the whole turn
/turn-diff file 2       only file #2 from the listing
/turn-diff file src/    only files whose path matches a fragment or glob
/turn-diff view 2       open file #2 in cmux's diff panel (line colours, optional word diffs)
/turn-diff render 2     render the after-side of file #2 in cmux's markdown panel (math typeset)
/turn-diff 2            the turn before last
/turn-diff 2 file 3     file #3 of that turn
/turn-diff on|off       paste automatically at the end of every turn (default: off)
```

### In a terminal (no pi involved)

```bash
turn-diff                   the previous turn's changes for the repo you are in
turn-diff list              just the changed files, numbered
turn-diff file              the unified diff of the whole turn
turn-diff file 2            only file #2 from the listing
turn-diff file '*.ts'       only matching paths
turn-diff 2                 one turn further back (1 = the latest)
turn-diff 2 file 3          file #3 of that turn
turn-diff view 2            open file #2 in cmux's diff panel
turn-diff render 2          render the after-side of file #2 in cmux's markdown panel
turn-diff --repo ~/x        same for another repo
turn-diff --all             one line per repo that has a turn report
turn-diff --json            machine-readable output
turn-diff --color always    force colors (auto / never for the other modes)
```

`turn-diff` only reads the state the extension persisted, so it never starts a pi session and never touches a turn.

## cmux panels (optional, need cmux)

Two panels, two jobs — pick the one that answers your question:

| Command | Panel | Shows | Math |
|---|---|---|---|
| `turn-diff view 2` | cmux diff viewer | the file's patch with line colours; enable **word diffs** in that panel's options menu for word-level highlights | raw `$...$` |
| `turn-diff render 2` | cmux markdown viewer | only the changed lines: removals in red with the removed words struck through, additions in green with the added words underlined; unchanged lines are left out | typeset by KaTeX |

A diff of a Markdown article shows raw `$...$`; when you want to *read* the changed part with the math typeset, use `render`:

`render` shows only the lines that changed: a removed line is drawn with the diff viewer's red palette and the words that were removed are struck through; an added line uses the green palette and the added words are underlined. Colours come from the panel's own `.hljs-deletion` / `.hljs-addition` classes (the sanitizer allows class names, not inline `style`). The panel opens with `cmux open --no-focus`, i.e. as a **tab in the focused pane** rather than a new split. Unchanged lines are dropped, and there is no source view — use `file` for that. If the content itself already contains `~~` or `<u>`, the document says so up front and prints those marks literally so they cannot be confused with this turn's marks. cmux bundles KaTeX, so formulas in the rendered part are really typeset. It opens with `cmux markdown open --focus false`, so it does not steal focus.

Caveats: this is a fragment, not the whole file — Markdown structures that start outside the hunk (a table split by the hunk, a paragraph cut in half) may render oddly, and relative image paths probably will not resolve. It also means this one subcommand needs cmux; everything else stays pure git.

## Colors

Diff bodies are painted like a change view, not like a log:

- added lines get a **green background**, removed lines a **red background**;
- inside a paired `-`/`+` line, only the tokens that actually changed get a **brighter background**, so a one-word edit stands out instead of repainting the whole line.

Colors follow the terminal by default (TTY only); `--color never` turns them off, `--color always` forces them through a pipe. In the session card the same palette is used.

A turn that touched several files does not dump everything at once: `/turn-diff file` opens a picker (all files or one), and `/turn-diff file <#>|<pattern>` goes straight to one file. What you asked for is rendered in full — no "30 lines, expand to see the rest" — and the command line uses the same words: `turn-diff file 2`.

## How it works

1. `before_agent_start` records the baseline: repo root, `HEAD`, a `git stash create` snapshot of the dirty tracked files (no ref written, no working-tree change), and fingerprints of the untracked files.
2. `agent_settled` diffs the baseline against the working tree: `git diff --numstat` for counts, `--name-status` for the A/M/D/R letter, and a full `git diff` for the patch body. Untracked files that appeared during the turn are counted as new files.
3. Both the stats and the patch are persisted per repo (last 20 turns) under `~/.pi/agent/state/turn-diff/`, which is what `/turn-diff`, the CLI, and the session card read.

Prefer `git stash create` over patching the index: it captures staged *and* unstaged changes without touching either, and the resulting commit is cheap because git deduplicates contents.

## Known limits

- **git only**: a directory that is not a git repository is skipped (there is no baseline to diff against).
- **Turn scope only**: the report answers "what changed during this turn". For "everything uncommitted", use plain `git diff` — this project only reports the turn.
- **Untracked files that already existed at baseline** are not reported even if the turn edited them — git has no diff base for them.
- The patch is text only: binaries and untracked files over 200 KB are left out, and a single turn's patch is capped at 80 KB (stats stay complete).
- Up to 20 turns per repo are kept; older ones are dropped.

## Development

- `turn-diff.ts` — the extension (single file, no dependencies beyond `pi-tui`)
- `scripts/turn-diff` — the CLI (Python 3, standard library only)
- `install.sh` — deploys both; `node --experimental-strip-types --check turn-diff.ts` is the syntax gate CI runs

## License

Copyright (c) 2026 All Contributors. Released under the [MIT License](LICENSE.md).
