/**
 * 主交互逻辑
 * 包含主题切换、视图切换、搜索、树形收藏等功能
 */

document.addEventListener('DOMContentLoaded', () => {
    // 初始化
    initTheme();
    initNav();
    initSearch();
    initBackToTop();
    loadNotes();
    // 默认视图是 tools，首次进入时加载工具列表
    ensureToolsLoaded();
    // collectionTree 懒加载：首次进入"随手收集"视图时才加载 collections.js
});

// ========================================
// 笔记数据加载
// ========================================
let notesLoaded = false;
let notesLoading = false;

async function loadNotes() {
    if (notesLoaded) {
        renderNotes();
        return;
    }
    if (notesLoading) return;
    notesLoading = true;

    const notesList = document.getElementById('notesList');
    const emptyState = document.getElementById('notesEmpty');

    try {
        const response = await fetch('notes/index.json');
        if (!response.ok) throw new Error('加载失败');
        const notes = await response.json();
        siteData.notes = notes;
        notesLoaded = true;
        notesLoading = false;
        renderNotes();
    } catch (error) {
        notesLoading = false;
        if (notesList) notesList.classList.add('hidden');
        if (emptyState) {
            emptyState.classList.remove('hidden');
            emptyState.innerHTML = '<p>笔记加载失败，请刷新重试</p>';
        }
    }
}

// ========================================
// 主题切换
// ========================================
function initTheme() {
    const themeToggle = document.getElementById('themeToggle');
    const sunIcon = themeToggle.querySelector('.sun-icon');
    const moonIcon = themeToggle.querySelector('.moon-icon');
    
    // 获取保存的主题或系统偏好
    const savedTheme = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = savedTheme || (prefersDark ? 'dark' : 'light');
    
    setTheme(theme);
    
    themeToggle.addEventListener('click', () => {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        setTheme(newTheme);
        localStorage.setItem('theme', newTheme);
    });
    
    function setTheme(theme) {
        if (theme === 'dark') {
            document.documentElement.setAttribute('data-theme', 'dark');
            sunIcon.classList.add('hidden');
            moonIcon.classList.remove('hidden');
        } else {
            document.documentElement.removeAttribute('data-theme');
            sunIcon.classList.remove('hidden');
            moonIcon.classList.add('hidden');
        }
    }
}

// ========================================
// 左侧导航切换
// ========================================
let currentView = 'tools';

function initNav() {
    const navLinks = document.querySelectorAll('.nav-link');
    
    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const view = link.dataset.view;
            switchView(view);
        });
    });

    // 绑定笔记返回按钮
    const backBtn = document.getElementById('noteBackBtn');
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            drillOutOfNote();
        });
    }

    // 绑定文章返回按钮
    const articleBackBtn = document.getElementById('articleBackBtn');
    if (articleBackBtn) {
        articleBackBtn.addEventListener('click', () => {
            drillOutOfArticle();
        });
    }

    // 绑定工具返回按钮
    const toolBackBtn = document.getElementById('toolBackBtn');
    if (toolBackBtn) {
        toolBackBtn.addEventListener('click', () => {
            drillOutOfTool();
        });
    }

    // 绑定更新记录返回按钮
    const changelogBackBtn = document.getElementById('changelogBackBtn');
    if (changelogBackBtn) {
        changelogBackBtn.addEventListener('click', () => {
            drillOutOfChangelog();
        });
    }
}

