# WeChat.ai

**把豆包和 DeepSeek 拉进同一个“微信群聊”，让两个 AI 自己聊起来。**

[![Via Browser](https://img.shields.io/badge/Via-Android-3DDC84?style=for-the-badge&logo=android&logoColor=white)](https://viayoo.com/)
[![Userscript](https://img.shields.io/badge/Userscript-.user.js-yellow?style=for-the-badge)](https://github.com/lin-drv-game/WeChat.ai/blob/main/wechat-ai.user.js)
[![License](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)](./LICENSE)
[![No Server](https://img.shields.io/badge/Server-None-brightgreen?style=for-the-badge)]()
[![No API Key](https://img.shields.io/badge/API%20Key-Not%20Required-lightgrey?style=for-the-badge)]()

[快速开始](#quick-start) · [功能](#features) · [配置](#configuration) · [贡献](#contributing)

> 一个纯前端用户脚本：不调 API、不依赖官方 SDK、不需要服务器。它做的只是在豆包和 DeepSeek 的网页输入框里“打字 → 点发送 → 读回复 → 转发给另一边”。

---

> **注意：Via 浏览器不支持 `.crx` 扩展。** 本项目以 `.user.js` 文件分发，必须通过 Via 内置的脚本管理器导入，不能当作 Chrome 扩展安装。

> **说明：** 本项目主要面向 Android 上的 **Via 浏览器**，但以标准用户脚本形式编写，**理论上也可在桌面端 Tampermonkey / Violentmonkey 中运行**。桌面端界面未针对鼠标/键盘和触摸操作做专门适配，体验可能不如 Via。

---

## Quick Start

### 前置条件

- Android 设备，安装 [Via 浏览器](https://viayoo.com/)
- 已登录 [豆包](https://www.doubao.com) 和 [DeepSeek](https://chat.deepseek.com) 账号
- **两个标签页同时保持打开**（每一边各自负责自己的半轮循环）

### 方式一：本地导入（推荐）

1. 下载 `wechat-ai.user.js`。
2. 打开 Via → `≡` → **设置** → **脚本** → `+` → **导入脚本**
3. 选择 `.user.js` 文件，确认 `@match` 包含：
   - `https://www.doubao.com/*`
   - `https://chat.deepseek.com/*`
4. 保存并启用

### 方式二：从 URL 安装

1. 将 `wechat-ai.user.js` 上传到任意 Public 仓库
2. 在 GitHub 上打开该文件，点击 **Raw**，复制完整 URL
3. Via 中访问 `viabrowser://settings/extensions` → `+` → **从 URL 安装**
4. 粘贴 Raw 链接并确认

### 跑通

打开豆包和 DeepSeek 两个标签页，右下角会出现浮动聊天窗口。输入一条消息并发送，两个 AI 就会按设定的轮次和长度自动交替对话。

---

## Features

| Feature | 说明 |
|---|---|
| **微信群聊 UI** | 左右气泡、头像、可拖拽、可缩放，还原微信聊天体验 |
| **双 AI 自动循环** | 用户消息 → 豆包 → 豆包回复转发 DeepSeek → DeepSeek 回复转发回豆包 |
| **轮次与长度控制** | `maxRounds` 控制往返轮数，`maxChars` 限制每条回复的软性长度，防止 AI 互相“刷屏” |
| **图片互通** | 提取豆包生成的图片并渲染；用户也可通过 `+` 按钮上传图片 |
| **完全可移动窗口** | 拖标题栏移动，右下角缩放，支持最大化 / 最小化 / 吸附为半透明侧边条 |
| **自定义背景与头像** | 长按空白区更换聊天背景；点击头像上传自定义头像（自动裁剪为 64×64 JPEG） |
| **下拉刷新** | 消息区滚动到顶部后下拉，重新加载页面 |
| **持久化历史** | 消息通过 `GM_setValue` 存储，刷新或重启浏览器后不丢失 |

---

## Configuration

配置位于脚本顶部：

```javascript
const DEFAULT_MAX_ROUNDS = 1;   // 每条用户消息触发的豆包 ↔ DeepSeek 往返轮数
const DEFAULT_MAX_CHARS  = 100; // 追加到每条 AI prompt 的软性字数提示（0 = 不限）
```




## 许可证

本项目采用 **MIT 许可证**。具有法律效力的英文原文请参阅 [LICENSE](./LICENSE)。

以下译文仅供参考：

- [简体中文](./LICENSE.zh-CN.md)
- [日本語](./LICENSE.ja.md)
- [한국어](./LICENSE.ko.md)

如各语言版本之间存在歧义，**以英文版本为准**。

版权所有 (c) 2026 shen136