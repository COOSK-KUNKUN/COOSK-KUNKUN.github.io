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
let currentView = 'notes';

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
}

function switchView(view) {
    currentView = view;
    
    // 更新导航状态
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.toggle('active', link.dataset.view === view);
    });
    
    // 切换视图
    const notesView = document.getElementById('notesView');
    const collectionsView = document.getElementById('collectionsView');
    
    if (view === 'notes') {
        notesView.classList.remove('hidden');
        collectionsView.classList.add('hidden');
    } else {
        notesView.classList.add('hidden');
        collectionsView.classList.remove('hidden');
        ensureCollectionsLoaded();
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
            } else {
                renderCollectionTree();
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