function switchView(view) {
    currentView = view;
    
    // 更新导航状态
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.toggle('active', link.dataset.view === view);
    });
    
    // 隐藏所有视图
    document.querySelectorAll('.view-section').forEach(s => s.classList.add('hidden'));
    
    // 显示目标视图
    if (view === 'notes') {
        document.getElementById('notesView').classList.remove('hidden');
    } else if (view === 'articles') {
        document.getElementById('articlesView').classList.remove('hidden');
        loadArticles();
    } else if (view === 'collections') {
        document.getElementById('collectionsView').classList.remove('hidden');
        ensureCollectionsLoaded();
    } else if (view === 'tools') {
        document.getElementById('toolsView').classList.remove('hidden');
        // 如果当前在工具详情钻入状态，先退回网格
        const detailView = document.getElementById('toolDetailView');
        const grid = document.getElementById('toolsGrid');
        if (detailView && !detailView.classList.contains('hidden')) {
            if (currentToolModule && typeof currentToolModule.unmount === 'function') {
                currentToolModule.unmount();
            }
            currentToolModule = null;
            detailView.classList.add('hidden');
            detailView.classList.remove('drilling-out');
            document.getElementById('toolDetailContent').innerHTML = '';
            grid.classList.remove('hidden');
        }
        ensureToolsLoaded();
    } else if (view === 'changelog') {
        document.getElementById('changelogView').classList.remove('hidden');
        const changelogDetailView = document.getElementById('changelogDetailView');
        const changelogListEl = document.getElementById('changelogList');
        if (changelogDetailView && !changelogDetailView.classList.contains('hidden')) {
            changelogDetailView.classList.add('hidden');
            document.getElementById('changelogDetailContent').innerHTML = '';
            changelogListEl.classList.remove('hidden');
        }
        loadChangelog();
    }
}

// ========================================
// 收藏数据懒加载
// ========================================
let collectionsLoaded = false;
let collectionsLoading = false;

function ensureCollectionsLoaded() {
    if (collectionsLoaded) {
        renderCollectionTree();
        return;
    }
    if (collectionsLoading) return;
    collectionsLoading = true;

    const container = document.getElementById('treeContainer');
    if (container) container.innerHTML = '<div class="tree-loading">加载中…</div>';

    const script = document.createElement('script');
    script.src = 'js/collections.js';
    script.onload = () => {
        siteData.collectionTree = window.__siteCollections || [];
        collectionsLoaded = true;
        collectionsLoading = false;
        renderCollectionTree();
    };
    script.onerror = () => {
        collectionsLoading = false;
        if (container) container.innerHTML = '<div class="tree-loading">收藏数据加载失败</div>';
    };
    document.head.appendChild(script);
}

// ========================================
// 搜索功能
// ========================================
let searchQuery = '';

function initSearch() {
    const searchInput = document.getElementById('searchInput');
    if (!searchInput) return;
    let debounceTimer;
    
    searchInput.addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            searchQuery = e.target.value.trim().toLowerCase();
            if (currentView === 'notes') {
                renderNotes();
            } else if (currentView === 'articles') {
                renderArticles();
            } else if (currentView === 'collections') {
                renderCollectionTree();
            } else if (currentView === 'tools') {
                renderToolsGrid();
            } else if (currentView === 'changelog') {
                renderChangelog();
            }
        }, 300);
    });
}

// ========================================
// 渲染笔记列表
// ========================================
function renderNotes() {
    const notesList = document.getElementById('notesList');
    const emptyState = document.getElementById('notesEmpty');
    if (!notesList || !emptyState) return;
    
    let filtered = siteData.notes;
    
    if (searchQuery) {
        filtered = filtered.filter(n => 
            n.title.toLowerCase().includes(searchQuery) ||
            n.excerpt.toLowerCase().includes(searchQuery)
        );
    }
    
    if (filtered.length === 0) {
        notesList.classList.add('hidden');
        emptyState.classList.remove('hidden');
        return;
    }
    
    notesList.classList.remove('hidden');
    emptyState.classList.add('hidden');
    
    notesList.innerHTML = filtered.map(note => `
        <div class="note-card" data-note-id="${note.id}" style="cursor:pointer;">
            <div class="note-header">
                <div>
                    <h2 class="note-title">${escapeHtml(note.title)}</h2>
                </div>
                <span class="note-date">${formatDate(note.date)}</span>
            </div>
            <p class="note-excerpt">${escapeHtml(note.excerpt)}</p>
            ${note.tags && note.tags.length > 0 ? `
                <div class="note-tags">
                    ${note.tags.map(tag => `<span class="note-tag">${escapeHtml(tag)}</span>`).join('')}
                </div>
            ` : ''}
        </div>
    `).join('');

    // 绑定点击钻入事件
    notesList.querySelectorAll('.note-card').forEach(card => {
        card.addEventListener('click', () => {
            const noteId = card.dataset.noteId;
            drillIntoNote(noteId);
        });
    });
}

