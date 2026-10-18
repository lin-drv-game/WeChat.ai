# WeChat.ai

A WeChat-style floating chat window that bridges **Doubao** and **DeepSeek** web clients into one shared conversation, implemented as a pure front-end userscript for Via Browser on mobile.

No API keys. No official SDK. No server. Just DOM automation: the script types into each AI's web input box, clicks send, reads the reply from the page, and forwards it to the other side.

---

## Features

- **Group-chat UI** — WeChat-inspired bubbles, avatars, left/right layout
- **Doubao + DeepSeek in one loop** — user message → Doubao → Doubao reply → DeepSeek → DeepSeek reply → back to Doubao
- **Round & length control** — configurable `maxRounds` and `maxChars` to stop runaway AI-to-AI chatter
- **Image support** — Doubao-generated images are extracted and rendered; user can upload images via the `+` button
- **Fully movable window** — drag by title bar, resize from bottom-right corner, maximize, minimize, snap to screen edge as a slim translucent bar
- **Custom backgrounds** — long-press the blank message area to change or reset the chat background
- **Custom avatars** — tap any avatar to upload your own (auto-cropped to 64×64 JPEG, stored in GM storage)
- **Pull-to-refresh** — scroll to top and pull down to reload the page
- **Persistent history** — messages are stored via `GM_setValue`, survive page reload and browser restart

---

## Platform

Designed and tested for **Via Browser on Android**. The script is a standard userscript and should also work in Tampermonkey / Violentmonkey on desktop, but the UI is optimized for mobile touch input.

> Via does **not** support `.crx` extensions. This project is distributed as a `.user.js` file loaded through Via's built-in script manager.

---

## Installation

### Option 1 — Import the file directly

1. Rename `WeChat.ai.txt` to `wechat-ai.user.js`.
2. Open Via → `≡` menu → **Settings** → **Scripts** → `+` → **Import script**.
3. Select the `.user.js` file. Make sure the `@match` rules include:
   - `https://www.doubao.com/*`
   - `https://chat.deepseek.com/*`
4. Save and enable.

### Option 2 — Install from URL

1. Upload `wechat-ai.user.js` to a GitHub repo (Public).
2. Open the file on GitHub and click **Raw**, copy the full URL.
3. In Via, go to `viabrowser://settings/extensions` → `+` → **Install from URL**.
4. Paste the Raw link and confirm.

---

## Usage

1. Open **Doubao** (`https://www.doubao.com`) and log in.
2. Open **DeepSeek** (`https://chat.deepseek.com`) in another tab and log in.
3. **Keep both tabs open** — each page handles its own half of the loop.
4. A floating WeChat-style window appears at the bottom-right of either page.
5. Type a message and hit **Send**. The flow runs automatically.
6. To stop early, just send a new message — it resets the session.

---

## Configuration

At the top of the script:

```javascript
const DEFAULT_MAX_ROUNDS = 1;   // how many Doubao↔DeepSeek round-trips per user message
const DEFAULT_MAX_CHARS  = 100; // soft character limit hint appended to each AI prompt (0 = no limit)
