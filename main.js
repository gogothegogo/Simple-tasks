'use strict';

const { Plugin, PluginSettingTab, Setting, MarkdownRenderChild, AbstractInputSuggest, EditorSuggest, moment, MarkdownView, Notice } = require('obsidian');

// Kanban grouping options: [codeblock value, dropdown label]
const KANBAN_GROUPS = [['category', 'By Category'], ['status', 'By Status'], ['day', 'By Day'], ['week', 'By Week'], ['month', 'By Month']];
const NO_CATEGORY = 'NO CATEGORY';
const NO_DATE = 'NO DATE';

class TaskScanner {
    constructor(app, plugin) {
        this.app = app;
        this.plugin = plugin;
    }

    async scanVault(state, globalSettings) {
        const files = this.app.vault.getMarkdownFiles();
        const tasks = [];
        const categoriesSet = new Set();
        
        const globalExcludeFolders = (globalSettings.excludedFolders || []).map(f => f.trim().replace(/,$/, '')).filter(f => f);
        const globalExcludeTags = (globalSettings.excludedTags || []).map(t => t.trim().replace(/,$/, '')).filter(t => t);

        const localTags = state.excludedTags || [];
        const localFolders = state.excludedFolders || [];
        const hasLocalFilters = localTags.length > 0 || localFolders.length > 0;

        for (const file of files) {
            // Apply global folder exclusions ONLY if not overridden by local filters
            if (!hasLocalFilters && globalExcludeFolders.some(f => this.isPathInFolder(file.path, f))) continue;

            const cache = this.app.metadataCache.getFileCache(file);
            if (!cache || !cache.listItems) continue;

            const taskItems = cache.listItems.filter(item => item.task);
            if (taskItems.length === 0) continue;

            const fileTags = this.getAllTagsFromCache(cache);
            // Apply global tag exclusions ONLY if not overridden by local filters
            if (!hasLocalFilters && this.shouldExcludeByTags(fileTags, globalExcludeTags, [])) continue;

            const content = await this.app.vault.cachedRead(file);
            const lines = content.split('\n');

            for (const item of taskItems) {
                const i = item.position.start.line;
                const line = lines[i];
                if (!line) continue;

                const taskMatch = line.match(/^(\s*[-*]\s*)\[([ xX\/])\]\s*(.*)$/);
                if (taskMatch) {
                    const text = taskMatch[3];
                    // Extract categories
                    const categories = [];
                    const catRegex = /==([^=]+)==/g;
                    let match;
                    while ((match = catRegex.exec(text)) !== null) {
                        const cat = match[1].trim().toUpperCase();
                        if (cat) {
                            categories.push(cat);
                            categoriesSet.add(cat);
                        }
                    }

                    // Extract last date only
                    const dates = text.match(/\d{4}-\d{2}-\d{2}/g);
                    const lastDate = dates ? dates[dates.length - 1] : null;
                    
                    // Extract task-level tags
                    const taskTags = [];
                    const tagRegex = /#[\w\/-]+/g;
                    while ((match = tagRegex.exec(text)) !== null) {
                        taskTags.push(match[0]);
                    }

                    const allTaskTags = [...new Set([...fileTags, ...taskTags])];
                    // Apply global tag exclusions ONLY if not overridden by local filters
                    if (!hasLocalFilters && this.shouldExcludeByTags(allTaskTags, globalExcludeTags, [])) continue;

                    tasks.push({
                        file,
                        line: i,
                        // mark: ' ' open, 'x' done, '/' in progress. In progress counts as not done.
                        mark: taskMatch[2].toLowerCase(),
                        status: taskMatch[2].toLowerCase() === 'x',
                        text,
                        categories,
                        date: lastDate,
                        tags: allTaskTags
                    });
                }
            }
        }

        return { tasks, categoriesSet };
    }

    isPathInFolder(filePath, folderPath) {
        if (!folderPath) return false;
        const normalizedFile = filePath.toLowerCase();
        const normalizedFolder = folderPath.toLowerCase();
        return normalizedFile.startsWith(normalizedFolder + '/') || normalizedFile === normalizedFolder;
    }

    getAllTagsFromCache(cache) {
        const tags = new Set();
        if (cache.tags) {
            cache.tags.forEach(t => tags.add(t.tag));
        }
        if (cache.frontmatter && cache.frontmatter.tags) {
            const fmTags = cache.frontmatter.tags;
            if (Array.isArray(fmTags)) {
                fmTags.forEach(t => tags.add(t.startsWith('#') ? t : '#' + t));
            } else if (typeof fmTags === 'string') {
                fmTags.split(',').forEach(t => {
                    const trimmed = t.trim();
                    tags.add(trimmed.startsWith('#') ? trimmed : '#' + trimmed);
                });
            }
        }
        return Array.from(tags);
    }

    shouldExcludeByTags(tags, globalEx, localEx) {
        const isExcluded = (tag, excludeList) => {
            return excludeList.some(ex => {
                const normalizedEx = ex.startsWith('#') ? ex : '#' + ex;
                return tag === normalizedEx || tag.startsWith(normalizedEx + '/');
            });
        };
        return tags.some(tag => isExcluded(tag, globalEx) || isExcluded(tag, localEx));
    }
}

class CategorySuggest extends EditorSuggest {
    constructor(app, plugin) {
        super(app);
        this.app = app;
        this.plugin = plugin;
    }
    onTrigger(cursor, editor, file) {
        const line = editor.getLine(cursor.line);
        const sub = line.substring(0, cursor.ch);
        const match = sub.match(/(?:^|\s)(\[([ xX]?)\])([^\]]*)$/);
        if (match) {
            const startCh = match.index + match[0].indexOf(match[1]);
            return { start: { line: cursor.line, ch: startCh }, end: cursor, query: match[3] || "" };
        }
        return null;
    }
    getSuggestions(context) {
        const query = (context.query || "").toLowerCase().trim();
        const line = this.context.editor.getLine(context.start.line);
        const existing = new Set();
        const mRegex = /==([^=]+)==/g;
        let m;
        while ((m = mRegex.exec(line)) !== null) existing.add(m[1].trim().toLowerCase());
        const cache = this.plugin.globalCategoryCache || new Set();
        return Array.from(cache).filter(cat => {
            const l = cat.toLowerCase();
            return l.includes(query) && !existing.has(l);
        }).sort().map(cat => ({ label: cat.toUpperCase(), value: cat.toUpperCase() }));
    }
    renderSuggestion(suggestion, el) { el.setText(suggestion.label); }
    selectSuggestion(suggestion) {
        const { editor, start, end } = this.context;
        const line = editor.getLine(start.line);
        const match = line.substring(start.ch).match(/^\[([ xX]?)\]/);
        let status = (match && match[1]) ? match[1] : " ";
        if (status.trim() === "") status = " ";
        const isAlreadyTask = /^(\s*)[-*]\s*\[([ xX\/])\]/.test(line);
        if (isAlreadyTask) {
            editor.replaceRange(`==${suggestion.value}== `, start, end);
        } else {
            const indent = (line.match(/^(\s*)/) || [""])[0];
            const before = line.substring(0, start.ch).substring(indent.length).trim();
            const after = line.substring(end.ch).trim();
            const newLine = `${indent}- [${status}] ${before} ==${suggestion.value}== ${after}`.replace(/\s{2,}/g, ' ').trimEnd();
            editor.replaceRange(newLine, { line: start.line, ch: 0 }, { line: start.line, ch: line.length });
        }
    }
}