// ========================================
// 笔记钻入/钻出
// ========================================
async function drillIntoNote(noteId) {
    const note = siteData.notes.find(n => n.id == noteId);
    if (!note) return;

    const notesList = document.getElementById('notesList');
    const detailView = document.getElementById('noteDetailView');
    const detailContent = document.getElementById('noteDetailContent');

    // 先显示加载状态
    detailContent.innerHTML = `
        <h1 class="detail-title">${escapeHtml(note.title)}</h1>
        <div class="detail-meta">
            <span class="detail-date">${formatDateFull(note.date)}</span>
        </div>
        <div class="detail-body"><p>加载中...</p></div>
    `;
    notesList.classList.add('hidden');
    detailView.classList.remove('hidden');
    detailView.classList.remove('drilling-out');
    window.scrollTo({ top: 0, behavior: 'smooth' });

    // 从 HTML 文件加载内容
    try {
        const response = await fetch(note.url);
        if (!response.ok) throw new Error('加载失败');
        const html = await response.text();
        
        // 解析 HTML 并提取笔记正文
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const noteBody = doc.querySelector('.note-body');
        const noteTitle = doc.querySelector('.note-title');
        const noteDate = doc.querySelector('.note-date');
        const noteTags = doc.querySelectorAll('.note-tag');
        
        // 更新内容
        let metaHtml = '';
        if (noteDate) {
            metaHtml += `<span class="detail-date">${noteDate.textContent}</span>`;
        }
        if (noteTags && noteTags.length > 0) {
            metaHtml += `<div class="detail-tags">`;
            noteTags.forEach(tag => {
                metaHtml += `<span class="detail-tag">${escapeHtml(tag.textContent)}</span>`;
            });
            metaHtml += `</div>`;
        }
        
        detailContent.innerHTML = `
            <h1 class="detail-title">${escapeHtml(noteTitle ? noteTitle.textContent : note.title)}</h1>
            <div class="detail-meta">${metaHtml}</div>
            <div class="detail-body">${noteBody ? noteBody.innerHTML : '<p>内容为空</p>'}</div>
        `;
    } catch (error) {
        detailContent.innerHTML = `
            <h1 class="detail-title">${escapeHtml(note.title)}</h1>
            <div class="detail-meta">
                <span class="detail-date">${formatDateFull(note.date)}</span>
            </div>
            <div class="detail-body"><p>内容加载失败，请刷新重试</p></div>
        `;
    }
}

function drillOutOfNote() {
    const notesList = document.getElementById('notesList');
    const detailView = document.getElementById('noteDetailView');

    detailView.classList.add('drilling-out');

    setTimeout(() => {
        detailView.classList.add('hidden');
        detailView.classList.remove('drilling-out');
        notesList.classList.remove('hidden');
    }, 280);
}

// ========================================
// 灵感仓库：数据加载、渲染、钻入/钻出
// ========================================
let articlesLoaded = false;
let articlesLoading = false;

