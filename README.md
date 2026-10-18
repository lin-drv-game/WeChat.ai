# WeChat.ai

> English | 中文

A WeChat-style floating chat window that bridges **Doubao** and **DeepSeek** web clients into one shared conversation, implemented as a pure front-end userscript for Via Browser on mobile.

No API keys. No official SDK. No server. Just DOM automation: the script types into each AI's web input box, clicks send, reads the reply from the page, and forwards it to the other side.

一个微信风格的浮动聊天窗口，将 **Doubao** 和 **DeepSeek** 网页客户端桥接进同一个共享对话，以纯前端用户脚本形式实现，面向移动端 Via 浏览器。

无需 API Key，无需官方 SDK，无需服务器。仅通过 DOM 自动化：脚本向每个 AI 的网页输入框输入文字、点击发送、从页面读取回复，并转发给另一方。

---

## Features / 功能特性

- **Group-chat UI** — WeChat-inspired bubbles, avatars, left/right layout  
  **群聊 UI** —— 微信风格气泡、头像、左右布局

- **Doubao + DeepSeek in one loop** — user message → Doubao → Doubao reply → DeepSeek → DeepSeek reply → back to Doubao  
  **Doubao + DeepSeek 单循环联动** —— 用户消息 → Doubao → Doubao 回复 → DeepSeek → DeepSeek 回复 → 回到 Doubao

- **Round & length control** — configurable `maxRounds` and `maxChars` to stop runaway AI-to-AI chatter  
  **轮次与长度控制** —— 可配置 `maxRounds` 和 `maxChars`，防止 AI 间无限聊天

- **Image support** — Doubao-generated images are extracted and rendered; user can upload images via the `+` button  
  **图片支持** —— 提取并渲染 Doubao 生成的图片；用户可通过 `+` 按钮上传图片

- **Fully movable window** — drag by title bar, resize from bottom-right corner, maximize, minimize, snap to screen edge as a slim translucent bar  
  **完全可移动窗口** —— 拖动标题栏移动，从右下角调整大小，支持最大化、最小化，吸附到屏幕边缘成为细长半透明条

- **Custom backgrounds** — long-press the blank message area to change or reset the chat background  
  **自定义背景** —— 长按消息区空白处更改或重置聊天背景

- **Custom avatars** — tap any avatar to upload your own (auto-cropped to 64×64 JPEG, stored in GM storage)  
  **自定义头像** —— 点击任意头像上传自己的头像（自动裁剪为 64×64 JPEG，存储在 GM 存储中）

- **Pull-to-refresh** — scroll to top and pull down to reload the page  
  **下拉刷新** —— 滚动到顶部并下拉以重新加载页面

- **Persistent history** — messages are stored via `GM_setValue`, survive page reload and browser restart  
  **持久历史** —— 消息通过 `GM_setValue` 存储，页面重载和浏览器重启后仍保留

---

## Platform / 平台

Designed and tested for **Via Browser on Android**. The script is a standard userscript and should also work in Tampermonkey / Violentmonkey on desktop, but the UI is optimized for mobile touch input.

为 Android 上的 **Via 浏览器**设计和测试。该脚本是标准用户脚本，理论上也可在桌面端 Tampermonkey / Violentmonkey 中运行，但 UI 针对移动端触摸输入优化。

> Via does **not** support `.crx` extensions. This project is distributed as a `.user.js` file loaded through Via's built-in script manager.  
> Via **不支持** `.crx` 扩展。本项目以 `.user.js` 文件分发，通过 Via 内置脚本管理器加载。

---

## Installation / 安装

### Option 1 — Import the file directly / 方式一 —— 直接导入文件

1. Rename `WeChat.ai.txt` to `wechat-ai.user.js`.  
   将 `WeChat.ai.txt` 重命名为 `wechat-ai.user.js`。

2. Open Via → `≡` menu → **Settings** → **Scripts** → `+` → **Import script**.  
   打开 Via → `≡` 菜单 → **设置** → **脚本** → `+` → **导入脚本**。

3. Select the `.user.js` file. Make sure the `@match` rules include:  
   选择 `.user.js` 文件。确保 `@match` 规则包含：
   - `https://www.doubao.com/*`
   - `https://chat.deepseek.com/*`

4. Save and enable.  
   保存并启用。

### Option 2 — Install from URL / 方式二 —— 从 URL 安装

1. Upload `wechat-ai.user.js` to a GitHub repo (Public).  
   将 `wechat-ai.user.js` 上传到 GitHub 仓库（公开）。

2. Open the file on GitHub and click **Raw**, copy the full URL.  
   在 GitHub 上打开该文件，点击 **Raw**，复制完整 URL。

3. In Via, go to `viabrowser://settings/extensions` → `+` → **Install from URL**.  
   在 Via 中进入 `viabrowser://settings/extensions` → `+` → **从 URL 安装**。

4. Paste the Raw link and confirm.  
   粘贴 Raw 链接并确认。

---

## Usage / 使用

1. Open **Doubao** (`https://www.doubao.com`) and log in.  
   打开 **Doubao**（`https://www.doubao.com`）并登录。

2. Open **DeepSeek** (`https://chat.deepseek.com`) in another tab and log in.  
   在另一个标签页打开 **DeepSeek**（`https://chat.deepseek.com`）并登录。

3. **Keep both tabs open** — each page handles its own half of the loop.  
   **保持两个标签页都打开** —— 每个页面负责循环中自己那一半。

4. A floating WeChat-style window appears at the bottom-right of either page.  
   任一页面右下角会出现微信风格浮动窗口。

5. Type a message and hit **Send**. The flow runs automatically.  
   输入消息并点击 **发送**。流程自动运行。

6. To stop early, just send a new message — it resets the session.  
   要提前停止，只需发送新消息 —— 它会重置会话。

---

## Configuration / 配置

At the top of the script:  
在脚本顶部：

```javascript
const DEFAULT_MAX_ROUNDS = 1;   // how many Doubao↔DeepSeek round-trips per user message
                                // 每条用户消息触发多少次 Doubao↔DeepSeek 往返
const DEFAULT_MAX_CHARS  = 100; // soft character limit hint appended to each AI prompt (0 = no limit)
                                // 追加到每个 AI 提示词后的软字符限制提示（0 = 不限制）
