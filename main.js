'use strict';

const { Plugin, PluginSettingTab, Setting, MarkdownRenderChild, AbstractInputSuggest, EditorSuggest, moment, MarkdownView, Notice } = require('obsidian');

class TaskScanner {
    constructor(app, plugin) {
        this.app = app;
        this.plugin = plugin;
    }

    async scanVault(state, globalSettings) {
        const files = this.app.vault.getMarkdownFiles();
        const tasks = [];
        const categoriesSet = new Set();
        
        const globalExcludeFolders = globalSettings.excludedFolders || [];
        const globalExcludeTags = globalSettings.excludedTags || [];

        for (const file of files) {
            if (globalExcludeFolders.some(f => this.isPathInFolder(file.path, f))) continue;

            const cache = this.app.metadataCache.getFileCache(file);
            if (!cache || !cache.listItems) continue;

            const taskItems = cache.listItems.filter(item => item.task);
            if (taskItems.length === 0) continue;

            const fileTags = this.getAllTagsFromCache(cache);
            if (this.shouldExcludeByTags(fileTags, globalExcludeTags, [])) continue;

            const content = await this.app.vault.cachedRead(file);
            const lines = content.split('\n');

            for (const item of taskItems) {
                const i = item.position.start.line;
                const line = lines[i];
                if (!line) continue;

                const taskMatch = line.match(/^(\s*[-*]\s*)\[([ xX])\]\s*(.*)$/);
                if (taskMatch) {
                    const text = taskMatch[3];
                    const categories = [];
                    const catRegex = /==([^=]+)==/g;
                    let match;
                    while ((match = catRegex.exec(text)) !== null) {
                        const cat = match[1].trim();
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

                    if (this.shouldExcludeByTags(taskTags, globalExcludeTags, [])) continue;

                    tasks.push({
                        file,
                        line: i,
                        status: taskMatch[2].toLowerCase() === 'x',
                        text,
                        categories,
                        date: lastDate,
                        tags: [...new Set([...fileTags, ...taskTags])]
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
        }).sort().map(cat => ({ label: cat, value: cat }));
    }
    renderSuggestion(suggestion, el) { el.setText(suggestion.label); }
    selectSuggestion(suggestion) {
        const { editor, start, end } = this.context;
        const line = editor.getLine(start.line);
        const match = line.substring(start.ch).match(/^\[([ xX]?)\]/);
        let status = (match && match[1]) ? match[1] : " ";
        if (status.trim() === "") status = " ";
        const isAlreadyTask = /^(\s*)[-*]\s*\[([ xX])\]/.test(line);
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
        const currentVal = this.inputEl.value;
        const parts = currentVal.split(',').map(p => p.trim());
        parts.pop(); // Remove the partial query
        parts.push(value);
        this.inputEl.value = parts.join(', ') + ', ';
        this.inputEl.dispatchEvent(new Event('input'));
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
            dateRangeMode: config.dateRangeMode || 'all',
            relDirection: config.relDirection || 'next', relNumber: config.relNumber || 1, relUnit: config.relUnit || 'weeks',
            specificFrom: config.specificFrom || "", specificTo: config.specificTo || "",
            tasks: [], availableCategories: new Set(), loading: true,
            filtersExpanded: config.expanded !== undefined ? config.expanded : true
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
        const config = { filterCategories: new Set(), status: 'all', excludedTags: [], excludedFolders: [], sort: 'date', title: null, showList: true, showStats: false, search: "", dateRangeMode: 'all' };
        source.split('\n').forEach(line => {
            const l = line.trim();
            if (l.startsWith('title:')) config.title = l.replace('title:', '').trim();
            else if (l.startsWith('view:')) { const v = l.replace('view:', '').trim(); config.showList = v.includes('list'); config.showStats = v.includes('stats'); }
            else if (l.startsWith('status:')) config.status = l.replace('status:', '').trim();
            else if (l.startsWith('sort:')) config.sort = l.replace('sort:', '').trim();
            else if (l.startsWith('search:')) config.search = l.replace('search:', '').trim();
            else if (l.startsWith('exclude-tags:')) config.excludedTags = l.replace('exclude-tags:', '').split(',').map(t => t.trim()).filter(t => t);
            else if (l.startsWith('exclude-folders:')) config.excludedFolders = l.replace('exclude-folders:', '').split(',').map(f => f.trim()).filter(f => f);
            else if (l.startsWith('expanded:')) config.expanded = l.replace('expanded:', '').trim() === 'true';
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

        const row2 = this.filterWrapper.createDiv('simple-tasks-header-row');
        const statusSelect = row2.createEl('select');
        [['all', 'All'], ['undone', 'Undone'], ['done', 'Done']].forEach(([v, l]) => {
            const opt = statusSelect.createEl('option', { value: v, text: l }); if (this.state.statusFilter === v) opt.selected = true;
        });
        statusSelect.onchange = (e) => { this.state.statusFilter = e.target.value; this.renderList(); };
        const sortSelect = row2.createEl('select');
        [['date', 'By Date'], ['file', 'By File']].forEach(([v, l]) => {
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
            const dir = rel.createEl('select'); [['next', 'Next'], ['last', 'Last']].forEach(([v, l]) => {
                const opt = dir.createEl('option', { value: v, text: l }); if (this.state.relDirection === v) opt.selected = true;
            });
            dir.onchange = (e) => { this.state.relDirection = e.target.value; this.renderList(); };
            const num = rel.createEl('input', { type: 'number', value: this.state.relNumber, cls: 'simple-tasks-number-short' });
            num.oninput = (e) => { this.state.relNumber = parseInt(e.target.value) || 0; this.renderList(); };
            const unit = rel.createEl('select'); ['days', 'weeks', 'months', 'years'].forEach(u => {
                const opt = unit.createEl('option', { value: u, text: u }); if (this.state.relUnit === u) opt.selected = true;
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
        const clearBtn = this.categoryBar.createEl('div', { text: 'All', cls: 'simple-tasks-chip' });
        clearBtn.onclick = () => { this.state.filterCategories.clear(); this.renderCategoryBar(); this.renderList(); };
        Array.from(this.state.availableCategories).sort().forEach(cat => {
            const isActive = this.state.filterCategories.has(cat.toLowerCase());
            const chip = this.categoryBar.createEl('div', { text: cat, cls: `simple-tasks-chip ${isActive ? 'is-active' : ''}` });
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
        if (this.state.sortBy !== 'date') newLines.push(`sort: ${this.state.sortBy}`);
        if (this.state.searchTerm) newLines.push(`search: ${this.state.searchTerm}`);
        if (this.state.excludedTags.length > 0) newLines.push(`exclude-tags: ${this.state.excludedTags.join(', ')}`);
        if (this.state.excludedFolders.length > 0) newLines.push(`exclude-folders: ${this.state.excludedFolders.join(', ')}`);
        newLines.push(`expanded: ${this.state.filtersExpanded}`);
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
        let filtered = this.state.tasks.filter(t => {
            if (this.state.statusFilter === 'done' && !t.status) return false;
            if (this.state.statusFilter === 'undone' && t.status) return false;

            // Instant local filters
            if (this.state.excludedTags.length > 0) {
                const tags = t.tags || [];
                if (this.state.excludedTags.some(ex => {
                    const nEx = ex.startsWith('#') ? ex : '#' + ex;
                    return tags.some(tag => tag === nEx || tag.startsWith(nEx + '/'));
                })) return false;
            }
            if (this.state.excludedFolders.length > 0) {
                if (this.state.excludedFolders.some(f => t.file.path.toLowerCase().startsWith(f.toLowerCase() + '/') || t.file.path.toLowerCase() === f.toLowerCase())) return false;
            }

            if (this.state.filterCategories.size > 0 && !t.categories.some(c => this.state.filterCategories.has(c.toLowerCase()))) return false;
            if (this.state.dateRangeMode === 'relative') {
                const start = moment().startOf('day'); const end = moment().startOf('day');
                if (this.state.relDirection === 'next') end.add(this.state.relNumber, this.state.relUnit); else start.subtract(this.state.relNumber, this.state.relUnit);
                if (!t.date || t.date < start.format('YYYY-MM-DD') || t.date > end.format('YYYY-MM-DD')) return false;
            } else if (this.state.dateRangeMode === 'specific') {
                if (this.state.specificFrom && (!t.date || t.date < this.state.specificFrom)) return false;
                if (this.state.specificTo && (!t.date || t.date > this.state.specificTo)) return false;
            }
            if (this.state.searchTerm && !t.text.toLowerCase().includes(this.state.searchTerm.toLowerCase())) return false;
            return true;
        });
        if (this.state.showStats) this.renderStats(filtered);
        if (!this.state.showList) return;
        filtered.sort((a, b) => {
            if (this.state.sortBy === 'date') { if (!a.date && !b.date) return 0; if (!a.date) return 1; if (!b.date) return -1; return a.date.localeCompare(b.date); }
            return a.file.path.localeCompare(b.file.path);
        });
        const ul = this.listContainer.createEl('ul', { cls: 'simple-tasks-list' });
        if (filtered.length === 0) { ul.createEl('li', { text: 'No matching tasks.', cls: 'simple-tasks-empty' }); return; }
        filtered.forEach(task => {
            const li = ul.createEl('li', { cls: 'simple-tasks-item' });
            const cb = li.createEl('input', { type: 'checkbox', cls: 'simple-tasks-checkbox' }); cb.checked = task.status;
            cb.onclick = async (e) => { e.stopPropagation(); await this.toggleTask(task); };
                        const div = li.createDiv('simple-tasks-content');
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
                                div.createSpan({ cls: 'simple-tasks-category', text: part.replace(/==/g, '') });
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
                        li.createSpan({ text: task.file.basename, cls: 'simple-tasks-file-hint' });
                        div.onclick = () => {
                            this.app.workspace.getLeaf().openFile(task.file, { eState: { line: task.line } });
                        };
                    });
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
        tasks.forEach(t => { const cats = t.categories.length > 0 ? t.categories : ['Uncategorized']; cats.forEach(c => { const lower = c.toLowerCase(); if (!stats[lower]) stats[lower] = { label: c, total: 0, done: 0 }; stats[lower].total++; if (t.status) stats[lower].done++; }); });
        const container = this.listContainer.createDiv('simple-tasks-stats-inline');
        Object.entries(stats).sort((a, b) => a[0].localeCompare(b[0])).forEach(([key, data]) => {
            const stat = container.createSpan({ cls: 'simple-tasks-stat-item' });
            stat.createSpan({ text: data.label, cls: 'simple-tasks-stat-name' });
            stat.createSpan({ text: ` (${data.done}/${data.total})`, cls: 'simple-tasks-stat-counts' });
        });
    }
    async toggleTask(task) {
        task.status = !task.status; this.renderList(); const content = await this.app.vault.read(task.file); const lines = content.split('\n');
        if (lines.length > task.line) {
            const match = lines[task.line].match(/^(\s*[-*]\s*)\[([ xX])\]/);
            if (match) { lines[task.line] = match[1] + (task.status ? '[x]' : '[ ]') + lines[task.line].substring(match[0].length); await this.app.vault.modify(task.file, lines.join('\n')); }
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