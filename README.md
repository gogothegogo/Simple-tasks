# Simple Tasks for Obsidian

A stateless, zero-database task management plugin for Obsidian. Simple Tasks scans your vault in real-time using Obsidian's metadata cache to aggregate tasks based on simple markdown syntax.

## Features

- **High Performance**: Uses `metadataCache` for fast scanning.
- **Live Updates**: Automatically refreshes views when you modify your notes.
- **Smart Autocomplete**: Type `[]` anywhere in a line to pick a category and auto-format/convert the line into a task.
- **Collapsible Filters**: Keep your workspace clean by collapsing the filter settings while keeping the task list visible.
- **Dual View Modes**: Show a task list and a progress summary (Stats) simultaneously.
- **Kanban Board**: Show the same tasks as draggable cards, grouped by category, status or due date. Dragging a card updates the task line.

## Task Syntax

Simple Tasks recognizes standard markdown tasks. You can enrich them with categories, dates, and tags.

- **Standard Task**: `- [ ] Buy milk`
- **In Progress Task**: `- [/] Buy milk`. Counts as not done in filters and stats. Themes that support it (for example Minimal) draw it as a half-done checkbox.
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

### Example

````markdown
```simpletasks
title: This week's work
view: list stats
status: undone
sort: date
folders: Projects
expanded: false
wrap: false
date: current 1 weeks
==TODO==
==RESEARCH==
```
````

### Configuration Options

One option per line. All options are optional.

| Option | Values | Default | Description |
| :--- | :--- | :--- | :--- |
| `title:` | text | `Simple Tasks` | The title displayed in the header. |
| `view:` | `list`, `stats`, `list stats` | `list` | Show the task list, the stats summary or both. |
| `status:` | `all`, `undone`, `done` | `all` | Filter by completion status. Stats ignore this filter, so the counters always show the full picture. |
| `sort:` | `date`, `name` | `date` | Tasks are always grouped by status first: in progress, then open, then done. Within each group, sort by due date (undated tasks last) or alphabetically by task text. Ties are sorted alphabetically. |
| `search:` | text | empty | Show only tasks containing this text (case-insensitive). |
| `==CATEGORY==` | one category per line | none | Category filter. Add several lines to filter on several categories (OR logic). |
| `cat-mode:` | `include`, `exclude` | `include` | `include` shows only tasks with the selected categories, `exclude` hides them. |
| `tags:` | `#tag1, #tag2` | none | Show ONLY tasks with these tags (OR logic). `#parent` also matches `#parent/child`. |
| `folders:` | `Folder1, Folder2` | none | Show ONLY tasks from these folders and their subfolders (OR logic, case-insensitive). |
| `date:` | `<next\|last\|current> <n> <days\|weeks\|months\|years>` | any time | Relative due date window, see below. |
| `from:` | `YYYY-MM-DD` | none | Start of a fixed due date range. |
| `to:` | `YYYY-MM-DD` | none | End of a fixed due date range. |
| `expanded:` | `true`, `false` | `true` | Whether the filter panel is open when the view renders. |
| `wrap:` | `true`, `false` | `true` | `true` shows the whole task text, wrapped over several lines. `false` keeps each task on one line and cuts it with "…" at the view width. |
| `kanban:` | `true`, `false` | `false` | Show the tasks as a kanban board instead of a list, see below. |
| `group:` | `category`, `status`, `day`, `week`, `month` | `category` | How the kanban board makes its columns. |

`exclude-tags:` and `exclude-folders:` are accepted as older aliases of `tags:` and `folders:`, with the same "show only" behaviour.

#### Relative dates (`date:`)

- `date: next 2 weeks`: from the start of the current week (Monday) to two weeks ahead. With `months` or `years`, from the start of the current month or year. `next 7 days` starts today.
- `date: last 7 days`: from seven days ago to today.
- `date: last 2 weeks`: from two weeks ago to the end of the current week (Sunday). With `months` or `years`, to the end of the current month or year.
- `date: current 1 months`: the current calendar month. `current` works with `days`, `weeks` (ISO week, Monday to Sunday), `months` and `years`. The number is ignored, but it must be there for the line to be read.

Use either `date:` or `from:`/`to:`, not both. Tasks without a due date are hidden while a date filter is active.

#### Kanban board (`kanban: true`)

Tasks stay plain task lines in your notes. The board is just another way to show them: every filter of the list view works the same, and cards keep the list sort order inside each column. Each card shows the checkbox, the task text with its categories and due date, and the note it comes from. Drag a card to another column to change the task line:

| `group:` | Columns | Dropping a card on a column |
| :--- | :--- | :--- |
| `category` | One per category, plus **NO CATEGORY**. A task with several categories shows in each of their columns. | Replaces all the task's categories with the column's category. On NO CATEGORY it removes them. |
| `status` | **Undone**, **In progress**, **Done** (only those allowed by the status filter). | Sets `[ ]`, `[/]` or `[x]`. |
| `day` | One per due date, plus today and **NO DATE**. | Sets the due date to that day. |
| `week` | One per ISO week (Monday to Sunday) with tasks, plus the current week and **NO DATE**. | Sets the due date to the Friday of that week. |
| `month` | One per month with tasks, plus the current month and **NO DATE**. | Sets the due date to the last working day (Monday to Friday) of that month. |

- Category columns come from the tasks the view shows before the status filter. A category column disappears when its last task moves out. To keep one on the board, select it in the category filter: with selected categories (IS mode) the board shows exactly those columns, even when empty.
- With a date filter, the board also shows the empty days, weeks or months in that range (up to 62 columns), and hides NO DATE, because undated tasks are filtered out.
- On NO DATE, a dropped card loses its due date. If a task has no date yet, the new date is added at the end of the line.
- Drag and drop needs a mouse. On touch devices (Obsidian mobile) the board can be viewed, but cards can't be dragged.

#### Tag and folder filters vs global exclusions

The plugin settings have global excluded folders and tags. They apply to every view **unless** the view sets its own `tags:` or `folders:`. In that case the global exclusions are ignored and the view shows only tasks that match one of its tags *or* one of its folders.

## Interactive Controls

- **Title**: click it to rename the view.
- **List / Stats checkboxes**: toggle the two views.
- **Filters checkbox**: show or hide the filter panel.
- **Search, tag and folder fields**: same as `search:`, `tags:` and `folders:`. The folder field suggests folders as you type.
- **Wrap checkbox** (next to the folder field): same as `wrap:`. Switch between full wrapped task text and one cut line per task. Hover over a cut task or file name to see the full text.
- **Kanban checkbox** (next to Wrap): same as `kanban:`. When on, a dropdown next to it picks the grouping, same as `group:`.
- **Status, sort and date dropdowns**: same as `status:`, `sort:` and `date:` / `from:` / `to:`. Pick "Any Time", "Relative" or "Range".
- **IS / NOT chip**: switch the category filter between include and exclude.
- **Category chips**: click to toggle a category. "ALL" clears the category filter.
- **Checkboxes in the list**: each click moves the task to the next status, `[ ]` → `[/]` → `[x]` → `[ ]`. The note is updated.
- **Due dates in the list**: click a date to change it with a date picker. The note is updated.
- **Save (💾)**: write the current filters back into the code block.
- **Refresh (⟳)**: force a manual vault scan.