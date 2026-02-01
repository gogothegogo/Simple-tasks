# Simple Tasks for Obsidian

A stateless, zero-database task management plugin for Obsidian. Simple Tasks scans your vault in real-time to aggregate tasks based on simple markdown syntax, without requiring complex setup or database maintenance.

## Features

- **Zero-Config**: Works out of the box by scanning standard markdown tasks.
- **Stateless**: No database to maintain; tasks are always up-to-date with your notes.
- **Powerful Filtering**: Filter by status, category, date range, tags, and text.
- **Exclusions**: Globally exclude specific folders (e.g., Templates, Archive) or tags.
- **Interactive View**: Toggle tasks, sort, and search directly from the task list.
- **Category Autocomplete**: Get suggestions for existing categories while you type.

## Installation

1.  Download the `main.js`, `manifest.json`, and `styles.css` files.
2.  Create a folder named `Simple-tasks` in your vault's `.obsidian/plugins/` directory.
3.  Place the downloaded files into that folder.
4.  Restart Obsidian or reload plugins.
5.  Enable "Simple Tasks" in **Settings > Community Plugins**.

## Task Syntax

Simple Tasks recognizes standard markdown tasks. You can add optional metadata like categories and due dates.

- **Standard Task**: `- [ ] Buy milk`
- **With Category**: `- [ ] ==Personal== Buy milk`
  - Categories are defined by highlighting text with `==`.
  - **Autocomplete**: Type `==` in any note to see a list of existing categories found in your vault.
- **With Due Date**: `- [ ] Buy milk 2025-03-01`
  - Dates must be in `YYYY-MM-DD` format.
- **With Tags**: `- [ ] Buy milk #groceries`

## Creating a Task View

To display tasks, create a code block using `simpletasks`. You can configure the view using a simple query syntax.

### Basic Usage

```simpletasks
status: all
```

### Advanced Filtering

You can combine multiple filters in the configuration line.

```simpletasks
filter: ==Work== done exclude: #archive sort: date
```

**Configuration Options:**

*   **Status**:
    *   `done`: Show only completed tasks.
    *   `undone`: Show only incomplete tasks.
    *   `all`: Show all tasks (default).
*   **Category Filter**:
    *   `==CategoryName==`: Only show tasks containing this specific highlighted category.
*   **Exclusions**:
    *   `exclude: #tag`: Exclude tasks that contain a specific tag.
*   **Sorting**:
    *   `sort: date`: Sort by due date (YYYY-MM-DD).
    *   `sort: file`: Sort alphabetically by file path.

## Interactive Filters

Once the view is rendered, you can refine the list using the controls at the top:

*   **Search**: Filter by text.
*   **Date Range**: Use the "From" and "To" date pickers to show tasks within a specific timeframe.
*   **Category Chips**: Click on the category names (e.g., `Work`, `Personal`) to instantly filter tasks by that category. Clicking "All" resets the filter.
*   **Refresh**: Re-scan the vault to pick up changes made in other notes.

## Settings

Go to **Settings > Simple Tasks** to configure global options.

*   **Excluded Folders**: Add folders here to completely ignore them during the vault scan (e.g., `Templates`, `Archive`). You can search and select existing folders from your vault.
*   **Excluded Tags**: Specify tags to globally exclude from all Simple Tasks views (e.g., `#hidden`).

## Usage Tips

*   **Click to Navigate**: Clicking the text of a task in the list will open the original note and scroll to the task.
*   **Autocomplete**: When creating tasks, type `==` to quickly select a category you've used before. This helps keep your categories consistent.