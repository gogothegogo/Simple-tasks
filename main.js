'use strict';

const { Plugin, PluginSettingTab, Setting, MarkdownRenderChild, AbstractInputSuggest, EditorSuggest } = require('obsidian');

class SimpleTasksPlugin extends Plugin {
    async onload() {
        await this.loadSettings();
        
        // Initialize global category cache
        this.globalCategoryCache = new Set(['Work', 'Personal', 'Urgent']);

        this.addSettingTab(new SimpleTasksSettingTab(this.app, this));
        
        // Register Editor Suggester for Categories
        this.registerEditorSuggest(new CategorySuggest(this.app, this));

        this.registerMarkdownCodeBlockProcessor("simpletasks", (source, el, ctx) => {
            const view = new SimpleTasksView(this.app, this.settings, source, el);
            ctx.addChild(view);
        });
    }

    async loadSettings() {
        this.settings = Object.assign({}, {
            excludedFolders: [],
            excludedTags: []
        }, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
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
        
        // Trigger if we just typed "==" or are inside "==..."
        // Matches "==" followed by any non-equal characters until the end of the substring (cursor)
        const match = sub.match(/==([^=]*)$/);
        
        if (match) {
            return {
                start: { line: cursor.line, ch: match.index },
                end: cursor,
                query: match[1]
            };
        }
        return null;
    }

    getSuggestions(context) {
        const query = context.query.toLowerCase();
        
        // Use the global cache from the plugin instance
        const cache = this.plugin.globalCategoryCache || new Set();
        
        return Array.from(cache)
            .filter(cat => cat.toLowerCase().includes(query))
            .sort()
            .map(cat => ({ label: cat, value: cat }));
    }

    renderSuggestion(suggestion, el) {
        el.setText(suggestion.label);
    }

    selectSuggestion(suggestion, evt) {
        const context = this.context;
        // The trigger included the leading "==".
        // We want the final result to be "==Value=="
        const replacement = `==${suggestion.value}== `;
        
        this.context.editor.replaceRange(
            replacement,
            context.start,
            context.end
        );
    }
}

class FolderSuggest extends AbstractInputSuggest {
    constructor(app, textInputEl) {
        super(app, textInputEl);
        this.app = app;
    }

    getSuggestions(query) {
        const lowerCaseQuery = query.toLowerCase();
        const files = this.app.vault.getAllLoadedFiles();
        const folders = files.filter(f => f.children).map(f => f.path);
        
        return folders.filter(path => 
            path.toLowerCase().includes(lowerCaseQuery) && path !== '/'
        );
    }

    renderSuggestion(value, el) {
        el.setText(value);
    }

    selectSuggestion(value, evt) {
        this.setValue(value);
        this.inputEl.trigger("input");
        this.close();
    }
}

class SimpleTasksSettingTab extends PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    renderFolderList(container) {
        container.empty();
        container.style.marginBottom = '20px';
        
        if (this.plugin.settings.excludedFolders.length === 0) {
            container.createDiv({ text: 'No folders excluded.', cls: 'setting-item-description' });
            return;
        }

        this.plugin.settings.excludedFolders.forEach(folder => {
            const item = container.createDiv('simple-tasks-excluded-item');
            Object.assign(item.style, {
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '5px 10px', marginBottom: '5px',
                backgroundColor: 'var(--background-secondary)', borderRadius: '4px'
            });

            item.createSpan({ text: folder });

            const removeBtn = item.createEl('button', { text: 'Remove' });
            removeBtn.onclick = async () => {
                this.plugin.settings.excludedFolders = this.plugin.settings.excludedFolders.filter(f => f !== folder);
                await this.plugin.saveSettings();
                this.renderFolderList(container);
            };
        });
    }

