// ==UserScript==
// @name         wechat.ai
// @namespace    wechat.ai
// @version      3.5.1
// @description  wechat.ai
// @match        https://www.doubao.com/*
// @match        https://chat.deepseek.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    const isDoubao = location.hostname.includes('doubao.com');
    const isDeepseek = location.hostname.includes('chat.deepseek.com');

    const KEY_TASK_DS = 'wechat_ai_task_deepseek';
    const KEY_REPLY_DS = 'wechat_ai_reply_deepseek';
    const KEY_MESSAGES = 'wechat_ai_messages';
    const KEY_USER_MSG = 'wechat_ai_user_msg';
    const KEY_BG = 'wechat_ai_bg';
    const KEY_SESSION = 'wechat_ai_session';

    const DEFAULT_MAX_ROUNDS = 1;
    const DEFAULT_MAX_CHARS = 100;

    const AVATARS = {
        user:     { img: 'https://lh3.googleusercontent.com/a/default-user=s100', text: 'U', bg: '#07c160' },
        doubao:   { img: 'data:image/jpeg;base64,...', text: '包', bg: '#f5a623' },
        deepseek: { img: 'data:image/jpeg;base64,...', text: '鲸', bg: '#4a6cf7' }
    };

    ['user', 'doubao', 'deepseek'].forEach(function (k) {
        const saved = GM_getValue('wechat_ai_avatar_' + k);
        if (saved) AVATARS[k].img = saved;
    });

    function getSession() {
        const raw = GM_getValue(KEY_SESSION);
        if (!raw) return { round: 0, maxRounds: DEFAULT_MAX_ROUNDS, maxChars: DEFAULT_MAX_CHARS, active: false };
        try {
            const s = JSON.parse(raw);
            return {
                round: s.round || 0,
                maxRounds: s.maxRounds || DEFAULT_MAX_ROUNDS,
                maxChars: s.maxChars || DEFAULT_MAX_CHARS,
                active: !!s.active
            };
        } catch (e) {
            return { round: 0, maxRounds: DEFAULT_MAX_ROUNDS, maxChars: DEFAULT_MAX_CHARS, active: false };
        }
    }

    function setSession(s) {
        GM_setValue(KEY_SESSION, JSON.stringify(s));
    }

    function resizeToDataURL(file, size) {
        return new Promise(function (resolve, reject) {
            const reader = new FileReader();
            reader.onerror = reject;
            reader.onload = function () {
                const img = new Image();
                img.onerror = reject;
                img.onload = function () {
                    const canvas = document.createElement('canvas');
                    canvas.width = size;
                    canvas.height = size;
                    const ctx = canvas.getContext('2d');
                    const minSide = Math.min(img.width, img.height);
                    const sx = (img.width - minSide) / 2;
                    const sy = (img.height - minSide) / 2;
                    ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);
                    resolve(canvas.toDataURL('image/jpeg', 0.82));
                };
                img.src = reader.result;
            };
            reader.readAsDataURL(file);
        });
    }

    function resizeImage(file, maxSide, quality) {
        return new Promise(function (resolve, reject) {
            const reader = new FileReader();
            reader.onerror = reject;
            reader.onload = function () {
                const img = new Image();
                img.onerror = reject;
                img.onload = function () {
                    let w = img.width, h = img.height;
                    const scale = Math.min(maxSide / w, maxSide / h, 1);
                    w = Math.round(w * scale);
                    h = Math.round(h * scale);
                    const canvas = document.createElement('canvas');
                    canvas.width = w;
                    canvas.height = h;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, w, h);
                    resolve(canvas.toDataURL('image/jpeg', quality || 0.75));
                };
                img.src = reader.result;
            };
            reader.readAsDataURL(file);
        });
    }

    function pickAvatar(who, avatarEl) {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.style.display = 'none';
        document.body.appendChild(input);
        input.onchange = async function () {
            const file = input.files && input.files[0];
            if (file) {
                try {
                    const dataUrl = await resizeToDataURL(file, 64);
                    AVATARS[who].img = dataUrl;
                    GM_setValue('wechat_ai_avatar_' + who, dataUrl);
                    avatarEl.style.backgroundImage = 'url("' + dataUrl + '")';
                    avatarEl.textContent = '';
                } catch (e) {}
            }
            if (input.parentNode) input.parentNode.removeChild(input);
        };
        input.click();
    }

    function makeWorkerTimer() {
        const listeners = [];
        try {
            const src = 'setInterval(function(){postMessage(1)},1000)';
            const blob = new Blob([src], { type: 'application/javascript' });
            const worker = new Worker(URL.createObjectURL(blob));
            worker.onmessage = function () {
                for (let i = 0; i < listeners.length; i++) listeners[i]();
            };
            return { add: function (fn) { listeners.push(fn); } };
        } catch (e) {
            setInterval(function () {
                for (let i = 0; i < listeners.length; i++) listeners[i]();
            }, 1000);
            return { add: function (fn) { listeners.push(fn); } };
        }
    }

    const workerTimer = makeWorkerTimer();

    function getMessages() {
        const raw = GM_getValue(KEY_MESSAGES);
        if (!raw) return [];
        try {
            const arr = JSON.parse(raw);
            return Array.isArray(arr) ? arr : [];
        } catch (e) {
            return [];
        }
    }

    function pushMessage(who, text, images) {
        const msgs = getMessages();
        const msg = {
            who: who,
            text: text || '',
            images: images || [],
            ts: Date.now() + Math.random()
        };
        msgs.push(msg);
        GM_setValue(KEY_MESSAGES, JSON.stringify(msgs));
        return msg;
    }

    async function setTextarea(el, text) {
        const setter = Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype, 'value'
        ).set;
        setter.call(el, '');
        el.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise(r => setTimeout(r, 60));
        setter.call(el, text);
        el.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function pasteIntoProseMirror(el, text) {
        el.focus();
        const dt = new DataTransfer();
        dt.setData('text/plain', text);
        el.dispatchEvent(new ClipboardEvent('paste', {
            clipboardData: dt,
            bubbles: true,
            cancelable: true
        }));
    }

    async function typeIntoDoubao(text) {
        const editor = document.querySelector('div[contenteditable="true"]');
        if (editor) {
            editor.focus();
            pasteIntoProseMirror(editor, text);
            await new Promise(r => setTimeout(r, 400));

            if (editor.innerHTML.length > 0 || (editor.innerText || '').trim().length > 0) return true;

            editor.focus();
            document.execCommand('insertText', false, text);
            await new Promise(r => setTimeout(r, 300));

            if (editor.innerHTML.length > 0 || (editor.innerText || '').trim().length > 0) return true;

            editor.textContent = text;
            await new Promise(r => setTimeout(r, 300));

            return (editor.innerText || '').trim().length > 0;
        }
        const ta = document.querySelector('textarea');
        if (ta && ta.offsetParent !== null) {
            await setTextarea(ta, text);
            return true;
        }
        return false;
    }

    async function pasteImageToDoubao(base64) {
        try {
            const res = await fetch(base64);
            const blob = await res.blob();
            const file = new File([blob], 'image_' + Date.now() + '.jpg', { type: 'image/jpeg' });

            const editor = document.querySelector('div[contenteditable="true"]');
            if (!editor) return false;

            editor.focus();
            await new Promise(r => setTimeout(r, 200));

            const dt = new DataTransfer();
            dt.items.add(file);

            const evt = new ClipboardEvent('paste', {
                clipboardData: dt,
                bubbles: true,
                cancelable: true
            });
            editor.dispatchEvent(evt);

            return true;
        } catch (e) {
            return false;
        }
    }

    async function typeIntoDeepseek(text) {
        const ta = document.querySelector('textarea#chat-input') || document.querySelector('textarea');
        if (!ta) return false;
        await setTextarea(ta, text);
        return true;
    }

    function pressEnter(el) {
        el.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true
        }));
        el.dispatchEvent(new KeyboardEvent('keyup', {
            key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true
        }));
    }

    function isEnabled(el) {
        if (!el) return false;
        if (el.disabled) return false;
        if (el.getAttribute('aria-disabled') === 'true') return false;
        if (el.offsetParent === null) return false;
        return true;
    }

    function findSendBtn(editorEl) {
        const labeled = document.querySelectorAll('[aria-label]');
        for (const b of labeled) {
            const label = (b.getAttribute('aria-label') || '').trim();
            if (label === '发送' || label.toLowerCase() === 'send') {
                if (isEnabled(b)) return b;
            }
        }
        for (const b of labeled) {
            const label = (b.getAttribute('aria-label') || '').trim();
            if (/^(发送|send)/i.test(label)) {
                if (isEnabled(b)) return b;
            }
        }
        if (editorEl) {
            let parent = editorEl.parentElement;
            for (let i = 0; i < 6 && parent; i++) {
                const btns = parent.querySelectorAll('button, div[role="button"]');
                const list = [];
                for (const b of btns) {
                    if (isEnabled(b)) list.push(b);
                }
                if (list.length > 0) return list[list.length - 1];
                parent = parent.parentElement;
            }
        }
        const all = document.querySelectorAll('button, div[role="button"]');
        for (const b of all) {
            const t = (b.innerText || '').trim();
            if ((t === '发送' || t.toLowerCase() === 'send') && isEnabled(b)) return b;
        }
        return null;
    }

    async function waitAndClickSend(editorEl, timeoutMs) {
        timeoutMs = timeoutMs || 4000;
        if (editorEl && editorEl.focus) {
            try { editorEl.focus(); } catch (e) {}
            await new Promise(r => setTimeout(r, 200));
        }
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            const btn = findSendBtn(editorEl);
            if (btn) {
                btn.click();
                return true;
            }
            await new Promise(r => setTimeout(r, 250));
        }
        if (editorEl) {
            pressEnter(editorEl);
            return true;
        }
        return false;
    }

    function readLatest(selectors) {
        for (const sel of selectors) {
            const els = document.querySelectorAll(sel);
            if (els.length === 0) continue;
            let t = (els[els.length - 1].innerText || '').trim();
            if (t.length > 0) {
                t = t.replace(/\n{3,}/g, '\n\n');
                return t;
            }
        }
        return '';
    }

    function pickImageSrc(img) {
        const link = img.closest('a');
        if (link && link.href && /\.(jpg|jpeg|png|webp|gif)/i.test(link.href.split('?')[0])) {
            return link.href;
        }
        const ds = img.getAttribute('data-src');
        if (ds) return ds;
        const dor = img.getAttribute('data-original');
        if (dor) return dor;
        return img.currentSrc || img.src || '';
    }

    function extractImagesFrom(container) {
        if (!container) return [];
        const imgs = container.querySelectorAll('img');
        const candidates = [];
        for (const img of imgs) {
            if (!img.complete) continue;
            if (img.naturalWidth < 80 || img.naturalHeight < 80) continue;
            const src = pickImageSrc(img);
            if (!src) continue;
            if (src.indexOf('blob:') === 0) continue;
            if (src.indexOf('data:') === 0 && src.length < 500) continue;
            if (/avatar|icon|emoji|logo|badge|gift|skeleton|placeholder|loading|spinner/i.test(src)) continue;
            if (/avatar|icon|emoji|logo|badge/i.test(img.className || '')) continue;
            const r = img.getBoundingClientRect();
            if (r.width < 30 || r.height < 30) continue;
            candidates.push({
                src: src,
                naturalArea: img.naturalWidth * img.naturalHeight,
                left: r.left, top: r.top, right: r.right, bottom: r.bottom
            });
        }

        const groups = [];
        for (const c of candidates) {
            let placed = false;
            for (const g of groups) {
                const ox = Math.max(0, Math.min(c.right, g.right) - Math.max(c.left, g.left));
                const oy = Math.max(0, Math.min(c.bottom, g.bottom) - Math.max(c.top, g.top));
                const oa = ox * oy;
                const ca = (c.right - c.left) * (c.bottom - c.top);
                const ga = (g.right - g.left) * (g.bottom - g.top);
                const minA = Math.min(ca, ga);
                if (minA > 0 && oa / minA > 0.5) {
                    if (c.naturalArea > g.naturalArea) {
                        g.src = c.src;
                        g.naturalArea = c.naturalArea;
                    }
                    placed = true;
                    break;
                }
            }
            if (!placed) {
                groups.push({
                    src: c.src,
                    naturalArea: c.naturalArea,
                    left: c.left, top: c.top, right: c.right, bottom: c.bottom
                });
            }
        }
        return groups.map(function (g) { return g.src; });
    }

    function getDoubaoReplyData() {
        const text = readLatest([
            '[data-testid="message_text_content"]',
            '[class*="message-content"]',
            '[class*="markdown-body"]'
        ]);
        let images = [];
        const textEls = document.querySelectorAll('[data-testid="message_text_content"]');
        if (textEls.length > 0) {
            let container = textEls[textEls.length - 1];
            for (let i = 0; i < 6 && container; i++) {
                images = extractImagesFrom(container);
                if (images.length > 0) break;
                container = container.parentElement;
            }
        }
        if (images.length === 0) {
            const rows = document.querySelectorAll('[class*="message-row"], [class*="chat-message"], [class*="message"]');
            if (rows.length > 0) {
                images = extractImagesFrom(rows[rows.length - 1]);
            }
        }
        return { text: text, images: images };
    }

    function getDsReplyData() {
        const text = readLatest([
            'div[class*="ds-markdown"]',
            'div[class*="markdown"]'
        ]);
        let images = [];
        const mdEls = document.querySelectorAll('div[class*="ds-markdown"]');
        if (mdEls.length > 0) {
            images = extractImagesFrom(mdEls[mdEls.length - 1]);
        }
        return { text: text, images: images };
    }

    GM_addStyle(`
        #wechat-ai-ui { position: fixed; right: 8px; bottom: 8px; width: 92vw; max-width: 400px; height: 60vh; max-height: 520px; background: #f5f5f5; border: 1px solid #ddd; border-radius: 10px; z-index: 99999; display: flex; flex-direction: column; font-family: -apple-system, sans-serif; font-size: 13px; box-shadow: 0 4px 16px rgba(0,0,0,0.15); overflow: hidden; color: #222 !important; }
        #wechat-ai-ui.wechat-ai-anim { transition: left 0.22s ease, top 0.22s ease, width 0.22s ease, height 0.22s ease, border-radius 0.22s ease; }
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
        .wechat-ai-bubble { max-width: 75%; padding: 8px 12px; border-radius: 10px; word-break: break-word; line-height: 1.5; font-size: 13px; color: #222 !important; background: #fff; }
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
        #wechat-ai-input-area { display: flex; border-top: 1px solid #ddd; flex-shrink: 0; }
        #wechat-ai-plus { border: none; background: #e8e8e8; color: #666 !important; padding: 0 14px; cursor: pointer; font-size: 20px; font-weight: bold; line-height: 1; font-family: inherit; }
        #wechat-ai-plus:active { background: #d0d0d0; }
        #wechat-ai-input { flex: 1; border: none; padding: 10px; outline: none; font-size: 14px; background: transparent; color: #222 !important; min-width: 0; }
        #wechat-ai-input::placeholder { color: #aaa !important; }
        #wechat-ai-send { border: none; background: #07c160; color: #fff !important; padding: 10px 18px; cursor: pointer; font-size: 14px; flex-shrink: 0; }
        #wechat-ai-toggle { position: fixed; right: 8px; bottom: 8px; width: 48px; height: 48px; border-radius: 50%; background: #07c160; color: #fff !important; border: none; font-size: 20px; z-index: 99999; cursor: pointer; display: none; }
        #wechat-ai-resize { position: absolute; right: 0; bottom: 0; width: 28px; height: 28px; cursor: nwse-resize; touch-action: none; z-index: 10; background: linear-gradient(135deg, transparent 52%, rgba(120,120,120,0.5) 52%, rgba(120,120,120,0.7) 100%); border-radius: 0 0 10px 0; -webkit-tap-highlight-color: transparent; }
        #wechat-ai-resize.wechat-ai-resizing { background: linear-gradient(135deg, transparent 52%, rgba(7,193,96,0.6) 52%, rgba(7,193,96,0.85) 100%); }
        #wechat-ai-bg-menu { position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); background: #fff; border-radius: 10px; box-shadow: 0 4px 24px rgba(0,0,0,0.25); padding: 8px; z-index: 100001; display: flex; flex-direction: column; gap: 4px; min-width: 150px; }
        #wechat-ai-bg-menu button { border: none; background: transparent; padding: 12px 16px; font-size: 14px; color: #333 !important; cursor: pointer; border-radius: 6px; text-align: center; font-family: inherit; }
        #wechat-ai-bg-menu button:active { background: #f0f0f0; }
        #wechat-ai-bg-mask { position: fixed; left: 0; top: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.25); z-index: 100000; }
    `);

    let panelState = 'normal';
    let normalRect = null;
    let renderedCount = 0;

    function readRect(panel) {
        const r = panel.getBoundingClientRect();
        return { left: r.left, top: r.top, width: r.width, height: r.height };
    }

    function applyRect(panel, rect, animate) {
        if (!rect) return;
        if (animate) panel.classList.add('wechat-ai-anim');
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
        panel.style.left = rect.left + 'px';
        panel.style.top = rect.top + 'px';
        panel.style.width = rect.width + 'px';
        panel.style.height = rect.height + 'px';
        panel.style.maxWidth = 'none';
        panel.style.maxHeight = 'none';
        if (animate) setTimeout(function () { panel.classList.remove('wechat-ai-anim'); }, 260);
    }

    function updateWinBtns() {
        const minBtn = document.getElementById('wechat-ai-min');
        const maxBtn = document.getElementById('wechat-ai-max');
        if (!minBtn || !maxBtn) return;
        minBtn.textContent = panelState === 'min' ? '▣' : '—';
        maxBtn.textContent = panelState === 'max' ? '❐' : '□';
    }

    function hideInnerElements() {
        ['wechat-ai-dragbar', 'wechat-ai-refresh-bar', 'wechat-ai-messages', 'wechat-ai-input-area', 'wechat-ai-resize'].forEach(function (id) {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
    }

    function showInnerElements() {
        ['wechat-ai-dragbar', 'wechat-ai-refresh-bar', 'wechat-ai-messages', 'wechat-ai-input-area', 'wechat-ai-resize'].forEach(function (id) {
            const el = document.getElementById(id);
            if (el) el.style.display = '';
        });
    }

    function snapToEdge(panel, side) {
        panelState = side === 'left' ? 'min-edge-left' : 'min-edge-right';
        updateWinBtns();

        const vh = window.innerHeight;
        const h = Math.min(vh * 0.5, 320);
        const top = Math.max(20, (vh - h) / 2);

        panel.classList.add('wechat-ai-anim');

        if (side === 'left') {
            panel.style.left = '0px';
            panel.style.right = 'auto';
            panel.style.borderRadius = '0 6px 6px 0';
        } else {
            panel.style.right = '0px';
            panel.style.left = 'auto';
            panel.style.borderRadius = '6px 0 0 6px';
        }
        panel.style.width = '8px';
        panel.style.top = top + 'px';
        panel.style.height = h + 'px';
        panel.style.background = 'rgba(7, 193, 96, 0.55)';
        panel.style.border = 'none';
        panel.style.boxShadow = '0 0 8px rgba(7, 193, 96, 0.35)';
        panel.style.maxWidth = 'none';
        panel.style.maxHeight = 'none';
        panel.style.cursor = 'pointer';
        panel.style.touchAction = 'none';

        hideInnerElements();

        setTimeout(function () { panel.classList.remove('wechat-ai-anim'); }, 260);
    }

    function restoreFromEdge(panel, animate) {
        showInnerElements();
        panel.style.background = '#f5f5f5';
        panel.style.border = '1px solid #ddd';
        panel.style.boxShadow = '0 4px 16px rgba(0,0,0,0.15)';
        panel.style.borderRadius = '10px';
        panel.style.cursor = '';
        panel.style.touchAction = '';
        panelState = 'normal';

        if (animate) {
            applyRect(panel, normalRect, true);
        } else {
            panel.classList.remove('wechat-ai-anim');
            if (normalRect) {
                panel.style.left = normalRect.left + 'px';
                panel.style.top = normalRect.top + 'px';
                panel.style.width = normalRect.width + 'px';
                panel.style.height = normalRect.height + 'px';
            }
            panel.style.right = 'auto';
            panel.style.bottom = 'auto';
            panel.style.maxWidth = 'none';
            panel.style.maxHeight = 'none';
        }
        updateWinBtns();
    }

    function toggleMin(panel) {
        if (panelState === 'min-edge-left' || panelState === 'min-edge-right') {
            restoreFromEdge(panel, true);
            return;
        }
        if (panelState === 'min') {
            applyRect(panel, normalRect, true);
            panelState = 'normal';
        } else {
            if (panelState === 'normal') {
                normalRect = readRect(panel);
            }
            panel.classList.add('wechat-ai-anim');
            panel.style.right = 'auto';
            panel.style.bottom = 'auto';
            panel.style.left = normalRect.left + 'px';
            panel.style.top = normalRect.top + 'px';
            panel.style.width = normalRect.width + 'px';
            panel.style.height = '32px';
            panel.style.maxWidth = 'none';
            panel.style.maxHeight = 'none';
            panelState = 'min';
            setTimeout(function () { panel.classList.remove('wechat-ai-anim'); }, 260);
        }
        updateWinBtns();
    }

    function toggleMax(panel) {
        if (panelState === 'min-edge-left' || panelState === 'min-edge-right') {
            restoreFromEdge(panel, false);
        }
        if (panelState === 'max') {
            applyRect(panel, normalRect, true);
            panelState = 'normal';
        } else {
            if (panelState === 'normal') {
                normalRect = readRect(panel);
            }
            panel.classList.add('wechat-ai-anim');
            panel.style.right = 'auto';
            panel.style.bottom = 'auto';
            panel.style.left = '4px';
            panel.style.top = '4px';
            panel.style.width = (window.innerWidth - 8) + 'px';
            panel.style.height = (window.innerHeight - 8) + 'px';
            panel.style.maxWidth = 'none';
            panel.style.maxHeight = 'none';
            panelState = 'max';
            setTimeout(function () { panel.classList.remove('wechat-ai-anim'); }, 260);
        }
        updateWinBtns();
    }

    function openImageFull(src) {
        const w = window.open('');
        if (w) {
            w.document.write('<html><head><title>查看图片</title><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#000;display:flex;align-items:center;justify-content:center;min-height:100vh;"><img src="' + src + '" style="max-width:100%;max-height:100vh;"></body></html>');
            w.document.close();
        }
    }

    function renderMessage(msg) {
        const c = document.getElementById('wechat-ai-messages');
        if (!c) return;
        const who = msg.who;
        const text = msg.text || '';
        const images = msg.images || [];

        if (who === 'system') {
            const s = document.createElement('div');
            s.className = 'wechat-ai-system';
            s.textContent = text;
            c.appendChild(s);
            c.scrollTop = c.scrollHeight;
            return;
        }

        const cfg = AVATARS[who] || AVATARS.doubao;
        const row = document.createElement('div');
        row.className = 'wechat-ai-row wechat-ai-' + who + (who === 'user' ? ' wechat-ai-right' : '');
        const av = document.createElement('div');
        av.className = 'wechat-ai-avatar';
        if (cfg.img) { av.style.backgroundImage = 'url("' + cfg.img + '")'; }
        else { av.style.backgroundColor = cfg.bg; av.textContent = cfg.text; }
        av.addEventListener('click', function () { pickAvatar(who, av); });
        const b = document.createElement('div');
        b.className = 'wechat-ai-bubble';

        const cleanText = (text || '').replace(/\n{3,}/g, '\n\n').trim();
        const uniq = [];
        if (images && images.length) {
            const seenSrc = {};
            for (const src of images) {
                if (seenSrc[src]) continue;
                seenSrc[src] = true;
                uniq.push(src);
            }
        }

        const hasText = cleanText.length > 0;
        const hasImages = uniq.length > 0;
        if (!hasText && hasImages) {
            b.className += ' wechat-ai-image-only';
        }
        if (hasText) {
            const t = document.createElement('div');
            t.textContent = cleanText;
            b.appendChild(t);
        }
        if (hasImages) {
            for (const src of uniq) {
                const img = document.createElement('img');
                img.className = 'wechat-ai-img' + (who === 'user' ? ' wechat-ai-img-small' : '');
                img.src = src;
                img.addEventListener('click', function (e) {
                    e.stopPropagation();
                    openImageFull(src);
                });
                img.onload = function () { c.scrollTop = c.scrollHeight; };
                img.onerror = function () {
                    if (img.parentNode) img.parentNode.removeChild(img);
                };
                b.appendChild(img);
            }
        }
        row.appendChild(av); row.appendChild(b);
        c.appendChild(row);
        c.scrollTop = c.scrollHeight;
    }

    function flushMessages() {
        const msgs = getMessages();
        if (msgs.length > renderedCount) {
            for (let i = renderedCount; i < msgs.length; i++) {
                renderMessage(msgs[i]);
            }
            renderedCount = msgs.length;
        }
    }

    async function sendUserMessage() {
        const inp = document.getElementById('wechat-ai-input');
        const text = inp.value.trim();
        if (!text) return;
        inp.value = '';
        inp.blur();
        await new Promise(r => setTimeout(r, 50));

        const oldSession = getSession();
        if (oldSession.active && oldSession.round > 0) {
            pushMessage('system', '上一轮对话尚未结束，已重置为新对话');
            flushMessages();
        }

        setSession({
            round: 0,
            maxRounds: DEFAULT_MAX_ROUNDS,
            maxChars: DEFAULT_MAX_CHARS,
            active: true
        });

        pushMessage('user', text);
        flushMessages();

        GM_setValue(KEY_USER_MSG, JSON.stringify({ text: text, ts: Date.now() }));
    }

    function pickUserImage() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.style.display = 'none';
        document.body.appendChild(input);
        input.onchange = async function () {
            const file = input.files && input.files[0];
            if (file) {
                try {
                    const dataUrl = await resizeImage(file, 480, 0.7);
                    
                    setSession({
                        round: 0,
                        maxRounds: DEFAULT_MAX_ROUNDS,
                        maxChars: DEFAULT_MAX_CHARS,
                        active: true
                    });
                    
                    pushMessage('user', '', [dataUrl]);
                    flushMessages();
                    GM_setValue(KEY_USER_MSG, JSON.stringify({
                        text: '[用户上传了一张图片]',
                        image: dataUrl,
                        ts: Date.now()
                    }));
                } catch (e) {}
            }
            if (input.parentNode) input.parentNode.removeChild(input);
        };
        input.click();
    }

    function applyBackground(messagesEl, dataUrl) {
        messagesEl.style.backgroundImage = 'url("' + dataUrl + '")';
    }

    function clearBackground(messagesEl) {
        messagesEl.style.backgroundImage = '';
        GM_setValue(KEY_BG, '');
    }

    function pickBackground() {
        const messagesEl = document.getElementById('wechat-ai-messages');
        if (!messagesEl) return;
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.style.display = 'none';
        document.body.appendChild(input);
        input.onchange = async function () {
            const file = input.files && input.files[0];
            if (file) {
                try {
                    const dataUrl = await resizeImage(file, 1280, 0.75);
                    GM_setValue(KEY_BG, dataUrl);
                    applyBackground(messagesEl, dataUrl);
                } catch (e) {}
            }
            if (input.parentNode) input.parentNode.removeChild(input);
        };
        input.click();
    }

    function showBgMenu() {
        const oldMask = document.getElementById('wechat-ai-bg-mask');
        const oldMenu = document.getElementById('wechat-ai-bg-menu');
        if (oldMask) oldMask.remove();
        if (oldMenu) oldMenu.remove();

        const mask = document.createElement('div');
        mask.id = 'wechat-ai-bg-mask';
        document.body.appendChild(mask);

        const menu = document.createElement('div');
        menu.id = 'wechat-ai-bg-menu';
        menu.innerHTML = `
            <button data-action="change">更换背景</button>
            <button data-action="clear">恢复默认</button>
            <button data-action="cancel">取消</button>
        `;
        document.body.appendChild(menu);

        function close() {
            if (mask.parentNode) mask.parentNode.removeChild(mask);
            if (menu.parentNode) menu.parentNode.removeChild(menu);
        }

        mask.addEventListener('click', close);

        menu.addEventListener('click', function (e) {
            const btn = e.target.closest('button');
            if (!btn) return;
            const action = btn.getAttribute('data-action');
            close();
            const messagesEl = document.getElementById('wechat-ai-messages');
            if (action === 'change') {
                pickBackground();
            } else if (action === 'clear') {
                if (messagesEl) clearBackground(messagesEl);
            }
        });
    }

    function setupBgPicker() {
        const messagesEl = document.getElementById('wechat-ai-messages');
        if (!messagesEl) return;

        const savedBg = GM_getValue(KEY_BG);
        if (savedBg) applyBackground(messagesEl, savedBg);

        let longPressTimer = null;
        let startX = 0, startY = 0;
        let triggered = false;

        function isBlankArea(target) {
            if (!target) return false;
            if (target.closest('.wechat-ai-avatar')) return false;
            if (target.closest('.wechat-ai-bubble')) return false;
            return true;
        }

        function onStart(e) {
            if (!isBlankArea(e.target)) return;
            const t = e.touches ? e.touches[0] : e;
            startX = t.clientX;
            startY = t.clientY;
            triggered = false;
            if (longPressTimer) clearTimeout(longPressTimer);
            longPressTimer = setTimeout(function () {
                longPressTimer = null;
                triggered = true;
                showBgMenu();
            }, 600);
        }

        function onMove(e) {
            if (!longPressTimer) return;
            const t = e.touches ? e.touches[0] : e;
            if (Math.abs(t.clientX - startX) > 10 || Math.abs(t.clientY - startY) > 10) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
            }
        }

        function onEnd() {
            if (longPressTimer) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
            }
            if (triggered) triggered = false;
        }

        messagesEl.addEventListener('touchstart', onStart, { passive: true });
        messagesEl.addEventListener('touchmove', onMove, { passive: true });
        messagesEl.addEventListener('touchend', onEnd);
        messagesEl.addEventListener('touchcancel', onEnd);
        messagesEl.addEventListener('mousedown', onStart);
        messagesEl.addEventListener('mousemove', onMove);
        messagesEl.addEventListener('mouseup', onEnd);
    }

    function setupPullToRefresh() {
        const bar = document.getElementById('wechat-ai-refresh-bar');
        const text = document.getElementById('wechat-ai-refresh-text');
        const icon = document.getElementById('wechat-ai-refresh-icon');
        const scroller = document.getElementById('wechat-ai-messages');
        if (!bar || !text || !icon || !scroller) return;

        const THRESHOLD = 60;
        const MAX_PULL = 100;
        let startY = 0;
        let pulling = false;
        let refreshing = false;

        function onStart(e) {
            if (refreshing) return;
            if (scroller.scrollTop > 0) return;
            startY = e.touches[0].clientY;
            pulling = true;
            bar.classList.add('wechat-ai-pulling');
        }

        function onMove(e) {
            if (!pulling || refreshing) return;
            const dy = e.touches[0].clientY - startY;
            if (dy <= 0) {
                bar.style.height = '0px';
                text.textContent = '下拉刷新';
                return;
            }
            if (e.cancelable) e.preventDefault();
            const dist = Math.min(dy * 0.6, MAX_PULL);
            bar.style.height = dist + 'px';
            if (dist >= THRESHOLD) {
                text.textContent = '松开刷新';
            } else {
                text.textContent = '下拉刷新';
            }
        }

        function onEnd() {
            if (!pulling) return;
            pulling = false;
            bar.classList.remove('wechat-ai-pulling');
            if (refreshing) return;
            const h = parseFloat(bar.style.height) || 0;
            if (h >= THRESHOLD) {
                startRefresh();
            } else {
                bar.style.height = '0px';
            }
        }

        function startRefresh() {
            refreshing = true;
            bar.style.height = '40px';
            icon.classList.add('wechat-ai-spinning');
            text.textContent = '正在刷新';
            setTimeout(function () {
                try { location.reload(); } catch (e) {}
            }, 500);
        }

        scroller.addEventListener('touchstart', onStart, { passive: true });
        scroller.addEventListener('touchmove', onMove, { passive: false });
        scroller.addEventListener('touchend', onEnd);
        scroller.addEventListener('touchcancel', onEnd);
    }

    function createUI() {
        if (document.getElementById('wechat-ai-ui')) return;
        const div = document.createElement('div');
        div.id = 'wechat-ai-ui';
        div.innerHTML = `
            <div id="wechat-ai-dragbar">
                <div id="wechat-ai-dragzone">≡   WeChat.ai</div>
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
            <div id="wechat-ai-messages"></div>
            <div id="wechat-ai-input-area">
                <button id="wechat-ai-plus" title="上传图片">+</button>
                <input id="wechat-ai-input" placeholder="输入消息">
                <button id="wechat-ai-send">发送</button>
            </div>
            <div id="wechat-ai-resize"></div>
        `;
        document.body.appendChild(div);
        const toggle = document.createElement('button');
        toggle.id = 'wechat-ai-toggle';
        toggle.textContent = '💬';
        document.body.appendChild(toggle);
        toggle.onclick = function () {
            div.style.display = 'flex';
            toggle.style.display = 'none';
        };
        document.getElementById('wechat-ai-send').onclick = sendUserMessage;
        document.getElementById('wechat-ai-plus').onclick = pickUserImage;
        document.getElementById('wechat-ai-input').addEventListener('keydown', function (e) {
            if (e.key === 'Enter') sendUserMessage();
        });

        const minBtn = document.getElementById('wechat-ai-min');
        const maxBtn = document.getElementById('wechat-ai-max');
        minBtn.addEventListener('touchstart', function (e) { e.stopPropagation(); }, { passive: true });
        minBtn.addEventListener('mousedown', function (e) { e.stopPropagation(); });
        maxBtn.addEventListener('touchstart', function (e) { e.stopPropagation(); }, { passive: true });
        maxBtn.addEventListener('mousedown', function (e) { e.stopPropagation(); });
        minBtn.addEventListener('click', function () { toggleMin(div); });
        maxBtn.addEventListener('click', function () { toggleMax(div); });

        enableDrag(div, document.getElementById('wechat-ai-dragbar'));
        enableResize(div, document.getElementById('wechat-ai-resize'));
        setupPullToRefresh();
        setupBgPicker();
        updateWinBtns();

        window.addEventListener('resize', function () {
            if (div.style.display === 'none') return;
            if (panelState === 'min-edge-left' || panelState === 'min-edge-right') {
                const vh = window.innerHeight;
                const h = Math.min(vh * 0.5, 320);
                const top = Math.max(20, (vh - h) / 2);
                div.style.top = top + 'px';
                div.style.height = h + 'px';
                return;
            }
            if (panelState !== 'normal') return;
            const r = div.getBoundingClientRect();
            let nl = r.left, nt = r.top, nw = r.width, nh = r.height;
            let changed = false;
            if (nl + nw > window.innerWidth - 4) {
                nw = Math.max(240, window.innerWidth - nl - 8);
                changed = true;
            }
            if (nt + nh > window.innerHeight - 4) {
                nh = Math.max(120, window.innerHeight - nt - 8);
                changed = true;
            }
            if (nl + nw > window.innerWidth - 4) {
                nl = Math.max(0, window.innerWidth - nw - 8);
                changed = true;
            }
            if (nt + nh > window.innerHeight - 4) {
                nt = Math.max(0, window.innerHeight - nh - 8);
                changed = true;
            }
            if (changed) {
                div.style.left = nl + 'px';
                div.style.top = nt + 'px';
                div.style.width = nw + 'px';
                div.style.height = nh + 'px';
                normalRect = { left: nl, top: nt, width: nw, height: nh };
            }
        });
    }

    function enableDrag(panel, handle) {
        let dragging = false, sx = 0, sy = 0, sl = 0, st = 0;

        function start(x, y) {
            if (panelState === 'min-edge-left' || panelState === 'min-edge-right') {
                restoreFromEdge(panel, false);
            }
            if (panelState === 'max') {
                panelState = 'normal';
                updateWinBtns();
            }
            const r = panel.getBoundingClientRect();
            dragging = true; sx = x; sy = y; sl = r.left; st = r.top;
            if (panelState === 'normal') {
                normalRect = { left: r.left, top: r.top, width: r.width, height: r.height };
            } else if (panelState === 'min' && normalRect) {
                normalRect.left = r.left;
                normalRect.top = r.top;
            }
            panel.classList.remove('wechat-ai-anim');
            panel.style.right = 'auto';
            panel.style.bottom = 'auto';
            panel.style.left = sl + 'px';
            panel.style.top = st + 'px';
        }

        function move(x, y) {
            if (!dragging) return;
            let nl = sl + (x - sx);
            let nt = st + (y - sy);
            const w = panel.offsetWidth, h = panel.offsetHeight;
            nl = Math.max(0, Math.min(window.innerWidth - Math.min(w, 60), nl));
            nt = Math.max(0, Math.min(window.innerHeight - 32, nt));
            panel.style.left = nl + 'px';
            panel.style.top = nt + 'px';
            if (normalRect) { normalRect.left = nl; normalRect.top = nt; }
        }

        function end() {
            if (!dragging) return;
            dragging = false;

            if (panelState === 'min') {
                const r = panel.getBoundingClientRect();
                const threshold = 40;
                if (r.left < threshold) {
                    snapToEdge(panel, 'left');
                } else if (r.right > window.innerWidth - threshold) {
                    snapToEdge(panel, 'right');
                }
            }
        }

        handle.addEventListener('touchstart', function (e) { start(e.touches[0].clientX, e.touches[0].clientY); }, { passive: true });
        handle.addEventListener('touchmove', function (e) { move(e.touches[0].clientX, e.touches[0].clientY); e.preventDefault(); }, { passive: false });
        handle.addEventListener('touchend', end);
        handle.addEventListener('touchcancel', end);
        handle.addEventListener('mousedown', function (e) { start(e.clientX, e.clientY); });
        document.addEventListener('mousemove', function (e) { move(e.clientX, e.clientY); });
        document.addEventListener('mouseup', end);
        handle.addEventListener('dblclick', function (e) {
            e.preventDefault();
            toggleMax(panel);
        });

        panel.addEventListener('click', function (e) {
            if (panelState === 'min-edge-left' || panelState === 'min-edge-right') {
                e.preventDefault();
                e.stopPropagation();
                restoreFromEdge(panel, true);
            }
        }, true);
    }

    function enableResize(panel, handle) {
        let resizing = false;
        let sx = 0, sy = 0, sw = 0, sh = 0;
        let left = 0, top = 0;

        function start(x, y) {
            if (panelState === 'min-edge-left' || panelState === 'min-edge-right') return;
            if (panelState === 'max') {
                panelState = 'normal';
                updateWinBtns();
            }
            if (panelState === 'min') {
                toggleMin(panel);
            }
            const r = panel.getBoundingClientRect();
            resizing = true;
            sx = x; sy = y;
            sw = r.width; sh = r.height;
            left = r.left; top = r.top;
            normalRect = { left: r.left, top: r.top, width: r.width, height: r.height };
            panel.classList.remove('wechat-ai-anim');
            panel.style.right = 'auto';
            panel.style.bottom = 'auto';
            panel.style.left = left + 'px';
            panel.style.top = top + 'px';
            panel.style.width = sw + 'px';
            panel.style.height = sh + 'px';
            panel.style.maxWidth = 'none';
            panel.style.maxHeight = 'none';
            handle.classList.add('wechat-ai-resizing');
        }

        function move(x, y) {
            if (!resizing) return;
            const dx = x - sx;
            const dy = y - sy;
            const minW = 240, minH = 120;
            const maxW = Math.max(minW, window.innerWidth - left - 8);
            const maxH = Math.max(minH, window.innerHeight - top - 8);
            const newW = Math.max(minW, Math.min(maxW, sw + dx));
            const newH = Math.max(minH, Math.min(maxH, sh + dy));
            panel.style.width = newW + 'px';
            panel.style.height = newH + 'px';
            if (normalRect) { normalRect.width = newW; normalRect.height = newH; }
        }

        function end() {
            if (!resizing) return;
            resizing = false;
            handle.classList.remove('wechat-ai-resizing');
        }

        handle.addEventListener('touchstart', function (e) {
            start(e.touches[0].clientX, e.touches[0].clientY);
        }, { passive: true });
        handle.addEventListener('touchmove', function (e) {
            if (!resizing) return;
            move(e.touches[0].clientX, e.touches[0].clientY);
            e.preventDefault();
        }, { passive: false });
        handle.addEventListener('touchend', end);
        handle.addEventListener('touchcancel', end);
        handle.addEventListener('mousedown', function (e) {
            start(e.clientX, e.clientY);
            e.preventDefault();
        });
        document.addEventListener('mousemove', function (e) {
            if (!resizing) return;
            move(e.clientX, e.clientY);
        });
        document.addEventListener('mouseup', end);
    }

    setTimeout(createUI, 1500);

    workerTimer.add(flushMessages);

    if (isDoubao) {
        let lastUserMsgTs = 0;
        let lastDsTime = 0;
        let executing = false;
        let seen = new Set();
        let lastKey = '';
        let stable = 0;
        let ready = false;
        let currentPath = location.pathname;
        let urlChangeUntil = 0;

        workerTimer.add(async function () {
            if (executing) return;
            const raw = GM_getValue(KEY_USER_MSG);
            if (!raw) return;
            let data;
            try { data = JSON.parse(raw); } catch (e) { return; }
            if (!data || data.ts === lastUserMsgTs) return;
            lastUserMsgTs = data.ts;

            executing = true;
            try {
                let imagePasted = false;
                if (data.image) {
                    imagePasted = await pasteImageToDoubao(data.image);
                    await new Promise(r => setTimeout(r, 800));
                }

                const rawText = (data.text || '').trim();
                const hasRealText = rawText && rawText !== '[用户上传了一张图片]';

                if (hasRealText) {
                    const ok = await typeIntoDoubao(rawText);
                    if (!ok && !imagePasted) {
                        pushMessage('system', '笨包输入框未就绪');
                        flushMessages();
                        return;
                    }
                } else if (!data.image) {
                    pushMessage('system', '消息为空');
                    flushMessages();
                    return;
                } else if (data.image && !imagePasted) {
                    const ok = await typeIntoDoubao('[用户上传了一张图片，请根据上下文回答]');
                    if (!ok) {
                        pushMessage('system', '笨包输入框未就绪');
                        flushMessages();
                        return;
                    }
                }

                await new Promise(r => setTimeout(r, 700));

                const editor = document.querySelector('div[contenteditable="true"]');
                const sent = await waitAndClickSend(editor || document.querySelector('textarea'), 5000);
                if (!sent) {
                    pushMessage('system', '发送失败，请手动发送');
                    flushMessages();
                    return;
                }

                await new Promise(r => setTimeout(r, 2500));
                const editor2 = document.querySelector('div[contenteditable="true"]');
                const remaining = editor2 ? (editor2.innerText || '').trim() : '';
                const textExpected = hasRealText ? rawText : '[用户上传了一张图片，请根据上下文回答]';
                if (remaining && remaining === textExpected.trim()) {
                    if (editor2) {
                        editor2.focus();
                        pressEnter(editor2);
                    }
                    await new Promise(r => setTimeout(r, 1500));
                    const editor3 = document.querySelector('div[contenteditable="true"]');
                    const remaining2 = editor3 ? (editor3.innerText || '').trim() : '';
                    if (remaining2 === textExpected.trim()) {
                        const btn = findSendBtn(editor3);
                        if (btn) btn.click();
                        await new Promise(r => setTimeout(r, 1500));
                        const editor4 = document.querySelector('div[contenteditable="true"]');
                        const remaining3 = editor4 ? (editor4.innerText || '').trim() : '';
                        if (remaining3 === textExpected.trim()) {
                            pushMessage('system', '笨包发送失败，请手动发送');
                            flushMessages();
                        }
                    }
                }
            } finally {
                executing = false;
            }
        });

        setInterval(function () {
            if (location.pathname === currentPath) return;
            currentPath = location.pathname;
            urlChangeUntil = Date.now() + 2000;
            lastKey = '';
            stable = 0;
            setTimeout(function () {
                if (!ready) return;
                const cur = getDoubaoReplyData();
                const k = cur.text + '###' + cur.images.join('|');
                if (cur.text || cur.images.length) {
                    seen.add(k);
                    lastKey = k;
                }
                stable = 0;
            }, 1500);
        }, 500);

        workerTimer.add(function () {
            if (!ready) return;
            if (Date.now() < urlChangeUntil) return;
            const latest = getDoubaoReplyData();
            if ((!latest.text || latest.text.length < 5) && latest.images.length === 0) return;

            const key = latest.text + '###' + latest.images.join('|');
            if (key !== lastKey) {
                lastKey = key;
                stable = 0;
                return;
            }
            stable++;
            if (stable < 3) return;
            if (seen.has(key)) return;
            seen.add(key);
            stable = 0;

            const session = getSession();

            if (!session.active) {
                pushMessage('doubao', latest.text, latest.images);
                flushMessages();
                return;
            }

            pushMessage('doubao', latest.text, latest.images);
            flushMessages();

            if (session.round >= session.maxRounds) {
                pushMessage('system', '已达最大轮次（' + session.maxRounds + '轮），对话结束');
                flushMessages();
                session.active = false;
                setSession(session);
                return;
            }

            let userText = '手动发送';
            const rawU = GM_getValue(KEY_USER_MSG);
            if (rawU) {
                try {
                    const u = JSON.parse(rawU);
                    if (u && u.text) userText = u.text;
                } catch (e) {}
            }

            const imgNote = latest.images.length ? '\n[笨包生成了 ' + latest.images.length + ' 张图片]' : '';
            let charHint = '';
            if (session.maxChars > 0) {
                charHint = '\n\n（请用不超过 ' + session.maxChars + ' 字简短回复，不要重复上文）';
            }

            GM_setValue(KEY_TASK_DS, JSON.stringify({
                text: 'User：' + userText + '\n\nDoubao：' + latest.text + imgNote + charHint,
                timestamp: Date.now()
            }));
            pushMessage('system', '已发给D老师（第' + (session.round + 1) + '/' + session.maxRounds + '轮）');
            flushMessages();
        });

        workerTimer.add(function () {
            const raw = GM_getValue(KEY_REPLY_DS);
            if (!raw) return;
            let d;
            try { d = JSON.parse(raw); } catch (e) { return; }
            if (!d || d.timestamp === lastDsTime) return;
            lastDsTime = d.timestamp;

            const session = getSession();
            if (!session.active) return;

            session.round++;

            if (session.round >= session.maxRounds) {
                pushMessage('system', '第' + session.round + '轮完成，对话结束');
                flushMessages();
                session.active = false;
                setSession(session);
                return;
            }

            setSession(session);

            (async function () {
                let charHint = '';
                if (session.maxChars > 0) {
                    charHint = '（请用不超过' + session.maxChars + '字简短回应）';
                }
                const payload = 'DeepSeek：' + (d.reply || '') + (d.images && d.images.length ? '\n[DeepSeek 发了 ' + d.images.length + ' 张图片]' : '') + charHint;
                const ok = await typeIntoDoubao(payload);
                if (!ok) return;
                await new Promise(r => setTimeout(r, 700));
                const editor = document.querySelector('div[contenteditable="true"]');
                await waitAndClickSend(editor || document.querySelector('textarea'), 5000);
            })();
        });

        setTimeout(function () {
            const init = getDoubaoReplyData();
            lastKey = init.text + '###' + init.images.join('|');
            if (init.text || init.images.length) seen.add(lastKey);
            ready = true;
        }, 5000);
    }

    if (isDeepseek) {
        let lastTaskTime = 0;

        workerTimer.add(async function () {
            const raw = GM_getValue(KEY_TASK_DS);
            if (!raw) return;
            let task;
            try { task = JSON.parse(raw); } catch (e) { return; }
            if (!task || task.timestamp === lastTaskTime) return;
            lastTaskTime = task.timestamp;

            const session = getSession();
            if (!session.active) return;

            const ta = document.querySelector('textarea#chat-input') || document.querySelector('textarea');
            const ok = await typeIntoDeepseek(task.text);
            if (!ok) return;
            await new Promise(r => setTimeout(r, 600));
            await waitAndClickSend(ta, 5000);

            let last = '';
            let st = 0;
            const check = setInterval(function () {
                const cur = getDsReplyData();
                const key = cur.text + '###' + cur.images.join('|');
                if ((!cur.text || cur.text.length < 5) && cur.images.length === 0) return;
                if (key === last) {
                    st++;
                    if (st >= 4) {
                        clearInterval(check);
                        pushMessage('deepseek', cur.text, cur.images);
                        flushMessages();
                        GM_setValue(KEY_REPLY_DS, JSON.stringify({
                            reply: cur.text,
                            images: cur.images,
                            timestamp: Date.now()
                        }));
                    }
                } else {
                    st = 0;
                    last = key;
                }
            }, 1000);

            setTimeout(function () { clearInterval(check); }, 180000);
        });
    }
})();