# Tampermonkey 脚本合集

网页增强用户脚本合集。每个脚本都是独立的 `.user.js` 文件，符合 Tampermonkey 规范，可直接在 Tampermonkey 中通过仓库 raw 链接一键安装使用。

## 安装方法

### 方法一：从 URL 安装（推荐）
1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 浏览器扩展。
2. 点击 Tampermonkey 图标 → **管理面板** → 右侧 **工具** → **从 URL 安装**。
3. 粘贴下方脚本对应的 raw 链接 → 点击 **安装**。

### 方法二：手动安装
1. 点击仓库中的脚本文件 → 右上角 **Raw** 查看源码 → 全选复制。
2. Tampermonkey 管理面板 → **添加新脚本** → 粘贴 → **保存**（Ctrl/Cmd+S）。

## 脚本列表

### 网页内视频全屏（In-Page Video Fullscreen）
- 文件：[`in-page-video-fullscreen.user.js`](in-page-video-fullscreen.user.js)
- 安装链接：
  ```
  https://raw.githubusercontent.com/zhuyifeiRuichuang/tampermonkey-scripts/main/in-page-video-fullscreen.user.js
  ```
- 功能：悬停任意网页视频，**点击右上角"网页全屏"按钮**（或按 `V` 键），将其放大到浏览器视口内全屏——**非系统原生全屏**，浏览器标签栏/地址栏仍可见。再次点击按钮或按 `V` / `Esc` 退出。
- 适用：任意网页视频。
  - YouTube：走镜像（captureStream）方案，画面稳定不黑屏。
  - 微博 / B站网页端等简单播放器：走容器放大方案，保留站点原生控制条。
- 配置：脚本顶部常量可调整热键、是否对非 YouTube 站点启用容器方案。

## 说明
- 所有脚本均为 `@grant none` 纯前端 DOM 操作，不请求任何站外资源，可本地审计。
- 脚本已设置规范 metadata（`@name` / `@namespace` / `@version` / `@description` / `@match` / `@run-at`），Tampermonkey 会按设置间隔自动检查更新。