    display() {
        const { containerEl } = this;
        const self = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: 'Simple Tasks Settings' });

        new Setting(containerEl)
            .setName('Excluded Folders')
            .setDesc('Manage folders to exclude from task scanning.')
            .setHeading();

        const foldersContainer = containerEl.createDiv('simple-tasks-folders-container');
        this.renderFolderList(foldersContainer);

        new Setting(containerEl)
            .setName('Add Folder')
            .setDesc('Search and select a folder to exclude.')
            .addText(text => {
                const input = text.inputEl;
                input.placeholder = 'Type to search folders...';
                new FolderSuggest(this.app, input);
            })
            .addButton(btn => btn
                .setButtonText('Add')
                .setCta()
                .onClick(async () => {
                    const settingControl = btn.buttonEl.parentElement;
                    const input = settingControl.querySelector('input');
                    
                    if (input) {
                        const val = input.value.trim();
                        if (val && !self.plugin.settings.excludedFolders.includes(val)) {
                            self.plugin.settings.excludedFolders.push(val);
                            await self.plugin.saveSettings();
                            input.value = '';
                            self.renderFolderList(foldersContainer);
                        }
                    }
                }));

        new Setting(containerEl)
            .setName('Excluded Tags')
            .setDesc('Enter tags to exclude globally (e.g. #archive), one per line.')
            .addTextArea(text => text
                .setPlaceholder('#archive\n#hidden')
                .setValue(this.plugin.settings.excludedTags.join('\n'))
                .onChange(async (value) => {
                    this.plugin.settings.excludedTags = value.split('\n').map(s => s.trim()).filter(s => s.length > 0);
                    await this.plugin.saveSettings();
                }));
    }
}

class SimpleTasksView extends MarkdownRenderChild {
    constructor(app, settings, source, el) {
        super(el);
        this.app = app;
        this.globalSettings = settings;
        this.source = source;
        this.containerEl = el;
        this.config = this.parseConfig(source);
        
        this.state = {
            searchTerm: "",
            sortBy: this.config.sort || "date",
            filterCategory: this.config.filterCategory,
            filterDateFrom: null,
            filterDateTo: null,
            tasks: [],
            availableCategories: new Set(),
            loading: true
        };
    }

    onload() {
        this.init();
    }

