# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Scope

This directory is the **Simple Tasks** Obsidian plugin (a stateless task aggregator that scans the vault via `metadataCache`). It sits inside a larger Obsidian vault that has its own `CLAUDE.md` at the vault root focused on Product Management work — that root file does **not** apply to plugin development. When working in this directory, treat it as an isolated JavaScript project.

## Build & test workflow

There is **no build step, bundler, transpiler, or test framework**. The plugin ships as plain ES5/ES2017 JavaScript loaded directly by Obsidian.

- `main.js` is the runtime entry point that Obsidian loads.
- `manifest.json` declares the plugin id (`simple-tasks`), version, and `isDesktopOnly: false`.
- `styles.css` is loaded automatically by Obsidian.
- `data.json` is the settings file written by `Plugin.saveData()` — do not commit user-specific contents.

To test changes: edit `main.js`, then in Obsidian use the "Reload app without saving" command (or toggle the plugin off/on in *Settings → Community plugins*). There are no unit tests; verification is manual inside Obsidian.

When bumping the version, update `manifest.json` and tag/commit accordingly. The repository's existing convention (see `git log`) is `chore: bump version to X.Y.Z`.

## Architecture

Everything lives in `main.js`. The classes and their responsibilities:

| Class | Role |
|---|---|
| `SimpleTasksPlugin` | Obsidian `Plugin` entry point. Registers the settings tab, the `simpletasks` codeblock processor, and the `CategorySuggest` editor suggest. Owns `globalCategoryCache` (a `Set` of category names harvested across renders, used by the autocomplete suggester). |
| `SimpleTasksSettingTab` | Renders the *global* exclusion settings (`excludedFolders`, `excludedTags`) persisted to `data.json`. |
| `TaskScanner` | Walks every markdown file via `app.vault.getMarkdownFiles()`, filters using `metadataCache.getFileCache(...).listItems`, and reads matching files with `cachedRead`. Returns `{ tasks, categoriesSet }`. |
| `SimpleTasksView` | One instance per `simpletasks` codeblock. Owns view state, parses codeblock config, debounces refresh on `metadataCache.on('resolved')` (1 s), and renders header / filter row / list / stats. Persists state back into the codeblock via `saveSettingsToCodeBlock()`. |
| `CategorySuggest` | `EditorSuggest` triggered by typing `[]`, `[ ]`, or `[x]` mid-line. Inserts `==CATEGORY==`; if the line is not yet a task, rewrites it as `- [ ] ...` with categories appended. |
| `FolderSuggest` | `AbstractInputSuggest` for folder pickers. Has two modes (single-value for the settings tab, comma-separated append for the codeblock filters) — switched by sniffing `inputEl.placeholder === 'Search folders...'`. |

### Task model

A task is parsed from any list item where `cache.listItems[i].task` is truthy and the line matches `^(\s*[-*]\s*)\[([ xX])\]\s*(.*)$`. From the matched text, the scanner extracts:

- **Categories**: every `==NAME==` (Obsidian highlight). Stored uppercased; comparisons are lowercase.
- **Date**: the *last* `YYYY-MM-DD` substring in the line is treated as the due date. Earlier dates remain plain text. The renderer in `renderList` re-derives `lastDatePartIndex` so only the final date becomes the clickable date-picker span.
- **Tags**: file-level tags from `cache.tags` + frontmatter, plus inline `#tag` matches in the task line. Frontmatter tags accept both array and comma-string forms.

### Filter precedence (important)

Both global and per-block filters exist. The rule is **either-or, not additive**:

- If the codeblock has any local `excludedTags` or `excludedFolders` → globals are ignored, and the local filters act as **inclusion** filters during the list-render pass (`statsScopedTasks` keeps only tasks that match a local tag *or* local folder). This is intentional but easy to misread — the codeblock keys are named `tags:`/`folders:`/`exclude-tags:`/`exclude-folders:` interchangeably (the parser maps both into `excludedTags`/`excludedFolders`), and they semantically pivot from exclude to include when present.
- If there are no local filters → globals apply as exclusions in `TaskScanner.scanVault` (folder check first, tag check after reading frontmatter).

Tag matching treats `#parent` as also matching `#parent/child` (prefix + `/`). Folder matching is case-insensitive and requires a `/` boundary or exact match (so excluding `Foo` does not exclude `Foobar/`).

### Codeblock config

Parsed line-by-line in `parseConfig`. Recognized keys: `title:`, `view:` (`list`, `stats`, or `list stats`), `status:` (`all`/`undone`/`done`), `cat-mode:` (`include`/`exclude`), `sort:` (`date`/`name`), `search:`, `tags:` / `exclude-tags:`, `folders:` / `exclude-folders:`, `expanded:`, `from:`, `to:`, `date: <next|last> <n> <days|weeks|months|years>`. A bare `==CATEGORY==` line adds that category to `filterCategories`.

`saveSettingsToCodeBlock()` writes back via `ctx.getSectionInfo()` + `vault.modify()`, replacing only the body lines between the fences.

### Stats vs list

`renderList` computes `statsScopedTasks` (everything except the status filter) and then `filtered` (with status filter applied). Stats are rendered from `statsScopedTasks` so the pending counter isn't tautological when the user filters to "undone" only.

## Conventions for code changes

- Keep everything in `main.js` — there is no module system. New classes go in the same file.
- Use the destructured imports already in place: `const { Plugin, ... } = require('obsidian')`. Do not introduce ESM `import` statements; Obsidian loads this file as CommonJS.
- Do not add npm dependencies — there is no `package.json` and the plugin must remain dependency-free to load.
- Inline styles via `Object.assign(el.style, { ... })` and class names via `createDiv('classname')` are the established pattern; prefer adding to `styles.css` for anything reusable.
- The plugin must remain mobile-compatible (`isDesktopOnly: false` in `manifest.json`) — avoid Node/Electron-only APIs.
