// store.js — 纯 JS JSON 存储（零原生依赖，个人邮箱场景：全量内存 + 落盘）
// 数据目录优先级: MAILHUB_DATA_DIR 环境变量 > 应用目录（源码/服务器部署）
// Electron 打包后由 electron/main.js 设置 MAILHUB_DATA_DIR 到用户数据目录（asar 包内只读）
const fs = require('fs');
const path = require('path');
const DATA_DIR = process.env.MAILHUB_DATA_DIR || __dirname;
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, 'mailhub.json');

let data = { accounts: [], mails: [], outbox: [], seq: { accounts: 1, mails: 1, outbox: 1 } };
try {
  if (fs.existsSync(DB_FILE)) data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
} catch (e) { /* 损坏则重建 */ }

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFileSync(DB_FILE, JSON.stringify(data));
  }, 300); // 防抖落盘
}
function saveNow() { fs.writeFileSync(DB_FILE, JSON.stringify(data)); }

process.on('exit', saveNow);

const db = {
  accounts: {
    all: () => data.accounts,
    get: (id) => data.accounts.find(a => a.id === Number(id)),
    getByEmail: (email) => data.accounts.find(a => a.email === email),
    insert: (row) => {
      row.id = data.seq.accounts++;
      data.accounts.push(row);
      save();
      return row.id;
    },
    del: (id) => {
      id = Number(id);
      data.accounts = data.accounts.filter(a => a.id !== id);
      data.mails = data.mails.filter(m => m.account_id !== id);
      save();
    },
  },
  mails: {
    find: (id) => data.mails.find(m => m.id === Number(id)),
    exist: (accId, folder, uid) => data.mails.find(m => m.account_id === Number(accId) && m.folder === folder && m.uid === String(uid)),
    insert: (row) => {
      row.id = data.seq.mails++;
      data.mails.push(row);
      save();
      return row.id;
    },
    list: (accId, folder, q, size, off) => {
      let rows = data.mails.filter(m => m.account_id === Number(accId) && m.folder === folder);
      if (q) {
        const k = q.toLowerCase();
        rows = rows.filter(m => (m.subject || '').toLowerCase().includes(k) || (m.from_addr || '').toLowerCase().includes(k) || (m.snippet || '').toLowerCase().includes(k));
      }
      rows.sort((a, b) => (b.date - a.date) || (b.id - a.id));
      return { rows: rows.slice(off, off + size), total: rows.length };
    },
    markSeen: (id) => { const m = db.mails.find(id); if (m) { m.seen = 1; save(); } },
    toggleStar: (id) => { const m = db.mails.find(id); if (m) { m.starred = m.starred ? 0 : 1; save(); } },
    markUnread: (id) => { const m = db.mails.find(id); if (m) { m.seen = 0; save(); } },
    del: (id) => { data.mails = data.mails.filter(m => m.id !== Number(id)); save(); },
    unseenCount: (accId) => data.mails.filter(m => m.account_id === Number(accId) && !m.seen).length,
  },
  outbox: {
    list: (accId) => data.outbox.filter(o => o.account_id === Number(accId)).sort((a, b) => b.sent_at - a.sent_at).slice(0, 100),
    insert: (row) => {
      row.id = data.seq.outbox++;
      row.sent_at = Math.floor(Date.now() / 1000);
      row.status = row.status || 'sent';
      data.outbox.push(row);
      save();
    },
  },
  saveNow,
};
module.exports = db;