    parseConfig(source) {
        const config = {
            filterCategory: null,
            status: 'all',
            excludedTags: [],
            sort: 'date'
        };

        if (source.includes(' done')) config.status = 'done';
        else if (source.includes(' undone')) config.status = 'undone';
        
        // Correct regex to capture category name between ==
        const catMatch = source.match(/==(.*?)/);
        if (catMatch) config.filterCategory = catMatch[1];

        if (source.includes('exclude:')) {
            const excludePart = source.split('exclude:')[1].split('sort:')[0];
            const tags = excludePart.match(/#[\\w/-]+/g);
            if (tags) config.excludedTags = tags;
        }

        if (source.includes('sort:')) {
            const sortPart = source.split('sort:')[1].trim();
            if (sortPart.startsWith('date')) config.sort = 'date';
        }

        return config;
    }

    async init() {
        this.containerEl.addClass('simple-tasks-container');
        this.renderHeader();
        this.renderLoading();
        await this.scanVault();
        this.renderList();
    }

    renderHeader() {
        const existingHeader = this.containerEl.querySelector('.simple-tasks-header');
        if (existingHeader) existingHeader.remove();
        
        this.headerEl = this.containerEl.createDiv('simple-tasks-header');
        
        const topRow = this.headerEl.createDiv('simple-tasks-header-top');
        Object.assign(topRow.style, { display: 'flex', gap: '10px', marginBottom: '10px', flexWrap: 'wrap' });

        const searchInput = topRow.createEl('input', {
            type: 'text',
            cls: 'simple-tasks-search',
            placeholder: 'Search tasks...'
        });
        searchInput.style.flexGrow = '1';
        searchInput.oninput = (e) => {
            this.state.searchTerm = e.target.value;
            this.renderList();
        };

        const controls = topRow.createDiv('simple-tasks-controls');
        
        const dateFrom = controls.createEl('input', { type: 'date', cls: 'simple-tasks-date-filter' });
        dateFrom.title = "From Date";
        dateFrom.onchange = (e) => {
            this.state.filterDateFrom = e.target.value;
            this.renderList();
        };

        const dateTo = controls.createEl('input', { type: 'date', cls: 'simple-tasks-date-filter' });
        dateTo.title = "To Date";
        dateTo.onchange = (e) => {
            this.state.filterDateTo = e.target.value;
            this.renderList();
        };
        dateTo.style.marginLeft = '5px';

        const sortBtn = controls.createEl('button', { text: `Sort: ${this.state.sortBy}` });
        sortBtn.style.marginLeft = '5px';
        sortBtn.onclick = () => {
            this.state.sortBy = this.state.sortBy === 'date' ? 'file' : 'date';
            sortBtn.innerText = `Sort: ${this.state.sortBy}`;
            this.renderList();
        };
        
        const refreshBtn = controls.createEl('button', { text: 'Refresh' });
        refreshBtn.style.marginLeft = "5px";
        refreshBtn.onclick = async () => {
            this.state.loading = true;
            this.renderList();
            await this.scanVault();
            this.renderCategoryBar();
            this.renderList();
        };

        this.categoryBar = this.headerEl.createDiv('simple-tasks-category-bar');
        Object.assign(this.categoryBar.style, { display: 'flex', gap: '5px', flexWrap: 'wrap', marginBottom: '10px' });
    }

    renderCategoryBar() {
        this.categoryBar.empty();
        
        if (this.state.availableCategories.size === 0) return;

        const allChip = this.categoryBar.createEl('button', { text: 'All', cls: 'simple-tasks-cat-chip' });
        this.styleChip(allChip, this.state.filterCategory === null);
        allChip.onclick = () => {
            this.state.filterCategory = null;
            this.renderCategoryBar();
            this.renderList();
        };

        const sortedCats = Array.from(this.state.availableCategories).sort();

        sortedCats.forEach(cat => {
            const chip = this.categoryBar.createEl('button', { text: cat, cls: 'simple-tasks-cat-chip' });
            this.styleChip(chip, this.state.filterCategory === cat);
            chip.onclick = () => {
                if (this.state.filterCategory === cat) this.state.filterCategory = null;
                else this.state.filterCategory = cat;
                
                this.renderCategoryBar();
                this.renderList();
            };
        });
    }

    styleChip(el, isActive) {
        el.style.fontSize = '0.8em';
        el.style.padding = '2px 8px';
        el.style.border = '1px solid var(--background-modifier-border)';
        el.style.borderRadius = '12px';
        el.style.cursor = 'pointer';
        el.style.backgroundColor = isActive ? 'var(--interactive-accent)' : 'var(--background-primary)';
        el.style.color = isActive ? 'var(--text-on-accent)' : 'var(--text-normal)';
    }

    renderLoading() {
        this.listContainer = this.containerEl.createDiv();
        this.listContainer.createDiv({ text: 'Scanning...' });
    }

    async scanVault() {
        const files = this.app.vault.getMarkdownFiles();
        const tasks = [];
        const categoriesSet = new Set();

        const globalExcludeFolders = this.globalSettings.excludedFolders;
        const globalExcludeTags = this.globalSettings.excludedTags;

        const plugin = this.app.plugins.getPlugin('simple-tasks');

        for (const file of files) {
            if (globalExcludeFolders.some(folder => file.path.startsWith(folder))) continue;

            const content = await this.app.vault.cachedRead(file);
            const lines = content.split('\n');

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const taskMatch = line.match(/^(\s*[-*]\s*)\[([ xX])\]\s*(.*)$/);
                
                if (taskMatch) {
                    const statusChar = taskMatch[2];
                    const isDone = statusChar === 'x' || statusChar === 'X';
                    const text = taskMatch[3];

                    const categories = [];
                    // FIXED REGEX: capture content inside ==...==
                    const catRegex = /==(.*?)/g;
                    let match;
                    while ((match = catRegex.exec(text)) !== null) {
                        const catName = match[1];
                        if (catName.trim()) {
                            categories.push(catName);
                            categoriesSet.add(catName);
                        }
                    }

                    const dateMatch = text.match(/\d{4}-\d{2}-\d{2}/);
                    const date = dateMatch ? dateMatch[0] : null;

                    const tags = [];
                    const tagRegex = /#[\\w/-]+/g;
                    while ((match = tagRegex.exec(text)) !== null) {
                        tags.push(match[0]);
                    }
                    
                    if (globalExcludeTags.some(t => tags.includes(t))) continue;
                    if (this.config.excludedTags.some(t => tags.includes(t))) continue;

                    tasks.push({
                        file: file,
                        line: i,
                        rawText: line,
                        indent: taskMatch[1],
                        status: isDone,
                        text: text,
                        categories: categories,
                        date: date,
                        tags: tags
                    });
                }
            }
        }
        
        this.state.tasks = tasks;
        this.state.availableCategories = categoriesSet;
        this.state.loading = false;
        
        // Update global cache for the suggester
        if (plugin) {
             plugin.globalCategoryCache = categoriesSet;
        }

        if (this.categoryBar) this.renderCategoryBar();
    }

