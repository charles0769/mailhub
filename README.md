# MailHub — 自部署多厂商邮件聚合客户端

一个纯自部署的邮件聚合 Web 客户端：Node.js（Express）服务端直连各家邮箱的 IMAP/SMTP，浏览器访问统一界面收发所有邮箱的邮件。**无第三方服务、无云端中转，全部数据留在你自己的机器上。**

支持 11 家厂商预设：163 / QQ / Gmail / Outlook / 126 / 新浪 / 搜狐 / Yahoo / Zoho / ProtonMail(桥) / 自定义 IMAP。

![技术栈](https://img.shields.io/badge/Node.js-20+-green) ![前端](https://img.shields.io/badge/前端-原生JS-blue) ![数据库](https://img.shields.io/badge/存储-JSON文件-orange)

## 功能

- **多帐号聚合**：添加多个邮箱，一个界面统一收件
- **收信**：IMAP 拉取最近邮件、正文渲染（iframe 隔离）、附件视图
- **发信**：SMTP + 富文本编辑器（加粗/斜体/列表/链接）
- **回复 / 全部回复 / 转发**：自动引用原文（净化后的安全 HTML）
- **双向已读同步**：本地标记已读 → 自动推送 `\Seen` 到 IMAP 服务器；服务器上已读 → 本地同步
- **星标 / 未读 / 删除 / 搜索**：全部本地缓存操作，秒级响应
- **过滤视图**：全部 / 未读 / 星标
- **定时拉取**：进页面自动拉 + 每 3 分钟后台拉新
- **防重复发送**：SMTP 发送中按钮禁用 + 状态锁
- **移动端适配**：手机浏览器 / PWA 添加到主屏幕可用

## 项目结构

```
mailhub/
├── server.js            # Express 服务端：REST API + 静态托管（IMAP 拉取 / SMTP 发送）
├── store.js             # 纯 JS JSON 存储层（零原生依赖，防抖落盘）
├── public/
│   └── index.html       # 前端单页应用（原生 JS，无框架，CSS 全内联）
├── electron/
│   └── main.js          # 桌面壳：启动内置服务器 + BrowserWindow
├── build-resources/
│   └── icon.png         # 应用图标
├── capacitor.config.json# 移动端壳配置（Android/iOS 加载远程服务器）
├── docs/
│   └── MOBILE.md        # 移动端打包指南（Android APK / iOS 说明）
├── Dockerfile           # Docker 镜像
├── docker-compose.yml   # 一键编排
└── .github/workflows/
    └── build.yml        # CI：tag 推送自动构建全平台安装包
```

**数据存储**：所有邮件、帐号、发件记录存在 `mailhub.json`（JSON 文件，内存全量 + 防抖落盘），不含任何外部数据库依赖。

## 快速开始（Docker 部署，推荐）

```bash
git clone https://github.com/charles0769/mailhub.git
cd mailhub
docker compose up -d --build
```

浏览器打开 `http://你的机器IP:18090`。

数据持久化在 `./mailhub-data/` 目录（容器内 `/data`）。

或者不用 compose：

```bash
docker build -t mailhub .
docker run -d --name mailhub -p 18090:18090 -v $PWD/mailhub-data:/data -e TZ=Asia/Shanghai mailhub
```

## 源码部署

要求：Node.js ≥ 18（推荐 20 LTS）。

```bash
git clone https://github.com/charles0769/mailhub.git
cd mailhub
npm install --omit=dev
node server.js
# ✓ MailHub :18090
```

浏览器访问 `http://127.0.0.1:18090`，添加邮箱帐号即可。

自定义端口 / 数据目录：

```bash
PORT=8080 MAILHUB_DATA_DIR=/var/lib/mailhub node server.js
```

生产环境常驻建议（任选）：

```bash
# 方式一：systemd
sudo tee /etc/systemd/system/mailhub.service > /dev/null <<'EOF'
[Unit]
Description=MailHub
After=network.target
[Service]
ExecStart=/usr/bin/node /opt/mailhub/server.js
Environment=PORT=18090
Restart=always
User=www-data
[Install]
WantedBy=multi-user.target
EOF
sudo systemctl enable --now mailhub

# 方式二：pm2
npm i -g pm2 && pm2 start server.js --name mailhub
```

## 桌面安装包（Electron）

| 平台 | 包 | 说明 |
|------|-----|------|
| Windows | `MailHub Setup 1.0.0.exe` | NSIS 安装向导，可自选安装目录 |
| Linux | `mailhub_1.0.0_amd64.deb` | Debian / Ubuntu / Deepin |
| Linux | `mailhub-1.0.0.x86_64.rpm` | Fedora / openSUSE / RHEL |
| Linux | `MailHub-1.0.0.AppImage` | 免安装，chmod +x 直接运行 |
| macOS | `MailHub-1.0.0.dmg` | 未签名（右键打开绕过 Gatekeeper） |

**下载方式**：

1. **GitHub Actions 自动构建**：仓库 → Actions → Build Release Packages → Run workflow，完成后在各 job 的 Artifacts 下载；或打 tag（`git tag v1.0.0 && git push --tags`）自动发 Release
2. **本地构建**（当前仓库里 dist/ 目录下已有现成产物）：

```bash
npm install
npx electron-builder --win      # Windows exe
npx electron-builder --linux    # deb + rpm + AppImage
npx electron-builder --mac      # dmg（需 macOS 机器）
```

桌面版说明：内置服务器随应用启动（自动挑空闲端口），数据保存在系统用户数据目录（Windows: `%APPDATA%/mailhub/data`，Linux: `~/.config/mailhub/data`，macOS: `~/Library/Application Support/mailhub/data`），与浏览器版数据互不干扰。

## 手机端

- **Android APK**：GitHub Actions 云端构建（本地无需 Android SDK），见 [docs/MOBILE.md](docs/MOBILE.md)
- **iOS**：无需打包——Safari 打开服务器地址 → 添加到主屏幕即为 PWA 全屏应用；或参考 MOBILE.md 用 Mac + Xcode 打 ipa（需开发者账号）

## 首次使用

1. 左栏「添加帐号」→ 选择厂商（如 163）→ 填邮箱和**授权码**（不是登录密码！163/QQ 需在官方设置里开启 IMAP/SMTP 并生成授权码）
2. 点「拉取邮件」首次同步（每帐号拉最近 100 封）
3. 之后每 3 分钟自动检查新邮件

## 常见问题

<details>
<summary>163 邮箱拉取报 SEARCH 错误？</summary>

已内置规避：163 不支持 UID SEARCH，服务端改用 sequence range 直接 fetch。如仍报错请确认已开启 IMAP 服务。
</details>

<details>
<summary>DNS 解析到 IPv6 连不上？</summary>

服务端已强制 IPv4（monkey-patch `dns.lookup` + SMTP/IMAP 预解析 A 记录直连，SNI 保留原域名保证 TLS 证书校验通过）。
</details>

<details>
<summary>better-sqlite3 段错误？</summary>

本项目不使用任何原生模块，存储层是纯 JS JSON。曾有版本用 SQLite，现已被替换。
</details>

<details>
<summary>如何备份？</summary>

备份 `mailhub.json` 一个文件即可（Docker 部署在 `./mailhub-data/mailhub.json`）。
</details>

## 安全提示

- `mailhub.json` 含邮箱授权码明文 + 邮件内容，**不要提交到 git、不要泄露**（.gitignore 已排除）
- 公网部署请务必套 HTTPS（Nginx 反代 + Let's Encrypt）或走 VPN/Tailscale
- 邮件正文在 iframe 中渲染；引用 HTML 做过净化（剥 script/style/固定定位），但自部署场景请自行评估风险

## License

MIT
