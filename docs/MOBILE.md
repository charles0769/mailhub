# MailHub 移动端（Android / iOS）

MailHub 的移动端方案与桌面端不同：手机上不打包 Node.js 服务器，而是由 Capacitor 提供原生壳（WebView），直接加载你自部署的 MailHub 服务器页面。

## 前提

先在一台机器（NAS / 服务器 / 树莓派 / 云主机）上部署 MailHub 服务端，参见主 README 的「Docker 部署」或「源码部署」。确保手机与服务器在同一局域网，或服务器有公网地址。

把 `capacitor.config.json` 里的 `server.url` 改成你的服务器地址，例如 `http://192.168.1.100:18090`。

## Android APK

### 方式一：GitHub Actions 云端构建（推荐，本地无需任何环境）

1. 推送代码到 GitHub
2. GitHub 仓库 → Actions → **Build Release Packages** → **Run workflow**
3. 等待 `android` job 完成，在 Artifacts 里下载 `android-apk`（MailHub-xxx.apk）
4. 传到手机安装（允许"未知来源应用"）

打 tag（`git tag v1.0.1 && git push --tags`）时 APK 会自动上传到 GitHub Release。

### 方式二：本地构建

需要 JDK 17 + Android SDK（Android Studio 自带）：

```bash
npm install
npx cap add android      # 首次执行，生成 android/ 工程
npx cap sync android     # 之后每次改了 capacitor.config.json 或前端代码后执行
cd android && ./gradlew assembleDebug
# 产物: android/app/build/outputs/apk/debug/app-debug.apk
```

debug 包无需签名配置，可直接安装。正式发布（release）需要自己生成 keystore 签名。

## iOS

**无法在 Linux/Windows 上打包 ipa**——iOS 应用必须用 Xcode（仅 macOS）编译，且真机安装需要 Apple 开发者账号（$99/年）签名。

可行的三条路：

1. **PWA（推荐，零成本）**：iPhone Safari 打开 `http://你的服务器:18090` → 分享 → **添加到主屏幕**。图标和全屏体验与原生 App 几乎一致，MailHub 前端已适配移动端视口。
2. **GitHub Actions**：macOS runner 上跑 `npx cap add ios && npx cap sync ios` 可生成 Xcode 工程 artifact，但**签名步骤仍需你自己的 Apple 开发者证书**，Actions 无法替代。
3. **本地 Mac 打包**：`npx cap add ios` 后用 Xcode 打开 `ios/App/App.xcworkspace`，配置签名团队后 Archive 导出 ipa。

## 安全提示

移动端通过 HTTP 明文连接服务器时，邮件内容在局域网内可见。公网使用务必套一层 HTTPS（Nginx 反代 + Let's Encrypt），并在 `capacitor.config.json` 里把 `server.url` 改为 `https://` 地址。
