const fs = require('fs');

// Read the HTML bookmarks file
const html = fs.readFileSync('favorites_2026_7_14.html', 'utf8');

// Parse bookmarks from HTML
function parseBookmarks(html) {
  const lines = html.split('\n');
  const root = { name: 'root', children: [] };
  const stack = [root];
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Check for folder (H3)
    const folderMatch = trimmed.match(/<DT><H3[^>]*>(.*?)<\/H3>/);
    if (folderMatch) {
      const folder = { name: folderMatch[1], children: [] };
      stack[stack.length - 1].children.push(folder);
      stack.push(folder);
      continue;
    }
    
    // Check for bookmark link (A)
    const linkMatch = trimmed.match(/<DT><A HREF="([^"]*)"[^>]*>(.*?)<\/A>/);
    if (linkMatch) {
      const bookmark = { name: linkMatch[2], url: linkMatch[1] };
      stack[stack.length - 1].children.push(bookmark);
      continue;
    }
    
    // Check for closing DL (end of folder)
    if (trimmed === '</DL><p>' || trimmed === '</DL>') {
      if (stack.length > 1) {
        stack.pop();
      }
    }
  }
  
  return root;
}

// Find a folder by name recursively
function findFolder(node, name) {
  if (node.name === name && node.children) {
    return node;
  }
  if (node.children) {
    for (const child of node.children) {
      const result = findFolder(child, name);
      if (result) return result;
    }
  }
  return null;
}

// Generate unique IDs
let idCounter = 0;
function generateId() {
  return 'item_' + (idCounter++);
}

// Convert bookmark node to data.js format
function convertNode(node) {
  if (node.url) {
    return {
      id: generateId(),
      name: node.name,
      url: node.url,
      date: '2024-01-01'
    };
  } else if (node.children) {
    const children = node.children
      .map(child => convertNode(child))
      .filter(c => c !== null);
    
    if (children.length === 0) return null;
    
    return {
      id: generateId(),
      name: node.name,
      type: 'folder',
      children: children
    };
  }
  return null;
}

// Count items
function countItems(nodes) {
  let count = 0;
  for (const node of nodes) {
    if (node.url) count++;
    if (node.children) count += countItems(node.children);
  }
  return count;
}

// Main
const parsed = parseBookmarks(html);

// Find "分类" folder
const categoryFolder = findFolder(parsed, '分类');

if (!categoryFolder) {
  console.error('Could not find "分类" folder!');
  process.exit(1);
}

// Filter out "其他" and "工程技术"
const excludedNames = ['其他', '其它', '工程技术'];
const filteredCategories = categoryFolder.children.filter(
  child => !excludedNames.includes(child.name)
);

console.log('Categories found in "分类":');
for (const cat of categoryFolder.children) {
  const excluded = excludedNames.includes(cat.name) ? ' [EXCLUDED]' : '';
  const childCount = cat.children ? cat.children.length : 0;
  console.log(`  - ${cat.name} (${childCount} items)${excluded}`);
}

console.log(`\nAfter filtering: ${filteredCategories.length} categories remain`);

// Convert to tree format
const collectionTree = [];
for (const cat of filteredCategories) {
  const converted = convertNode(cat);
  if (converted) {
    collectionTree.push(converted);
  }
}

const totalItems = countItems(collectionTree);
console.log(`Total bookmarks: ${totalItems}`);
console.log(`Total top-level categories: ${collectionTree.length}`);

// Read existing data.js to preserve notes section
const existingData = fs.readFileSync('js/data.js', 'utf8');
const notesMatch = existingData.match(/notes:\s*\[[\s\S]*?\n\s*\]/);
const notesSection = notesMatch ? notesMatch[0] : `notes: [
        {
            id: 1,
            title: '我的第一篇笔记',
            excerpt: '这是我在 COOSK-KUNKUN 的第一篇笔记，记录一些想法和感悟...',
            content: '完整内容...',
            date: '2024-01-30',
            tags: ['随笔', '生活'],
            url: 'notes/first-note-2026-07-14.html'
        }
    ]`;

// Generate output
const output = `/**
 * 数据文件
 * 包含笔记和收藏两个部分的数据
 * 收藏数据从浏览器书签导入 (${new Date().toISOString().split('T')[0]})
 * 仅包含"分类"文件夹内容（已排除"其他"和"工程技术"）
 */

const siteData = {
    // 笔记数据（博客文章）
    ${notesSection},

    // 收藏数据 - 树形结构（从浏览器书签导入）
    collectionTree: ${JSON.stringify(collectionTree, null, 4)}
};
`;

fs.writeFileSync('js/data.js', output);
console.log('\nDone! Written to js/data.js');