async function loadArticles() {
    if (articlesLoaded) {
        renderArticles();
        return;
    }
    if (articlesLoading) return;
    articlesLoading = true;

    const articlesList = document.getElementById('articlesList');
    const emptyState = document.getElementById('articlesEmpty');

    try {
        const response = await fetch('articles/index.json');
        if (!response.ok) throw new Error('加载失败');
        const articles = await response.json();
        siteData.articles = articles;
        articlesLoaded = true;
        articlesLoading = false;
        renderArticles();
    } catch (error) {
        articlesLoading = false;
        if (articlesList) articlesList.classList.add('hidden');
        if (emptyState) {
            emptyState.classList.remove('hidden');
            emptyState.innerHTML = '<p>文章加载失败，请刷新重试</p>';
        }
    }
}

function renderArticles() {
    const articlesList = document.getElementById('articlesList');
    const emptyState = document.getElementById('articlesEmpty');
    if (!articlesList || !emptyState) return;

    let filtered = siteData.articles;

    if (searchQuery) {
        filtered = filtered.filter(a =>
            a.title.toLowerCase().includes(searchQuery) ||
            (a.excerpt || '').toLowerCase().includes(searchQuery)
        );
    }

    if (filtered.length === 0) {
        articlesList.classList.add('hidden');
        emptyState.classList.remove('hidden');
        return;
    }

    articlesList.classList.remove('hidden');
    emptyState.classList.add('hidden');

    articlesList.innerHTML = filtered.map(article => `
        <div class="article-card" data-article-id="${article.id}" style="cursor:pointer;">
            <div class="article-header">
                <div>
                    <h2 class="article-title">${escapeHtml(article.title)}</h2>
                </div>
                <span class="article-date">${formatDate(article.date)}</span>
            </div>
            <p class="article-excerpt">${escapeHtml(article.excerpt || '')}</p>
            ${article.tags && article.tags.length > 0 ? `
                <div class="article-tags">
                    ${article.tags.map(tag => `<span class="article-tag">${escapeHtml(tag)}</span>`).join('')}
                </div>
            ` : ''}
        </div>
    `).join('');

    articlesList.querySelectorAll('.article-card').forEach(card => {
        card.addEventListener('click', () => {
            drillIntoArticle(card.dataset.articleId);
        });
    });
}

async function drillIntoArticle(articleId) {
    const article = siteData.articles.find(a => a.id == articleId);
    if (!article) return;

    const articlesList = document.getElementById('articlesList');
    const detailView = document.getElementById('articleDetailView');
    const detailContent = document.getElementById('articleDetailContent');

    detailContent.innerHTML = `
        <h1 class="detail-title">${escapeHtml(article.title)}</h1>
        <div class="detail-meta">
            <span class="detail-date">${formatDateFull(article.date)}</span>
        </div>
        <div class="detail-body"><p>加载中...</p></div>
    `;
    articlesList.classList.add('hidden');
    detailView.classList.remove('hidden');
    detailView.classList.remove('drilling-out');
    window.scrollTo({ top: 0, behavior: 'smooth' });

    try {
        const response = await fetch(article.url);
        if (!response.ok) throw new Error('加载失败');
        const html = await response.text();

        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const articleBody = doc.querySelector('.article-body');
        const articleTitle = doc.querySelector('.article-title');
        const articleDate = doc.querySelector('.article-date');
        const articleTags = doc.querySelectorAll('.article-tag');

        let metaHtml = '';
        if (articleDate) {
            metaHtml += `<span class="detail-date">${articleDate.textContent}</span>`;
        }
        if (articleTags && articleTags.length > 0) {
            metaHtml += `<div class="detail-tags">`;
            articleTags.forEach(tag => {
                metaHtml += `<span class="detail-tag">${escapeHtml(tag.textContent)}</span>`;
            });
            metaHtml += `</div>`;
        }

        detailContent.innerHTML = `
            <h1 class="detail-title">${escapeHtml(articleTitle ? articleTitle.textContent : article.title)}</h1>
            <div class="detail-meta">${metaHtml}</div>
            <div class="detail-body">${articleBody ? articleBody.innerHTML : '<p>内容为空</p>'}</div>
        `;
    } catch (error) {
        detailContent.innerHTML = `
            <h1 class="detail-title">${escapeHtml(article.title)}</h1>
            <div class="detail-meta">
                <span class="detail-date">${formatDateFull(article.date)}</span>
            </div>
            <div class="detail-body"><p>内容加载失败，请刷新重试</p></div>
        `;
    }
}

