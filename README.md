# 爱聊(WeChat.ai)

一款仿微信风格的悬浮聊天窗口，将**豆包**和**DeepSeek**两个网页客户端桥接进同一个共享对话，以纯前端用户脚本的形式实现，专为手机端 Via 浏览器打造。

无需 API Key，无需官方 SDK，无需服务器。完全依靠 DOM 自动化：脚本把内容输入到各 AI 的网页输入框、点击发送、读取页面上的回复，再转发给另一方。

---

功能特性

· 群聊式界面 —— 仿微信气泡、头像、左右分栏布局
· 豆包 + DeepSeek 闭环联动 —— 用户消息 → 豆包 → 豆包回复 → DeepSeek → DeepSeek 回复 → 再回到豆包
· 轮次与长度控制 —— 可配置 maxRounds 和 maxChars，防止 AI 之间无休止地互聊
· 图片支持 —— 可提取并渲染豆包生成的图片；用户也可通过 + 按钮上传图片
· 窗口完全可移动 —— 拖拽标题栏移动、右下角调整大小、最大化、最小化、吸附到屏幕边缘变成半透明细条
· 自定义背景 —— 长按消息区空白处可更换或重置聊天背景
· 自定义头像 —— 点击任意头像即可上传自己的头像（自动裁剪为 64×64 JPEG，存入 GM 存储）
· 下拉刷新 —— 滚动到顶部后下拉即可重新加载页面
· 历史记录持久化 —— 消息通过 GM_setValue 存储，页面刷新或浏览器重启后依然保留

---

平台说明

专为 Android 上的 Via 浏览器 设计并测试。该脚本是标准用户脚本，理论上也可在桌面端的 Tampermonkey / Violentmonkey 中运行，但界面针对移动端触摸操作做了优化。

Via 不支持 .crx 扩展。本项目以 .user.js 文件形式分发，通过 Via 内置的脚本管理器加载。

---

安装方法

方式一 —— 直接导入文件

1. 将 WeChat.ai.txt 重命名为 wechat-ai.user.js。
2. 打开 Via → ≡ 菜单 → 设置 → 脚本 → + → 导入脚本。
3. 选择该 .user.js 文件。请确保 @match 规则包含：
   · https://www.doubao.com/*
   · https://chat.deepseek.com/*
4. 保存并启用。

方式二 —— 通过 URL 安装

1. 将 wechat-ai.user.js 上传到 GitHub 仓库（Public）。
2. 在 GitHub 上打开该文件，点击 Raw，复制完整链接。
3. 在 Via 中访问 viabrowser://settings/extensions → + → 从 URL 安装。
4. 粘贴 Raw 链接并确认。

---

使用说明

1. 打开 豆包（https://www.doubao.com）并登录。
2. 在另一个标签页打开 DeepSeek（https://chat.deepseek.com）并登录。
3. 保持两个标签页都开着 —— 每个页面各自负责闭环中的一半流程。
4. 任意一个页面的右下角会浮出仿微信风格的窗口。
5. 输入消息并点击 发送，流程会自动运行。
6. 如需提前停止，直接发送一条新消息即可重置会话。

---

配置项

位于脚本顶部：

```javascript
const DEFAULT_MAX_ROUNDS = 1;   // 每条用户消息触发的豆包↔DeepSeek 往返次数
const DEFAULT_MAX_CHARS  = 100; // 附加给每个 AI 提示词的软性字符数限制提示（0 = 不限制）
```