    renderList() {
        this.listContainer.empty();
        
        if (this.state.loading) {
            this.listContainer.createDiv({ text: 'Scanning...' });
            return;
        }

        let filtered = this.state.tasks.filter(t => {
            if (this.config.status === 'done' && !t.status) return false;
            if (this.config.status === 'undone' && t.status) return false;

            const activeFilter = this.state.filterCategory; 
            if (activeFilter) {
                 if (!t.categories.includes(activeFilter)) return false;
            }

            if (this.state.filterDateFrom) {
                if (!t.date || t.date < this.state.filterDateFrom) return false;
            }
            if (this.state.filterDateTo) {
                if (!t.date || t.date > this.state.filterDateTo) return false;
            }

            if (this.state.searchTerm) {
                const term = this.state.searchTerm.toLowerCase();
                if (!t.text.toLowerCase().includes(term)) return false;
            }

            return true;
        });

        filtered.sort((a, b) => {
            if (this.state.sortBy === 'date') {
                if (!a.date && !b.date) return 0;
                if (!a.date) return 1;
                if (!b.date) return -1;
                return a.date.localeCompare(b.date);
            } else {
                return a.file.path.localeCompare(b.file.path);
            }
        });

        const ul = this.listContainer.createEl('ul', { cls: 'simple-tasks-list' });

        if (filtered.length === 0) {
            ul.createEl('li', { text: 'No tasks found.' });
            return;
        }

        filtered.forEach(task => {
            const li = ul.createEl('li', { cls: 'simple-tasks-item' });

            const cb = li.createEl('input', {
                type: 'checkbox',
                cls: 'simple-tasks-checkbox'
            });
            cb.checked = task.status;
            cb.onclick = async (e) => {
                e.stopPropagation();
                await this.toggleTask(task);
            };

            const contentDiv = li.createDiv('simple-tasks-content');
            this.renderTaskContent(contentDiv, task);

            contentDiv.onclick = () => {
                this.app.workspace.getLeaf().openFile(task.file, {
                    eState: { line: task.line }
                });
            };
        });
    }

    renderTaskContent(el, task) {
        // FIXED REGEX
        const parts = task.text.split(/(==.*?==)|(\d{4}-\d{2}-\d{2})|(#[\\w/-]+)/g).filter(p => p);
        
        parts.forEach(part => {
            if (!part) return;
            if (part.startsWith('==') && part.endsWith('==')) {
                el.createSpan({ cls: 'simple-tasks-category', text: part.replace(/==/g, '') });
            } else if (part.match(/^\d{4}-\d{2}-\d{2}$/)) {
                el.createSpan({ cls: 'simple-tasks-date', text: part });
            } else if (part.startsWith('#')) {
                el.createSpan({ cls: 'simple-tasks-tag', text: part });
            } else {
                el.createSpan({ text: part });
            }
        });

        const fileHint = el.createSpan({ text: ` (${task.file.basename})` });
        fileHint.style.color = 'var(--text-faint)';
        fileHint.style.fontSize = '0.8em';
        fileHint.style.marginLeft = '5px';
    }

    async toggleTask(task) {
        task.status = !task.status;
        this.renderList();

        const content = await this.app.vault.read(task.file);
        const lines = content.split('\n');
        if (lines.length > task.line) {
            const originalLine = lines[task.line];
            const checkboxRegex = /^(\s*[-*]\s*)\[([ xX])\]/;
            const match = originalLine.match(checkboxRegex);
            
            if (match) {
                const prefix = match[1];
                const newStatus = task.status ? '[x]' : '[ ]';
                const restOfLine = originalLine.substring(match[0].length);
                const newLine = prefix + newStatus + restOfLine;
                lines[task.line] = newLine;
                await this.app.vault.modify(task.file, lines.join('\n'));
                task.rawText = newLine;
            }
        }
    }
}

module.exports = SimpleTasksPlugin;