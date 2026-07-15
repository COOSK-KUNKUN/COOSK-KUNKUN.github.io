const fs = require('fs');

const bookmarks = JSON.parse(fs.readFileSync('parsed_bookmarks.json', 'utf8'));

// The bookmarks are nested: 收藏夹栏 > 收藏夹栏 > 分类 > [游戏资源, 趣站探索, 论坛交流, 绘画参考, 书籍资源, ...]
// We need to extract the "分类" level children

let categories = [];

function findCategories(node) {
  if (node.name === '分类' && node.children) {
    categories = node.children;
    return true;
  }
  if (node.children) {
    for (const child of node.children) {
      if (findCategories(child)) return true;
    }
  }
  return false;
}

// Also collect items from "未分类"
let unclassified = [];
function findUnclassified(node) {
  if (node.name === '未分类' && node.children) {
    unclassified = node.children;
    return true;
  }
  if (node.children) {
    for (const child of node.children) {
      if (findUnclassified(child)) return true;
    }
  }
  return false;
}

for (const item of bookmarks) {
  findCategories(item);
  findUnclassified(item);
}

// Generate unique IDs
let idCounter = 0;
function generateId() {
  return 'item_' + (idCounter++);
}

// Convert bookmark structure to data.js format
function convertNode(node, parentId) {
  if (node.url) {
    // It's a link
    return {
      id: generateId(),
      name: node.name,
      url: node.url,
      date: '2024-01-01'
    };
  } else if (node.children) {
    // It's a folder
    return {
      id: generateId(),
      name: node.name,
      type: 'folder',
      children: node.children.map(child => convertNode(child, node.name))
    };
  }
  return null;
}

// Build the collection tree
const collectionTree = [];

// Add unclassified items as "网页收藏"
if (unclassified.length > 0) {
  collectionTree.push({
    id: generateId(),
    name: '网页收藏',
    type: 'folder',
    children: unclassified.map(item => ({
      id: generateId(),
      name: item.name,
      url: item.url,
      date: '2024-01-01'
    }))
  });
}

// Add categories
for (const cat of categories) {
  const converted = convertNode(cat);
  if (converted) {
    collectionTree.push(converted);
  }
}

// Count total items
function countItems(nodes) {
  let count = 0;
  for (const node of nodes) {
    if (node.url) {
      count++;
    }
    if (node.children) {
      count += countItems(node.children);
    }
  }
  return count;
}

const totalItems = countItems(collectionTree);
console.log('Total items:', totalItems);
console.log('Total folders:', collectionTree.length);

// Output as JS code
const output = `/**
 * 数据文件
 * 包含笔记和收藏两个部分的数据
 * 收藏数据从浏览器书签导入 (${new Date().toISOString().split('T')[0]})
 */

const siteData = {
    // 笔记数据（博客文章）
    notes: [
        {
            id: 1,
            title: '我的第一篇笔记',
            excerpt: '这是我在 COOSK琨琨 的第一篇笔记，记录一些想法和感悟...',
            content: '完整内容...',
            date: '2024-01-30',
            tags: ['随笔', '生活'],
            url: 'notes/first-note-2026-07-14.html'
        }
    ],

    // 收藏数据 - 树形结构（从浏览器书签导入）
    collectionTree: ${JSON.stringify(collectionTree, null, 4)}
};
`;

fs.writeFileSync('js/data.js', output);
console.log('Done! Written to js/data.js');