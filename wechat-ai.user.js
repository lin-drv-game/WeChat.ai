// ==UserScript==
// @name         wechat.ai
// @namespace    wechat.ai
// @version      1.1.1
// @description  WeChat-style group chat bridging Doubao & DeepSeek web clients
// @match        https://www.doubao.com/*
// @match        https://chat.deepseek.com/*
// @require      https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js
// @resource     hljs_css https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_getResourceText
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    /* =====================================================================
     * 1. 配置与常量
     * ===================================================================== */

    /** 全局可调参数。 */
    const CONFIG = Object.freeze({
        MAX_ROUNDS: 1,
        MAX_CHARS: 100,
        ANIM_MS: 220,
        MIN_SNAP_PX: 40,
        /** 同一 AI 流式更新同一气泡的时间窗（毫秒）。 */
        STREAM_UPDATE_WINDOW_MS: 13500,
        /** 系统消息去重时间窗（毫秒）。 */
        SYSTEM_DEDUP_WINDOW_MS: 5000,
        /** 回复文本连续稳定多少个 tick 后视为完成。 */
        REPLY_STABLE_TICKS: 3,
        /** 轮询间隔（毫秒）。 */
        POLL_INTERVAL_MS: 1000,
        /** 已处理回复指纹缓存上限。 */
        SEEN_LIMIT: 200,
        IMG_ACCEPT: 'image/jpeg,image/png,image/webp,image/gif,image/bmp,image/heic,image/heif,image/*',
    });

    /** GM 存储键名集合。 */
    const KEYS = Object.freeze({
        TASK: 'wechat_ai_task_deepseek',
        REPLY: 'wechat_ai_reply_deepseek',
        MSGS: 'wechat_ai_messages',
        USER: 'wechat_ai_user_msg',
        BG: 'wechat_ai_bg',
        SESS: 'wechat_ai_session',
        THINKING: 'wechat_ai_thinking',
        /** @param {string} who 角色名 @returns {string} 头像存储键 */
        AVATAR: who => 'wechat_ai_avatar_' + who,
    });

    /** 当前站点信息。 */
    const SITE = (() => {
        const isDoubao = location.hostname.includes('doubao.com');
        return Object.freeze({
            isDoubao,
            myRole: isDoubao ? 'doubao' : 'deepseek',
            myLabel: isDoubao ? '豆包' : 'DeepSeek',
            otherLabel: isDoubao ? 'DeepSeek' : '豆包',
        });
    })();

    const DS_AVATAR_URL = 'https://avatars.githubusercontent.com/u/148330874?v=4';
    const DB_AVATAR_URL = 'https://lf-flow-web-cdn.doubao.com/obj/flow-doubao/doubao/chat/favicon-doubao.png';

    /** 三个角色的头像配置，img 优先，否则用底色 + 文字。 */
    const AVATARS = {
        user: { img: 'https://lh3.googleusercontent.com/a/default-user=s100', text: 'U', bg: '#07c160' },
        doubao: { img: DB_AVATAR_URL, text: '包', bg: '#f5a623' },
        deepseek: { img: DS_AVATAR_URL, text: '鲸', bg: '#4a6cf7' },
    };
    ['user', 'doubao', 'deepseek'].forEach(restoreAvatar);

    /* =====================================================================
     * 2. 通用工具
     * ===================================================================== */

    /**
     * 延时。
     * @param {number} ms 毫秒
     * @returns {Promise<void>}
     */
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

    /**
     * 查询单个元素。
     * @param {string} selector CSS 选择器
     * @param {ParentNode} [root=document] 查询根
     * @returns {Element|null}
     */
    const $ = (selector, root = document) => root.querySelector(selector);

    /**
     * 查询多个元素并转为数组。
     * @param {string} selector CSS 选择器
     * @param {ParentNode} [root=document] 查询根
     * @returns {Element[]}
     */
    const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

    /**
     * 将数值限制在区间内。
     * @param {number} value 原值
     * @param {number} min 下界
     * @param {number} max 上界
     * @returns {number}
     */
    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

    /**
     * 生成注入给 AI 的群聊提示词。
     * @param {string} role 当前 AI 角色显示名
     * @returns {string}
     */
    const GROUP_PROMPT = role =>
        `当前是一个多AI群聊，参与者有用户、豆包和DeepSeek。你现在是${role},请简短回复。\n\n`;

    /* =====================================================================
     * 3. 存储层
     * ===================================================================== */

    /**
     * GM 存储封装：带 raw 字符串缓存，避免重复 JSON.parse。
     */
    const Store = (() => {
        /** @type {Map<string, {raw: string, value: any}>} */
        const cache = new Map();

        /**
         * 读取并反序列化 JSON。
         * @param {string} key 存储键
         * @param {*} fallback 解析失败或空值时的回退值
         * @returns {*}
         */
        function readJSON(key, fallback) {
            const raw = GM_getValue(key);
            if (raw === undefined || raw === null || raw === '') return fallback;
            const cached = cache.get(key);
            if (cached && cached.raw === raw) return cached.value;
            try {
                const value = JSON.parse(raw);
                cache.set(key, { raw, value });
                return value;
            } catch (e) {
                return fallback;
            }
        }

        /**
         * 序列化并写入 JSON，内容未变化时跳过写入。
         * @param {string} key 存储键
         * @param {*} value 待写入值
         * @returns {void}
         */
        function writeJSON(key, value) {
            const raw = JSON.stringify(value);
            const cached = cache.get(key);
            if (cached && cached.raw === raw) return;
            cache.set(key, { raw, value });
            GM_setValue(key, raw);
        }

        /**
         * 清空指定键。
         * @param {string} key 存储键
         * @returns {void}
         */
        function clear(key) {
            cache.delete(key);
            GM_setValue(key, '');
        }

        return { readJSON, writeJSON, clear };
    })();

    /* =====================================================================
     * 4. 消息 / 会话 / 思考状态
     * ===================================================================== */

    /**
     * 聊天消息存取，负责流式更新覆盖与系统消息去重。
     */
    const Messages = {
        /**
         * 获取全部消息。
         * @returns {Array<Object>}
         */
        list() {
            return Store.readJSON(KEYS.MSGS, []);
        },

        /**
         * 追加或更新一条消息。
         * @param {'user'|'system'|'doubao'|'deepseek'} who 发送者
         * @param {string} [text=''] 文本内容
         * @param {string[]} [images=[]] 图片地址列表
         * @param {{thinkingMs?: number}} [extra] 附加字段
         * @returns {void}
         */
        push(who, text, images, extra) {
            const msgs = this.list();
            const now = Date.now();

            // 同一 AI 的流式更新：时间窗内覆盖最后一个气泡而非新增
            if (who !== 'user' && who !== 'system' && msgs.length > 0) {
                const last = msgs[msgs.length - 1];
                if (last.who === who && now - last.ts < CONFIG.STREAM_UPDATE_WINDOW_MS) {
                    last.text = text || '';
                    last.images = images || [];
                    last.ts = now + Math.random();
                    if (extra && extra.thinkingMs !== undefined) last.thinkingMs = extra.thinkingMs;
                    else delete last.thinkingMs;
                    Store.writeJSON(KEYS.MSGS, msgs);
                    return;
                }
            }

            // 系统消息短时间去重
            if (who === 'system' && msgs.length > 0) {
                const last = msgs[msgs.length - 1];
                if (last.who === 'system'
                    && last.text === text
                    && now - last.ts < CONFIG.SYSTEM_DEDUP_WINDOW_MS) {
                    return;
                }
            }

            msgs.push(Object.assign(
                { who, text: text || '', images: images || [], ts: now + Math.random() },
                extra || {}
            ));
            Store.writeJSON(KEYS.MSGS, msgs);
        },

        /**
         * 清空全部消息。
         * @returns {void}
         */
        clear() {
            Store.clear(KEYS.MSGS);
        },
    };

    /**
     * 会话轮次状态。
     */
    const Session = {
        /**
         * 读取会话，缺失字段用默认值补齐。
         * @returns {{round: number, maxRounds: number, maxChars: number, active: boolean}}
         */
        get() {
            const raw = Store.readJSON(KEYS.SESS, null) || {};
            return Object.assign(
                { round: 0, maxRounds: CONFIG.MAX_ROUNDS, maxChars: CONFIG.MAX_CHARS, active: false },
                raw
            );
        },

        /**
         * 写入会话。
         * @param {Object} session 会话对象
         * @returns {void}
         */
        set(session) {
            Store.writeJSON(KEYS.SESS, session);
        },

        /**
         * 重置为初始会话并标记为进行中。
         * @returns {void}
         */
        reset() {
            this.set({
                round: 0,
                maxRounds: CONFIG.MAX_ROUNDS,
                maxChars: CONFIG.MAX_CHARS,
                active: true,
            });
        },
    };

    /**
     * DeepSeek「深度思考」计时状态。
     */
    const Thinking = {
        /**
         * 读取思考状态。
         * @returns {{active: boolean, startTime: number, duration: number}}
         */
        get() {
            const raw = Store.readJSON(KEYS.THINKING, null) || {};
            return Object.assign({ active: false, startTime: 0, duration: 0 }, raw);
        },

        /**
         * 写入思考状态。
         * @param {{active: boolean, startTime?: number, duration?: number}} state 状态对象
         * @returns {void}
         */
        set(state) {
            Store.writeJSON(KEYS.THINKING, state);
        },
    };

    /* =====================================================================
     * 5. 图片与文件工具
     * ===================================================================== */

    /**
     * 读取图片文件并按需缩放/裁剪，输出 JPEG DataURL。
     * @param {File} file 图片文件
     * @param {number} maxSide 最长边像素
     * @param {number} [quality=0.75] JPEG 质量 0~1
     * @param {boolean} [square=false] 是否居中裁剪为正方形
     * @returns {Promise<string>} DataURL
     */
    function resizeImage(file, maxSide, quality, square) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = reject;
            reader.onload = () => {
                const img = new Image();
                img.onerror = reject;
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    if (square) {
                        const min = Math.min(img.width, img.height);
                        canvas.width = canvas.height = maxSide;
                        ctx.drawImage(
                            img,
                            (img.width - min) / 2, (img.height - min) / 2, min, min,
                            0, 0, maxSide, maxSide
                        );
                    } else {
                        const scale = Math.min(maxSide / img.width, maxSide / img.height, 1);
                        canvas.width = Math.round(img.width * scale);
                        canvas.height = Math.round(img.height * scale);
                        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                    }
                    resolve(canvas.toDataURL('image/jpeg', quality || 0.75));
                };
                img.src = reader.result;
            };
            reader.readAsDataURL(file);
        });
    }

    /**
     * 创建隐藏的 file input 并选择文件。
     * @param {string} accept accept 属性
     * @param {(file: File) => Promise<void>|void} callback 选中文件后的回调
     * @returns {void}
     */
    function pickFile(accept, callback) {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = accept;
        input.style.display = 'none';
        document.body.appendChild(input);

        input.onchange = async () => {
            const file = input.files && input.files[0];
            if (file) {
                try {
                    await callback(file);
                } catch (e) {
                    /* 忽略单个文件处理异常 */
                }
            }
            input.remove();
        };
        input.click();
    }

    /* =====================================================================
     * 6. AI 适配层
     * ===================================================================== */

    /**
     * 判断元素是否可点击。
     * @param {Element|null} el 目标元素
     * @returns {boolean}
     */
    const isEnabled = el =>
        !!el
        && !el.disabled
        && el.getAttribute('aria-disabled') !== 'true'
        && el.offsetParent !== null;

    /**
     * 以原生 setter 写入 textarea 并触发 input 事件。
     * @param {HTMLTextAreaElement} el 目标输入框
     * @param {string} text 文本
     * @returns {Promise<void>}
     */
    async function setTextarea(el, text) {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
        setter.call(el, '');
        el.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(60);
        setter.call(el, text);
        el.dispatchEvent(new Event('input', { bubbles: true }));
    }

    /**
     * 向元素派发 Enter 按键事件。
     * @param {Element} el 目标元素
     * @returns {void}
     */
    function pressEnter(el) {
        ['keydown', 'keyup'].forEach(type => {
            el.dispatchEvent(new KeyboardEvent(type, {
                key: 'Enter',
                code: 'Enter',
                keyCode: 13,
                bubbles: true,
                cancelable: true,
            }));
        });
    }

    /**
     * 定位发送按钮：aria-label → 图标 → 文本 → 编辑器父级。
     * @param {Element|null} editorEl 输入框元素
     * @returns {Element|null}
     */
    function findSendBtn(editorEl) {
        const labeled = $$('[aria-label]');

        for (const btn of labeled) {
            const label = (btn.getAttribute('aria-label') || '').trim();
            if ((label === '发送' || label.toLowerCase() === 'send') && isEnabled(btn)) return btn;
        }
        for (const btn of labeled) {
            const label = (btn.getAttribute('aria-label') || '').trim();
            if (/^(发送|send)/i.test(label) && isEnabled(btn)) return btn;
        }

        if (editorEl) {
            let parent = editorEl.parentElement;
            for (let i = 0; i < 8 && parent; i++) {
                const btns = $$('button, div[role="button"], div[class*="send"]', parent).filter(isEnabled);
                if (btns.length) return btns[btns.length - 1];
                parent = parent.parentElement;
            }
        }

        for (const icon of $$('svg')) {
            if (icon.innerHTML.includes('send')
                || icon.innerHTML.includes('发送')
                || icon.classList.contains('send')) {
                const btn = icon.closest('button, div[role="button"]');
                if (btn && isEnabled(btn)) return btn;
            }
        }

        return $$('button, div[role="button"]')
            .find(btn => (btn.innerText || '').trim() === '发送' && isEnabled(btn)) || null;
    }

    /**
     * 等待发送按钮可用并点击，超时则回退为 Enter。
     * @param {Element|null} editorEl 输入框元素
     * @param {number} [timeout=5000] 超时毫秒
     * @returns {Promise<boolean>} 是否完成发送动作
     */
    async function waitAndClickSend(editorEl, timeout = 5000) {
        if (editorEl && editorEl.focus) {
            try {
                editorEl.focus();
            } catch (e) {
                /* 部分页面 focus 可能抛错 */
            }
            await sleep(300);
        }
        const start = Date.now();
        while (Date.now() - start < timeout) {
            const btn = findSendBtn(editorEl);
            if (btn) {
                btn.click();
                return true;
            }
            await sleep(200);
        }
        if (editorEl) {
            pressEnter(editorEl);
            return true;
        }
        return false;
    }

    /**
     * 从容器中提取有效图片地址（过滤头像/图标，按重叠区域去重）。
     * @param {Element|null} container 容器
     * @returns {string[]}
     */
    function extractImages(container) {
        if (!container) return [];

        /** @type {Array<{src: string, area: number, left: number, top: number, right: number, bottom: number}>} */
        const candidates = [];

        for (const img of container.querySelectorAll('img')) {
            if (!img.complete || img.naturalWidth < 80 || img.naturalHeight < 80) continue;
            const src = img.closest('a')?.href
                || img.getAttribute('data-src')
                || img.getAttribute('data-original')
                || img.currentSrc
                || img.src
                || '';
            if (!src || src.startsWith('blob:')) continue;
            if (src.startsWith('data:') && src.length < 500) continue;
            if (/avatar|icon|emoji|logo|badge|gift|skeleton|placeholder|loading|spinner/i.test(src)) continue;
            if (/avatar|icon|emoji|logo|badge/i.test(img.className || '')) continue;
            const rect = img.getBoundingClientRect();
            if (rect.width < 30 || rect.height < 30) continue;
            candidates.push({
                src,
                area: img.naturalWidth * img.naturalHeight,
                left: rect.left,
                top: rect.top,
                right: rect.right,
                bottom: rect.bottom,
            });
        }

        /** @type {Array<{src: string, area: number, left: number, top: number, right: number, bottom: number}>} */
        const groups = [];
        for (const candidate of candidates) {
            let placed = false;
            for (const group of groups) {
                const overlapX = Math.max(0, Math.min(candidate.right, group.right) - Math.max(candidate.left, group.left));
                const overlapY = Math.max(0, Math.min(candidate.bottom, group.bottom) - Math.max(candidate.top, group.top));
                const minArea = Math.min(
                    (candidate.right - candidate.left) * (candidate.bottom - candidate.top),
                    (group.right - group.left) * (group.bottom - group.top)
                );
                if (minArea > 0 && overlapX * overlapY / minArea > 0.5) {
                    if (candidate.area > group.area) {
                        group.src = candidate.src;
                        group.area = candidate.area;
                    }
                    placed = true;
                    break;
                }
            }
            if (!placed) groups.push(Object.assign({}, candidate));
        }

        return groups.map(group => group.src);
    }

    /**
     * 读取最新一条回复文本，并把 `<pre>` 转为 Markdown 代码块。
     * @param {string[]} selectors 候选选择器，按优先级排列
     * @returns {string}
     */
    function readLatest(selectors) {
        for (const selector of selectors) {
            const els = document.querySelectorAll(selector);
            if (!els.length) continue;

            const el = els[els.length - 1];
            const clone = el.cloneNode(true);
            clone
                .querySelectorAll('button, svg, [class*="copy"], [class*="download"], [class*="banner"], [class*="header"]')
                .forEach(node => node.remove());

            clone.querySelectorAll('pre').forEach(pre => {
                const codeEl = pre.querySelector('code');
                const codeText = codeEl ? codeEl.innerText : pre.innerText;
                let lang = 'text';
                const parent = pre.parentElement;
                if (parent) {
                    const match = parent.innerText
                        .match(/^(python|javascript|java|cpp|c|go|rust|php|sql|html|css|bash|shell|json|typescript|ts|js)\b/i);
                    if (match) lang = match[1].toLowerCase();
                }
                const md = `\n\`\`\`${lang}\n${codeText}\n\`\`\`\n`;
                pre.parentNode.replaceChild(document.createTextNode(md), pre);
            });

            const text = (clone.innerText || '')
                .trim()
                .replace(/\n?复制\n?下载\n?/g, '\n')
                .replace(/\n?复制\n?/g, '\n')
                .replace(/\n?下载\n?/g, '\n')
                .replace(/\n{3,}/g, '\n\n');
            if (text) return text;
        }
        return '';
    }

    /**
     * 豆包页面适配器。
     */
    const Doubao = {
        /**
         * 找到可见的 contenteditable 编辑器。
         * @returns {Element|null}
         */
        findEditor() {
            for (const el of $$('div[contenteditable="true"], [role="textbox"]')) {
                const rect = el.getBoundingClientRect();
                if (rect.width > 100 && rect.height > 20 && rect.top > 0) return el;
            }
            return $('div[contenteditable="true"]');
        },

        /**
         * 向豆包输入框写入文本，依次尝试粘贴 / insertText / innerHTML。
         * @param {string} text 文本
         * @returns {Promise<boolean>} 是否写入成功
         */
        async type(text) {
            const editor = this.findEditor();
            if (editor) {
                editor.focus();

                const selection = window.getSelection();
                const range = document.createRange();
                range.selectNodeContents(editor);
                selection.removeAllRanges();
                selection.addRange(range);
                document.execCommand('delete', false, null);
                await sleep(150);

                const dataTransfer = new DataTransfer();
                dataTransfer.setData('text/plain', text);
                editor.dispatchEvent(new ClipboardEvent('paste', {
                    clipboardData: dataTransfer,
                    bubbles: true,
                    cancelable: true,
                }));
                await sleep(300);
                if ((editor.innerText || '').trim().length > 0) return true;

                document.execCommand('insertText', false, text);
                await sleep(300);
                if ((editor.innerText || '').trim().length > 0) return true;

                editor.innerHTML = `<p>${text}</p>`;
                editor.dispatchEvent(new InputEvent('input', {
                    inputType: 'insertText',
                    data: text,
                    bubbles: true,
                    cancelable: false,
                }));
                editor.dispatchEvent(new Event('change', { bubbles: true }));
                await sleep(300);
                return !!(editor.innerText || '').trim();
            }

            const textarea = $('textarea');
            if (textarea && textarea.offsetParent !== null) {
                await setTextarea(textarea, text);
                return true;
            }
            return false;
        },

        /**
         * 以粘贴事件向豆包输入图片。
         * @param {string} base64 图片 DataURL
         * @returns {Promise<boolean>} 是否成功派发
         */
        async pasteImage(base64) {
            try {
                const blob = await (await fetch(base64)).blob();
                const file = new File([blob], 'image_' + Date.now() + '.jpg', { type: 'image/jpeg' });
                const editor = $('div[contenteditable="true"]');
                if (!editor) return false;
                editor.focus();
                await sleep(200);
                const dataTransfer = new DataTransfer();
                dataTransfer.items.add(file);
                editor.dispatchEvent(new ClipboardEvent('paste', {
                    clipboardData: dataTransfer,
                    bubbles: true,
                    cancelable: true,
                }));
                return true;
            } catch (e) {
                return false;
            }
        },

        /**
         * 读取豆包最新回复文本。
         * @returns {string}
         */
        readLatest() {
            return readLatest([
                '[data-testid="message_text_content"]',
                '[class*="message-content"]',
                '[class*="markdown-body"]',
            ]);
        },

        /**
         * 读取豆包最新回复中的图片。
         * @returns {string[]}
         */
        extractImages() {
            const els = $$('[data-testid="message_text_content"]');
            if (els.length) {
                let container = els[els.length - 1];
                for (let i = 0; i < 6 && container; i++) {
                    const images = extractImages(container);
                    if (images.length) return images;
                    container = container.parentElement;
                }
            }
            const rows = $$('[class*="message-row"], [class*="chat-message"], [class*="message"]');
            return rows.length ? extractImages(rows[rows.length - 1]) : [];
        },

        /**
         * 获取豆包输入框。
         * @returns {Element|null}
         */
        getInputBox() {
            return $('div[contenteditable="true"]') || $('textarea');
        },
    };

    /**
     * DeepSeek 页面适配器。
     */
    const DeepSeek = {
        /**
         * 向 DeepSeek 输入框写入文本。
         * @param {string} text 文本
         * @returns {Promise<boolean>} 是否写入成功
         */
        async type(text) {
            const textarea = $('textarea#chat-input') || $('textarea');
            if (!textarea) return false;
            await setTextarea(textarea, text);
            return true;
        },

        /**
         * 读取 DeepSeek 最新回复文本。
         * @returns {string}
         */
        readLatest() {
            return readLatest(['div[class*="ds-markdown"]', 'div[class*="markdown"]']);
        },

        /**
         * 读取 DeepSeek 最新回复中的图片。
         * @returns {string[]}
         */
        extractImages() {
            const els = $$('div[class*="ds-markdown"]');
            return els.length ? extractImages(els[els.length - 1]) : [];
        },

        /**
         * 获取 DeepSeek 输入框。
         * @returns {Element|null}
         */
        getInputBox() {
            return $('textarea#chat-input') || $('textarea');
        },
    };

    /** 当前站点对应的适配器。 */
    const AI = SITE.isDoubao ? Doubao : DeepSeek;

    /**
     * 读取当前页面最新回复（文本 + 图片），并忽略回显的群聊提示词。
     * @returns {{text: string, images: string[]}}
     */
    function getReplyData() {
        const text = AI.readLatest();
        if (text && (text.includes('系统提示：当前是一个多AI群聊') || text.includes('User：'))) {
            return { text: '', images: [] };
        }
        return { text, images: AI.extractImages() };
    }

    /* =====================================================================
     * 7. 渲染层
     * ===================================================================== */

    /**
     * 将含 Markdown 代码块的文本渲染为 DOM（代码块带复制按钮与高亮）。
     * @param {HTMLElement} container 渲染容器
     * @param {string} text 原始文本
     * @returns {void}
     */
    function renderMarkdownContent(container, text) {
        const codeBlockRegex = /```(\w*)\n([\s\S]*?)(?:```|$)/g;
        let lastIndex = 0;
        let match;
        let hasCode = false;

        while ((match = codeBlockRegex.exec(text)) !== null) {
            hasCode = true;

            const textBefore = text.slice(lastIndex, match.index);
            if (textBefore.trim()) {
                const paragraph = document.createElement('div');
                paragraph.style.whiteSpace = 'pre-wrap';
                paragraph.textContent = textBefore;
                container.appendChild(paragraph);
            }

            const lang = match[1] || 'text';
            const code = match[2].replace(/\n$/, '');

            const block = document.createElement('div');
            block.className = 'wechat-ai-code-block';

            const header = document.createElement('div');
            header.className = 'wechat-ai-code-header';

            const langSpan = document.createElement('span');
            langSpan.className = 'wechat-ai-code-lang';
            langSpan.textContent = lang;

            const copyBtn = document.createElement('button');
            copyBtn.className = 'wechat-ai-code-copy';
            copyBtn.textContent = '复制';
            copyBtn.addEventListener('click', () => copyCode(code, copyBtn));

            header.appendChild(langSpan);
            header.appendChild(copyBtn);

            const pre = document.createElement('pre');
            const codeEl = document.createElement('code');
            codeEl.className = `language-${lang}`;
            codeEl.textContent = code;
            pre.appendChild(codeEl);

            block.appendChild(header);
            block.appendChild(pre);
            container.appendChild(block);

            if (window.hljs) {
                try {
                    window.hljs.highlightElement(codeEl);
                } catch (e) {
                    /* 高亮失败不影响展示 */
                }
            }

            lastIndex = match.index + match[0].length;
        }

        const textAfter = text.slice(lastIndex);
        if (textAfter.trim() || !hasCode) {
            const paragraph = document.createElement('div');
            paragraph.style.whiteSpace = 'pre-wrap';
            paragraph.textContent = textAfter || text;
            container.appendChild(paragraph);
        }
    }

    /**
     * 复制代码并给出按钮反馈。
     * @param {string} code 代码文本
     * @param {HTMLButtonElement} button 触发按钮
     * @returns {void}
     */
    function copyCode(code, button) {
        const done = () => {
            button.textContent = '已复制';
            setTimeout(() => { button.textContent = '复制'; }, 2000);
        };
        if (navigator.clipboard) {
            navigator.clipboard.writeText(code).then(done).catch(done);
            return;
        }
        const textarea = document.createElement('textarea');
        textarea.value = code;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
        done();
    }

    /**
     * 获取消息容器。
     * @returns {HTMLElement|null}
     */
    const messagesEl = () => document.getElementById('wechat-ai-messages');

    /**
     * 渲染单条消息。
     * @param {{who: string, text: string, images?: string[], thinkingMs?: number}} message 消息对象
     * @returns {void}
     */
    function renderMessage(message) {
        const container = messagesEl();
        if (!container) return;

        const { who, text, images, thinkingMs } = message;

        if (who === 'system') {
            const systemEl = document.createElement('div');
            systemEl.className = 'wechat-ai-system';
            systemEl.textContent = text;
            container.appendChild(systemEl);
            container.scrollTop = container.scrollHeight;
            return;
        }

        const avatarConfig = AVATARS[who] || AVATARS.doubao;
        const row = document.createElement('div');
        row.className = 'wechat-ai-row wechat-ai-' + who + (who === 'user' ? ' wechat-ai-right' : '');

        const avatarEl = document.createElement('div');
        avatarEl.className = 'wechat-ai-avatar';
        if (avatarConfig.img) avatarEl.style.backgroundImage = `url("${avatarConfig.img}")`;
        else {
            avatarEl.style.backgroundColor = avatarConfig.bg;
            avatarEl.textContent = avatarConfig.text;
        }
        avatarEl.addEventListener('click', () => pickAvatar(who, avatarEl));

        const bubble = document.createElement('div');
        bubble.className = 'wechat-ai-bubble';

        if (who === 'deepseek' && thinkingMs > 0) {
            ThinkingIndicator.stop();
            Thinking.set({ active: false, duration: thinkingMs });
            ThinkingIndicator.lastKey = '';
            const info = document.createElement('div');
            info.className = 'wechat-ai-think-info';
            info.textContent = '已思考，用时 ' + Math.round(thinkingMs / 1000) + ' 秒';
            bubble.appendChild(info);
        }

        const cleanText = (text || '').replace(/\n{3,}/g, '\n\n').trim();
        const uniqueImages = [];
        if (images && images.length) {
            const seen = new Set();
            for (const src of images) {
                if (!seen.has(src)) {
                    seen.add(src);
                    uniqueImages.push(src);
                }
            }
        }

        const hasText = cleanText.length > 0;
        const hasImages = uniqueImages.length > 0;
        if (!hasText && hasImages && !(who === 'deepseek' && thinkingMs > 0)) {
            bubble.className += ' wechat-ai-image-only';
        }

        if (hasText) renderMarkdownContent(bubble, cleanText);

        if (hasImages) {
            for (const src of uniqueImages) {
                const img = document.createElement('img');
                img.className = 'wechat-ai-img' + (who === 'user' ? ' wechat-ai-img-small' : '');
                img.src = src;
                img.addEventListener('click', event => {
                    event.stopPropagation();
                    openImageFull(src);
                });
                img.onload = () => { container.scrollTop = container.scrollHeight; };
                img.onerror = () => img.remove();
                bubble.appendChild(img);
            }
        }

        row.appendChild(avatarEl);
        row.appendChild(bubble);
        container.appendChild(row);
        container.scrollTop = container.scrollHeight;
    }

    /**
     * 增量渲染器：按消息 ts 比对，支持最后一条被流式更新后重绘。
     */
    const View = {
        /** @type {number} 已渲染消息数量 */
        renderedCount: 0,
        /** @type {number[]} 已渲染消息的 ts 快照 */
        renderedTs: [],

        /**
         * 清空渲染状态与容器内消息节点（保留思考指示器）。
         * @returns {void}
         */
        reset() {
            const container = messagesEl();
            if (container) {
                Array.from(container.children).forEach(el => {
                    if (el.id !== 'wechat-ai-thinking') el.remove();
                });
            }
            this.renderedCount = 0;
            this.renderedTs.length = 0;
        },

        /**
         * 将存储中的消息同步到 UI。
         * @returns {void}
         */
        flush() {
            const container = messagesEl();
            if (!container) return;

            const msgs = Messages.list();
            if (msgs.length < this.renderedCount) this.reset();

            // 最后一条被流式更新：移除旧节点，交给下面重绘
            if (this.renderedCount === msgs.length && this.renderedCount > 0) {
                const last = msgs[this.renderedCount - 1];
                if (last.ts !== this.renderedTs[this.renderedCount - 1]) {
                    const nodes = Array.from(container.children).filter(el => el.id !== 'wechat-ai-thinking');
                    const lastNode = nodes[nodes.length - 1];
                    if (lastNode) lastNode.remove();
                    this.renderedCount--;
                    this.renderedTs.pop();
                }
            }

            for (let i = this.renderedCount; i < msgs.length; i++) {
                renderMessage(msgs[i]);
                this.renderedTs[i] = msgs[i].ts;
            }
            this.renderedCount = msgs.length;

            const thinkingEl = document.getElementById('wechat-ai-thinking');
            if (!thinkingEl) return;
            if (!Thinking.get().active) {
                if (thinkingEl.style.display !== 'none') ThinkingIndicator.stop();
            } else if (thinkingEl.parentNode === container && thinkingEl !== container.lastElementChild) {
                container.appendChild(thinkingEl);
                container.scrollTop = container.scrollHeight;
            }
        },
    };

    /* =====================================================================
     * 8. 思考指示器
     * ===================================================================== */

    /**
     * DeepSeek「深度思考中」动画指示器。
     */
    const ThinkingIndicator = {
        /** @type {number|null} */
        timer: null,
        /** @type {string} */
        lastKey: '',

        /**
         * 启动动画。
         * @returns {void}
         */
        start() {
            this.stop();
            const el = document.getElementById('wechat-ai-thinking');
            if (!el) return;
            el.style.display = 'flex';

            const textEl = el.querySelector('.wechat-ai-thinking-text');
            if (!textEl) return;

            const dots = ['.', '..', '...'];
            let index = 0;
            textEl.textContent = '深度思考中.';
            this.timer = setInterval(() => {
                index = (index + 1) % 3;
                textEl.textContent = '深度思考中' + dots[index];
            }, 450);
        },

        /**
         * 停止动画并隐藏。
         * @returns {void}
         */
        stop() {
            if (this.timer) {
                clearInterval(this.timer);
                this.timer = null;
            }
            const el = document.getElementById('wechat-ai-thinking');
            if (el) el.style.display = 'none';
        },

        /**
         * 根据存储状态同步动画显隐。
         * @returns {void}
         */
        check() {
            const state = Thinking.get();
            if (state.active) {
                const msgs = Messages.list();
                if (Date.now() - state.startTime > 60000 || msgs.length === 0) {
                    Thinking.set({ active: false, duration: 0 });
                    this.lastKey = '';
                    this.stop();
                    return;
                }
                const key = String(state.startTime);
                if (this.lastKey !== key) {
                    this.lastKey = key;
                    this.start();
                }
            } else if (this.lastKey) {
                this.lastKey = '';
                this.stop();
            }
        },
    };

    /**
     * 记录 DeepSeek 思考开始时间。
     * @returns {void}
     */
    function markThinkingStart() {
        if (SITE.isDoubao) return;
        Thinking.set({ active: true, startTime: Date.now(), duration: 0 });
        ThinkingIndicator.lastKey = '';
    }

    /* =====================================================================
     * 9. UI：窗口与手势
     * ===================================================================== */

    /** 当前窗口状态：normal | min | max | edge-l | edge-r。 */
    let state = 'normal';
    /** 正常态下的窗口矩形快照。 */
    let savedRect = null;

    /**
     * 读取元素当前矩形。
     * @param {HTMLElement} el 目标元素
     * @returns {{left: number, top: number, width: number, height: number}}
     */
    function readRect(el) {
        const rect = el.getBoundingClientRect();
        return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    }

    /**
     * 应用矩形到元素，可选过渡动画。
     * @param {HTMLElement} el 目标元素
     * @param {{left: number, top: number, width: number, height: number}} rect 矩形
     * @param {boolean} [animate=false] 是否带动画
     * @returns {void}
     */
    function applyRect(el, rect, animate) {
        if (!rect) return;
        if (animate) el.classList.add('wechat-ai-anim');
        Object.assign(el.style, {
            right: 'auto',
            bottom: 'auto',
            maxWidth: 'none',
            maxHeight: 'none',
            left: rect.left + 'px',
            top: rect.top + 'px',
            width: rect.width + 'px',
            height: rect.height + 'px',
        });
        if (animate) setTimeout(() => el.classList.remove('wechat-ai-anim'), CONFIG.ANIM_MS + 20);
    }

    /**
     * 切换内部组件显隐。
     * @param {boolean} visible 是否可见
     * @returns {void}
     */
    function setInnerVisible(visible) {
        ['wechat-ai-dragbar', 'wechat-ai-refresh-bar', 'wechat-ai-messages', 'wechat-ai-input-area', 'wechat-ai-resize']
            .forEach(id => {
                const el = document.getElementById(id);
                if (el) el.style.display = visible ? '' : 'none';
            });
    }

    /**
     * 同步窗口按钮图标。
     * @returns {void}
     */
    function updateBtns() {
        const minBtn = document.getElementById('wechat-ai-min');
        const maxBtn = document.getElementById('wechat-ai-max');
        if (!minBtn || !maxBtn) return;
        minBtn.textContent = (state === 'min' || state === 'edge-l' || state === 'edge-r') ? '▣' : '—';
        maxBtn.textContent = state === 'max' ? '❐' : '□';
    }

    /**
     * 设置窗口状态并刷新按钮。
     * @param {string} next 新状态
     * @returns {void}
     */
    function setState(next) {
        state = next;
        updateBtns();
    }

    /**
     * 计算拖拽时应吸附到哪一侧。
     * @param {number} left 当前左边距
     * @param {number} width 当前宽度
     * @returns {'left'|'right'|null}
     */
    function computeSnap(left, width) {
        if (state === 'min') {
            if (left < CONFIG.MIN_SNAP_PX) return 'left';
            if (left + width > window.innerWidth - CONFIG.MIN_SNAP_PX) return 'right';
        } else if (state === 'normal') {
            if (-left >= width / 3) return 'left';
            if (left + width - window.innerWidth >= width / 3) return 'right';
        }
        return null;
    }

    /**
     * 清除吸附提示样式。
     * @param {HTMLElement} el 窗口元素
     * @returns {void}
     */
    function clearSnapHints(el) {
        el.classList.remove('wechat-ai-snap-left', 'wechat-ai-snap-right');
    }

    /**
     * 吸附为侧边半透明细条。
     * @param {HTMLElement} el 窗口元素
     * @param {'left'|'right'} side 吸附方向
     * @returns {void}
     */
    function snapToEdge(el, side) {
        clearSnapHints(el);
        setState(side === 'left' ? 'edge-l' : 'edge-r');

        const viewportHeight = window.innerHeight;
        const height = Math.min(viewportHeight * 0.5, 320);
        const top = Math.max(20, (viewportHeight - height) / 2);

        el.classList.add('wechat-ai-anim');
        Object.assign(el.style, {
            width: '8px',
            top: top + 'px',
            height: height + 'px',
            borderRadius: side === 'left' ? '0 6px 6px 0' : '6px 0 0 6px',
            background: 'rgba(7,193,96,0.55)',
            border: 'none',
            boxShadow: '0 0 8px rgba(7,193,96,0.35)',
            maxWidth: 'none',
            maxHeight: 'none',
            cursor: 'pointer',
            touchAction: 'none',
        });
        if (side === 'left') {
            el.style.left = '0px';
            el.style.right = 'auto';
        } else {
            el.style.right = '0px';
            el.style.left = 'auto';
        }

        setInnerVisible(false);
        setTimeout(() => el.classList.remove('wechat-ai-anim'), CONFIG.ANIM_MS + 20);
    }

    /**
     * 从侧边细条恢复为正常窗口。
     * @param {HTMLElement} el 窗口元素
     * @param {boolean} animate 是否带动画
     * @returns {void}
     */
    function restoreFromEdge(el, animate) {
        setInnerVisible(true);
        clearSnapHints(el);
        Object.assign(el.style, {
            background: '#f5f5f5',
            border: '1px solid #ddd',
            boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
            borderRadius: '10px',
            cursor: '',
            touchAction: '',
        });
        setState('normal');
        el.classList.remove('wechat-ai-anim');
        applyRect(el, savedRect, animate);
    }

    /**
     * 最小化 / 还原窗口。
     * @param {HTMLElement} el 窗口元素
     * @returns {void}
     */
    function toggleMin(el) {
        clearSnapHints(el);
        if (state === 'edge-l' || state === 'edge-r') return restoreFromEdge(el, true);
        if (state === 'min') {
            applyRect(el, savedRect, true);
            setState('normal');
            return;
        }
        if (state === 'normal') savedRect = readRect(el);

        el.classList.add('wechat-ai-anim');
        Object.assign(el.style, {
            right: 'auto',
            bottom: 'auto',
            left: savedRect.left + 'px',
            top: savedRect.top + 'px',
            width: savedRect.width + 'px',
            height: '32px',
            maxWidth: 'none',
            maxHeight: 'none',
        });
        setState('min');
        setTimeout(() => el.classList.remove('wechat-ai-anim'), CONFIG.ANIM_MS + 20);
    }

    /**
     * 最大化 / 还原窗口。
     * @param {HTMLElement} el 窗口元素
     * @returns {void}
     */
    function toggleMax(el) {
        clearSnapHints(el);
        if (state === 'edge-l' || state === 'edge-r') restoreFromEdge(el, false);
        if (state === 'max') {
            applyRect(el, savedRect, true);
            setState('normal');
            return;
        }
        if (state === 'normal') savedRect = readRect(el);

        el.classList.add('wechat-ai-anim');
        Object.assign(el.style, {
            right: 'auto',
            bottom: 'auto',
            left: '4px',
            top: '4px',
            width: (window.innerWidth - 8) + 'px',
            height: (window.innerHeight - 8) + 'px',
            maxWidth: 'none',
            maxHeight: 'none',
        });
        setState('max');
        setTimeout(() => el.classList.remove('wechat-ai-anim'), CONFIG.ANIM_MS + 20);
    }

    /**
     * 绑定触摸 / 鼠标手势，统一为 start / move / end 回调。
     * @param {HTMLElement} handle 手势触发元素
     * @param {HTMLElement} panel 联动面板
     * @param {{
     *   start: (x: number, y: number) => boolean|void,
     *   move: (x: number, y: number) => void,
     *   end?: () => void
     * }} handlers 手势回调
     * @returns {void}
     */
    function bindGesture(handle, panel, handlers) {
        let active = false;
        let lastX = 0;
        let lastY = 0;
        let rafPending = false;

        const flushMove = () => {
            rafPending = false;
            if (active) handlers.move(lastX, lastY);
        };

        const onMove = (x, y) => {
            lastX = x;
            lastY = y;
            if (!rafPending && active) {
                rafPending = true;
                requestAnimationFrame(flushMove);
            }
        };

        const onDown = (x, y) => {
            if (handlers.start(x, y) === false) return;
            active = true;
            lastX = x;
            lastY = y;
            panel.classList.add('wechat-ai-gesture');
        };

        const onUp = () => {
            if (!active) return;
            if (rafPending) {
                cancelAnimationFrame(flushMove);
                flushMove();
            }
            active = false;
            panel.classList.remove('wechat-ai-gesture');
            clearSnapHints(panel);
            if (handlers.end) handlers.end();
        };

        handle.addEventListener('touchstart', e => onDown(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
        handle.addEventListener('touchmove', e => {
            if (!active) return;
            onMove(e.touches[0].clientX, e.touches[0].clientY);
            if (e.cancelable) e.preventDefault();
        }, { passive: false });
        handle.addEventListener('touchend', onUp);
        handle.addEventListener('touchcancel', onUp);

        handle.addEventListener('mousedown', e => onDown(e.clientX, e.clientY));
        document.addEventListener('mousemove', e => {
            if (active) onMove(e.clientX, e.clientY);
        });
        document.addEventListener('mouseup', onUp);
    }

    /**
     * 启用拖拽移动。
     * @param {HTMLElement} el 窗口元素
     * @param {HTMLElement} handle 标题栏
     * @returns {void}
     */
    function enableDrag(el, handle) {
        let startX = 0;
        let startY = 0;
        let startLeft = 0;
        let startTop = 0;
        let startWidth = 0;

        bindGesture(handle, el, {
            start(x, y) {
                clearSnapHints(el);
                if (state === 'edge-l' || state === 'edge-r') restoreFromEdge(el, false);
                if (state === 'max') setState('normal');

                const rect = readRect(el);
                startX = x;
                startY = y;
                startLeft = rect.left;
                startTop = rect.top;
                startWidth = rect.width;

                if (state === 'normal') {
                    savedRect = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
                } else if (state === 'min' && savedRect) {
                    savedRect.left = rect.left;
                    savedRect.top = rect.top;
                }

                el.classList.remove('wechat-ai-anim');
                Object.assign(el.style, {
                    right: 'auto',
                    bottom: 'auto',
                    left: startLeft + 'px',
                    top: startTop + 'px',
                });
            },

            move(x, y) {
                let nextLeft = startLeft + (x - startX);
                let nextTop = startTop + (y - startY);

                if (state === 'min') {
                    nextLeft = clamp(nextLeft, 0, window.innerWidth - Math.min(startWidth, 60));
                } else {
                    nextLeft = clamp(nextLeft, -startWidth, window.innerWidth);
                }
                nextTop = clamp(nextTop, 0, window.innerHeight - 32);

                el.style.left = nextLeft + 'px';
                el.style.top = nextTop + 'px';

                const hint = computeSnap(nextLeft, startWidth);
                el.classList.toggle('wechat-ai-snap-left', hint === 'left');
                el.classList.toggle('wechat-ai-snap-right', hint === 'right');
            },

            end() {
                const rect = readRect(el);
                const side = computeSnap(rect.left, rect.width);
                if (side) return snapToEdge(el, side);

                if (state === 'min') {
                    if (savedRect) {
                        savedRect.left = rect.left;
                        savedRect.top = rect.top;
                    }
                } else if (state === 'normal') {
                    const finalLeft = clamp(rect.left, 0, Math.max(0, window.innerWidth - rect.width));
                    if (finalLeft !== rect.left) el.style.left = finalLeft + 'px';
                    if (savedRect) {
                        savedRect.left = finalLeft;
                        savedRect.top = rect.top;
                    }
                }
            },
        });

        handle.addEventListener('dblclick', event => {
            event.preventDefault();
            toggleMax(el);
        });

        el.addEventListener('click', event => {
            if (state === 'edge-l' || state === 'edge-r') {
                event.preventDefault();
                event.stopPropagation();
                restoreFromEdge(el, true);
            }
        }, true);
    }

    /**
     * 启用右下角缩放。
     * @param {HTMLElement} el 窗口元素
     * @param {HTMLElement} handle 缩放手柄
     * @returns {void}
     */
    function enableResize(el, handle) {
        let startX = 0;
        let startY = 0;
        let startWidth = 0;
        let startHeight = 0;
        let startLeft = 0;
        let startTop = 0;

        bindGesture(handle, el, {
            start(x, y) {
                if (state === 'edge-l' || state === 'edge-r') return false;
                if (state === 'max') setState('normal');
                if (state === 'min') toggleMin(el);

                const rect = readRect(el);
                startX = x;
                startY = y;
                startWidth = rect.width;
                startHeight = rect.height;
                startLeft = rect.left;
                startTop = rect.top;
                savedRect = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };

                el.classList.remove('wechat-ai-anim');
                Object.assign(el.style, {
                    right: 'auto',
                    bottom: 'auto',
                    left: startLeft + 'px',
                    top: startTop + 'px',
                    width: startWidth + 'px',
                    height: startHeight + 'px',
                    maxWidth: 'none',
                    maxHeight: 'none',
                });
                handle.classList.add('wechat-ai-resizing');
            },

            move(x, y) {
                const MIN_WIDTH = 240;
                const MIN_HEIGHT = 120;
                const maxWidth = Math.max(MIN_WIDTH, window.innerWidth - startLeft - 8);
                const maxHeight = Math.max(MIN_HEIGHT, window.innerHeight - startTop - 8);

                const width = clamp(startWidth + (x - startX), MIN_WIDTH, maxWidth);
                const height = clamp(startHeight + (y - startY), MIN_HEIGHT, maxHeight);

                el.style.width = width + 'px';
                el.style.height = height + 'px';
                if (savedRect) {
                    savedRect.width = width;
                    savedRect.height = height;
                }
            },

            end() {
                handle.classList.remove('wechat-ai-resizing');
            },
        });
    }

    /**
     * 新窗口打开大图。
     * @param {string} src 图片地址
     * @returns {void}
     */
    function openImageFull(src) {
        const win = window.open('');
        if (!win) return;
        win.document.write(
            '<html><head><title>查看图片</title>'
            + '<meta name="viewport" content="width=device-width,initial-scale=1"></head>'
            + '<body style="margin:0;background:#000;display:flex;align-items:center;justify-content:center;min-height:100vh;">'
            + '<img src="' + src + '" style="max-width:100%;max-height:100vh;"></body></html>'
        );
        win.document.close();
    }

    /**
     * 从存储恢复自定义头像。
     * @param {string} who 角色名
     * @returns {void}
     */
    function restoreAvatar(who) {
        const saved = GM_getValue(KEYS.AVATAR(who));
        if (saved) AVATARS[who].img = saved;
    }

    /**
     * 选择并保存自定义头像。
     * @param {string} who 角色名
     * @param {HTMLElement} el 头像元素
     * @returns {void}
     */
    function pickAvatar(who, el) {
        pickFile(CONFIG.IMG_ACCEPT, async file => {
            const url = await resizeImage(file, 64, 0.82, true);
            AVATARS[who].img = url;
            GM_setValue(KEYS.AVATAR(who), url);
            el.style.backgroundImage = `url("${url}")`;
            el.textContent = '';
            if (who === 'deepseek') {
                const thinkAvatar = document.querySelector('#wechat-ai-thinking .wechat-ai-avatar');
                if (thinkAvatar) thinkAvatar.style.backgroundImage = `url("${url}")`;
            }
        });
    }

    /**
     * 选择并发送用户图片消息。
     * @returns {void}
     */
    function pickUserImage() {
        pickFile(CONFIG.IMG_ACCEPT, async file => {
            const url = await resizeImage(file, 480, 0.7);
            Session.reset();
            Thinking.set({ active: false, duration: 0 });
            ThinkingIndicator.lastKey = '';
            ThinkingIndicator.stop();

            Messages.push('user', '', [url]);
            View.flush();
            Store.writeJSON(KEYS.USER, {
                text: '[用户上传了一张图片]',
                image: url,
                ts: Date.now(),
                source: SITE.myRole,
            });
        });
    }

    /**
     * 选择并保存聊天背景。
     * @returns {void}
     */
    function pickBackground() {
        const container = messagesEl();
        if (!container) return;
        pickFile(CONFIG.IMG_ACCEPT, async file => {
            const url = await resizeImage(file, 1280, 0.75);
            GM_setValue(KEYS.BG, url);
            container.style.backgroundImage = `url("${url}")`;
        });
    }

    /**
     * 显示背景设置菜单。
     * @param {number} x 屏幕 X
     * @param {number} y 屏幕 Y
     * @returns {void}
     */
    function showBgMenu(x, y) {
        ['wechat-ai-bg-mask', 'wechat-ai-bg-menu'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.remove();
        });

        const mask = document.createElement('div');
        mask.id = 'wechat-ai-bg-mask';
        document.body.appendChild(mask);

        const menu = document.createElement('div');
        menu.id = 'wechat-ai-bg-menu';
        menu.innerHTML =
            '<button data-action="change">更换背景</button>'
            + '<button data-action="clear">恢复背景</button>'
            + '<button data-action="clear-chat" style="color:#e53935 !important;">清空对话</button>'
            + '<button data-action="cancel">取消操作</button>';
        menu.style.left = Math.min(window.innerWidth - 160, Math.max(10, x - 75)) + 'px';
        menu.style.top = Math.min(window.innerHeight - 220, Math.max(10, y - 80)) + 'px';
        document.body.appendChild(menu);

        const close = () => {
            mask.remove();
            menu.remove();
        };
        mask.addEventListener('click', close);
        menu.addEventListener('click', event => {
            const btn = event.target.closest('button');
            if (!btn) return;
            const action = btn.getAttribute('data-action');
            close();
            if (action === 'change') pickBackground();
            else if (action === 'clear') {
                const container = messagesEl();
                if (container) {
                    container.style.backgroundImage = '';
                    GM_setValue(KEYS.BG, '');
                }
            } else if (action === 'clear-chat') {
                clearChat();
            }
        });
    }

    /**
     * 绑定长按空白区打开背景菜单。
     * @returns {void}
     */
    function setupBgPicker() {
        const container = messagesEl();
        if (!container) return;

        const saved = GM_getValue(KEYS.BG);
        if (saved) container.style.backgroundImage = `url("${saved}")`;

        let timer = null;
        let startX = 0;
        let startY = 0;

        const isBlank = target =>
            target
            && !target.closest('.wechat-ai-avatar')
            && !target.closest('.wechat-ai-bubble')
            && target.id !== 'wechat-ai-thinking';

        const onStart = event => {
            if (!isBlank(event.target)) return;
            const point = event.touches ? event.touches[0] : event;
            startX = point.clientX;
            startY = point.clientY;
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
                timer = null;
                showBgMenu(startX, startY);
            }, 600);
        };

        const onMove = event => {
            if (!timer) return;
            const point = event.touches ? event.touches[0] : event;
            if (Math.abs(point.clientX - startX) > 10 || Math.abs(point.clientY - startY) > 10) {
                clearTimeout(timer);
                timer = null;
            }
        };

        const onEnd = () => {
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
        };

        container.addEventListener('touchstart', onStart, { passive: true });
        container.addEventListener('touchmove', onMove, { passive: true });
        container.addEventListener('touchend', onEnd);
        container.addEventListener('touchcancel', onEnd);
        container.addEventListener('mousedown', onStart);
        container.addEventListener('mousemove', onMove);
        container.addEventListener('mouseup', onEnd);
    }

    /**
     * 绑定消息区下拉刷新。
     * @returns {void}
     */
    function setupPullToRefresh() {
        const bar = document.getElementById('wechat-ai-refresh-bar');
        const text = document.getElementById('wechat-ai-refresh-text');
        const icon = document.getElementById('wechat-ai-refresh-icon');
        const scroller = messagesEl();
        if (!bar || !text || !icon || !scroller) return;

        const THRESHOLD = 60;
        const MAX_PULL = 100;
        let startY = 0;
        let pulling = false;
        let refreshing = false;

        scroller.addEventListener('touchstart', event => {
            if (refreshing || scroller.scrollTop > 0) return;
            startY = event.touches[0].clientY;
            pulling = true;
            bar.classList.add('wechat-ai-pulling');
        }, { passive: true });

        scroller.addEventListener('touchmove', event => {
            if (!pulling || refreshing) return;
            const deltaY = event.touches[0].clientY - startY;
            if (deltaY <= 0) {
                bar.style.height = '0px';
                text.textContent = '下拉刷新';
                return;
            }
            if (event.cancelable) event.preventDefault();
            const distance = Math.min(deltaY * 0.6, MAX_PULL);
            bar.style.height = distance + 'px';
            text.textContent = distance >= THRESHOLD ? '松开刷新' : '下拉刷新';
        }, { passive: false });

        const onEnd = () => {
            if (!pulling) return;
            pulling = false;
            bar.classList.remove('wechat-ai-pulling');
            if (refreshing) return;

            const height = parseFloat(bar.style.height) || 0;
            if (height >= THRESHOLD) {
                refreshing = true;
                bar.style.height = '40px';
                icon.classList.add('wechat-ai-spinning');
                text.textContent = '正在刷新';
                clearChat();
                setTimeout(() => {
                    try {
                        location.reload();
                    } catch (e) {
                        /* 刷新失败时保持当前页面 */
                    }
                }, 600);
            } else {
                bar.style.height = '0px';
            }
        };

        scroller.addEventListener('touchend', onEnd);
        scroller.addEventListener('touchcancel', onEnd);
    }

    /**
     * 发送输入框中的用户消息。
     * @returns {void}
     */
    function sendUserMessage() {
        const input = document.getElementById('wechat-ai-input');
        if (!input) return;

        const text = input.value.trim();
        if (!text) return;

        input.value = '';
        input.blur();

        (async () => {
            await sleep(50);
            const session = Session.get();
            if (session.active && session.round > 0) {
                Messages.push('system', '上轮对话未结束，已重置为新对话');
                View.flush();
            }
            Session.reset();
            Thinking.set({ active: false, duration: 0 });
            ThinkingIndicator.lastKey = '';
            ThinkingIndicator.stop();

            Messages.push('user', text);
            View.flush();
            Store.writeJSON(KEYS.USER, { text, ts: Date.now(), source: SITE.myRole });
        })();
    }

    /**
     * 清空全部会话与 UI 状态。
     * @returns {void}
     */
    function clearChat() {
        Store.clear(KEYS.MSGS);
        Store.clear(KEYS.USER);
        Store.clear(KEYS.TASK);
        Store.clear(KEYS.REPLY);
        Store.clear(KEYS.SESS);
        Store.clear(KEYS.THINKING);

        View.reset();
        ThinkingIndicator.stop();
        ThinkingIndicator.lastKey = '';
        Poller.reset();
    }

    /**
     * 创建聊天窗口 UI 并绑定事件。
     * @returns {void}
     */
    function createUI() {
        if (document.getElementById('wechat-ai-ui')) return;

        const panel = document.createElement('div');
        panel.id = 'wechat-ai-ui';
        panel.innerHTML = `
            <div id="wechat-ai-dragbar">
                <div id="wechat-ai-dragzone">≡   WeChat.ai </div>
                <div id="wechat-ai-winbtns">
                    <button id="wechat-ai-min" class="wechat-ai-winbtn">—</button>
                    <button id="wechat-ai-max" class="wechat-ai-winbtn">□</button>
                </div>
            </div>
            <div id="wechat-ai-refresh-bar">
                <span id="wechat-ai-refresh-content">
                    <span id="wechat-ai-refresh-icon">↻</span>
                    <span id="wechat-ai-refresh-text">下拉刷新</span>
                </span>
            </div>
            <div id="wechat-ai-messages">
                <div id="wechat-ai-thinking" class="wechat-ai-row wechat-ai-deepseek">
                    <div class="wechat-ai-avatar" style="background-image: url('${DS_AVATAR_URL}'); background-color: transparent;"></div>
                    <div class="wechat-ai-thinking-text">深度思考中...</div>
                </div>
            </div>
            <div id="wechat-ai-input-area">
                <button id="wechat-ai-plus" title="上传图片">+</button>
                <input id="wechat-ai-input" placeholder="输入消息">
                <button id="wechat-ai-send">发送</button>
            </div>
            <div id="wechat-ai-resize"></div>
        `;
        document.body.appendChild(panel);

        const toggle = document.createElement('button');
        toggle.id = 'wechat-ai-toggle';
        toggle.textContent = '💬';
        document.body.appendChild(toggle);
        toggle.addEventListener('click', () => {
            panel.style.display = 'flex';
            toggle.style.display = 'none';
        });

        document.getElementById('wechat-ai-send').addEventListener('click', sendUserMessage);
        document.getElementById('wechat-ai-plus').addEventListener('click', pickUserImage);
        document.getElementById('wechat-ai-input').addEventListener('keydown', event => {
            if (event.key === 'Enter') sendUserMessage();
        });

        const minBtn = document.getElementById('wechat-ai-min');
        const maxBtn = document.getElementById('wechat-ai-max');
        [minBtn, maxBtn].forEach(btn => {
            btn.addEventListener('touchstart', event => event.stopPropagation(), { passive: true });
            btn.addEventListener('mousedown', event => event.stopPropagation());
        });
        minBtn.addEventListener('click', () => toggleMin(panel));
        maxBtn.addEventListener('click', () => toggleMax(panel));

        enableDrag(panel, document.getElementById('wechat-ai-dragbar'));
        enableResize(panel, document.getElementById('wechat-ai-resize'));
        setupPullToRefresh();
        setupBgPicker();
        updateBtns();

        window.addEventListener('resize', () => {
            if (panel.style.display === 'none') return;

            if (state === 'edge-l' || state === 'edge-r') {
                const viewportHeight = window.innerHeight;
                const height = Math.min(viewportHeight * 0.5, 320);
                panel.style.top = Math.max(20, (viewportHeight - height) / 2) + 'px';
                panel.style.height = height + 'px';
                return;
            }
            if (state !== 'normal') return;

            const rect = readRect(panel);
            let left = rect.left;
            let top = rect.top;
            let width = rect.width;
            let height = rect.height;
            let changed = false;

            if (left + width > window.innerWidth - 4) {
                width = Math.max(240, window.innerWidth - left - 8);
                changed = true;
            }
            if (top + height > window.innerHeight - 4) {
                height = Math.max(120, window.innerHeight - top - 8);
                changed = true;
            }
            if (left + width > window.innerWidth - 4) {
                left = Math.max(0, window.innerWidth - width - 8);
                changed = true;
            }
            if (top + height > window.innerHeight - 4) {
                top = Math.max(0, window.innerHeight - height - 8);
                changed = true;
            }
            if (!changed) return;

            Object.assign(panel.style, {
                left: left + 'px',
                top: top + 'px',
                width: width + 'px',
                height: height + 'px',
            });
            savedRect = { left, top, width, height };
        });
    }

    /* =====================================================================
     * 10. 轮询与转发控制
     * ===================================================================== */

    /**
     * 有界集合：用于记录已处理的回复指纹，避免内存无限增长。
     */
    const SeenSet = (() => {
        /** @type {Set<string>} */
        const set = new Set();
        /** @type {string[]} */
        const queue = [];

        return {
            /**
             * 是否已存在。
             * @param {string} key 指纹
             * @returns {boolean}
             */
            has(key) {
                return set.has(key);
            },

            /**
             * 添加指纹，超出上限时淘汰最旧的。
             * @param {string} key 指纹
             * @returns {void}
             */
            add(key) {
                if (set.has(key)) return;
                set.add(key);
                queue.push(key);
                if (queue.length > CONFIG.SEEN_LIMIT) set.delete(queue.shift());
            },

            /**
             * 清空集合。
             * @returns {void}
             */
            clear() {
                set.clear();
                queue.length = 0;
            },
        };
    })();

    /**
     * 轮询器：消费跨标签页消息、捕获本页 AI 回复并转发。
     */
    const Poller = {
        /** @type {boolean} 是否正在执行转发动作 */
        executing: false,
        /** @type {{from: string, round: number, userText: string}|null} 待转发上下文 */
        pendingForward: null,
        /** @type {number} */
        lastUserTs: 0,
        /** @type {number} */
        lastTaskTs: 0,
        /** @type {number} */
        lastReplyTs: 0,
        /** @type {string} */
        lastKey: '',
        /** @type {number} */
        stable: 0,
        /** @type {boolean} */
        ready: false,
        /** @type {string} */
        currentHref: location.href,
        /** @type {number} */
        urlChangeUntil: 0,
        /** @type {number|null} */
        initInterval: null,

        /**
         * 重置轮询状态。
         * @returns {void}
         */
        reset() {
            this.executing = false;
            this.pendingForward = null;
            this.lastUserTs = 0;
            this.lastTaskTs = 0;
            this.lastReplyTs = 0;
            this.lastKey = '';
            this.stable = 0;
            SeenSet.clear();
        },

        /**
         * 处理用户消息：写入本页 AI 并发送。
         * @param {{text?: string, image?: string}} data 用户消息
         * @returns {Promise<void>}
         */
        async handleUser(data) {
            let imagePasted = false;
            if (data.image && SITE.isDoubao) {
                imagePasted = await Doubao.pasteImage(data.image);
                await sleep(800);
            }

            const rawText = (data.text || '').trim();
            const hasRealText = rawText && rawText !== '[用户上传了一张图片]';

            let textToSend = '';
            if (hasRealText) textToSend = rawText;
            else if (data.image && !imagePasted) textToSend = '[用户上传了一张图片，请根据上下文回答]';
            else if (!data.image) return;

            if (textToSend) textToSend = GROUP_PROMPT(SITE.myLabel) + textToSend;

            if (textToSend) {
                const ok = await AI.type(textToSend);
                if (!ok) {
                    Messages.push('system', '[' + SITE.myLabel + '] 输入框未就绪');
                    View.flush();
                    return;
                }
            }

            await sleep(1500);
            const sent = await waitAndClickSend(AI.getInputBox(), 5000);
            if (!sent) {
                Messages.push('system', '[' + SITE.myLabel + '] 发送失败');
                View.flush();
                return;
            }

            markThinkingStart();
            this.pendingForward = { from: SITE.myRole, round: 0, userText: rawText };
        },

        /**
         * 处理来自对面的转发任务。
         * @param {{text: string, from: string, round?: number}} task 任务
         * @returns {Promise<void>}
         */
        async handleTask(task) {
            const ok = await AI.type(task.text);
            if (!ok) {
                Messages.push('system', '[' + SITE.myLabel + '] 输入框未就绪');
                View.flush();
                return;
            }
            await sleep(1500);
            await waitAndClickSend(AI.getInputBox(), 5000);
            markThinkingStart();
            this.pendingForward = { from: task.from, round: task.round || 0, userText: '' };
        },

        /**
         * 处理需要回送到本页 AI 的回复。
         * @param {{text: string, round?: number}} reply 回复
         * @returns {Promise<void>}
         */
        async handleReply(reply) {
            const ok = await AI.type(reply.text);
            if (!ok) return;
            await sleep(1500);
            await waitAndClickSend(AI.getInputBox(), 5000);
            markThinkingStart();
            this.pendingForward = { from: SITE.myRole, round: reply.round || 0, userText: '' };
        },

        /**
         * 消费一条待处理动作（用户消息 / 任务 / 回复）。
         * @returns {Promise<void>}
         */
        async tick() {
            if (this.executing) return;
            if (Date.now() < this.urlChangeUntil) return;

            let action = null;

            const userRaw = GM_getValue(KEYS.USER);
            if (userRaw) {
                let data;
                try {
                    data = JSON.parse(userRaw);
                } catch (e) {
                    data = null;
                }
                if (data && data.ts !== this.lastUserTs && data.source === SITE.myRole) {
                    this.lastUserTs = data.ts;
                    action = { type: 'user', data };
                }
            }

            if (!action) {
                const taskRaw = GM_getValue(KEYS.TASK);
                if (taskRaw) {
                    let task;
                    try {
                        task = JSON.parse(taskRaw);
                    } catch (e) {
                        task = null;
                    }
                    if (task && task.timestamp !== this.lastTaskTs && task.from !== SITE.myRole) {
                        this.lastTaskTs = task.timestamp;
                        action = { type: 'task', data: task };
                    }
                }
            }

            if (!action) {
                const replyRaw = GM_getValue(KEYS.REPLY);
                if (replyRaw) {
                    let reply;
                    try {
                        reply = JSON.parse(replyRaw);
                    } catch (e) {
                        reply = null;
                    }
                    if (reply && reply.timestamp !== this.lastReplyTs && reply.from === SITE.myRole) {
                        this.lastReplyTs = reply.timestamp;
                        action = { type: 'reply', data: reply };
                    }
                }
            }

            if (!action) return;

            this.executing = true;
            try {
                if (action.type === 'user') await this.handleUser(action.data);
                else if (action.type === 'task') await this.handleTask(action.data);
                else await this.handleReply(action.data);
            } finally {
                this.executing = false;
            }
        },

        /**
         * 捕获本页 AI 的稳定回复，并转发给对面。
         * @returns {void}
         */
        capture() {
            if (!this.ready || Date.now() < this.urlChangeUntil) return;

            const latest = getReplyData();
            if (!latest.text || latest.text.includes('当前是一个多AI群聊')) return;
            if (latest.text.length < 5 && !latest.images.length) return;

            const key = latest.text + '###' + latest.images.join('|');
            if (key !== this.lastKey) {
                this.lastKey = key;
                this.stable = 0;
                return;
            }
            this.stable++;
            if (this.stable < CONFIG.REPLY_STABLE_TICKS || SeenSet.has(key)) return;
            SeenSet.add(key);
            this.stable = 0;

            let thinkingMs = 0;
            if (!SITE.isDoubao) {
                const thinking = Thinking.get();
                if (thinking.active) {
                    thinkingMs = Date.now() - thinking.startTime;
                    Thinking.set({ active: false, duration: thinkingMs });
                    ThinkingIndicator.lastKey = '';
                    ThinkingIndicator.stop();
                }
            }

            Messages.push(SITE.myRole, latest.text, latest.images, thinkingMs > 0 ? { thinkingMs } : null);
            View.flush();

            if (!this.pendingForward) return;
            const forward = this.pendingForward;
            this.pendingForward = null;

            const session = Session.get();
            const newRound = forward.round + 1;
            if (newRound >= session.maxRounds * 2) {
                Messages.push('system', '对话结束（' + session.maxRounds + '轮）');
                View.flush();
                session.active = false;
                Session.set(session);
                return;
            }
            Session.set(Object.assign({}, session, { round: newRound }));

            const targetKey = forward.from === SITE.myRole ? KEYS.TASK : KEYS.REPLY;
            const charHint = session.maxChars > 0
                ? '\n\n（请用不超过' + session.maxChars + '字简短回复）'
                : '';
            const text = GROUP_PROMPT(SITE.otherLabel) + (
                forward.userText
                    ? 'User：' + forward.userText + '\n\n' + SITE.myLabel + '：' + latest.text + charHint
                    : SITE.myLabel + '：' + latest.text + charHint
            );

            Store.writeJSON(targetKey, {
                text,
                from: forward.from,
                round: newRound,
                timestamp: Date.now(),
            });
        },

        /**
         * 记录页面初始化时已存在的回复，避免误判为新回复。
         * @returns {void}
         */
        initReady() {
            let count = 0;
            let lastInitKey = '';

            this.initInterval = setInterval(() => {
                const current = getReplyData();
                const key = current.text + '###' + current.images.join('|');
                if (key && key === lastInitKey) {
                    count++;
                    if (count >= 2) {
                        SeenSet.add(key);
                        this.lastKey = key;
                        this.ready = true;
                        clearInterval(this.initInterval);
                    }
                } else {
                    lastInitKey = key;
                    count = 0;
                }
            }, 1000);

            setTimeout(() => {
                if (this.ready) return;
                const current = getReplyData();
                const key = current.text + '###' + current.images.join('|');
                if (key) {
                    SeenSet.add(key);
                    this.lastKey = key;
                }
                this.ready = true;
                clearInterval(this.initInterval);
            }, 5000);
        },

        /**
         * 监听 SPA 路由变化并重置捕获状态。
         * @returns {void}
         */
        watchUrl() {
            setInterval(() => {
                if (location.href === this.currentHref) return;
                this.currentHref = location.href;
                this.urlChangeUntil = Date.now() + 3000;
                this.pendingForward = null;
                this.lastKey = '';
                this.stable = 0;

                const capture = () => {
                    if (!this.ready) return;
                    const current = getReplyData();
                    if (current.text || current.images.length) {
                        const key = current.text + '###' + current.images.join('|');
                        SeenSet.add(key);
                        this.lastKey = key;
                    }
                    this.stable = 0;
                };
                setTimeout(capture, 1000);
                setTimeout(capture, 2000);
                setTimeout(capture, 2800);
            }, 500);
        },

        /**
         * 启动初始化与路由监听。
         * @returns {void}
         */
        start() {
            this.initReady();
            this.watchUrl();
        },
    };

    /* =====================================================================
     * 11. 计时器
     * ===================================================================== */

    /**
     * 基于 Web Worker 的计时器，避免后台标签页被节流。
     * @returns {{add: (fn: () => void) => void}}
     */
    function makeWorkerTimer() {
        /** @type {Array<() => void>} */
        const listeners = [];
        try {
            const worker = new Worker(URL.createObjectURL(new Blob(
                ['setInterval(function(){postMessage(1)},' + CONFIG.POLL_INTERVAL_MS + ')'],
                { type: 'application/javascript' }
            )));
            worker.onmessage = () => listeners.forEach(fn => fn());
        } catch (e) {
            setInterval(() => listeners.forEach(fn => fn()), CONFIG.POLL_INTERVAL_MS);
        }
        return {
            /**
             * 注册每个 tick 的回调。
             * @param {() => void} fn 回调
             * @returns {void}
             */
            add(fn) {
                listeners.push(fn);
            },
        };
    }

    const timer = makeWorkerTimer();
    timer.add(() => View.flush());
    timer.add(() => ThinkingIndicator.check());
    timer.add(() => Poller.tick());
    timer.add(() => Poller.capture());

    /* =====================================================================
     * 12. 样式
     * ===================================================================== */

    try {
        const hljsCss = GM_getResourceText('hljs_css');
        GM_addStyle(hljsCss);
    } catch (e) {
        /* 资源缺失时不影响主功能 */
    }

    GM_addStyle(`
        #wechat-ai-ui { position: fixed; right: 8px; bottom: 8px; width: 92vw; max-width: 400px; height: 60vh; max-height: 520px; background: #f5f5f5; border: 1px solid #ddd; border-radius: 10px; z-index: 99999; display: flex; flex-direction: column; font-family: -apple-system, sans-serif; font-size: 13px; box-shadow: 0 4px 16px rgba(0,0,0,0.15); overflow: hidden; color: #222 !important; }
        #wechat-ai-ui.wechat-ai-anim { transition: left ${CONFIG.ANIM_MS}ms cubic-bezier(0.4,0,0.2,1), top ${CONFIG.ANIM_MS}ms cubic-bezier(0.4,0,0.2,1), width ${CONFIG.ANIM_MS}ms cubic-bezier(0.4,0,0.2,1), height ${CONFIG.ANIM_MS}ms cubic-bezier(0.4,0,0.2,1), border-radius ${CONFIG.ANIM_MS}ms cubic-bezier(0.4,0,0.2,1), background ${CONFIG.ANIM_MS}ms cubic-bezier(0.4,0,0.2,1), box-shadow ${CONFIG.ANIM_MS}ms cubic-bezier(0.4,0,0.2,1); }
        #wechat-ai-ui.wechat-ai-gesture { will-change: left, top, width, height; }
        #wechat-ai-ui.wechat-ai-snap-left { box-shadow: inset 4px 0 0 #07c160, 0 4px 16px rgba(0,0,0,0.15) !important; }
        #wechat-ai-ui.wechat-ai-snap-right { box-shadow: inset -4px 0 0 #07c160, 0 4px 16px rgba(0,0,0,0.15) !important; }
        #wechat-ai-dragbar { height: 32px; background: #e8e8e8; display: flex; align-items: center; padding: 0 4px 0 8px; font-size: 12px; color: #666 !important; cursor: move; user-select: none; border-bottom: 1px solid #ddd; flex-shrink: 0; touch-action: none; }
        #wechat-ai-dragzone { flex: 1; text-align: center; pointer-events: none; color: #666 !important; }
        #wechat-ai-winbtns { display: flex; gap: 2px; flex-shrink: 0; }
        .wechat-ai-winbtn { width: 30px; height: 24px; border: none; background: transparent; color: #555 !important; font-size: 14px; cursor: pointer; border-radius: 4px; padding: 0; line-height: 1; font-family: inherit; touch-action: manipulation; }
        .wechat-ai-winbtn:active { background: rgba(0,0,0,0.12); }
        #wechat-ai-refresh-bar { height: 0; overflow: hidden; flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-size: 12px; color: #999 !important; transition: height 0.2s ease; }
        #wechat-ai-refresh-bar.wechat-ai-pulling { transition: none; }
        #wechat-ai-refresh-content { display: inline-flex; align-items: center; gap: 6px; }
        #wechat-ai-refresh-icon { display: inline-block; font-size: 14px; line-height: 1; color: #999 !important; }
        #wechat-ai-refresh-icon.wechat-ai-spinning { animation: wechat-ai-spin 0.8s linear infinite; }
        @keyframes wechat-ai-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        #wechat-ai-messages { flex: 1 1 0; min-height: 0; height: 0; overflow-y: auto; padding: 8px; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; background-size: cover; background-position: center; background-repeat: no-repeat; }
        .wechat-ai-row { display: flex; align-items: flex-start; margin: 6px 0; gap: 6px; }
        .wechat-ai-row.wechat-ai-right { flex-direction: row-reverse; }
        .wechat-ai-avatar { width: 32px; height: 32px; border-radius: 50%; flex-shrink: 0; background-size: cover; background-position: center; background-color: #ccc; display: flex; align-items: center; justify-content: center; font-size: 12px; color: #fff !important; font-weight: bold; overflow: hidden; cursor: pointer; }
        .wechat-ai-bubble { max-width: 85%; padding: 8px 12px; border-radius: 10px; word-break: break-word; line-height: 1.5; font-size: 13px; color: #222 !important; background: #fff; overflow: hidden; }
        .wechat-ai-bubble div { color: #222 !important; }
        .wechat-ai-user .wechat-ai-bubble { background: #95ec69; color: #111 !important; }
        .wechat-ai-user .wechat-ai-bubble div { color: #111 !important; }
        .wechat-ai-doubao .wechat-ai-bubble { background: #fff; border: 1px solid #eee; color: #222 !important; }
        .wechat-ai-deepseek .wechat-ai-bubble { background: #dce6ff; color: #1a2340 !important; }
        .wechat-ai-deepseek .wechat-ai-bubble div { color: #1a2340 !important; }
        .wechat-ai-image-only { background: transparent !important; padding: 0 !important; border: none !important; }
        .wechat-ai-bubble img.wechat-ai-img { display: block; max-width: 100%; max-height: 240px; height: auto; object-fit: contain; border-radius: 6px; margin-top: 6px; cursor: zoom-in; }
        .wechat-ai-bubble img.wechat-ai-img:first-child { margin-top: 0; }
        .wechat-ai-bubble img.wechat-ai-img.wechat-ai-img-small { width: 100px !important; height: 100px !important; max-width: 100px !important; max-height: 100px !important; object-fit: cover; }
        .wechat-ai-system { text-align: center; font-size: 11px; color: #999 !important; margin: 6px 0; }
        .wechat-ai-think-info { font-size: 11px; color: #999 !important; margin-bottom: 4px; font-weight: normal; }
        #wechat-ai-thinking { display: none; }
        #wechat-ai-thinking .wechat-ai-thinking-text { font-size: 12px; color: #888 !important; margin-top: 6px; }
        #wechat-ai-input-area { display: flex; border-top: 1px solid #ddd; flex-shrink: 0; }
        #wechat-ai-plus { border: none; background: #e8e8e8; color: #666 !important; padding: 0 14px; cursor: pointer; font-size: 20px; font-weight: bold; line-height: 1; font-family: inherit; }
        #wechat-ai-plus:active { background: #d0d0d0; }
        #wechat-ai-input { flex: 1; border: none; padding: 10px; outline: none; font-size: 14px; background: transparent; color: #222 !important; min-width: 0; }
        #wechat-ai-input::placeholder { color: #aaa !important; }
        #wechat-ai-send { border: none; background: #07c160; color: #fff !important; padding: 10px 18px; cursor: pointer; font-size: 14px; flex-shrink: 0; }
        #wechat-ai-toggle { position: fixed; right: 8px; bottom: 8px; width: 48px; height: 48px; border-radius: 50%; background: #07c160; color: #fff !important; border: none; font-size: 20px; z-index: 99999; cursor: pointer; display: none; }
        #wechat-ai-resize { position: absolute; right: 0; bottom: 0; width: 28px; height: 28px; cursor: nwse-resize; touch-action: none; z-index: 10; background: linear-gradient(135deg, transparent 52%, rgba(120,120,120,0.5) 52%, rgba(120,120,120,0.7) 100%); border-radius: 0 0 10px 0; -webkit-tap-highlight-color: transparent; }
        #wechat-ai-resize.wechat-ai-resizing { background: linear-gradient(135deg, transparent 52%, rgba(7,193,96,0.6) 52%, rgba(7,193,96,0.85) 100%); }
        #wechat-ai-bg-menu { position: fixed; background: #fff; border-radius: 10px; box-shadow: 0 4px 24px rgba(0,0,0,0.25); padding: 8px; z-index: 100001; display: flex; flex-direction: column; gap: 4px; min-width: 150px; }
        #wechat-ai-bg-menu button { border: none; background: transparent; padding: 12px 16px; font-size: 14px; color: #333 !important; cursor: pointer; border-radius: 6px; text-align: center; font-family: inherit; }
        #wechat-ai-bg-menu button:active { background: #f0f0f0; }
        #wechat-ai-bg-mask { position: fixed; left: 0; top: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.25); z-index: 100000; }
        .wechat-ai-code-block { margin: 6px 0; border-radius: 6px; overflow: hidden; background: #1e1e1e; border: 1px solid #333; }
        .wechat-ai-code-header { display: flex; justify-content: space-between; align-items: center; background: #2d2d2d; padding: 4px 8px; font-size: 11px; color: #aaa; user-select: none; }
        .wechat-ai-code-lang { text-transform: uppercase; }
        .wechat-ai-code-copy { background: transparent; border: 1px solid #555; color: #ddd; border-radius: 4px; padding: 2px 8px; cursor: pointer; font-size: 11px; font-family: inherit; }
        .wechat-ai-code-copy:active { background: rgba(255,255,255,0.1); }
        .wechat-ai-code-block pre { margin: 0; padding: 8px; overflow-x: auto; }
        .wechat-ai-code-block code { font-family: Consolas, Monaco, 'Andale Mono', 'Ubuntu Mono', monospace; font-size: 12px; color: #d4d4d4; background: transparent !important; padding: 0 !important; }
    `);

    /* =====================================================================
     * 13. 启动
     * ===================================================================== */

    /**
     * 等待页面主要输入区就绪后创建 UI。
     * @returns {void}
     */
    function waitForPageReady() {
        let attempts = 0;
        const MAX_ATTEMPTS = 30;

        const interval = setInterval(() => {
            attempts++;
            const hasInput = !!document.querySelector('div[contenteditable="true"], textarea');
            const rootRendered = document.getElementById('root')
                && document.getElementById('root').children.length > 0;

            if (hasInput || rootRendered) {
                clearInterval(interval);
                createUI();
                setTimeout(() => {
                    View.flush();
                    ThinkingIndicator.check();
                }, 500);
            } else if (attempts >= MAX_ATTEMPTS) {
                clearInterval(interval);
                createUI();
            }
        }, 500);
    }

    waitForPageReady();
    Poller.start();
})();