# 爱聊 (WeChat.ai) / WeChat.ai

一款仿微信风格的悬浮聊天窗口，将 **豆包** 和 **DeepSeek** 两个网页客户端桥接进同一个共享对话，以纯前端用户脚本的形式实现。
A WeChat-style floating chat window that bridges **Doubao** and **DeepSeek** web clients into one shared conversation, implemented as a pure front-end userscript.

无需 API Key，无需官方 SDK，无需服务器。完全依靠 DOM 自动化：脚本把内容输入到各 AI 的网页输入框、点击发送、读取页面上的回复，再转发给另一方。
No API keys, no official SDK, no server. Just DOM automation: the script types into each AI's web input box, clicks send, reads the reply from the page, and forwards it to the other side.

---

##  核心功能 / Features

- **群聊式界面 (Group-chat UI)**：仿微信气泡、头像、左右分栏布局。 / WeChat-inspired bubbles, avatars, left/right layout.
- **豆包 + DeepSeek 闭环联动 (Doubao + DeepSeek Loop)**：用户消息 → 豆包 → 豆包回复 → DeepSeek → DeepSeek 回复 → 再回到豆包。 / User message → Doubao → Doubao reply → DeepSeek → DeepSeek reply → back to Doubao.
- **心跳检测与自动补全 (Heartbeat & Auto-Open)**：脚本会自动检测另一方是否在线，如果只打开了其中一个页面，会自动在后台唤起另一个标签页，且刷新时不会无限增殖。 / Automatically detects if the other page is missing and opens it in the background. Preventing infinite tab multiplication upon refreshing.
- **轮次与长度控制 (Round & Length Control)**：可配置 `MAX_ROUNDS` 和 `MAX_CHARS`，防止 AI 之间无休止地互聊。 / Configurable `maxRounds` and `maxChars` to stop runaway AI-to-AI chatter.
- **代码与图片支持 (Code & Image Support)**：自动提取 Markdown 代码块并使用 GitHub Dark 主题高亮渲染；用户可通过 `+` 按钮上传图片。 / Extracts Markdown code blocks with GitHub Dark highlighting; supports image uploads.
- **跨平台专属手势 (Cross-platform Gestures)**：针对 PC（Edge）和移动端（Via）分别优化的独立交互逻辑。 / Dedicated UI/UX logic optimized separately for Desktop (Edge) and Mobile (Via).
- **精致 UI 与 GPU 加速 (Refined UI & GPU Acceleration)**：PC 端窗口比例缩小，阴影更细腻，引入 `translateZ(0)` 硬件加速，确保动画如丝般顺滑不卡顿。 / Narrower PC window, finer shadows, and GPU hardware acceleration to prevent stuttering.
- **历史记录持久化 (Persistent History)**：消息通过 `GM_setValue` 存储，页面刷新后依然保留。 / Messages are stored via `GM_setValue`, surviving page reloads.

---

##  平台与安装 / Platform & Installation

###  PC 端（Windows Edge）

1. 打开 Edge 浏览器，进入扩展商店安装 **Tampermonkey（篡改猴）** 插件。
   Install the **Tampermonkey** extension from the Edge Add-ons store.
2. 点击浏览器右上角的 Tampermonkey 图标，选择 **管理面板 (Dashboard)**。
   Click the Tampermonkey icon and select **Dashboard**.
3. 点击 `+` 号新建脚本，清空编辑器里的默认代码。
   Click the `+` tab to add a new script, clear the default code.
4. 将本项目的全部代码粘贴进去，按 `Ctrl + S` 保存并启用即可。
   Paste the code, press `Ctrl + S` to save and enable.

### 📱 移动端（Android Via）

1. 将脚本保存为 `wechat-ai.user.js`。
   Save the file as `wechat-ai.user.js`.
2. 打开 Via 浏览器 → `≡` 菜单 → **设置** → **脚本** → `+` → **导入脚本**。
   Open Via → `≡` menu → **Settings** → **Scripts** → `+` → **Import script**.
3. 确保脚本的 `@match` 规则包含 `https://www.doubao.com/*` 和 `https://chat.deepseek.com/*`。
   Ensure the `@match` rules include both domains.

---

##  操作指南 / Usage Guide

### 通用逻辑 / General Logic
打开**豆包**和 **DeepSeek** 页面并登录。任意一个页面的右下角会浮出聊天窗口。输入消息并点击 **发送**，双端 AI 的对话闭环会自动开始运行。
Open both **Doubao** and **DeepSeek** and log in. A floating window appears at the bottom-right of either page. Type a message and hit **Send**, the AI loop runs automatically.

###  桌面端专属操作 (Edge)

- **右键菜单**：在悬浮窗内的空白处点击鼠标右键，即可呼出菜单（更换背景、恢复背景、清空对话）。 / **Right-click Menu**: Right-click on the blank area inside the window to open the menu.
- **四周缩放**：鼠标靠近窗口的四周边缘或四个角，会出现拉伸光标，支持上、下、左、右及四个斜角自由调整窗口大小。 / **4-way Resize**: Hover over the window edges or corners to drag and resize the window in 8 directions.
- **滚轮刷新**：鼠标在聊天记录区域向上滚动（或到达顶部继续上滑），会触发双端网页的同步刷新（不清空聊天记录）。 / **Scroll to Refresh**: Scroll up to the top of the message area to trigger a synchronized page refresh (without clearing chat).
- **悬停与快捷键**：窗口吸附在边缘时会变成细条，鼠标悬停会提示 `Alt + w 召出`，按 `Alt + W` 即可在任何状态下立刻召回窗口。 / **Hover & Shortcut**: When snapped to the edge, hover to see `Alt + w` tooltip. Press `Alt + W` globally to summon the window.

###  移动端专属操作 (Via)

- **长按菜单**：长按聊天区空白处呼出菜单。 / **Long-press Menu**: Long-press the blank area to open the menu.
- **下拉刷新**：列表滑到顶部后继续下拉即可刷新。 / **Pull-to-Refresh**: Pull down at the top of the list.
- **点击吸附条**：窗口贴边变细条后，点击细条即可召回窗口。 / **Tap to Summon**: Tap the slim edge bar to restore the window.

---

##  配置项 / Configuration

位于脚本顶部 / At the top of the script:

```javascript
const MAX_ROUNDS = 1;   // 每条用户消息触发多少次 豆包↔DeepSeek 的往返对话 / Round-trips per user message
const MAX_CHARS  = 100; // 附加给 AI 的软性字数限制提示（0 = 不限制） / Soft character limit hint (0 = no limit)
