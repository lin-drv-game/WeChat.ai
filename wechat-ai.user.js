// ==UserScript==
// @name         wechat.ai
// @namespace    wechat.ai
// @version      3.7.0
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
    const myRole = isDoubao ? 'doubao' : 'deepseek';
    const myLabel = isDoubao ? '豆包' : 'DeepSeek';
    const otherLabel = isDoubao ? 'D老师' : '豆包';

    const K = {
        TASK: 'wechat_ai_task_deepseek',
        REPLY: 'wechat_ai_reply_deepseek',
        MSGS: 'wechat_ai_messages',
        USER: 'wechat_ai_user_msg',
        BG: 'wechat_ai_bg',
        SESS: 'wechat_ai_session'
    };
    const MAX_ROUNDS = 1;
    const MAX_CHARS = 100;
    const ANIM_MS = 220;
    const MIN_SNAP_PX = 40;
    const IMG_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,image/bmp,image/heic,image/heif,image/*';

    const AVATARS = {
        user:     { img: 'https://lh3.googleusercontent.com/a/default-user=s100', text: 'U', bg: '#07c160' },
        doubao:   { img: 'https://lf-flow-web-cdn.doubao.com/obj/flow-doubao/doubao/chat/favicon-doubao.png', text: '包', bg: '#f5a623' },
        deepseek: { img: 'https://avatars.githubusercontent.com/u/148330874?v=4', text: '鲸', bg: '#4a6cf7' }
    };
    ['user', 'doubao', 'deepseek'].forEach(k => {
        const s = GM_getValue('wechat_ai_avatar_' + k);
        if (s) AVATARS[k].img = s;
    });

    const sleep = ms => new Promise(r => setTimeout(r, ms));

    function rafThrottle(fn) {
        let pending = false, args;
        return function (...a) {
            args = a;
            if (!pending) {
                pending = true;
                requestAnimationFrame(() => { pending = false; fn.apply(null, args); });
            }
        };
    }

    function getSession() {
        const raw = GM_getValue(K.SESS);
        if (!raw) return { round: 0, maxRounds: MAX_ROUNDS, maxChars: MAX_CHARS, active: false };
        try {
            const s = JSON.parse(raw);
            return {
                round: s.round || 0,
                maxRounds: s.maxRounds || MAX_ROUNDS,
                maxChars: s.maxChars || MAX_CHARS,
                active: !!s.active
            };
        } catch (e) {
            return { round: 0, maxRounds: MAX_ROUNDS, maxChars: MAX_CHARS, active: false };
        }
    }
    const setSession = s => GM_setValue(K.SESS, JSON.stringify(s));
    const resetSession = () => setSession({ round: 0, maxRounds: MAX_ROUNDS, maxChars: MAX_CHARS, active: true });

    function getMessages() {
        try { const a = JSON.parse(GM_getValue(K.MSGS)); return Array.isArray(a) ? a : []; }
        catch (e) { return []; }
    }
    function pushMessage(who, text, images) {
        const msgs = getMessages();
        msgs.push({ who, text: text || '', images: images || [], ts: Date.now() + Math.random() });
        GM_setValue(K.MSGS, JSON.stringify(msgs));
    }

    function loadImage(file) {
        return new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onerror = reject;
            r.onload = () => {
                const img = new Image();
                img.onerror = reject;
                img.onload = () => resolve(img);
                img.src = r.result;
            };
            r.readAsDataURL(file);
        });
    }

    async function resizeImage(file, maxSide, quality, square) {
        const img = await loadImage(file);
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (square) {
            const min = Math.min(img.width, img.height);
            canvas.width = canvas.height = maxSide;
            ctx.drawImage(img, (img.width - min) / 2, (img.height - min) / 2, min, min, 0, 0, maxSide, maxSide);
        } else {
            const scale = Math.min(maxSide / img.width, maxSide / img.height, 1);
            canvas.width = Math.round(img.width * scale);
            canvas.height = Math.round(img.height * scale);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        }
        return canvas.toDataURL('image/jpeg', quality || 0.75);
    }

    function pickFile(accept, cb) {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = accept;
        input.style.display = 'none';
        document.body.appendChild(input);
        input.onchange = async () => {
            const f = input.files && input.files[0];
            if (f) try { await cb(f); } catch (e) {}
            input.remove();
        };
        input.click();
    }

    function pickAvatar(who, el) {
        pickFile(IMG_ACCEPT, async f => {
            const url = await resizeImage(f, 64, 0.82, true);
            AVATARS[who].img = url;
            GM_setValue('wechat_ai_avatar_' + who, url);
            el.style.backgroundImage = `url("${url}")`;
            el.textContent = '';
        });
    }

    function pickUserImage() {
        pickFile(IMG_ACCEPT, async f => {
            const url = await resizeImage(f, 480, 0.7);
            resetSession();
            pushMessage('user', '', [url]);
            flush();
            GM_setValue(K.USER, JSON.stringify({ text: '[用户上传了一张图片]', image: url, ts: Date.now(), source: myRole }));
        });
    }

    function pickBackground() {
        const el = document.getElementById('wechat-ai-messages');
        if (!el) return;
        pickFile(IMG_ACCEPT, async f => {
            const url = await resizeImage(f, 1280, 0.75);
            GM_setValue(K.BG, url);
            el.style.backgroundImage = `url("${url}")`;
        });
    }

    function makeWorkerTimer() {
        const listeners = [];
        try {
            const src = 'setInterval(function(){postMessage(1)},1000)';
            const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'application/javascript' })));
            w.onmessage = () => listeners.forEach(fn => fn());
        } catch (e) {
            setInterval(() => listeners.forEach(fn => fn()), 1000);
        }
        return { add: fn => listeners.push(fn) };
    }
    const timer = makeWorkerTimer();

    async function setTextarea(el, text) {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
        setter.call(el, '');
        el.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(60);
        setter.call(el, text);
        el.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function pasteText(el, text) {
        el.focus();
        const dt = new DataTransfer();
        dt.setData('text/plain', text);
        el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }

    async function typeIntoDoubao(text) {
        const editor = document.querySelector('div[contenteditable="true"]');
        if (editor) {
            editor.focus();
            pasteText(editor, text);
            await sleep(400);
            if (editor.innerHTML.length > 0 || (editor.innerText || '').trim()) return true;
            editor.focus();
            document.execCommand('insertText', false, text);
            await sleep(300);
            if (editor.innerHTML.length > 0 || (editor.innerText || '').trim()) return true;
            editor.textContent = text;
            await sleep(300);
            return !!(editor.innerText || '').trim();
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
            const blob = await (await fetch(base64)).blob();
            const file = new File([blob], 'image_' + Date.now() + '.jpg', { type: 'image/jpeg' });
            const editor = document.querySelector('div[contenteditable="true"]');
            if (!editor) return false;
            editor.focus();
            await sleep(200);
            const dt = new DataTransfer();
            dt.items.add(file);
            editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
            return true;
        } catch (e) { return false; }
    }

    async function typeIntoDeepseek(text) {
        const ta = document.querySelector('textarea#chat-input') || document.querySelector('textarea');
        if (!ta) return false;
        await setTextarea(ta, text);
        return true;
    }

    const typeIntoMyAI = text => isDoubao ? typeIntoDoubao(text) : typeIntoDeepseek(text);

    function pressEnter(el) {
        ['keydown', 'keyup'].forEach(t => el.dispatchEvent(new KeyboardEvent(t, {
            key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true
        })));
    }

    const isEnabled = el => el && !el.disabled && el.getAttribute('aria-disabled') !== 'true' && el.offsetParent !== null;

    function findSendBtn(editorEl) {
        const labeled = [...document.querySelectorAll('[aria-label]')];
        for (const b of labeled) {
            const l = (b.getAttribute('aria-label') || '').trim();
            if ((l === '发送' || l.toLowerCase() === 'send') && isEnabled(b)) return b;
        }
        for (const b of labeled) {
            const l = (b.getAttribute('aria-label') || '').trim();
            if (/^(发送|send)/i.test(l) && isEnabled(b)) return b;
        }
        if (editorEl) {
            let p = editorEl.parentElement;
            for (let i = 0; i < 6 && p; i++) {
                const btns = [...p.querySelectorAll('button, div[role="button"]')].filter(isEnabled);
                if (btns.length) return btns[btns.length - 1];
                p = p.parentElement;
            }
        }
        return [...document.querySelectorAll('button, div[role="button"]')]
            .find(b => (b.innerText || '').trim() === '发送' && isEnabled(b)) || null;
    }

    async function waitAndClickSend(editorEl, timeout) {
        timeout = timeout || 4000;
        if (editorEl && editorEl.focus) {
            try { editorEl.focus(); } catch (e) {}
            await sleep(200);
        }
        const start = Date.now();
        while (Date.now() - start < timeout) {
            const btn = findSendBtn(editorEl);
            if (btn) { btn.click(); return true; }
            await sleep(250);
        }
        if (editorEl) { pressEnter(editorEl); return true; }
        return false;
    }

    function readLatest(selectors) {
        for (const sel of selectors) {
            const els = document.querySelectorAll(sel);
            if (!els.length) continue;
            const t = (els[els.length - 1].innerText || '').trim().replace(/\n{3,}/g, '\n\n');
            if (t) return t;
        }
        return '';
    }

    function pickImageSrc(img) {
        const link = img.closest('a');
        if (link && link.href && /\.(jpg|jpeg|png|webp|gif)/i.test(link.href.split('?')[0])) return link.href;
        return img.getAttribute('data-src') || img.getAttribute('data-original') || img.currentSrc || img.src || '';
    }

    function extractImages(container) {
        if (!container) return [];
        const candidates = [];
        for (const img of container.querySelectorAll('img')) {
            if (!img.complete || img.naturalWidth < 80 || img.naturalHeight < 80) continue;
            const src = pickImageSrc(img);
            if (!src || src.startsWith('blob:')) continue;
            if (src.startsWith('data:') && src.length < 500) continue;
            if (/avatar|icon|emoji|logo|badge|gift|skeleton|placeholder|loading|spinner/i.test(src)) continue;
            if (/avatar|icon|emoji|logo|badge/i.test(img.className || '')) continue;
            const r = img.getBoundingClientRect();
            if (r.width < 30 || r.height < 30) continue;
            candidates.push({
                src,
                area: img.naturalWidth * img.naturalHeight,
                left: r.left, top: r.top, right: r.right, bottom: r.bottom
            });
        }
        const groups = [];
        for (const c of candidates) {
            let placed = false;
            for (const g of groups) {
                const ox = Math.max(0, Math.min(c.right, g.right) - Math.max(c.left, g.left));
                const oy = Math.max(0, Math.min(c.bottom, g.bottom) - Math.max(c.top, g.top));
                const minA = Math.min((c.right - c.left) * (c.bottom - c.top), (g.right - g.left) * (g.bottom - g.top));
                if (minA > 0 && ox * oy / minA > 0.5) {
                    if (c.area > g.area) { g.src = c.src; g.area = c.area; }
                    placed = true;
                    break;
                }
            }
            if (!placed) groups.push({ src: c.src, area: c.area, left: c.left, top: c.top, right: c.right, bottom: c.bottom });
        }
        return groups.map(g => g.src);
    }

    function getReplyData() {
        const text = readLatest(isDoubao
            ? ['[data-testid="message_text_content"]', '[class*="message-content"]', '[class*="markdown-body"]']
            : ['div[class*="ds-markdown"]', 'div[class*="markdown"]']);
        let images = [];
        if (isDoubao) {
            const els = document.querySelectorAll('[data-testid="message_text_content"]');
            if (els.length) {
                let c = els[els.length - 1];
                for (let i = 0; i < 6 && c; i++) {
                    images = extractImages(c);
                    if (images.length) break;
                    c = c.parentElement;
                }
            }
            if (!images.length) {
                const rows = document.querySelectorAll('[class*="message-row"], [class*="chat-message"], [class*="message"]');
                if (rows.length) images = extractImages(rows[rows.length - 1]);
            }
        } else {
            const els = document.querySelectorAll('div[class*="ds-markdown"]');
            if (els.length) images = extractImages(els[els.length - 1]);
        }
        return { text, images };
    }

    const getMyInputBox = () => isDoubao
        ? document.querySelector('div[contenteditable="true"]') || document.querySelector('textarea')
        : document.querySelector('textarea#chat-input') || document.querySelector('textarea');

    GM_addStyle(`
        #wechat-ai-ui { position: fixed; right: 8px; bottom: 8px; width: 92vw; max-width: 400px; height: 60vh; max-height: 520px; background: #f5f5f5; border: 1px solid #ddd; border-radius: 10px; z-index: 99999; display: flex; flex-direction: column; font-family: -apple-system, sans-serif; font-size: 13px; box-shadow: 0 4px 16px rgba(0,0,0,0.15); overflow: hidden; color: #222 !important; }
        #wechat-ai-ui.wechat-ai-anim { transition: left ${ANIM_MS}ms cubic-bezier(0.4,0,0.2,1), top ${ANIM_MS}ms cubic-bezier(0.4,0,0.2,1), width ${ANIM_MS}ms cubic-bezier(0.4,0,0.2,1), height ${ANIM_MS}ms cubic-bezier(0.4,0,0.2,1), border-radius ${ANIM_MS}ms cubic-bezier(0.4,0,0.2,1), background ${ANIM_MS}ms cubic-bezier(0.4,0,0.2,1), box-shadow ${ANIM_MS}ms cubic-bezier(0.4,0,0.2,1); }
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
        #wechat-ai-bg-menu { position: fixed; left: 50%; top: 50%; transform: translate(-50%,-50%); background: #fff; border-radius: 10px; box-shadow: 0 4px 24px rgba(0,0,0,0.25); padding: 8px; z-index: 100001; display: flex; flex-direction: column; gap: 4px; min-width: 150px; }
        #wechat-ai-bg-menu button { border: none; background: transparent; padding: 12px 16px; font-size: 14px; color: #333 !important; cursor: pointer; border-radius: 6px; text-align: center; font-family: inherit; }
        #wechat-ai-bg-menu button:active { background: #f0f0f0; }
        #wechat-ai-bg-mask { position: fixed; left: 0; top: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.25); z-index: 100000; }
    `);

    let state = 'normal';
    let savedRect = null;
    let rendered = 0;

    function readRect(el) {
        const r = el.getBoundingClientRect();
        return { left: r.left, top: r.top, width: r.width, height: r.height };
    }

    function applyRect(el, r, animate) {
        if (!r) return;
        if (animate) el.classList.add('wechat-ai-anim');
        Object.assign(el.style, {
            right: 'auto', bottom: 'auto', maxWidth: 'none', maxHeight: 'none',
            left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px'
        });
        if (animate) setTimeout(() => el.classList.remove('wechat-ai-anim'), ANIM_MS + 20);
    }

    function setInnerVisible(v) {
        ['wechat-ai-dragbar', 'wechat-ai-refresh-bar', 'wechat-ai-messages', 'wechat-ai-input-area', 'wechat-ai-resize']
            .forEach(id => {
                const el = document.getElementById(id);
                if (el) el.style.display = v ? '' : 'none';
            });
    }

    function updateBtns() {
        const min = document.getElementById('wechat-ai-min');
        const max = document.getElementById('wechat-ai-max');
        if (!min || !max) return;
        min.textContent = (state === 'min' || state === 'edge-l' || state === 'edge-r') ? '▣' : '—';
        max.textContent = state === 'max' ? '❐' : '□';
    }

    const setState = next => { state = next; updateBtns(); };

    function computeSnap(left, width) {
        if (state === 'min') {
            if (left < MIN_SNAP_PX) return 'left';
            if (left + width > window.innerWidth - MIN_SNAP_PX) return 'right';
        } else if (state === 'normal') {
            if (-left >= width / 3) return 'left';
            if (left + width - window.innerWidth >= width / 3) return 'right';
        }
        return null;
    }

    function clearSnapHints(el) {
        el.classList.remove('wechat-ai-snap-left', 'wechat-ai-snap-right');
    }

    function snapToEdge(el, side) {
        clearSnapHints(el);
        setState(side === 'left' ? 'edge-l' : 'edge-r');
        const vh = window.innerHeight;
        const h = Math.min(vh * 0.5, 320);
        const top = Math.max(20, (vh - h) / 2);
        el.classList.add('wechat-ai-anim');
        Object.assign(el.style, {
            width: '8px', top: top + 'px', height: h + 'px',
            borderRadius: side === 'left' ? '0 6px 6px 0' : '6px 0 0 6px',
            background: 'rgba(7,193,96,0.55)', border: 'none',
            boxShadow: '0 0 8px rgba(7,193,96,0.35)',
            maxWidth: 'none', maxHeight: 'none', cursor: 'pointer', touchAction: 'none'
        });
        if (side === 'left') { el.style.left = '0px'; el.style.right = 'auto'; }
        else { el.style.right = '0px'; el.style.left = 'auto'; }
        setInnerVisible(false);
        setTimeout(() => el.classList.remove('wechat-ai-anim'), ANIM_MS + 20);
    }

    function restoreFromEdge(el, animate) {
        setInnerVisible(true);
        clearSnapHints(el);
        Object.assign(el.style, {
            background: '#f5f5f5', border: '1px solid #ddd',
            boxShadow: '0 4px 16px rgba(0,0,0,0.15)', borderRadius: '10px',
            cursor: '', touchAction: ''
        });
        setState('normal');
        el.classList.remove('wechat-ai-anim');
        applyRect(el, savedRect, animate);
    }

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
            right: 'auto', bottom: 'auto',
            left: savedRect.left + 'px', top: savedRect.top + 'px',
            width: savedRect.width + 'px', height: '32px',
            maxWidth: 'none', maxHeight: 'none'
        });
        setState('min');
        setTimeout(() => el.classList.remove('wechat-ai-anim'), ANIM_MS + 20);
    }

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
            right: 'auto', bottom: 'auto', left: '4px', top: '4px',
            width: (window.innerWidth - 8) + 'px', height: (window.innerHeight - 8) + 'px',
            maxWidth: 'none', maxHeight: 'none'
        });
        setState('max');
        setTimeout(() => el.classList.remove('wechat-ai-anim'), ANIM_MS + 20);
    }

    function bindGesture(handle, panel, handlers) {
        let active = false;
        let lastX = 0, lastY = 0;
        let rafPending = false;

        const flushMove = () => {
            rafPending = false;
            if (active) handlers.move(lastX, lastY);
        };

        const onMove = (x, y) => {
            lastX = x; lastY = y;
            if (!rafPending && active) {
                rafPending = true;
                requestAnimationFrame(flushMove);
            }
        };

        const down = (x, y) => {
            if (handlers.start(x, y) === false) return;
            active = true;
            lastX = x; lastY = y;
            panel.classList.add('wechat-ai-gesture');
        };

        const up = () => {
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

        handle.addEventListener('touchstart', e => down(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
        handle.addEventListener('touchmove', e => {
            if (!active) return;
            onMove(e.touches[0].clientX, e.touches[0].clientY);
            if (e.cancelable) e.preventDefault();
        }, { passive: false });
        handle.addEventListener('touchend', up);
        handle.addEventListener('touchcancel', up);
        handle.addEventListener('mousedown', e => down(e.clientX, e.clientY));
        document.addEventListener('mousemove', e => { if (active) onMove(e.clientX, e.clientY); });
        document.addEventListener('mouseup', up);
    }

    function enableDrag(el, handle) {
        let sx = 0, sy = 0, sl = 0, st = 0, w0 = 0;
        bindGesture(handle, el, {
            start(x, y) {
                clearSnapHints(el);
                if (state === 'edge-l' || state === 'edge-r') restoreFromEdge(el, false);
                if (state === 'max') setState('normal');
                const r = readRect(el);
                sx = x; sy = y; sl = r.left; st = r.top; w0 = r.width;
                if (state === 'normal') savedRect = { left: r.left, top: r.top, width: r.width, height: r.height };
                else if (state === 'min' && savedRect) { savedRect.left = r.left; savedRect.top = r.top; }
                el.classList.remove('wechat-ai-anim');
                Object.assign(el.style, { right: 'auto', bottom: 'auto', left: sl + 'px', top: st + 'px' });
            },
            move(x, y) {
                let nl = sl + (x - sx);
                let nt = st + (y - sy);
                if (state === 'min') nl = Math.max(0, Math.min(window.innerWidth - Math.min(w0, 60), nl));
                else nl = Math.max(-w0, Math.min(window.innerWidth, nl));
                nt = Math.max(0, Math.min(window.innerHeight - 32, nt));
                el.style.left = nl + 'px';
                el.style.top = nt + 'px';
                const hint = computeSnap(nl, w0);
                el.classList.toggle('wechat-ai-snap-left', hint === 'left');
                el.classList.toggle('wechat-ai-snap-right', hint === 'right');
            },
            end() {
                const r = readRect(el);
                const side = computeSnap(r.left, r.width);
                if (side) return snapToEdge(el, side);
                if (state === 'min') {
                    if (savedRect) { savedRect.left = r.left; savedRect.top = r.top; }
                } else if (state === 'normal') {
                    const w = r.width;
                    let fl = r.left;
                    if (fl < 0) fl = 0;
                    if (fl + w > window.innerWidth) fl = Math.max(0, window.innerWidth - w);
                    if (fl !== r.left) el.style.left = fl + 'px';
                    if (savedRect) { savedRect.left = fl; savedRect.top = r.top; }
                }
            }
        });
        handle.addEventListener('dblclick', e => { e.preventDefault(); toggleMax(el); });
        el.addEventListener('click', e => {
            if (state === 'edge-l' || state === 'edge-r') {
                e.preventDefault();
                e.stopPropagation();
                restoreFromEdge(el, true);
            }
        }, true);
    }

    function enableResize(el, handle) {
        let sx = 0, sy = 0, sw = 0, sh = 0, sl = 0, st = 0;
        bindGesture(handle, el, {
            start(x, y) {
                if (state === 'edge-l' || state === 'edge-r') return false;
                if (state === 'max') setState('normal');
                if (state === 'min') toggleMin(el);
                const r = readRect(el);
                sx = x; sy = y; sw = r.width; sh = r.height; sl = r.left; st = r.top;
                savedRect = { left: r.left, top: r.top, width: r.width, height: r.height };
                el.classList.remove('wechat-ai-anim');
                Object.assign(el.style, {
                    right: 'auto', bottom: 'auto', left: sl + 'px', top: st + 'px',
                    width: sw + 'px', height: sh + 'px', maxWidth: 'none', maxHeight: 'none'
                });
                handle.classList.add('wechat-ai-resizing');
            },
            move(x, y) {
                const minW = 240, minH = 120;
                const maxW = Math.max(minW, window.innerWidth - sl - 8);
                const maxH = Math.max(minH, window.innerHeight - st - 8);
                const w = Math.max(minW, Math.min(maxW, sw + (x - sx)));
                const h = Math.max(minH, Math.min(maxH, sh + (y - sy)));
                el.style.width = w + 'px';
                el.style.height = h + 'px';
                if (savedRect) { savedRect.width = w; savedRect.height = h; }
            },
            end() { handle.classList.remove('wechat-ai-resizing'); }
        });
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
        const { who, text, images } = msg;

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
        if (cfg.img) av.style.backgroundImage = `url("${cfg.img}")`;
        else { av.style.backgroundColor = cfg.bg; av.textContent = cfg.text; }
        av.addEventListener('click', () => pickAvatar(who, av));
        const b = document.createElement('div');
        b.className = 'wechat-ai-bubble';

        const cleanText = (text || '').replace(/\n{3,}/g, '\n\n').trim();
        const uniq = [];
        if (images && images.length) {
            const seen = {};
            for (const s of images) if (!seen[s]) { seen[s] = true; uniq.push(s); }
        }

        const hasText = cleanText.length > 0;
        const hasImages = uniq.length > 0;
        if (!hasText && hasImages) b.className += ' wechat-ai-image-only';
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
                img.addEventListener('click', e => { e.stopPropagation(); openImageFull(src); });
                img.onload = () => { c.scrollTop = c.scrollHeight; };
                img.onerror = () => img.remove();
                b.appendChild(img);
            }
        }
        row.appendChild(av);
        row.appendChild(b);
        c.appendChild(row);
        c.scrollTop = c.scrollHeight;
    }

    function flush() {
        const msgs = getMessages();
        if (msgs.length > rendered) {
            for (let i = rendered; i < msgs.length; i++) renderMessage(msgs[i]);
            rendered = msgs.length;
        }
    }

    async function sendUserMessage() {
        const inp = document.getElementById('wechat-ai-input');
        const text = inp.value.trim();
        if (!text) return;
        inp.value = '';
        inp.blur();
        await sleep(50);

        const old = getSession();
        if (old.active && old.round > 0) {
            pushMessage('system', '上一轮尚未结束，已重置为新对话');
            flush();
        }
        resetSession();
        pushMessage('user', text);
        flush();
        GM_setValue(K.USER, JSON.stringify({ text, ts: Date.now(), source: myRole }));
    }

    function showBgMenu() {
        ['wechat-ai-bg-mask', 'wechat-ai-bg-menu'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.remove();
        });
        const mask = document.createElement('div');
        mask.id = 'wechat-ai-bg-mask';
        document.body.appendChild(mask);
        const menu = document.createElement('div');
        menu.id = 'wechat-ai-bg-menu';
        menu.innerHTML = '<button data-action="change">更换背景</button><button data-action="clear">恢复默认</button><button data-action="cancel">取消</button>';
        document.body.appendChild(menu);
        const close = () => { mask.remove(); menu.remove(); };
        mask.addEventListener('click', close);
        menu.addEventListener('click', e => {
            const btn = e.target.closest('button');
            if (!btn) return;
            const action = btn.getAttribute('data-action');
            close();
            if (action === 'change') pickBackground();
            else if (action === 'clear') {
                const el = document.getElementById('wechat-ai-messages');
                if (el) { el.style.backgroundImage = ''; GM_setValue(K.BG, ''); }
            }
        });
    }

    function setupBgPicker() {
        const el = document.getElementById('wechat-ai-messages');
        if (!el) return;
        const saved = GM_getValue(K.BG);
        if (saved) el.style.backgroundImage = `url("${saved}")`;

        let timer = null, sx = 0, sy = 0;
        const isBlank = t => t && !t.closest('.wechat-ai-avatar') && !t.closest('.wechat-ai-bubble');
        const start = e => {
            if (!isBlank(e.target)) return;
            const t = e.touches ? e.touches[0] : e;
            sx = t.clientX; sy = t.clientY;
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => { timer = null; showBgMenu(); }, 600);
        };
        const move = e => {
            if (!timer) return;
            const t = e.touches ? e.touches[0] : e;
            if (Math.abs(t.clientX - sx) > 10 || Math.abs(t.clientY - sy) > 10) {
                clearTimeout(timer); timer = null;
            }
        };
        const end = () => { if (timer) { clearTimeout(timer); timer = null; } };

        el.addEventListener('touchstart', start, { passive: true });
        el.addEventListener('touchmove', move, { passive: true });
        el.addEventListener('touchend', end);
        el.addEventListener('touchcancel', end);
        el.addEventListener('mousedown', start);
        el.addEventListener('mousemove', move);
        el.addEventListener('mouseup', end);
    }

    function setupPullToRefresh() {
        const bar = document.getElementById('wechat-ai-refresh-bar');
        const text = document.getElementById('wechat-ai-refresh-text');
        const icon = document.getElementById('wechat-ai-refresh-icon');
        const scroller = document.getElementById('wechat-ai-messages');
        if (!bar || !text || !icon || !scroller) return;

        const THRESHOLD = 60, MAX_PULL = 100;
        let startY = 0, pulling = false, refreshing = false;

        scroller.addEventListener('touchstart', e => {
            if (refreshing || scroller.scrollTop > 0) return;
            startY = e.touches[0].clientY;
            pulling = true;
            bar.classList.add('wechat-ai-pulling');
        }, { passive: true });
        scroller.addEventListener('touchmove', e => {
            if (!pulling || refreshing) return;
            const dy = e.touches[0].clientY - startY;
            if (dy <= 0) { bar.style.height = '0px'; text.textContent = '下拉刷新'; return; }
            if (e.cancelable) e.preventDefault();
            const dist = Math.min(dy * 0.6, MAX_PULL);
            bar.style.height = dist + 'px';
            text.textContent = dist >= THRESHOLD ? '松开刷新' : '下拉刷新';
        }, { passive: false });
        const end = () => {
            if (!pulling) return;
            pulling = false;
            bar.classList.remove('wechat-ai-pulling');
            if (refreshing) return;
            const h = parseFloat(bar.style.height) || 0;
            if (h >= THRESHOLD) {
                refreshing = true;
                bar.style.height = '40px';
                icon.classList.add('wechat-ai-spinning');
                text.textContent = '正在刷新';
                setTimeout(() => { try { location.reload(); } catch (e) {} }, 500);
            } else {
                bar.style.height = '0px';
            }
        };
        scroller.addEventListener('touchend', end);
        scroller.addEventListener('touchcancel', end);
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
        toggle.onclick = () => { div.style.display = 'flex'; toggle.style.display = 'none'; };

        document.getElementById('wechat-ai-send').onclick = sendUserMessage;
        document.getElementById('wechat-ai-plus').onclick = pickUserImage;
        document.getElementById('wechat-ai-input').addEventListener('keydown', e => {
            if (e.key === 'Enter') sendUserMessage();
        });

        const minBtn = document.getElementById('wechat-ai-min');
        const maxBtn = document.getElementById('wechat-ai-max');
        [minBtn, maxBtn].forEach(b => {
            b.addEventListener('touchstart', e => e.stopPropagation(), { passive: true });
            b.addEventListener('mousedown', e => e.stopPropagation());
        });
        minBtn.addEventListener('click', () => toggleMin(div));
        maxBtn.addEventListener('click', () => toggleMax(div));

        enableDrag(div, document.getElementById('wechat-ai-dragbar'));
        enableResize(div, document.getElementById('wechat-ai-resize'));
        setupPullToRefresh();
        setupBgPicker();
        updateBtns();

        window.addEventListener('resize', () => {
            if (div.style.display === 'none') return;
            if (state === 'edge-l' || state === 'edge-r') {
                const vh = window.innerHeight;
                const h = Math.min(vh * 0.5, 320);
                div.style.top = Math.max(20, (vh - h) / 2) + 'px';
                div.style.height = h + 'px';
                return;
            }
            if (state !== 'normal') return;
            const r = readRect(div);
            let nl = r.left, nt = r.top, nw = r.width, nh = r.height, changed = false;
            if (nl + nw > window.innerWidth - 4) { nw = Math.max(240, window.innerWidth - nl - 8); changed = true; }
            if (nt + nh > window.innerHeight - 4) { nh = Math.max(120, window.innerHeight - nt - 8); changed = true; }
            if (nl + nw > window.innerWidth - 4) { nl = Math.max(0, window.innerWidth - nw - 8); changed = true; }
            if (nt + nh > window.innerHeight - 4) { nt = Math.max(0, window.innerHeight - nh - 8); changed = true; }
            if (changed) {
                Object.assign(div.style, { left: nl + 'px', top: nt + 'px', width: nw + 'px', height: nh + 'px' });
                savedRect = { left: nl, top: nt, width: nw, height: nh };
            }
        });
    }

    setTimeout(createUI, 1500);
    timer.add(flush);

    let executing = false;
    let pendingForward = null;
    let lastUserTs = 0;
    let lastTaskTs = 0;
    let lastReplyTs = 0;

    const seen = new Set();
    let lastKey = '';
    let stable = 0;
    let ready = false;
    let currentPath = location.pathname;
    let urlChangeUntil = 0;

    setTimeout(() => {
        const init = getReplyData();
        lastKey = init.text + '###' + init.images.join('|');
        if (init.text || init.images.length) seen.add(lastKey);
        ready = true;
    }, 5000);

    async function handleUser(data) {
        pushMessage('system', '[' + myLabel + '] 正在处理用户消息...');
        flush();

        let imagePasted = false;
        if (data.image && isDoubao) {
            imagePasted = await pasteImageToDoubao(data.image);
            await sleep(800);
        }

        const rawText = (data.text || '').trim();
        const hasRealText = rawText && rawText !== '[用户上传了一张图片]';
        let textToSend = '';
        if (hasRealText) textToSend = rawText;
        else if (data.image && !imagePasted) textToSend = '[用户上传了一张图片，请根据上下文回答]';
        else if (!data.image) { pushMessage('system', '消息为空'); flush(); return; }

        if (textToSend) {
            const ok = await typeIntoMyAI(textToSend);
            if (!ok) { pushMessage('system', '[' + myLabel + '] 输入框未就绪'); flush(); return; }
        }
        await sleep(700);
        const sent = await waitAndClickSend(getMyInputBox(), 5000);
        if (!sent) { pushMessage('system', '[' + myLabel + '] 发送失败'); flush(); return; }

        pendingForward = { from: myRole, round: 0, userText: rawText };
        pushMessage('system', '[' + myLabel + '] 已发送，等待回复...');
        flush();
    }

    async function handleTask(task) {
        const ok = await typeIntoMyAI(task.text);
        if (!ok) { pushMessage('system', '[' + myLabel + '] 输入框未就绪'); flush(); return; }
        await sleep(700);
        await waitAndClickSend(getMyInputBox(), 5000);
        pendingForward = { from: task.from, round: task.round || 0, userText: '' };
    }

    async function handleReply(d) {
        const ok = await typeIntoMyAI('对方：' + (d.text || ''));
        if (!ok) return;
        await sleep(700);
        await waitAndClickSend(getMyInputBox(), 5000);
        pendingForward = { from: myRole, round: d.round || 0, userText: '' };
    }

    timer.add(async () => {
        if (executing) return;

        let action = null;
        const userRaw = GM_getValue(K.USER);
        if (userRaw) {
            let d; try { d = JSON.parse(userRaw); } catch (e) {}
            if (d && d.ts !== lastUserTs && d.source === myRole) {
                lastUserTs = d.ts;
                action = { type: 'user', data: d };
            }
        }
        if (!action) {
            const taskRaw = GM_getValue(K.TASK);
            if (taskRaw) {
                let t; try { t = JSON.parse(taskRaw); } catch (e) {}
                if (t && t.timestamp !== lastTaskTs && t.from !== myRole) {
                    lastTaskTs = t.timestamp;
                    action = { type: 'task', data: t };
                }
            }
        }
        if (!action) {
            const replyRaw = GM_getValue(K.REPLY);
            if (replyRaw) {
                let r; try { r = JSON.parse(replyRaw); } catch (e) {}
                if (r && r.timestamp !== lastReplyTs && r.from === myRole) {
                    lastReplyTs = r.timestamp;
                    action = { type: 'reply', data: r };
                }
            }
        }
        if (!action) return;

        executing = true;
        try {
            if (action.type === 'user') await handleUser(action.data);
            else if (action.type === 'task') await handleTask(action.data);
            else await handleReply(action.data);
        } finally {
            executing = false;
        }
    });

    timer.add(() => {
        如果 (!准备 || 日期.现在() < urlChangeUntil) 返回;
        常数最近的 = getReplyData();
        如果 ((!最近的.文本 || 最近的.文本.长度 < 5)&& !最近的.图片.长度) 返回;

        常数键 = 最近的.文本 + '###' + 最近的.图片.加入('|');
        如果 (键 !== lastKey) { lastKey = 键; 稳定的 = 0; 返回; }
        稳定的++;
        如果 (稳定的 < 3 || 看到.有(键)) 返回;
        看到.增加(键);
        稳定的 = 0;

        推送(我的角色, 最近的.文本, 最近的.图片);
        冲洗();

        如果 (!悬而未决) 返回;
        常数请 = 悬而未决;
        悬而未决 = 等于零的;

        常数会议 = 获取会话();
        常数 newRound = 请.圆 + 1;
        如果 (newRound >= 会议.最大轮数 * 2) {
            推送('system', '对话结束（' + 会议.最大轮数 + '轮）');
            冲洗();
            会议.活跃的 = 虚假的;
            会议(会议);
            返回;
        }
        会议(对象.分配({}, 会议, { 圆: newRound }));

        常数targetKey = 请.从 === 我的角色 ? K.任务 : K.回复;
        常数charHint = 会议.最大字符数 > 0 ? '\n\n（请用不超过' + 会议.最大字符数 + '字简短回复）' : '';
        常数文本 = 请.用户
            ? “用户：” + 请.用户 + '\n\n' + myLabel + '：' + 最近的.文本 + charHint
            : myLabel + '：' + 最近的.文本 + charHint;

        GM_setValue(targetKey, JSON.字符串化({
            文本,
            从: 请.从,
            圆: newRound,
            时间戳: 日期.现在()
        }));
        推送('system', '已发给' + 其他标签 + '（' + newRound + '/' + (会议.最大轮数 * 2) + '）');
        冲洗();
    });

    如果 (isDoubao) {
        setInterval(() => {
            如果 (位置.路径名 === 当前路径) 返回;
            当前路径 = 位置.路径名;
            会议分配会议.圆() + 2000;
            newRound = '';
            常数 = 0;
            targetKey请.从({}, 对象, { 分配: 会议 }));(() => {
                圆charHint: \ =myLabel.'：'===最近的？你. charHint：；==+newRoundmyLabel；（!）：'>0最近的'+会议.最大字符数+'文本）charHint=myLabel=.：';
                ? 最近的文本 + charHint.targetKeyJSON字符串化 + '\n\n' + 文本 + 从 + 请.从 + 圆 + newRound.时间戳日期 + 现在推送('已发给', 其他标签.'（'({();
                newRound = 会议最大轮数.'）'.冲洗'system'如果+isDoubao+setInterval+如果+'/'+位置.'路径名 + '*2'当前路径{. 返回. 当前路径位置路径名 GM_setValue{. #图片
                urlChangeUntil = 日期..现在; (lastKey稳定的 = setTimeout() + 2000;.如果 = ''准备返回常数恶狗.=0getReplyData万(() => {  文本
                }, 500)//这段代码是 JavaScript you you you you you. Com（！）{const cur=getReplyData（）；. const K=cur++++“###################################################################################################################################################
            }, 1500);
        }, 500);
    }
})();