function drillOutOfArticle() {
    const articlesList = document.getElementById('articlesList');
    const detailView = document.getElementById('articleDetailView');

    detailView.classList.add('drilling-out');

    setTimeout(() => {
        detailView.classList.add('hidden');
        detailView.classList.remove('drilling-out');
        articlesList.classList.remove('hidden');
    }, 280);
}

// ========================================
// 更新记录数据加载
// ========================================
let changelogLoaded = false;
let changelogLoading = false;

async function loadChangelog() {
    if (changelogLoaded) {
        renderChangelog();
        return;
    }
    if (changelogLoading) return;
    changelogLoading = true;

    const changelogList = document.getElementById('changelogList');
    const emptyState = document.getElementById('changelogEmpty');

    try {
        const response = await fetch('changelog/index.json');
        if (!response.ok) throw new Error('加载失败');
        const changelogs = await response.json();
        siteData.changelogs = changelogs;
        changelogLoaded = true;
        changelogLoading = false;
        renderChangelog();
    } catch (error) {
        changelogLoading = false;
        if (changelogList) changelogList.classList.add('hidden');
        if (emptyState) {
            emptyState.classList.remove('hidden');
            emptyState.innerHTML = '<p>更新记录加载失败，请刷新重试</p>';
        }
    }
}

// ========================================
// 渲染更新记录列表
// ========================================
function renderChangelog() {
    const changelogList = document.getElementById('changelogList');
    const emptyState = document.getElementById('changelogEmpty');
    if (!changelogList || !emptyState) return;

    let filtered = (siteData.changelogs || []).slice();

    // 按日期倒序，最新的排最前
    filtered.sort((a, b) => new Date(b.date) - new Date(a.date));

    if (searchQuery) {
        filtered = filtered.filter(c =>
            (c.version || '').toLowerCase().includes(searchQuery) ||
            (c.title || '').toLowerCase().includes(searchQuery) ||
            (c.summary || '').toLowerCase().includes(searchQuery)
        );
    }

    if (filtered.length === 0) {
        changelogList.classList.add('hidden');
        emptyState.classList.remove('hidden');
        return;
    }

    changelogList.classList.remove('hidden');
    emptyState.classList.add('hidden');

    changelogList.innerHTML = filtered.map(item => `
        <div class="changelog-item" data-changelog-id="${item.id}" style="cursor:pointer;">
            <div class="changelog-version">${escapeHtml(item.version)}</div>
            <h3 class="changelog-title">${escapeHtml(item.title)}</h3>
            <div class="changelog-date">${formatDateFull(item.date)}</div>
            <p class="changelog-summary">${escapeHtml(item.summary || '')}</p>
        </div>
    `).join('');

    changelogList.querySelectorAll('.changelog-item').forEach(card => {
        card.addEventListener('click', () => {
            drillIntoChangelog(card.dataset.changelogId);
        });
    });
}

