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

A task is parsed from any list item where `cache.listItems[i].task` is truthy and the line matches `^(\s*[-*]\s*)\[([ xX\/])\]\s*(.*)$`. `task.mark` holds the status character (`' '` open, `'x'` done, `'/'` in progress) and `task.status` is `true` only for done, so in progress counts as not done in filters and stats. Clicking a list checkbox cycles `[ ]` → `[/]` → `[x]` → `[ ]` (`toggleTask`). List checkboxes get `checked` + `data-task` like Obsidian's own, so themes can draw `[/]` as half done. From the matched text, the scanner extracts:

- **Categories**: every `==NAME==` (Obsidian highlight). Stored uppercased; comparisons are lowercase.
- **Date**: the *last* `YYYY-MM-DD` substring in the line is treated as the due date. Earlier dates remain plain text. The renderer in `renderList` re-derives `lastDatePartIndex` so only the final date becomes the clickable date-picker span.
- **Tags**: file-level tags from `cache.tags` + frontmatter, plus inline `#tag` matches in the task line. Frontmatter tags accept both array and comma-string forms.

### Filter precedence (important)

Both global and per-block filters exist. The rule is **either-or, not additive**:

- If the codeblock has any local `excludedTags` or `excludedFolders` → globals are ignored, and the local filters act as **inclusion** filters during the list-render pass (`statsScopedTasks` keeps only tasks that match a local tag *or* local folder). This is intentional but easy to misread — the codeblock keys are named `tags:`/`folders:`/`exclude-tags:`/`exclude-folders:` interchangeably (the parser maps both into `excludedTags`/`excludedFolders`), and they semantically pivot from exclude to include when present.
- If there are no local filters → globals apply as exclusions in `TaskScanner.scanVault` (folder check first, tag check after reading frontmatter).

Tag matching treats `#parent` as also matching `#parent/child` (prefix + `/`). Folder matching is case-insensitive and requires a `/` boundary or exact match (so excluding `Foo` does not exclude `Foobar/`).

### Codeblock config

Parsed line-by-line in `parseConfig`. Recognized keys: `title:`, `view:` (`list`, `stats`, or `list stats`), `status:` (`all`/`undone`/`done`), `cat-mode:` (`include`/`exclude`), `sort:` (`date`/`name`, always after a status grouping: `[/]`, then `[ ]`, then `[x]`), `search:`, `tags:` / `exclude-tags:`, `folders:` / `exclude-folders:`, `expanded:`, `kanban:` (`true`/`false`), `group:` (see Kanban), `wrap:` (`true`/`false`, default `true`; `false` adds the `simple-tasks-nowrap` class to the container so each task is cut to one line with an ellipsis), `from:`, `to:`, `date: <next|last|current> <n> <days|weeks|months|years>` (`current` ignores `n` but the parser still needs three parts). A bare `==CATEGORY==` line adds that category to `filterCategories`.

`saveSettingsToCodeBlock()` writes back via `ctx.getSectionInfo()` + `vault.modify()`, replacing only the body lines between the fences.

### Kanban

`kanban: true` swaps the list for a board (`renderKanban`), `group:` picks the columns (`KANBAN_GROUPS`: `category`, `status`, `day`, `week`, `month`). `renderList` does all filtering and sorting first, then hands the sorted tasks to the board, so filters and order are shared. `renderTaskRow` renders checkbox, text and file name for both list rows and cards. `buildKanbanColumns` makes the columns: category columns come from `statsScopedTasks` (before the status filter), or are exactly the selected categories in include mode; date columns come from task dates plus the current period plus every period of the date filter (`getDateRange`, max 62). Drops go through `moveTaskToColumn` → `modifyTaskLine`, which re-reads the note and refuses to write if the line no longer holds the same task text. Week drops set the Friday of the ISO week, month drops the last Monday to Friday day of the month (`dropDate`). Drag and drop is HTML5 DnD, so it does not work on touch.

### Category menu

Category chips in `renderTaskRow` are clickable: `showCategoryMenu` opens an Obsidian `Menu` with all `availableCategories` and replaces only the clicked `==X==` (found by its occurrence in the line) via `modifyTaskLine`. If the task already has the picked category, the clicked one is removed instead of creating a duplicate.

### Stats vs list

`renderList` computes `statsScopedTasks` (everything except the status filter) and then `filtered` (with status filter applied). Stats are rendered from `statsScopedTasks` so the pending counter isn't tautological when the user filters to "undone" only.

## Conventions for code changes

- Keep everything in `main.js` — there is no module system. New classes go in the same file.
- Use the destructured imports already in place: `const { Plugin, ... } = require('obsidian')`. Do not introduce ESM `import` statements; Obsidian loads this file as CommonJS.
- Do not add npm dependencies — there is no `package.json` and the plugin must remain dependency-free to load.
- Inline styles via `Object.assign(el.style, { ... })` and class names via `createDiv('classname')` are the established pattern; prefer adding to `styles.css` for anything reusable.
- The plugin must remain mobile-compatible (`isDesktopOnly: false` in `manifest.json`) — avoid Node/Electron-only APIs.
