# MailHub — 全厂商邮件聚合客户端

自部署的 IMAP/SMTP 邮件客户端，支持国内外主流邮箱厂商。浏览器访问 :18090 即用。

## 支持的厂商（11 家预设 + 自定义）
QQ / 网易163 / 网易126 / Gmail / Outlook / Yahoo / iCloud / 新浪 / 阿里企业邮 / 腾讯企业邮 / 自定义 IMAP

## 启动
```bash
npm install
node server.js       # :18090
```

## 功能
- 多帐号聚合（无限个）
- IMAP 拉取（最近 100 封）· 搜索 · 星标 · 已读
- SMTP 发送 · 已发送记录（含失败状态）
- 帐号连接测试 · 帐号删除
- 邮件正文 iframe 沙箱渲染（防 XSS）

## 注意
- QQ/163/126 需在邮箱设置里开启 IMAP 并生成**授权码**（不是登录密码）
- Gmail 需应用专用密码或 OAuth
- 数据存储在 mailhub.json（本地文件，不上传）