// ========================================
// 更新记录钻入/钻出
// ========================================
async function drillIntoChangelog(id) {
    const item = (siteData.changelogs || []).find(c => c.id == id);
    if (!item) return;

    const changelogList = document.getElementById('changelogList');
    const detailView = document.getElementById('changelogDetailView');
    const detailContent = document.getElementById('changelogDetailContent');

    detailContent.innerHTML = `
        <h1 class="detail-title">${escapeHtml(item.title)}</h1>
        <div class="detail-meta">
            <span class="detail-date">${formatDateFull(item.date)}</span>
        </div>
        <div class="detail-body"><p>加载中...</p></div>
    `;
    changelogList.classList.add('hidden');
    detailView.classList.remove('hidden');
    detailView.classList.remove('drilling-out');
    window.scrollTo({ top: 0, behavior: 'smooth' });

    try {
        const response = await fetch(item.url);
        if (!response.ok) throw new Error('加载失败');
        const html = await response.text();

        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const changelogBody = doc.querySelector('.changelog-body');

        detailContent.innerHTML = `
            <h1 class="detail-title">${escapeHtml(item.title)}</h1>
            <div class="detail-meta">
                <span class="detail-date">${formatDateFull(item.date)}</span>
            </div>
            <div class="detail-body">${changelogBody ? changelogBody.innerHTML : '<p>内容为空</p>'}</div>
        `;
    } catch (error) {
        detailContent.innerHTML = `
            <h1 class="detail-title">${escapeHtml(item.title)}</h1>
            <div class="detail-meta">
                <span class="detail-date">${formatDateFull(item.date)}</span>
            </div>
            <div class="detail-body"><p>内容加载失败，请刷新重试</p></div>
        `;
    }
}

function drillOutOfChangelog() {
    const changelogList = document.getElementById('changelogList');
    const detailView = document.getElementById('changelogDetailView');

    detailView.classList.add('drilling-out');

    setTimeout(() => {
        detailView.classList.add('hidden');
        detailView.classList.remove('drilling-out');
        changelogList.classList.remove('hidden');
    }, 280);
}

function formatDateFull(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    return `${year}年${month}月${day}日`;
}

// ========================================
// 树形收藏列表
// ========================================
let sortAscending = true;

// 展开状态管理
const expandedState = {};

function renderCollectionTree() {
    const container = document.getElementById('treeContainer');
    const emptyState = document.getElementById('collectionsEmpty');
    const recordCount = document.getElementById('recordCount');
    if (!container || !emptyState || !recordCount) return;

    // 有搜索词时过滤整棵树，仅保留命中的链接及其所在文件夹路径
    const isSearching = searchQuery.length > 0;
    const tree = isSearching
        ? filterTree(siteData.collectionTree, searchQuery)
        : siteData.collectionTree;

    // 记录数反映当前展示的链接数
    const totalLinks = countAllLinks(tree);
    recordCount.textContent = `» 记录数:${totalLinks}`;

    if (tree.length === 0) {
        container.classList.add('hidden');
        emptyState.classList.remove('hidden');
        return;
    }

    container.classList.remove('hidden');
    emptyState.classList.add('hidden');

    // 搜索时强制展开，让命中结果可见
    container.innerHTML = renderTreeNodes(tree, isSearching);

    // 绑定展开/折叠事件
    bindTreeEvents(container);
}

// 按搜索词过滤树：文件夹名命中则保留整个文件夹，否则只保留命中的后代
function filterTree(nodes, query) {
    const result = [];
    for (const node of nodes) {
        if (node.type === 'folder') {
            const nameMatch = (node.name || '').toLowerCase().includes(query);
            const filteredChildren = filterTree(node.children || [], query);
            if (nameMatch || filteredChildren.length > 0) {
                result.push({
                    ...node,
                    children: nameMatch ? (node.children || []) : filteredChildren
                });
            }
        } else {
            const name = (node.name || node.title || '').toLowerCase();
            const url = (node.url || '').toLowerCase();
            if (name.includes(query) || url.includes(query)) {
                result.push(node);
            }
        }
    }
    return result;
}

function countAllLinks(nodes) {
    let count = 0;
    for (const node of nodes) {
        if (node.type === 'folder') {
            count += countAllLinks(node.children || []);
        } else {
            count++;
        }
    }
    return count;
}

