# Simple Tasks for Obsidian

A stateless, zero-database task management plugin for Obsidian. Simple Tasks scans your vault in real-time using Obsidian's metadata cache to aggregate tasks based on simple markdown syntax.

## Features

- **High Performance**: Uses `metadataCache` for fast scanning.
- **Live Updates**: Automatically refreshes views when you modify your notes.
- **Smart Autocomplete**: Type `[]` anywhere in a line to pick a category and auto-format/convert the line into a task.
- **Collapsible Filters**: Keep your workspace clean by collapsing the filter settings while keeping the task list visible.
- **Dual View Modes**: Show a task list and a progress summary (Stats) simultaneously.

## Task Syntax

Simple Tasks recognizes standard markdown tasks. You can enrich them with categories, dates, and tags.

- **Standard Task**: `- [ ] Buy milk`
- **With Category**: `- [ ] ==Personal== Buy milk`
  - Categories are defined using highlight syntax `==`.
- **With Due Date**: `- [ ] Buy milk 2025-03-01` (Format: `YYYY-MM-DD`)

### Smart Task Creation
In any note, type `[]` (or `[ ]`, `[x]`) anywhere in a line. 
1.  A category menu appears immediately.
2.  Selecting a category inserts it at your cursor.
3.  If the line isn't a task, it is automatically converted (prepending `- [ ]`).
4.  To add more categories, simply type `[]` again.

## Creating a Task View

Create a code block starting with `simpletasks`. Use the **Save 💾** button in the header to persist your interactive filters back to the code block.

### Configuration Options

| Option | Values | Description |
| :--- | :--- | :--- |
| `title:` | `text` | The title displayed in the header. |
| `view:` | `list`, `stats`, `list stats` | Choose to show the list, the stats summary, or both. |
| `status:` | `undone`, `done`, `all` | Filter by completion status. |
| `sort:` | `date`, `file` | Sort order (Default: `date`). |
| `exclude-tags:` | `#tag1 #tag2` | Hide tasks containing specific tags (space separated). |
| `exclude-folders:`| `Folder1, Folder2` | Hide tasks from specific folders (comma separated). |
| `expanded:` | `true`, `false` | Whether the filter header is expanded by default. |

## Interactive Controls

- **Collapse Button (+ / −)**: Located in the title line, toggles filter visibility.
- **View Checkboxes**: Toggle "List" and "Stats" views in real-time.
- **Save Filters (💾)**: Overwrites the code block with your current interactive configuration.
- **Category Chips**: Click chips to toggle multi-category filtering. "All" resets filters.
- **Rescan (⟳)**: Force a manual vault scan.