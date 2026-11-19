// electron/main.js — MailHub 桌面壳：启动内置 Express 服务器 + 窗口加载页面
const { app, BrowserWindow, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');

// 数据目录 → 用户数据目录（打包后 asar 只读，数据必须放外面）
process.env.MAILHUB_DATA_DIR = path.join(app.getPath('userData'), 'data');
fs.mkdirSync(process.env.MAILHUB_DATA_DIR, { recursive: true });

// 在 server 启动前预解析环境（server.js 的 DNS monkey-patch 只影响其自身进程内——同进程内全局生效）
const serverPath = path.join(__dirname, '..', 'server.js');

let mainWindow = null;
let actualPort = 0;

function findFreePort(start) {
  return new Promise(function (resolve) {
    var port = start;
    function tryNext() {
      var srv = net.createServer();
      srv.listen(port, '127.0.0.1', function () {
        srv.close(function () { resolve(port); });
      });
      srv.on('error', function () { port += 1; if (port > start + 50) { resolve(start); } tryNext(); });
    }
    tryNext();
  });
}

async function startServer() {
  actualPort = await findFreePort(18490);
  process.env.PORT = String(actualPort);
  // 启动 Express（server.js 会监听 process.env.PORT）
  require(serverPath);
  // 等端口就绪
  await new Promise(function (resolve) {
    var tries = 0;
    var t = setInterval(function () {
      var s = net.connect({ host: '127.0.0.1', port: actualPort }, function () { s.destroy(); clearInterval(t); resolve(); });
      s.on('error', function () { s.destroy(); });
      if (++tries > 50) { clearInterval(t); resolve(); }
    }, 200);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: 'MailHub',
    backgroundColor: '#1a1a2e',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  // 外部链接（邮件正文里的链接）用系统浏览器打开
  mainWindow.webContents.setWindowOpenHandler(function (details) {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });
  mainWindow.loadURL('http://127.0.0.1:' + actualPort);
}

app.whenReady().then(async function () {
  Menu.setApplicationMenu(null);
  await startServer();
  createWindow();
  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  app.quit();
});