function renderTreeNodes(nodes, forceExpand) {
    let html = '';

    // 排序
    let sortedNodes = [...nodes];
    sortedNodes.sort((a, b) => {
        // 文件夹始终排在链接前面
        if (a.type === 'folder' && b.type !== 'folder') return -1;
        if (a.type !== 'folder' && b.type === 'folder') return 1;

        const nameA = a.name || a.title || '';
        const nameB = b.name || b.title || '';
        return sortAscending ? nameA.localeCompare(nameB, 'zh') : nameB.localeCompare(nameA, 'zh');
    });

    for (const node of sortedNodes) {
        if (node.type === 'folder') {
            // 搜索时强制展开，否则读取展开状态（默认折叠）
            const isExpanded = forceExpand || expandedState[node.id] === true;

            html += `
                <div class="tree-folder" data-id="${node.id}">
                    <div class="tree-folder-header" data-folder-id="${node.id}" role="button" tabindex="0" aria-expanded="${isExpanded}">
                        <span class="tree-arrow ${isExpanded ? 'expanded' : ''}">
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                                <path d="M4 2l4 4-4 4z"/>
                            </svg>
                        </span>
                        <span class="tree-folder-icon">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="#f0c040" stroke="#d4a020" stroke-width="1">
                                <path d="M2 6a2 2 0 012-2h4l2 2h8a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"/>
                            </svg>
                        </span>
                        <span class="tree-folder-name">${escapeHtml(node.name)}</span>
                    </div>
                    <div class="tree-folder-children ${isExpanded ? '' : 'collapsed'}">
                        ${renderTreeNodes(node.children || [], forceExpand)}
                    </div>
                </div>
            `;
        } else {
            // 链接项
            html += `
                <a href="${escapeHtml(node.url)}" class="tree-link" target="_blank" rel="noopener noreferrer" title="${escapeHtml(node.name)}">
                    <span class="tree-link-icon">
                        <span class="favicon-generic">🔗</span>
                    </span>
                    <span class="tree-link-name">${escapeHtml(node.name)}</span>
                </a>
            `;
        }
    }

    return html;
}

function bindTreeEvents(container) {
    const folderHeaders = container.querySelectorAll('.tree-folder-header');

    const toggleFolder = (header) => {
        const folder = header.closest('.tree-folder');
        const children = folder.querySelector('.tree-folder-children');
        const arrow = header.querySelector('.tree-arrow');

        // 以 DOM 当前状态为准判断下一步，避免 expandedState 与 DOM 不同步
        // （搜索强制展开时 expandedState 未写入，翻转旧值会导致首次点击"空点"）
        const willExpand = children.classList.contains('collapsed');

        children.classList.toggle('collapsed', !willExpand);
        arrow.classList.toggle('expanded', willExpand);
        header.setAttribute('aria-expanded', willExpand);
        expandedState[header.dataset.folderId] = willExpand;
    };

    folderHeaders.forEach(header => {
        header.addEventListener('click', (e) => {
            e.preventDefault();
            toggleFolder(header);
        });
        // 键盘可操作：回车 / 空格展开折叠
        header.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleFolder(header);
            }
        });
    });
}

// 排序控制
document.addEventListener('DOMContentLoaded', () => {
    const sortControl = document.getElementById('sortControl');
    const sortArrow = document.getElementById('sortArrow');
    
    if (sortControl) {
        sortControl.addEventListener('click', () => {
            sortAscending = !sortAscending;
            sortArrow.textContent = sortAscending ? '↑' : '↓';
            renderCollectionTree();
        });
    }
});

// ========================================
// 工具箱：懒加载 + 渲染 + 钻入/钻出
// ========================================
let toolsLoaded = false;
let toolsLoading = false;
let currentToolModule = null;