class FolderSuggest extends AbstractInputSuggest {
    constructor(app, textInputEl) { 
        super(app, textInputEl); 
        this.app = app; 
        this.inputEl = textInputEl;
    }
    getSuggestions(query) {
        const lowerCaseQuery = query.toLowerCase();
        const files = this.app.vault.getAllLoadedFiles();
        const folders = files.filter(f => f.children).map(f => f.path);
        return folders.filter(path => path.toLowerCase().includes(lowerCaseQuery) && path !== '/');
    }
    renderSuggestion(value, el) { el.setText(value); }
    selectSuggestion(value) {
        const isSettingTab = this.inputEl.placeholder === 'Search folders...';
        if (isSettingTab) {
            this.inputEl.value = value;
            this.inputEl.dispatchEvent(new Event('input'));
        } else {
            const currentVal = this.inputEl.value;
            const parts = currentVal.split(',').map(p => p.trim());
            parts.pop(); // Remove the partial query
            parts.push(value);
            this.inputEl.value = parts.join(', ') + ', ';
            this.inputEl.dispatchEvent(new Event('input'));
        }
        this.close();
    }
}

class SimpleTasksSettingTab extends PluginSettingTab {
    constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
    renderFolderList(container) {
        container.empty();
        if (this.plugin.settings.excludedFolders.length === 0) {
            container.createDiv({ text: 'No folders excluded.', cls: 'setting-item-description' });
            return;
        }
        this.plugin.settings.excludedFolders.forEach(folder => {
            const item = container.createDiv('simple-tasks-excluded-item');
            Object.assign(item.style, { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 10px', marginBottom: '5px', backgroundColor: 'var(--background-secondary)', borderRadius: '4px' });
            item.createSpan({ text: folder });
            const removeBtn = item.createEl('button', { text: 'Remove' });
            removeBtn.onclick = async () => {
                this.plugin.settings.excludedFolders = this.plugin.settings.excludedFolders.filter(f => f !== folder);
                await this.plugin.saveSettings(); this.renderFolderList(container);
            };
        });
    }
    display() {
        const { containerEl } = this; containerEl.empty();
        containerEl.createEl('h2', { text: 'Simple Tasks Settings' });
        new Setting(containerEl).setName('Excluded Folders').setDesc('Folders to ignore during scanning.').setHeading();
        const foldersContainer = containerEl.createDiv(); this.renderFolderList(foldersContainer);
        new Setting(containerEl).setName('Add Folder')
            .addText(text => { text.inputEl.placeholder = 'Search folders...'; new FolderSuggest(this.app, text.inputEl); })
            .addButton(btn => btn.setButtonText('Add').setCta().onClick(async () => {
                const input = btn.buttonEl.parentElement.querySelector('input');
                const val = input.value.trim();
                if (val && !this.plugin.settings.excludedFolders.includes(val)) {
                    this.plugin.settings.excludedFolders.push(val);
                    await this.plugin.saveSettings(); input.value = ''; this.renderFolderList(foldersContainer);
                }
            }));
        new Setting(containerEl).setName('Excluded Tags').setDesc('Tasks containing these tags will be ignored.').addTextArea(text => text.setPlaceholder('#archive\n#hidden').setValue(this.plugin.settings.excludedTags.join('\n')).onChange(async (value) => {
            this.plugin.settings.excludedTags = value.split('\n').map(s => s.trim()).filter(s => s.length > 0);
            await this.plugin.saveSettings();
        }));
    }
}

class SimpleTasksView extends MarkdownRenderChild {
    constructor(app, plugin, source, el, ctx) {
        super(el);
        this.app = app; this.plugin = plugin; this.globalSettings = plugin.settings;
        this.source = source; this.ctx = ctx; this.containerEl = el;
        this.scanner = new TaskScanner(app, plugin);
        const config = this.parseConfig(source);
        this.state = {
            title: config.title || "Simple Tasks",
            showList: config.showList !== undefined ? config.showList : true,
            showStats: config.showStats !== undefined ? config.showStats : false,
            statusFilter: config.status || "all",
            sortBy: config.sort || "date",
            excludedTags: config.excludedTags || [],
            excludedFolders: config.excludedFolders || [],
            searchTerm: config.search || "",
            filterCategories: config.filterCategories || new Set(),
            categoryFilterMode: config.categoryFilterMode || 'include',
            dateRangeMode: config.dateRangeMode || 'all',
            relDirection: config.relDirection || 'next', relNumber: config.relNumber || 1, relUnit: config.relUnit || 'weeks',
            specificFrom: config.specificFrom || "", specificTo: config.specificTo || "",
            tasks: [], availableCategories: new Set(), loading: true,
            filtersExpanded: config.expanded !== undefined ? config.expanded : true,
            wrapText: config.wrap !== undefined ? config.wrap : true,
            kanban: config.kanban || false,
            groupBy: config.group || 'category'
        };
        this.refreshTimer = null;
    }
    onload() { 
        this.init(); 
        this.registerEvent(this.app.metadataCache.on('resolved', () => {
            if (this.refreshTimer) clearTimeout(this.refreshTimer);
            this.refreshTimer = setTimeout(() => this.refresh(), 1000);
        }));
    }
    onunload() { if (this.refreshTimer) clearTimeout(this.refreshTimer); }
    async refresh() { await this.scanVault(); this.renderHeader(); this.renderList(); }
    parseConfig(source) {
        const config = { filterCategories: new Set(), categoryFilterMode: 'include', status: 'all', excludedTags: [], excludedFolders: [], sort: 'date', title: null, showList: true, showStats: false, search: "", dateRangeMode: 'all' };
        source.split('\n').forEach(line => {
            const l = line.trim();
            if (l.startsWith('title:')) config.title = l.replace('title:', '').trim();
            else if (l.startsWith('view:')) { const v = l.replace('view:', '').trim(); config.showList = v.includes('list'); config.showStats = v.includes('stats'); }
            else if (l.startsWith('status:')) config.status = l.replace('status:', '').trim();
            else if (l.startsWith('cat-mode:')) config.categoryFilterMode = l.replace('cat-mode:', '').trim();
            else if (l.startsWith('sort:')) config.sort = l.replace('sort:', '').trim();
            else if (l.startsWith('search:')) config.search = l.replace('search:', '').trim();
            else if (l.startsWith('tags:')) config.excludedTags = l.replace('tags:', '').split(',').map(t => t.trim()).filter(t => t);
            else if (l.startsWith('exclude-tags:')) config.excludedTags = l.replace('exclude-tags:', '').split(',').map(t => t.trim()).filter(t => t);
            else if (l.startsWith('folders:')) config.excludedFolders = l.replace('folders:', '').split(',').map(f => f.trim()).filter(f => f);
            else if (l.startsWith('exclude-folders:')) config.excludedFolders = l.replace('exclude-folders:', '').split(',').map(f => f.trim()).filter(f => f);
            else if (l.startsWith('expanded:')) config.expanded = l.replace('expanded:', '').trim() === 'true';
            else if (l.startsWith('wrap:')) config.wrap = l.replace('wrap:', '').trim() !== 'false';
            else if (l.startsWith('kanban:')) config.kanban = l.replace('kanban:', '').trim() === 'true';
            else if (l.startsWith('group:')) { const g = l.replace('group:', '').trim(); if (KANBAN_GROUPS.some(([v]) => v === g)) config.group = g; }
            else if (l.startsWith('from:')) { config.specificFrom = l.replace('from:', '').trim(); config.dateRangeMode = 'specific'; }
            else if (l.startsWith('to:')) { config.specificTo = l.replace('to:', '').trim(); config.dateRangeMode = 'specific'; }
            else if (l.startsWith('date:')) {
                const parts = l.replace('date:', '').trim().split(' ');
                if (parts.length >= 3) { config.dateRangeMode = 'relative'; config.relDirection = parts[0]; config.relNumber = parseInt(parts[1]); config.relUnit = parts[2]; }
            }
            const catMatch = l.match(/==([^=]+)==/);
            if (catMatch) config.filterCategories.add(catMatch[1].trim().toLowerCase());
        });
        return config;
    }
    async init() { this.containerEl.addClass('simple-tasks-container'); await this.scanVault(); this.renderHeader(); this.renderList(); }
    renderHeader() {
        this.containerEl.empty();
        const topRow = this.containerEl.createDiv('simple-tasks-top-row');
        const titleContainer = topRow.createDiv('simple-tasks-title-container');
        const renderTitle = () => {
            titleContainer.empty();
            const titleEl = titleContainer.createEl('h3', { text: this.state.title || "Simple Tasks", cls: 'simple-tasks-title-display' });
            titleEl.onclick = () => {
                titleContainer.empty();
                const input = titleContainer.createEl('input', { type: 'text', value: this.state.title, cls: 'simple-tasks-title-edit' });
                input.focus();
                input.onblur = () => { this.state.title = input.value; renderTitle(); };
                input.onkeydown = (e) => { if (e.key === 'Enter') { this.state.title = input.value; renderTitle(); } };
            };
        };
        renderTitle();
        this.containerEl.toggleClass('simple-tasks-nowrap', !this.state.wrapText);
        const actionsContainer = topRow.createDiv('simple-tasks-actions');

        const listLabel = actionsContainer.createEl('label', { cls: 'simple-tasks-checkbox-label' });
        const listCb = listLabel.createEl('input', { type: 'checkbox' }); listCb.checked = this.state.showList;
        listLabel.appendText(' List');
        listCb.onchange = (e) => { this.state.showList = e.target.checked; this.renderList(); };

        const statsLabel = actionsContainer.createEl('label', { cls: 'simple-tasks-checkbox-label' });
        const statsCb = statsLabel.createEl('input', { type: 'checkbox' }); statsCb.checked = this.state.showStats;
        statsLabel.appendText(' Stats');
        statsCb.onchange = (e) => { this.state.showStats = e.target.checked; this.renderList(); };

        const toggleLabel = actionsContainer.createEl('label', { cls: 'simple-tasks-checkbox-label' });
        const toggleCb = toggleLabel.createEl('input', { type: 'checkbox' }); toggleCb.checked = this.state.filtersExpanded;
        toggleLabel.appendText(' Filters');
        toggleCb.onchange = (e) => { this.state.filtersExpanded = e.target.checked; this.filterWrapper.style.display = this.state.filtersExpanded ? 'block' : 'none'; };
        
        const saveBtn = actionsContainer.createEl('button', { text: '💾', cls: 'clickable-icon', title: 'Save settings to block' });
        saveBtn.onclick = () => this.saveSettingsToCodeBlock();
        const refreshBtn = actionsContainer.createEl('button', { text: '⟳', cls: 'clickable-icon', title: 'Refresh' });
        refreshBtn.onclick = () => this.refresh();

        this.filterWrapper = this.containerEl.createDiv('simple-tasks-filter-wrapper');
        if (!this.state.filtersExpanded) this.filterWrapper.style.display = 'none';

        const row1 = this.filterWrapper.createDiv('simple-tasks-header-row simple-tasks-row-evenly');
        const searchInput = row1.createEl('input', { type: 'text', placeholder: 'Search...', cls: 'simple-tasks-input-long' });
        searchInput.value = this.state.searchTerm; searchInput.oninput = (e) => { this.state.searchTerm = e.target.value; this.renderList(); };

        const exTags = row1.createEl('input', { type: 'text', placeholder: 'Exclude tags...', cls: 'simple-tasks-input-long' });
        exTags.value = this.state.excludedTags.join(', ');
        exTags.oninput = (e) => { 
            this.state.excludedTags = e.target.value.split(',').map(t => t.trim()).filter(t => t);     
            this.renderList(); 
        };
        
        const exFolders = row1.createEl('input', { type: 'text', placeholder: 'Exclude folders...', cls: 'simple-tasks-input-long' });
        exFolders.value = this.state.excludedFolders.join(', '); 
        exFolders.oninput = (e) => { 
            this.state.excludedFolders = e.target.value.split(',').map(f => f.trim()).filter(f => f);
            this.renderList();
        };

        const wrapLabel = row1.createEl('label', { cls: 'simple-tasks-checkbox-label simple-tasks-compact', title: 'Wrap long tasks, or cut them to one line' });
        const wrapCb = wrapLabel.createEl('input', { type: 'checkbox' }); wrapCb.checked = this.state.wrapText;
        wrapLabel.appendText(' Wrap');
        wrapCb.onchange = (e) => { this.state.wrapText = e.target.checked; this.containerEl.toggleClass('simple-tasks-nowrap', !this.state.wrapText); };

        const kanbanLabel = row1.createEl('label', { cls: 'simple-tasks-checkbox-label simple-tasks-compact', title: 'Show tasks as a kanban board instead of a list' });
        const kanbanCb = kanbanLabel.createEl('input', { type: 'checkbox' }); kanbanCb.checked = this.state.kanban;
        kanbanLabel.appendText(' Kanban');
        kanbanCb.onchange = (e) => { this.state.kanban = e.target.checked; this.renderHeader(); this.renderList(); };
        if (this.state.kanban) {
            const groupSelect = row1.createEl('select', { cls: 'simple-tasks-compact', title: 'Group kanban columns by' });
            KANBAN_GROUPS.forEach(([v, l]) => {
                const opt = groupSelect.createEl('option', { value: v, text: l }); if (this.state.groupBy === v) opt.selected = true;
            });
            groupSelect.onchange = (e) => { this.state.groupBy = e.target.value; this.renderList(); };
        }

        const row2 = this.filterWrapper.createDiv('simple-tasks-header-row');
        const statusSelect = row2.createEl('select');
        [['all', 'All'], ['undone', 'Undone'], ['done', 'Done']].forEach(([v, l]) => {
            const opt = statusSelect.createEl('option', { value: v, text: l }); if (this.state.statusFilter === v) opt.selected = true;
        });
        statusSelect.onchange = (e) => { this.state.statusFilter = e.target.value; this.renderList(); };
        const sortSelect = row2.createEl('select');
        [['date', 'By Date'], ['name', 'By Name']].forEach(([v, l]) => {
            const opt = sortSelect.createEl('option', { value: v, text: l }); if (this.state.sortBy === v) opt.selected = true;
        });
        sortSelect.onchange = (e) => { this.state.sortBy = e.target.value; this.renderList(); };
        const modeSelect = row2.createEl('select');
        [['all', 'Any Time'], ['relative', 'Relative'], ['specific', 'Range']].forEach(([v, l]) => {
            const opt = modeSelect.createEl('option', { value: v, text: l }); if (this.state.dateRangeMode === v) opt.selected = true;
        });
        modeSelect.onchange = (e) => { this.state.dateRangeMode = e.target.value; this.renderHeader(); this.renderList(); };

        if (this.state.dateRangeMode === 'relative') {
            const rel = row2.createDiv('simple-tasks-date-controls');
            const dir = rel.createEl('select'); [['next', 'Next'], ['last', 'Last'], ['current', 'Current']].forEach(([v, l]) => {
                const opt = dir.createEl('option', { value: v, text: l }); if (this.state.relDirection === v) opt.selected = true;
            });
            dir.onchange = (e) => { this.state.relDirection = e.target.value; this.renderHeader(); this.renderList(); };
            const isCurrent = this.state.relDirection === 'current';
            if (!isCurrent) {
                const num = rel.createEl('input', { type: 'number', value: this.state.relNumber, cls: 'simple-tasks-number-short' });
                num.oninput = (e) => { this.state.relNumber = parseInt(e.target.value) || 0; this.renderList(); };
            }
            const unit = rel.createEl('select');
            const unitOptions = isCurrent
                ? [['days', 'day'], ['weeks', 'week'], ['months', 'month'], ['years', 'year']]
                : [['days', 'days'], ['weeks', 'weeks'], ['months', 'months'], ['years', 'years']];
            unitOptions.forEach(([v, l]) => {
                const opt = unit.createEl('option', { value: v, text: l }); if (this.state.relUnit === v) opt.selected = true;
            });
            unit.onchange = (e) => { this.state.relUnit = e.target.value; this.renderList(); };
        } else if (this.state.dateRangeMode === 'specific') {
            const spec = row2.createDiv('simple-tasks-date-controls');
            const f = spec.createEl('input', { type: 'date' }); f.value = this.state.specificFrom; f.onchange = (e) => { this.state.specificFrom = e.target.value; this.renderList(); };
            const t = spec.createEl('input', { type: 'date' }); t.value = this.state.specificTo; t.onchange = (e) => { this.state.specificTo = e.target.value; this.renderList(); };
        }
        
        this.categoryBar = row2.createDiv('simple-tasks-bar-inline');
        this.renderCategoryBar();
        this.listContainer = this.containerEl.createDiv();
    }
    renderCategoryBar() {
        if (!this.categoryBar) return; this.categoryBar.empty();

        const modeBtn = this.categoryBar.createEl('div', { 
            text: this.state.categoryFilterMode === 'include' ? 'IS' : 'NOT', 
            cls: `simple-tasks-chip simple-tasks-mode-toggle ${this.state.categoryFilterMode === 'exclude' ? 'is-exclude' : ''}`,
            title: 'Toggle between Include and Exclude mode'
        });
        modeBtn.onclick = () => {
            this.state.categoryFilterMode = this.state.categoryFilterMode === 'include' ? 'exclude' : 'include';
            this.renderCategoryBar();
            this.renderList();
        };

        const clearBtn = this.categoryBar.createEl('div', { text: 'ALL', cls: 'simple-tasks-chip' });
        clearBtn.onclick = () => { this.state.filterCategories.clear(); this.renderCategoryBar(); this.renderList(); };
        
        Array.from(this.state.availableCategories).sort().forEach(cat => {
            const isActive = this.state.filterCategories.has(cat.toLowerCase());
            const chipCls = `simple-tasks-chip ${isActive ? 'is-active' : ''} ${isActive && this.state.categoryFilterMode === 'exclude' ? 'is-destructive' : ''}`;
            const chip = this.categoryBar.createEl('div', { text: cat.toUpperCase(), cls: chipCls });
            chip.onclick = () => { if (isActive) this.state.filterCategories.delete(cat.toLowerCase()); else this.state.filterCategories.add(cat.toLowerCase()); this.renderCategoryBar(); this.renderList(); };
        });
    }
    async saveSettingsToCodeBlock() {
        const section = this.ctx.getSectionInfo(this.containerEl); if (!section) { new Notice("Cannot find code block."); return; }
        const view = this.app.workspace.getActiveViewOfType(MarkdownView); if (!view) return;
        const newLines = []; if (this.state.title) newLines.push(`title: ${this.state.title}`);
        const views = []; if (this.state.showList) views.push('list'); if (this.state.showStats) views.push('stats');
        newLines.push(`view: ${views.join(' ')}`);
        if (this.state.statusFilter !== 'all') newLines.push(`status: ${this.state.statusFilter}`);
        if (this.state.categoryFilterMode !== 'include') newLines.push(`cat-mode: ${this.state.categoryFilterMode}`);
        if (this.state.sortBy !== 'date') newLines.push(`sort: ${this.state.sortBy}`);
        if (this.state.searchTerm) newLines.push(`search: ${this.state.searchTerm}`);
        if (this.state.excludedTags.length > 0) newLines.push(`tags: ${this.state.excludedTags.join(', ')}`);
        if (this.state.excludedFolders.length > 0) newLines.push(`folders: ${this.state.excludedFolders.join(', ')}`);
        newLines.push(`expanded: ${this.state.filtersExpanded}`);
        if (!this.state.wrapText) newLines.push('wrap: false');
        if (this.state.kanban) { newLines.push('kanban: true'); newLines.push(`group: ${this.state.groupBy}`); }
        if (this.state.dateRangeMode === 'relative') newLines.push(`date: ${this.state.relDirection} ${this.state.relNumber} ${this.state.relUnit}`);
        else if (this.state.dateRangeMode === 'specific') { if (this.state.specificFrom) newLines.push(`from: ${this.state.specificFrom}`); if (this.state.specificTo) newLines.push(`to: ${this.state.specificTo}`); }
        this.state.filterCategories.forEach(cat => newLines.push(`==${cat}==`));
        const content = await this.app.vault.read(view.file); const lines = content.split('\n');
        lines.splice(section.lineStart + 1, section.lineEnd - section.lineStart - 1, ...newLines);
        await this.app.vault.modify(view.file, lines.join('\n')); new Notice("Filters saved!");
    }
    async scanVault() {
        const { tasks, categoriesSet } = await this.scanner.scanVault(this.state, this.globalSettings);
        this.state.tasks = tasks; this.state.availableCategories = categoriesSet; this.state.loading = false;
        const plugin = this.app.plugins.getPlugin('simple-tasks'); if (plugin) plugin.globalCategoryCache = categoriesSet;
    }
    renderList() {
        if (!this.listContainer) return; this.listContainer.empty();
        if (this.state.loading) { this.listContainer.createDiv({ text: 'Scanning...' }); return; }
        
        const localTags = this.state.excludedTags || [];
        const localFolders = this.state.excludedFolders || [];
        const hasLocalFilters = localTags.length > 0 || localFolders.length > 0;
        
        const globalExcludeFolders = this.globalSettings.excludedFolders || [];
        const globalExcludeTags = this.globalSettings.excludedTags || [];
        const dateRange = this.getDateRange();

        let statsScopedTasks = this.state.tasks.filter(t => {
            const matchesLocalTags = localTags.length > 0 && t.tags.some(tag => 
                localTags.some(ex => {
                    const nEx = ex.startsWith('#') ? ex : '#' + ex;
                    return tag === nEx || tag.startsWith(nEx + '/');
                })
            );
            
            const matchesLocalFolders = localFolders.length > 0 && localFolders.some(f => 
                t.file.path.toLowerCase().startsWith(f.toLowerCase() + '/') || t.file.path.toLowerCase() === f.toLowerCase()
            );

            const matchesGlobalTags = globalExcludeTags.some(ex => {
                const nEx = ex.startsWith('#') ? ex : '#' + ex;
                return t.tags.some(tag => tag === nEx || tag.startsWith(nEx + '/'));
            });

            const matchesGlobalFolders = globalExcludeFolders.some(f => 
                t.file.path.toLowerCase().startsWith(f.toLowerCase() + '/') || t.file.path.toLowerCase() === f.toLowerCase()
            );

            if (hasLocalFilters) {
                if (!(matchesLocalTags || matchesLocalFolders)) return false;
            } else {
                if (matchesGlobalTags || matchesGlobalFolders) return false;
            }

            if (this.state.filterCategories.size > 0) {
                const hasSelectedCat = t.categories.some(c => this.state.filterCategories.has(c.toLowerCase()));
                if (this.state.categoryFilterMode === 'include') {
                    if (!hasSelectedCat) return false;
                } else {
                    if (hasSelectedCat) return false;
                }
            }

            if (dateRange) {
                if (dateRange.from && (!t.date || t.date < dateRange.from)) return false;
                if (dateRange.to && (!t.date || t.date > dateRange.to)) return false;
            }
            if (this.state.searchTerm && !t.text.toLowerCase().includes(this.state.searchTerm.toLowerCase())) return false;
            return true;
        });

        let filtered = statsScopedTasks.filter(t => {
            if (this.state.statusFilter === 'done' && !t.status) return false;
            if (this.state.statusFilter === 'undone' && t.status) return false;
            return true;
        });

        if (this.state.showStats) this.renderStats(statsScopedTasks);
        if (!this.state.showList) return;
        const sortKey = (t) => t.replace(/==[^=]+==/g, '').replace(/\s/g, '');
        // Status groups first: in progress, then open, then done
        const statusRank = { '/': 0, ' ': 1, 'x': 2 };
        filtered.sort((a, b) => {
            const rank = (t) => (t.mark in statusRank) ? statusRank[t.mark] : 1;
            const s = rank(a) - rank(b);
            if (s !== 0) return s;
            const cmpName = () => sortKey(a.text).localeCompare(sortKey(b.text), undefined, { sensitivity: 'base' });
            if (this.state.sortBy === 'date') {
                if (!a.date && !b.date) return cmpName();
                if (!a.date) return 1;
                if (!b.date) return -1;
                const d = a.date.localeCompare(b.date);
                return d !== 0 ? d : cmpName();
            }
            return cmpName();
        });
        if (this.state.kanban) { this.renderKanban(filtered, dateRange, statsScopedTasks); return; }
        const ul = this.listContainer.createEl('ul', { cls: 'simple-tasks-list' });
        if (filtered.length === 0) { ul.createEl('li', { text: 'No matching tasks.', cls: 'simple-tasks-empty' }); return; }
        filtered.forEach(task => this.renderTaskRow(ul.createEl('li', { cls: 'simple-tasks-item' }), task));
    }

    // Checkbox, task text and file name of one task. Used by list rows and kanban cards.
    renderTaskRow(el, task) {
            // Same markup as Obsidian's own task checkboxes, so themes can draw [/] as half done
            const cb = el.createEl('input', { type: 'checkbox', cls: 'simple-tasks-checkbox' }); cb.checked = task.mark !== ' '; cb.dataset.task = task.mark;
            cb.onclick = async (e) => { e.stopPropagation(); await this.toggleTask(task); };
                        const div = el.createDiv('simple-tasks-content');
                        // Extract the task text without the checkbox part
                        const taskText = task.text;
                        
                        // Regex to find all dates to identify the last one
                        const dateRegex = /\d{4}-\d{2}-\d{2}/g;
                        const dates = taskText.match(dateRegex);
                        const lastDate = dates ? dates[dates.length - 1] : null;
                        let lastDateFound = false;
            
                        // We split by categories, dates, and tags
                        // We need to be careful to only treat the LAST occurrence of a date as special
                        const parts = taskText.split(/(==[^=]+==)|(\d{4}-\d{2}-\d{2})|(#[w/-]+)/g).filter(p => p);
                        
                        // Find the index of the last date part
                        let lastDatePartIndex = -1;
                        for (let i = parts.length - 1; i >= 0; i--) {
                            if (parts[i] && parts[i].match(/^\d{4}-\d{2}-\d{2}$/)) {
                                lastDatePartIndex = i;
                                break;
                            }
                        }
            
                        parts.forEach((part, idx) => {
                            if (part && part.startsWith('==')) {
                                div.createSpan({ cls: 'simple-tasks-category', text: part.replace(/==/g, '').toUpperCase() });
                            } else if (part && part.match(/^\d{4}-\d{2}-\d{2}$/)) {
                                if (idx === lastDatePartIndex) {
                                    const dateSpan = div.createSpan({
                                        cls: 'simple-tasks-date-text is-interactive',
                                        text: part
                                    });
                                    dateSpan.onclick = (e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        
                                        // Aggressive cleanup
                                        document.querySelectorAll('.simple-tasks-hidden-picker').forEach(p => p.remove());

                                        const picker = document.createElement('input');
                                        picker.type = 'date';
                                        picker.className = 'simple-tasks-hidden-picker';
                                        
                                        const isDark = document.body.classList.contains('theme-dark');
                                        // Use direct click coordinates for the anchor
                                        const x = e.clientX;
                                        const y = e.clientY;

                                        Object.assign(picker.style, {
                                            position: 'fixed',
                                            left: x + 'px',
                                            top: y + 'px',
                                            width: '20px',
                                            height: '20px',
                                            opacity: '0.01',
                                            zIndex: '10001',
                                            pointerEvents: 'auto',
                                            colorScheme: isDark ? 'dark' : 'light'
                                        });
                                        
                                        document.body.appendChild(picker);
                                        picker.value = part;
                                        
                                        picker.onchange = async (ev) => {
                                            const newDate = ev.target.value;
                                            if (newDate && newDate !== part) {
                                                await this.updateTaskDate(task, part, newDate);
                                            }
                                            picker.remove();
                                        };
                                        
                                        picker.onblur = () => {
                                            // Allow some time for the change event to fire before removal
                                            setTimeout(() => { if(picker.parentNode) picker.remove(); }, 500);
                                        };

                                        // Use requestAnimationFrame to ensure the browser has laid out the element 
                                        // before triggering the native picker, which fixes 'top-left' anchoring.
                                        requestAnimationFrame(() => {
                                            picker.focus();
                                            if (picker.showPicker) {
                                                picker.showPicker();
                                            } else {
                                                picker.click();
                                            }
                                        });
                                    };
                                } else {
                                    // Not the last date, render as normal text
                                    div.createSpan({ text: part });
                                }
                            } else if (part && part.startsWith('#')) {
                                div.createSpan({ cls: 'simple-tasks-tag-text', text: part });
                            } else if (part) {
                                div.createSpan({ text: part });
                            }
                        });
                        const fileHint = el.createSpan({ text: task.file.basename, cls: 'simple-tasks-file-hint' });
                        // Show the full text on hover, but only when it is cut with an ellipsis
                        [div, fileHint].forEach(cutEl => cutEl.addEventListener('mouseenter', () => {
                            const isCut = cutEl.scrollWidth > cutEl.clientWidth || cutEl.scrollHeight > cutEl.clientHeight;
                            if (isCut) cutEl.setAttribute('title', cutEl.textContent); else cutEl.removeAttribute('title');
                        }));
                        div.onclick = () => {
                            this.app.workspace.getLeaf().openFile(task.file, { eState: { line: task.line } });
                        };
    }

    // ----- Kanban -----

    // Columns as [{ key, label, tasks, isCurrent }]. Tasks keep the list sort order inside each column.
    // scopeTasks are the tasks before the status filter: category columns come from them, so a column
    // does not vanish when its tasks are only hidden by the status filter.
    buildKanbanColumns(tasks, dateRange, scopeTasks) {
        const group = this.state.groupBy;
        const columns = new Map();
        const addColumn = (key, label, isCurrent) => { if (!columns.has(key)) columns.set(key, { key, label, tasks: [], isCurrent: !!isCurrent }); return columns.get(key); };

        if (group === 'status') {
            const status = this.state.statusFilter;
            if (status !== 'done') { addColumn(' ', 'Undone'); addColumn('/', 'In progress'); }
            if (status !== 'undone') addColumn('x', 'Done');
            tasks.forEach(t => { if (columns.has(t.mark)) columns.get(t.mark).tasks.push(t); });
            return Array.from(columns.values());
        }

        if (group === 'category') {
            const selected = Array.from(this.state.filterCategories).map(c => c.toUpperCase());
            if (selected.length > 0 && this.state.categoryFilterMode === 'include') {
                // Only the selected categories, also when empty, so they work as drop targets
                selected.sort().forEach(c => addColumn(c, c));
            } else {
                addColumn(NO_CATEGORY, NO_CATEGORY);
                const excluded = this.state.categoryFilterMode === 'exclude' ? selected : [];
                Array.from(new Set([].concat(...scopeTasks.map(t => t.categories)))).filter(c => !excluded.includes(c)).sort().forEach(c => addColumn(c, c));
            }
            tasks.forEach(t => {
                const cats = t.categories.length > 0 ? t.categories : [NO_CATEGORY];
                cats.forEach(c => { if (columns.has(c)) columns.get(c).tasks.push(t); });
            });
            return Array.from(columns.values());
        }

        // day, week or month: one column per period, oldest first
        const keys = new Set(tasks.filter(t => t.date).map(t => this.periodKey(t.date)));
        keys.add(this.periodKey(moment().format('YYYY-MM-DD')));
        if (dateRange && dateRange.from && dateRange.to) {
            // Every period of the date filter, so empty ones can be dropped on (capped for long ranges)
            const unit = group === 'week' ? 'isoWeek' : group;
            const cursor = moment(dateRange.from).startOf(unit), last = moment(dateRange.to);
            for (let i = 0; i < 62 && !cursor.isAfter(last); i++) { keys.add(this.periodKey(cursor.format('YYYY-MM-DD'))); cursor.add(1, group === 'week' ? 'weeks' : group + 's'); }
        }
        const currentKey = this.periodKey(moment().format('YYYY-MM-DD'));
        Array.from(keys).sort().forEach(k => addColumn(k, this.periodLabel(k), k === currentKey));
        // Undated tasks only exist when no date filter is set
        if (!dateRange) addColumn(NO_DATE, NO_DATE);
        tasks.forEach(t => { const k = t.date ? this.periodKey(t.date) : NO_DATE; if (columns.has(k)) columns.get(k).tasks.push(t); });
        return Array.from(columns.values());
    }

    // Column key of a date: the day itself, the Monday of its ISO week, or YYYY-MM
    periodKey(date) {
        const m = moment(date, 'YYYY-MM-DD');
        if (this.state.groupBy === 'week') return m.startOf('isoWeek').format('YYYY-MM-DD');
        if (this.state.groupBy === 'month') return m.format('YYYY-MM');
        return m.format('YYYY-MM-DD');
    }

    periodLabel(key) {
        if (this.state.groupBy === 'week') {
            const m = moment(key, 'YYYY-MM-DD');
            return `W${m.isoWeek()} · ${m.format('D MMM')} – ${m.clone().add(6, 'days').format('D MMM YYYY')}`;
        }
        if (this.state.groupBy === 'month') return moment(key, 'YYYY-MM').format('MMMM YYYY');
        return moment(key, 'YYYY-MM-DD').format('ddd D MMM YYYY');
    }

    // Due date a task gets when dropped on a column: the day, or the last working day (Mon-Fri) of the week or month
    dropDate(key) {
        if (this.state.groupBy === 'week') return moment(key, 'YYYY-MM-DD').isoWeekday(5).format('YYYY-MM-DD');
        if (this.state.groupBy === 'month') {
            const m = moment(key, 'YYYY-MM').endOf('month');
            while (m.isoWeekday() > 5) m.subtract(1, 'days');
            return m.format('YYYY-MM-DD');
        }
        return key;
    }

    renderKanban(tasks, dateRange, scopeTasks) {
        const columns = this.buildKanbanColumns(tasks, dateRange, scopeTasks);
        const board = this.listContainer.createDiv('simple-tasks-board');
        columns.forEach(col => {
            const colEl = board.createDiv('simple-tasks-column');
            const head = colEl.createDiv({ cls: 'simple-tasks-column-head' + (col.isCurrent ? ' is-current' : '') });
            head.createSpan({ text: col.label, cls: 'simple-tasks-column-title' });
            head.createSpan({ text: String(col.tasks.length), cls: 'simple-tasks-column-count' });
            const body = colEl.createDiv('simple-tasks-column-body');
            col.tasks.forEach(task => {
                const card = body.createDiv('simple-tasks-item simple-tasks-card');
                this.renderTaskRow(card, task);
                card.draggable = true;
                card.addEventListener('dragstart', (e) => {
                    this.drag = { task, from: col.key };
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', task.text);
                    card.addClass('is-dragging');
                });
                card.addEventListener('dragend', () => {
                    card.removeClass('is-dragging');
                    board.querySelectorAll('.is-drop-target').forEach(b => b.removeClass('is-drop-target'));
                    this.drag = null;
                });
            });
            body.addEventListener('dragover', (e) => {
                if (!this.drag || this.drag.from === col.key) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                body.addClass('is-drop-target');
            });
            body.addEventListener('dragleave', (e) => { if (!body.contains(e.relatedTarget)) body.removeClass('is-drop-target'); });
            body.addEventListener('drop', async (e) => {
                if (!this.drag || this.drag.from === col.key) return;
                e.preventDefault();
                body.removeClass('is-drop-target');
                const task = this.drag.task; this.drag = null;
                await this.moveTaskToColumn(task, col.key);
            });
        });

        // Every change redraws the board, so keep the horizontal scroll position. It is stored per
        // code block on the plugin, so it also survives Obsidian re-rendering the whole code block.
        if (!this.plugin.boardScroll) this.plugin.boardScroll = new Map();
        const scrollKey = `${this.ctx.sourcePath}\n${this.source}`;
        board.scrollLeft = this.plugin.boardScroll.get(scrollKey) || 0;
        board.addEventListener('scroll', () => this.plugin.boardScroll.set(scrollKey, board.scrollLeft));
    }

    // Rewrites the task line for the column it was dropped on
    async moveTaskToColumn(task, key) {
        const group = this.state.groupBy;
        await this.modifyTaskLine(task, (prefix, mark, text) => {
            if (group === 'status') return { mark: key, text };
            if (group === 'category') {
                // Dropping replaces all categories with the column's one
                const rest = text.replace(/==[^=]+==/g, '').replace(/\s{2,}/g, ' ').trim();
                return { mark, text: key === NO_CATEGORY ? rest : `==${key}== ${rest}`.trim() };
            }
            const dates = text.match(/\d{4}-\d{2}-\d{2}/g);
            const lastDate = dates ? dates[dates.length - 1] : null;
            if (key === NO_DATE) {
                if (!lastDate) return { mark, text };
                const i = text.lastIndexOf(lastDate);
                return { mark, text: (text.substring(0, i) + text.substring(i + lastDate.length)).replace(/\s{2,}/g, ' ').trim() };
            }
            const newDate = this.dropDate(key);
            if (!lastDate) return { mark, text: `${text} ${newDate}` };
            const i = text.lastIndexOf(lastDate);
            return { mark, text: text.substring(0, i) + newDate + text.substring(i + lastDate.length) };
        });
    }

    // Changes one task line in its note. edit(prefix, mark, text) returns the new { mark, text }.
    // Nothing is written if the line no longer holds this task (the note changed since the last scan).
    async modifyTaskLine(task, edit) {
        const content = await this.app.vault.read(task.file);
        const lines = content.split('\n');
        const match = lines.length > task.line ? lines[task.line].match(/^(\s*[-*]\s*)\[([ xX\/])\]\s*(.*)$/) : null;
        if (!match || match[3] !== task.text) { new Notice('Task changed in the note, refreshing.'); await this.refresh(); return; }
        const result = edit(match[1], match[2], match[3]);
        lines[task.line] = `${match[1]}[${result.mark}] ${result.text}`;
        await this.app.vault.modify(task.file, lines.join('\n'));
        await this.refresh();
    }

    // Active due date filter as { from, to } (YYYY-MM-DD, either may be empty), or null for "Any Time"
    getDateRange() {
        if (this.state.dateRangeMode === 'relative') {
            let start, end;
            if (this.state.relDirection === 'current') {
                const unitMap = { 'days': 'day', 'weeks': 'isoWeek', 'months': 'month', 'years': 'year' };
                const u = unitMap[this.state.relUnit] || 'day';
                start = moment().startOf(u); end = moment().endOf(u);
            } else {
                start = moment().startOf('day'); end = moment().startOf('day');
                // With weeks/months/years the whole current period counts: "last N" runs to its end, "next N" from its start
                const periodUnit = { 'weeks': 'isoWeek', 'months': 'month', 'years': 'year' }[this.state.relUnit];
                if (this.state.relDirection === 'next') {
                    end.add(this.state.relNumber, this.state.relUnit);
                    if (periodUnit) start = moment().startOf(periodUnit);
                } else {
                    start.subtract(this.state.relNumber, this.state.relUnit);
                    if (periodUnit) end = moment().endOf(periodUnit);
                }
            }
            return { from: start.format('YYYY-MM-DD'), to: end.format('YYYY-MM-DD') };
        }
        if (this.state.dateRangeMode === 'specific') return { from: this.state.specificFrom, to: this.state.specificTo };
        return null;
    }

    async updateTaskDate(task, oldDate, newDate) {
        const content = await this.app.vault.read(task.file);
        const lines = content.split('\n');
        if (lines.length > task.line) {
            const line = lines[task.line];
            const lastIndex = line.lastIndexOf(oldDate);
            if (lastIndex !== -1) {
                lines[task.line] = line.substring(0, lastIndex) + newDate + line.substring(lastIndex + oldDate.length);
                await this.app.vault.modify(task.file, lines.join('\n'));
                new Notice(`Updated date to ${newDate}`);
                await this.refresh();
            }
        }
    }

    renderStats(tasks) {
        const stats = {};
        let totalUndone = 0;
        let totalTasks = tasks.length;
        tasks.forEach(t => { 
            if (!t.status) totalUndone++;
            const cats = t.categories.length > 0 ? t.categories : ['Uncategorized']; 
            cats.forEach(c => { const lower = c.toLowerCase(); if (!stats[lower]) stats[lower] = { label: c.toUpperCase(), total: 0, undone: 0 }; stats[lower].total++; if (!t.status) stats[lower].undone++; }); 
        });
        const container = this.listContainer.createDiv('simple-tasks-stats-inline');
        
        const mainStat = container.createSpan({ cls: 'simple-tasks-stat-item' });
        mainStat.createSpan({ text: 'Pending: ', cls: 'simple-tasks-stat-name' });
        mainStat.createSpan({ text: `${totalUndone}/${totalTasks}`, cls: 'simple-tasks-stat-counts' });

        Object.entries(stats).sort((a, b) => a[0].localeCompare(b[0])).forEach(([key, data]) => {
            const stat = container.createSpan({ cls: 'simple-tasks-stat-item' });
            stat.createSpan({ text: data.label, cls: 'simple-tasks-stat-name' });
            stat.createSpan({ text: ` (${data.undone}/${data.total})`, cls: 'simple-tasks-stat-counts' });
        });
    }
    async toggleTask(task) {
        // Click cycle: [ ] -> [/] -> [x] -> [ ]
        const nextMark = { ' ': '/', '/': 'x', 'x': ' ' };
        task.mark = nextMark[task.mark] || ' '; task.status = task.mark === 'x';
        this.renderList(); const content = await this.app.vault.read(task.file); const lines = content.split('\n');
        if (lines.length > task.line) {
            const match = lines[task.line].match(/^(\s*[-*]\s*)\[([ xX\/])\]/);
            if (match) { lines[task.line] = match[1] + `[${task.mark}]` + lines[task.line].substring(match[0].length); await this.app.vault.modify(task.file, lines.join('\n')); }
        }
    }
}

class SimpleTasksPlugin extends Plugin {
    async onload() {
        await this.loadSettings();
        this.globalCategoryCache = new Set(['Work', 'Personal', 'Urgent']);
        this.addSettingTab(new SimpleTasksSettingTab(this.app, this));
        this.registerEditorSuggest(new CategorySuggest(this.app, this));
        this.registerMarkdownCodeBlockProcessor("simpletasks", (source, el, ctx) => {
            const view = new SimpleTasksView(this.app, this, source, el, ctx);
            ctx.addChild(view);
        });
    }
    async loadSettings() { this.settings = Object.assign({}, { excludedFolders: [], excludedTags: [] }, await this.loadData()); }
    async saveSettings() { await this.saveData(this.settings); }
}

module.exports = SimpleTasksPlugin;