function ensureToolsLoaded() {
    if (toolsLoaded) {
        renderToolsGrid();
        return;
    }
    if (toolsLoading) return;
    toolsLoading = true;

    const grid = document.getElementById('toolsGrid');
    if (grid) grid.innerHTML = '<div class="tool-loading"><div class="tool-loading-spinner"></div><span>加载工具列表…</span></div>';

    const script = document.createElement('script');
    script.type = 'module';
    script.src = 'js/tools/registry.js';
    script.onload = () => {
        toolsLoaded = true;
        toolsLoading = false;
        renderToolsGrid();
    };
    script.onerror = () => {
        toolsLoading = false;
        if (grid) grid.innerHTML = '<div class="tool-loading">工具列表加载失败</div>';
    };
    document.head.appendChild(script);
}

function renderToolsGrid() {
    const grid = document.getElementById('toolsGrid');
    const emptyState = document.getElementById('toolsEmpty');
    if (!grid) return;

    const tools = window.__toolRegistry || [];

    // 搜索过滤
    let filtered = tools;
    if (searchQuery) {
        filtered = tools.filter(t =>
            t.name.toLowerCase().includes(searchQuery) ||
            (t.desc || '').toLowerCase().includes(searchQuery)
        );
    }

    if (filtered.length === 0) {
        grid.classList.add('hidden');
        if (emptyState) emptyState.classList.remove('hidden');
        return;
    }

    grid.classList.remove('hidden');
    if (emptyState) emptyState.classList.add('hidden');

    grid.innerHTML = filtered.map(tool => `
        <div class="tool-card" data-tool-id="${tool.id}">
            <div class="tool-card-icon">${tool.icon}</div>
            <h3 class="tool-card-name">${escapeHtml(tool.name)}</h3>
            <p class="tool-card-desc">${escapeHtml(tool.desc || '')}</p>
        </div>
    `).join('');

    // 绑定点击钻入
    grid.querySelectorAll('.tool-card').forEach(card => {
        card.addEventListener('click', () => {
            drillIntoTool(card.dataset.toolId);
        });
    });
}

async function drillIntoTool(toolId) {
    const tool = (window.__toolRegistry || []).find(t => t.id === toolId);
    if (!tool) return;

    const grid = document.getElementById('toolsGrid');
    const detailView = document.getElementById('toolDetailView');
    const detailContent = document.getElementById('toolDetailContent');

    // 显示加载状态
    detailContent.innerHTML = '<div class="tool-loading"><div class="tool-loading-spinner"></div><span>加载工具…</span></div>';
    grid.classList.add('hidden');
    detailView.classList.remove('hidden');
    detailView.classList.remove('drilling-out');
    window.scrollTo({ top: 0, behavior: 'smooth' });

    try {
        const module = await tool.loader();
        currentToolModule = module;
        module.mount(detailContent);
    } catch (e) {
        console.error('Tool load error:', e);
        detailContent.innerHTML = '<div class="tool-loading">工具加载失败，请刷新重试</div>';
    }
}

function drillOutOfTool() {
    const grid = document.getElementById('toolsGrid');
    const detailView = document.getElementById('toolDetailView');
    const detailContent = document.getElementById('toolDetailContent');

    // 调用工具的 unmount 清理
    if (currentToolModule && typeof currentToolModule.unmount === 'function') {
        currentToolModule.unmount();
    }
    currentToolModule = null;

    detailView.classList.add('drilling-out');

    setTimeout(() => {
        detailView.classList.add('hidden');
        detailView.classList.remove('drilling-out');
        grid.classList.remove('hidden');
        detailContent.innerHTML = '';
    }, 280);
}

// ========================================
// 返回顶部
// ========================================
function initBackToTop() {
    const btn = document.getElementById('backToTop');
    if (!btn) return;

    window.addEventListener('scroll', () => {
        btn.classList.toggle('visible', window.scrollY > 300);
    }, { passive: true });
    
    btn.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });
}

// ========================================
// 工具函数
// ========================================
function formatDate(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const month = date.getMonth() + 1;
    const day = date.getDate();
    return `${month}月${day}日`;
}

// HTML 转义：防止书签名/标题里的特殊字符破坏结构或注入
function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}