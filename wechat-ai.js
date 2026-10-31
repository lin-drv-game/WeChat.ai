// ==UserScript==
// @name         爱聊 (WeChat.ai)
// @namespace    wechat.ai
// @version      1.2.0
// @description  微信风格的豆包与 DeepSeek 实时群聊脚本
// @match        https://www.doubao.com/*
// @match        https://chat.deepseek.com/*
// @require      https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js
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
    const otherLabel = isDoubao ? 'DeepSeek' : '豆包';

    const K = {
        TASK: 'wechat_ai_task_deepseek',
        REPLY: 'wechat_ai_reply_deepseek',
        MSGS: 'wechat_ai_messages',
        USER: 'wechat_ai_user_msg',
        BG: 'wechat_ai_bg',
        SESS: 'wechat_ai_session',
        THINKING: 'wechat_ai_thinking'
    };
    const MAX_ROUNDS = 1;
    const MAX_CHARS = 100;
    const ANIM_MS = 220;
    const MIN_SNAP_PX = 15;
    const IMG_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,image/bmp,image/heic,image/heif,image/*';

    const DS_AVATAR_URL = 'https://avatars.githubusercontent.com/u/148330874?v=4';
    const DB_AVATAR_URL = 'https://lf-flow-web-cdn.doubao.com/obj/flow-doubao/doubao/chat/favicon-doubao.png';

    const AVATARS = {
        user: { img: 'https://lh3.googleusercontent.com/a/default-user=s100', text: 'U', bg: '#07c160' },
        doubao: { img: DB_AVATAR_URL, text: '包', bg: '#f5a623' },
        deepseek: { img: DS_AVATAR_URL, text: '鲸', bg: '#4a6cf7' }
    };
    ['user', 'doubao', 'deepseek'].forEach(k => {
        const s = GM_getValue('wechat_ai_avatar_' + k);
        if (s) AVATARS[k].img = s;
    });

    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const GROUP_PROMPT = role => `系统提示：当前是一个多AI群聊，参与者有用户、豆包和DeepSeek。你现在是${role},请简短回复。\n\n`;

    const getSession = () => {
        try { return Object.assign({ round: 0, maxRounds: MAX_ROUNDS, maxChars: MAX_CHARS, active: false }, JSON.parse(GM_getValue(K.SESS) || '{}')); }
        catch (e) { return { round: 0, maxRounds: MAX_ROUNDS, maxChars: MAX_CHARS, active: false }; }
    };
    const setSession = s => GM_setValue(K.SESS, JSON.stringify(s));
    const resetSession = () => setSession({ round: 0, maxRounds: MAX_ROUNDS, maxChars: MAX_CHARS, active: true });

    const getThinking = () => {
        try { return Object.assign({ active: false, startTime: 0, duration: 0 }, JSON.parse(GM_getValue(K.THINKING) || '{}')); }
        catch (e) { return { active: false, startTime: 0, duration: 0 }; }
    };
    const setThinking = t => GM_setValue(K.THINKING, JSON.stringify(t));

    const getMessages = () => {
        try { const a = JSON.parse(GM_getValue(K.MSGS)); return Array.isArray(a) ? a : []; } catch (e) { return []; }
    };
    
    const pushMessage = (who, text, images, extra) => {
        const msgs = getMessages();
        
        if (who !== 'user' && who !== 'system' && msgs.length > 0) {
            const last = msgs[msgs.length - 1];
            if (last.who === who && Date.now() - last.ts < 13500) {
                last.text = text || '';
                last.images = images || [];
                last.ts = Date.now() + Math.random();
                if (extra) {
                    if (extra.thinkingMs !== undefined) last.thinkingMs = extra.thinkingMs;
                } else {
                    delete last.thinkingMs;
                }
                GM_setValue(K.MSGS, JSON.stringify(msgs));
                return;
            }
        }

        if (who === 'system' && msgs.length > 0) {
            const last = msgs[msgs.length - 1];
            if (last.who === 'system' && last.text === text && Date.now() - last.ts < 5000) return;
        }
        
        msgs.push(Object.assign({ who, text: text || '', images: images || [], ts: Date.now() + Math.random() }, extra || {}));
        GM_setValue(K.MSGS, JSON.stringify(msgs));
    };

    function resizeImage(file, maxSide, quality, square) {
        return new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onerror = reject;
            r.onload = () => {
                const img = new Image();
                img.onerror = reject;
                img.onload = () => {
                    const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d');
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
                    resolve(canvas.toDataURL('image/jpeg', quality || 0.75));
                };
                img.src = r.result;
            };
            r.readAsDataURL(file);
        });
    }

    function pickFile(accept, cb) {
        const input = document.createElement('input');
        input.type = 'file'; input.accept = accept; input.style.display = 'none';
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
            if (who === 'deepseek') {
                const thinkAv = document.querySelector('#wechat-ai-thinking .wechat-ai-avatar');
                if (thinkAv) thinkAv.style.backgroundImage = `url("${url}")`;
            }
        });
    }

    function pickUserImage() {
        pickFile(IMG_ACCEPT, async f => {
            const url = await resizeImage(f, 480, 0.7);
            resetSession();
            setThinking({ active: false, duration: 0 });
            lastThinkingKey = '';
            stopThinking();
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

    async function setTextarea(el, text) {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
        setter.call(el, ''); el.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(60);
        setter.call(el, text); el.dispatchEvent(new Event('input', { bubbles: true }));
    }

    async function typeIntoDoubao(text) {
        const editors = [...document.querySelectorAll('div[contenteditable="true"], [role="textbox"]')];
        let editor = null;
        for (const e of editors) {
            const r = e.getBoundingClientRect();
            if (r.width > 100 && r.height > 20 && r.top > 0) { editor = e; break; }
        }
        if (!editor) editor = document.querySelector('div[contenteditable="true"]');

        if (editor) {
            editor.focus();
            const sel = window.getSelection(), range = document.createRange();
            range.selectNodeContents(editor); sel.removeAllRanges(); sel.addRange(range);
            document.execCommand('delete', false, null);
            await sleep(150);

            const dt = new DataTransfer(); dt.setData('text/plain', text);
            editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
            await sleep(300);
            if ((editor.innerText || '').trim().length > 0) return true;

            document.execCommand('insertText', false, text);
            await sleep(300);
            if ((editor.innerText || '').trim().length > 0) return true;

            editor.innerHTML = '';
            const p = document.createElement('p');
            p.textContent = text;
            editor.appendChild(p);
            editor.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: text, bubbles: true, cancelable: false }));
            editor.dispatchEvent(new Event('change', { bubbles: true }));
            await sleep(300);
            return !!(editor.innerText || '').trim();
        }

        const ta = document.querySelector('textarea');
        if (ta && ta.offsetParent !== null) { await setTextarea(ta, text); return true; }
        return false;
    }

    async function pasteImageToDoubao(base64) {
        try {
            const blob = await (await fetch(base64)).blob();
            const file = new File([blob], 'image_' + Date.now() + '.jpg', { type: 'image/jpeg' });
            const editor = document.querySelector('div[contenteditable="true"]');
            if (!editor) return false;
            editor.focus(); await sleep(200);
            const dt = new DataTransfer(); dt.items.add(file);
            editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
            return true;
        } catch (e) { return false; }
    }

    async function typeIntoDeepseek(text) {
        const ta = document.querySelector('textarea#chat-input') || document.querySelector('textarea');
        if (!ta) return false;
        await setTextarea(ta, text); return true;
    }

    const typeIntoMyAI = text => isDoubao ? typeIntoDoubao(text) : typeIntoDeepseek(text);
    const pressEnter = el => ['keydown', 'keyup'].forEach(t => el.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true })));
    const isEnabled = el => el && !el.disabled && el.getAttribute('aria-disabled') !== 'true' && el.offsetParent !== null;

    function findSendBtn(editorEl) {
        const labeled = [...document.querySelectorAll('[aria-label]')];
        for (const b of labeled) { const l = (b.getAttribute('aria-label') || '').trim(); if ((l === '发送' || l.toLowerCase() === 'send') && isEnabled(b)) return b; }
        for (const b of labeled) { const l = (b.getAttribute('aria-label') || '').trim(); if (/^(发送|send)/i.test(l) && isEnabled(b)) return b; }
        if (editorEl) {
            let p = editorEl.parentElement;
            for (let i = 0; i < 8 && p; i++) {
                const btns = [...p.querySelectorAll('button, div[role="button"], div[class*="send"]')].filter(isEnabled);
                if (btns.length) return btns[btns.length - 1];
                p = p.parentElement;
            }
        }
        const icons = [...document.querySelectorAll('svg')];
        for (const icon of icons) {
            if (icon.innerHTML.includes('send') || icon.innerHTML.includes('发送') || icon.classList.contains('send')) {
                const btn = icon.closest('button, div[role="button"]');
                if (btn && isEnabled(btn)) return btn;
            }
        }
        return [...document.querySelectorAll('button, div[role="button"]')].find(b => (b.innerText || '').trim() === '发送' && isEnabled(b)) || null;
    }

    async function waitAndClickSend(editorEl, timeout = 5000) {
        if (editorEl && editorEl.focus) { try { editorEl.focus(); } catch (e) {} await sleep(300); }
        const start = Date.now();
        while (Date.now() - start < timeout) {
            const btn = findSendBtn(editorEl);
            if (btn) { btn.click(); return true; }
            await sleep(200);
        }
        if (editorEl) { pressEnter(editorEl); return true; }
        return false;
    }

    function readLatest(selectors) {
        for (const sel of selectors) {
            const els = document.querySelectorAll(sel);
            if (!els.length) continue;
            
            const el = els[els.length - 1];
            const clone = el.cloneNode(true);
            
            clone.querySelectorAll('button, svg, [class*="copy"], [class*="download"], [class*="banner"], [class*="header"]').forEach(n => n.remove());
            
            const pres = [...clone.querySelectorAll('pre')];
            pres.forEach(pre => {
                const codeEl = pre.querySelector('code');
                let codeText = codeEl ? codeEl.innerText : pre.innerText;
                let lang = 'text';
                
                let parent = pre.parentElement;
                if (parent) {
                    const langMatch = parent.innerText.match(/^(python|javascript|java|cpp|c|go|rust|php|sql|html|css|bash|shell|json|typescript|ts|js)\b/i);
                    if (langMatch) lang = langMatch[1].toLowerCase();
                }
                
                if (lang === 'text') {
                    if (codeText.includes('print(') || codeText.includes('def ') || codeText.includes('import ')) lang = 'python';
                    else if (codeText.includes('function') || codeText.includes('const ') || codeText.includes('let ') || codeText.includes('console.log')) lang = 'javascript';
                    else if (codeText.includes('#include')) lang = 'cpp';
                    else if (codeText.includes('public class') || codeText.includes('public static void')) lang = 'java';
                    else if (codeText.includes('<html>') || codeText.includes('<div>')) lang = 'html';
                }
                
                const mdCode = `\n\`\`\`${lang}\n${codeText}\n\`\`\`\n`;
                const textNode = document.createTextNode(mdCode);
                pre.parentNode.replaceChild(textNode, pre);
            });

            let t = (clone.innerText || '').trim()
                .replace(/\n?复制\n?下载\n?/g, '\n')
                .replace(/\n?复制\n?/g, '\n')
                .replace(/\n?下载\n?/g, '\n')
                .replace(/\n{3,}/g, '\n\n');
                
            if (t) return t;
        }
        return '';
    }

    function extractImages(container) {
        if (!container) return [];
        const candidates = [];
        for (const img of container.querySelectorAll('img')) {
            if (!img.complete || img.naturalWidth < 80 || img.naturalHeight < 80) continue;
            const a = img.closest('a');
            const src = (a ? a.href : null) || img.getAttribute('data-src') || img.getAttribute('data-original') || img.currentSrc || img.src || '';
            if (!src || src.startsWith('blob:')) continue;
            if (src.startsWith('data:') && src.length < 500) continue;
            if (/avatar|icon|emoji|logo|badge|gift|skeleton|placeholder|loading|spinner/i.test(src)) continue;
            if (/avatar|icon|emoji|logo|badge/i.test(img.className || '')) continue;
            const r = img.getBoundingClientRect();
            if (r.width < 30 || r.height < 30) continue;
            candidates.push({ src, area: img.naturalWidth * img.naturalHeight, left: r.left, top: r.top, right: r.right, bottom: r.bottom });
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
                    placed = true; break;
                }
            }
            if (!placed) groups.push({ src: c.src, area: c.area, left: c.left, top: c.top, right: c.right, bottom: c.bottom });
        }
        return groups.map(g => g.src);
    }

    function getReplyData() {
        let text = readLatest(isDoubao ? ['[data-testid="message_text_content"]', '[class*="message-content"]', '[class*="markdown-body"]'] : ['div[class*="ds-markdown"]', 'div[class*="markdown"]']);
        
        if (text && (text.includes('系统提示：当前是一个多AI群聊') || text.includes('User：'))) {
            return { text: '', images: [] };
        }

        let images = [];
        if (isDoubao) {
            const els = document.querySelectorAll('[data-testid="message_text_content"]');
            if (els.length) {
                let c = els[els.length - 1];
                for (let i = 0; i < 6 && c; i++) { images = extractImages(c); if (images.length) break; c = c.parentElement; }
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

    const getMyInputBox = () => isDoubao ? document.querySelector('div[contenteditable="true"]') || document.querySelector('textarea') : document.querySelector('textarea#chat-input') || document.querySelector('textarea');

    GM_addStyle(`
        #wechat-ai-ui { position: fixed; right: 20px; bottom: 20px; width: 92vw; max-width: 380px; height: 55vh; max-height: 480px; background: #f5f5f5; border: 1px solid #ddd; border-radius: 12px; z-index: 99999; display: flex; flex-direction: column; font-family: -apple-system, sans-serif; font-size: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.12); overflow: hidden; color: #222 !important; transform: translateZ(0); }
        #wechat-ai-ui.wechat-ai-anim { transition: left ${ANIM_MS}ms cubic-bezier(0.4,0,0.2,1), top ${ANIM_MS}ms cubic-bezier(0.4,0,0.2,1), width ${ANIM_MS}ms cubic-bezier(0.4,0,0.2,1), height ${ANIM_MS}ms cubic-bezier(0.4,0,0.2,1), border-radius ${ANIM_MS}ms cubic-bezier(0.4,0,0.2,1), background ${ANIM_MS}ms cubic-bezier(0.4,0,0.2,1), box-shadow ${ANIM_MS}ms cubic-bezier(0.4,0,0.2,1); }
        #wechat-ai-ui.wechat-ai-gesture { will-change: left, top, width, height; }
        
        #wechat-ai-ui.wechat-ai-edge { overflow: visible !important; }
        #wechat-ai-ui.wechat-ai-edge::after { content: ''; position: absolute; top: 0; bottom: 0; width: 30px; z-index: 1; }
        #wechat-ai-ui.wechat-ai-edge.wechat-ai-snap-left::after { left: 0; }
        #wechat-ai-ui.wechat-ai-edge.wechat-ai-snap-right::after { right: 0; }

        .wechat-ai-edge .resize-handle { display: none !important; }
        .resize-handle { position: absolute; z-index: 20; }
        .rh-n { top: -4px; left: 0; right: 0; height: 8px; cursor: n-resize; }
        .rh-s { bottom: -4px; left: 0; right: 0; height: 8px; cursor: s-resize; }
        .rh-e { top: 0; bottom: 0; right: -4px; width: 8px; cursor: e-resize; }
        .rh-w { top: 0; bottom: 0; left: -4px; width: 8px; cursor: w-resize; }
        .rh-ne { top: -4px; right: -4px; width: 12px; height: 12px; cursor: ne-resize; }
        .rh-nw { top: -4px; left: -4px; width: 12px; height: 12px; cursor: nw-resize; }
        .rh-se { bottom: -4px; right: -4px; width: 12px; height: 12px; cursor: se-resize; }
        .rh-sw { bottom: -4px; left: -4px; width: 12px; height: 12px; cursor: sw-resize; }
        
        #wechat-ai-dragbar { height: 28px; background: #ebebeb; display: flex; align-items: center; padding: 0 4px 0 12px; font-size: 11px; color: #666 !important; cursor: move; user-select: none; border-bottom: 1px solid #ddd; flex-shrink: 0; touch-action: none; border-radius: 12px 12px 0 0; }
        #wechat-ai-dragzone { flex: 1; text-align: center; pointer-events: none; color: #999 !important; font-weight: 500; }
        #wechat-ai-winbtns { display: flex; gap: 2px; flex-shrink: 0; }
        
        .wechat-ai-winbtn { position: relative; width: 32px; height: 24px; border: none; background: transparent; color: #777 !important; font-size: 14px; cursor: pointer; border-radius: 4px; padding: 0; line-height: 1; font-family: inherit; touch-action: manipulation; transition: all 0.15s ease; }
        .wechat-ai-winbtn:hover { background: rgba(0,0,0,0.08); color: #222 !important; }
        .wechat-ai-winbtn:active { transform: scale(0.9); }
        .wechat-ai-winbtn[data-tip]::after { content: attr(data-tip); position: absolute; top: 30px; left: 50%; transform: translateX(-50%) translateY(-10px); background: rgba(30,30,30,0.85); color: #fff; padding: 4px 8px; border-radius: 4px; font-size: 11px; white-space: nowrap; pointer-events: none; opacity: 0; transition: all 0.2s ease; z-index: 100; box-shadow: 0 2px 8px rgba(0,0,0,0.15); }
        .wechat-ai-winbtn[data-tip]:hover::after { opacity: 1; transform: translateX(-50%) translateY(0); }

        #wechat-ai-messages { position: relative; flex: 1 1 0; min-height: 0; height: 0; overflow-y: auto; padding: 10px; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; background-size: cover; background-position: center; background-repeat: no-repeat; }
        
        #wechat-ai-pc-refresh-tip { position: absolute; top: 0; left: 0; right: 0; height: 32px; background: rgba(7,193,96,0.9); color: #fff !important; font-size: 12px; display: flex; align-items: center; justify-content: center; transform: translateY(-40px); transition: transform 0.25s cubic-bezier(0.4,0,0.2,1), background 0.2s; z-index: 15; font-weight: 500; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
        #wechat-ai-pc-refresh-tip.show { transform: translateY(0); }

        .wechat-ai-row { display: flex; align-items: flex-start; margin: 8px 0; gap: 8px; }
        .wechat-ai-row.wechat-ai-right { flex-direction: row-reverse; }
        .wechat-ai-avatar { width: 28px; height: 28px; border-radius: 50%; flex-shrink: 0; background-size: cover; background-position: center; background-color: #ccc; display: flex; align-items: center; justify-content: center; font-size: 11px; color: #fff !important; font-weight: bold; overflow: hidden; cursor: pointer; }
        
        .wechat-ai-bubble { max-width: 80%; padding: 8px 10px; border-radius: 8px; word-break: break-word; line-height: 1.5; font-size: 12px; color: #222 !important; background: #fff; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
        .wechat-ai-bubble > div { color: #222 !important; }
        .wechat-ai-user .wechat-ai-bubble { background: #95ec69; color: #111 !important; }
        .wechat-ai-user .wechat-ai-bubble > div { color: #111 !important; }
        .wechat-ai-doubao .wechat-ai-bubble { background: #fff; border: 1px solid #eee; color: #222 !important; }
        .wechat-ai-deepseek .wechat-ai-bubble { background: #e8eeff; color: #1a2340 !important; }
        .wechat-ai-deepseek .wechat-ai-bubble > div { color: #1a2340 !important; }
        
        .wechat-ai-image-only { background: transparent !important; padding: 0 !important; border: none !important; box-shadow: none !important; }
        .wechat-ai-bubble img.wechat-ai-img { display: block; max-width: 100%; max-height: 200px; height: auto; object-fit: contain; border-radius: 6px; margin-top: 6px; cursor: zoom-in; }
        .wechat-ai-bubble img.wechat-ai-img:first-child { margin-top: 0; }
        .wechat-ai-bubble img.wechat-ai-img.wechat-ai-img-small { width: 80px !important; height: 80px !important; max-width: 80px !important; max-height: 80px !important; object-fit: cover; }
        .wechat-ai-system { text-align: center; font-size: 10px; color: #aaa !important; margin: 8px 0; }
        .wechat-ai-think-info { font-size: 10px; color: #aaa !important; margin-bottom: 4px; font-weight: normal; }
        #wechat-ai-thinking { display: none; }
        #wechat-ai-thinking .wechat-ai-thinking-text { font-size: 11px; color: #888 !important; margin-top: 6px; }
        
        #wechat-ai-input-area { display: flex; border-top: 1px solid #ddd; flex-shrink: 0; background: #fff; border-radius: 0 0 12px 12px; }
        #wechat-ai-plus { border: none; background: transparent; color: #888 !important; padding: 0 12px; cursor: pointer; font-size: 18px; font-weight: bold; line-height: 1; font-family: inherit; transition: color 0.15s; }
        #wechat-ai-plus:hover { color: #07c160 !important; }
        #wechat-ai-input { flex: 1; border: none; padding: 10px; outline: none; font-size: 12px; background: transparent; color: #222 !important; min-width: 0; }
        #wechat-ai-input::placeholder { color: #bbb !important; }
        #wechat-ai-send { border: none; background: #07c160; color: #fff !important; padding: 8px 16px; cursor: pointer; font-size: 12px; flex-shrink: 0; border-radius: 0 0 12px 0; transition: background 0.15s; }
        #wechat-ai-send:hover { background: #06ad56; }
        
        #wechat-ai-toggle { position: fixed; right: 20px; bottom: 20px; width: 44px; height: 44px; border-radius: 50%; background: #07c160; color: #fff !important; border: none; font-size: 18px; z-index: 99999; cursor: pointer; display: none; box-shadow: 0 4px 12px rgba(0,0,0,0.15); }
        
        #wechat-ai-bg-menu { position: fixed; background: #fff; border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,0.15); padding: 4px; z-index: 100001; display: flex; flex-direction: column; gap: 2px; min-width: 120px; }
        #wechat-ai-bg-menu button { border: none; background: transparent; padding: 8px 12px; font-size: 12px; color: #333 !important; cursor: pointer; border-radius: 4px; text-align: left; font-family: inherit; transition: background 0.15s; }
        #wechat-ai-bg-menu button:hover { background: #f5f5f5; }
        #wechat-ai-bg-mask { position: fixed; left: 0; top: 0; right: 0; bottom: 0; background: transparent; z-index: 100000; }
        
        #wechat-ai-tooltip { display: none; position: absolute; background: rgba(30,30,30,0.85); color: #fff; padding: 6px 10px; border-radius: 6px; font-size: 11px; white-space: nowrap; pointer-events: none; z-index: 100000; top: 50%; transform: translateY(-50%); box-shadow: 0 2px 8px rgba(0,0,0,0.15); }
        #wechat-ai-ui.wechat-ai-edge:hover #wechat-ai-tooltip { display: block; }

        #wechat-ai-snap-layouts { position: fixed; left: 50%; top: 12px; transform: translateX(-50%); background: rgba(28, 28, 30, 0.75); border-radius: 12px; padding: 12px; display: none; gap: 16px; z-index: 999999; box-shadow: 0 12px 48px rgba(0,0,0,0.4); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); border: 1px solid rgba(255,255,255,0.15); }
        
        .snap-group-wrap { position: relative; }
        .snap-group { width: 100px; height: 64px; display: flex; gap: 4px; background: rgba(0,0,0,0.2); padding: 4px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1); cursor: pointer; transition: all 0.2s ease; }
        .snap-group-wrap:hover .snap-group { background: rgba(0,0,0,0.4); border-color: rgba(255,255,255,0.3); transform: scale(1.05); }
        
        .snap-zone { background: rgba(255,255,255,0.15); border-radius: 4px; transition: all 0.15s; height: 100%; }
        .snap-zone:hover { background: rgba(7,193,96,0.85); box-shadow: 0 0 12px rgba(7,193,96,0.5); }
        
        .snap-label { position: absolute; top: 110%; left: 50%; transform: translateX(-50%); background: rgba(0,0,0,0.85); color: #fff; font-size: 11px; padding: 4px 8px; border-radius: 4px; white-space: nowrap; pointer-events: none; opacity: 0; transition: opacity 0.2s; z-index: 10; border: 1px solid rgba(255,255,255,0.1); }
        .snap-group-wrap:hover .snap-label { opacity: 1; }

        .wechat-ai-code-block { margin: 6px 0; border-radius: 6px; overflow: hidden; background: #0d1117; border: 1px solid #30363d; }
        .wechat-ai-code-header { display: flex; justify-content: space-between; align-items: center; background: #161b22; padding: 4px 8px; font-size: 10px; color: #8b949e !important; user-select: none; border-bottom: 1px solid #30363d; }
        .wechat-ai-code-lang { text-transform: uppercase; }
        .wechat-ai-code-copy { background: transparent; border: 1px solid #30363d; color: #c9d1d9 !important; border-radius: 4px; padding: 2px 8px; cursor: pointer; font-size: 10px; font-family: inherit; }
        .wechat-ai-code-copy:active { background: rgba(255,255,255,0.1); }
        .wechat-ai-code-block pre { margin: 0; padding: 10px; overflow-x: auto; }
        .wechat-ai-code-block code { font-family: Consolas, Monaco, 'Andale Mono', 'Ubuntu Mono', monospace; font-size: 11px; background: transparent !important; padding: 0 !important; color: #c9d1d9 !important; }
        
        .wechat-ai-code-block .hljs-keyword, .wechat-ai-code-block .hljs-built_in, .wechat-ai-code-block .hljs-type, .wechat-ai-code-block .hljs-literal, .wechat-ai-code-block .hljs-number, .wechat-ai-code-block .hljs-regexp, .wechat-ai-code-block .hljs-symbol, .wechat-ai-code-block .hljs-bullet, .wechat-ai-code-block .hljs-link, .wechat-ai-code-block .hljs-meta { color: #ff7b72 !important; }
        .wechat-ai-code-block .hljs-title, .wechat-ai-code-block .hljs-section, .wechat-ai-code-block .hljs-title.function_, .wechat-ai-code-block .hljs-selector-id { color: #d2a8ff !important; }
        .wechat-ai-code-block .hljs-string, .wechat-ai-code-block .hljs-doctag, .wechat-ai-code-block .hljs-attr, .wechat-ai-code-block .hljs-attribute { color: #a5d6ff !important; }
        .wechat-ai-code-block .hljs-comment, .wechat-ai-code-block .hljs-quote { color: #8b949e !important; }
        .wechat-ai-code-block .hljs-variable, .wechat-ai-code-block .hljs-template-variable, .wechat-ai-code-block .hljs-selector-class, .wechat-ai-code-block .hljs-selector-attr, .wechat-ai-code-block .hljs-selector-pseudo { color: #ffa657 !important; }
        .wechat-ai-code-block .hljs-params { color: #c9d1d9 !important; }
    `);

    let state = 'normal', savedRect = null, rendered = 0, thinkingTimer = null, lastThinkingKey = '';

    function readRect(el) { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; }
    function applyRect(el, r, animate) {
        if (!r) return;
        if (animate) el.classList.add('wechat-ai-anim');
        Object.assign(el.style, { right: 'auto', bottom: 'auto', maxWidth: 'none', maxHeight: 'none', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
        if (animate) setTimeout(() => el.classList.remove('wechat-ai-anim'), ANIM_MS + 20);
    }
    function setInnerVisible(v) {
        ['wechat-ai-dragbar', 'wechat-ai-messages', 'wechat-ai-input-area'].forEach(id => {
            const el = document.getElementById(id); if (el) el.style.display = v ? '' : 'none';
        });
    }
    function updateBtns() {
        const min = document.getElementById('wechat-ai-min'), max = document.getElementById('wechat-ai-max');
        if (!min || !max) return;
        min.textContent = (state === 'min' || state === 'edge-l' || state === 'edge-r') ? '▣' : '—';
        max.textContent = state === 'max' ? '❐' : '□';
        
        min.setAttribute('data-tip', (state === 'min' || state === 'edge-l' || state === 'edge-r') ? '还原' : '最小化');
        max.setAttribute('data-tip', state === 'max' ? '向下还原' : '最大化');
    }
    const setState = next => { state = next; updateBtns(); };

    function computeSnap(left, width) {
        if (left < MIN_SNAP_PX) return 'left';
        if (left + width > window.innerWidth - MIN_SNAP_PX) return 'right';
        return null;
    }
    const clearSnapHints = el => el.classList.remove('wechat-ai-snap-left', 'wechat-ai-snap-right');

    function snapToEdge(el, side) {
        clearSnapHints(el); 
        el.classList.add('wechat-ai-edge');
        el.classList.add(side === 'left' ? 'wechat-ai-snap-left' : 'wechat-ai-snap-right');
        setState(side === 'left' ? 'edge-l' : 'edge-r');
        
        const vh = window.innerHeight, h = Math.min(vh * 0.3, 200), top = Math.max(20, (vh - h) / 2);
        el.classList.add('wechat-ai-anim');
        Object.assign(el.style, { width: '6px', top: top + 'px', height: h + 'px', borderRadius: side === 'left' ? '0 4px 4px 0' : '4px 0 0 4px', background: 'rgba(7,193,96,0.65)', border: 'none', boxShadow: '0 0 8px rgba(7,193,96,0.35)', maxWidth: 'none', maxHeight: 'none', cursor: 'pointer', touchAction: 'none' });
        
        if (side === 'left') { 
            el.style.left = '0px'; el.style.right = 'auto'; 
            const tt = document.getElementById('wechat-ai-tooltip');
            if (tt) { tt.style.left = '16px'; tt.style.right = 'auto'; }
        } else { 
            el.style.right = '0px'; el.style.left = 'auto'; 
            const tt = document.getElementById('wechat-ai-tooltip');
            if (tt) { tt.style.right = '16px'; tt.style.left = 'auto'; }
        }
        
        setInnerVisible(false);
        setTimeout(() => el.classList.remove('wechat-ai-anim'), ANIM_MS + 20);
    }

    function restoreFromEdge(el, animate) {
        setInnerVisible(true); 
        clearSnapHints(el);
        el.classList.remove('wechat-ai-edge');
        Object.assign(el.style, { background: '#f5f5f5', border: '1px solid #ddd', boxShadow: '0 8px 24px rgba(0,0,0,0.12)', borderRadius: '12px', cursor: '', touchAction: '' });
        setState('normal'); 
        el.classList.remove('wechat-ai-anim'); 
        applyRect(el, savedRect, animate);
    }

    function toggleMin(el) {
        clearSnapHints(el);
        if (state === 'edge-l' || state === 'edge-r' || state === 'min') { 
            restoreFromEdge(el, true); 
            return; 
        }
        if (state === 'normal') savedRect = readRect(el);
        snapToEdge(el, 'right');
    }

    function toggleMax(el) {
        clearSnapHints(el);
        if (state === 'edge-l' || state === 'edge-r') restoreFromEdge(el, false);
        if (state === 'max') { applyRect(el, savedRect, true); setState('normal'); return; }
        if (state === 'normal') savedRect = readRect(el);
        el.classList.add('wechat-ai-anim');
        Object.assign(el.style, { right: 'auto', bottom: 'auto', left: '4px', top: '4px', width: (window.innerWidth - 8) + 'px', height: (window.innerHeight - 8) + 'px', maxWidth: 'none', maxHeight: 'none' });
        setState('max'); setTimeout(() => el.classList.remove('wechat-ai-anim'), ANIM_MS + 20);
    }

    function getSnapRect(type) {
        const vw = window.innerWidth, vh = window.innerHeight;
        switch(type) {
            case 'left-half': return { left: 0, top: 0, width: vw/2, height: vh };
            case 'right-half': return { left: vw/2, top: 0, width: vw/2, height: vh };
            case 'left-2-3': return { left: 0, top: 0, width: vw*0.66, height: vh };
            case 'right-1-3': return { left: vw*0.66, top: 0, width: vw*0.34, height: vh };
            case 'left-1-3': return { left: 0, top: 0, width: vw*0.34, height: vh };
            case 'right-2-3': return { left: vw*0.34, top: 0, width: vw*0.66, height: vh };
        }
        return null;
    }

    function setupSnapLayouts(panel) {
        const layouts = document.getElementById('wechat-ai-snap-layouts');
        
        panel._showLayouts = () => {
            if (state === 'max' || state === 'edge-l' || state === 'edge-r') return;
            layouts.style.display = 'flex';
        };

        panel._hideLayouts = () => {
            layouts.style.display = 'none';
        };
    }

    function bindGesture(handle, panel, handlers) {
        let active = false, lastX = 0, lastY = 0, rafPending = false;
        const flushMove = () => { rafPending = false; if (active) handlers.move(lastX, lastY); };
        const onMove = (x, y) => {
            lastX = x; lastY = y;
            if (!rafPending && active) { rafPending = true; requestAnimationFrame(flushMove); }
        };
        const down = (x, y) => {
            if (handlers.start(x, y) === false) return;
            active = true; lastX = x; lastY = y; panel.classList.add('wechat-ai-gesture');
        };
        const up = (e) => {
            if (!active) return;
            if (rafPending) { cancelAnimationFrame(flushMove); flushMove(); }
            active = false; panel.classList.remove('wechat-ai-gesture'); clearSnapHints(panel);
            if (handlers.end) handlers.end(e);
        };
        handle.addEventListener('mousedown', e => { down(e.clientX, e.clientY); });
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
                el.classList.remove('wechat-ai-anim');
                Object.assign(el.style, { right: 'auto', bottom: 'auto', left: sl + 'px', top: st + 'px' });
            },
            move(x, y) {
                let nl = sl + (x - sx), nt = st + (y - sy);
                nl = Math.max(-w0, Math.min(window.innerWidth, nl));
                nt = Math.max(0, Math.min(window.innerHeight - 28, nt));
                el.style.left = nl + 'px'; el.style.top = nt + 'px';
                
                if (nt <= 30 && el._showLayouts) el._showLayouts();
                else if (nt > 60 && el._hideLayouts) el._hideLayouts();

                const hint = computeSnap(nl, w0);
                el.classList.toggle('wechat-ai-snap-left', hint === 'left');
                el.classList.toggle('wechat-ai-snap-right', hint === 'right');
            },
            end(e) {
                let isInLayout = false;
                let snapType = null;
                const layouts = document.getElementById('wechat-ai-snap-layouts');
                
                if (layouts && layouts.style.display === 'flex') {
                    const x = e.clientX, y = e.clientY;
                    const rect = layouts.getBoundingClientRect();
                    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
                        const target = document.elementFromPoint(x, y);
                        const zone = target ? target.closest('.snap-zone') : null;
                        if (zone) {
                            snapType = zone.dataset.snap;
                            isInLayout = true;
                        }
                    }
                    if (el._hideLayouts) el._hideLayouts();
                }

                if (isInLayout && snapType) {
                    const r = getSnapRect(snapType);
                    if (r) {
                        applyRect(el, r, true);
                        savedRect = Object.assign({}, r);
                        setState('normal');
                        return;
                    }
                }

                const r = readRect(el), side = computeSnap(r.left, r.width);
                if (side) return snapToEdge(el, side);
                if (state === 'normal') {
                    const w = r.width; let fl = r.left;
                    if (fl < 0) fl = 0;
                    if (fl + w > window.innerWidth) fl = Math.max(0, window.innerWidth - w);
                    if (fl !== r.left) el.style.left = fl + 'px';
                    if (savedRect) { savedRect.left = fl; savedRect.top = r.top; }
                }
            }
        });
        handle.addEventListener('dblclick', e => { e.preventDefault(); toggleMax(el); });
        el.addEventListener('click', e => {
            if (state === 'edge-l' || state === 'edge-r') { e.preventDefault(); e.stopPropagation(); restoreFromEdge(el, true); }
        }, true);
    }

    function enableResize(el, handle) {
        const dir = handle.dataset.dir;
        let sx = 0, sy = 0, sw = 0, sh = 0, sl = 0, st = 0;
        bindGesture(handle, el, {
            start(x, y) {
                if (state === 'edge-l' || state === 'edge-r') return false;
                if (state === 'max') setState('normal');
                if (state === 'min') return false;
                const r = readRect(el);
                sx = x; sy = y; sw = r.width; sh = r.height; sl = r.left; st = r.top;
                savedRect = { left: r.left, top: r.top, width: r.width, height: r.height };
                el.classList.remove('wechat-ai-anim');
            },
            move(x, y) {
                const dx = x - sx, dy = y - sy;
                let newW = sw, newH = sh, newL = sl, newT = st;
                const minW = 280, minH = 200;
                if (dir.includes('e')) newW = Math.max(minW, sw + dx);
                if (dir.includes('w')) { newW = Math.max(minW, sw - dx); newL = sl + sw - newW; }
                if (dir.includes('s')) newH = Math.max(minH, sh + dy);
                if (dir.includes('n')) { newH = Math.max(minH, sh - dy); newT = st + sh - newH; }
                Object.assign(el.style, { left: newL + 'px', top: newT + 'px', width: newW + 'px', height: newH + 'px', maxWidth: 'none', maxHeight: 'none' });
                if (savedRect) { savedRect.left = newL; savedRect.top = newT; savedRect.width = newW; savedRect.height = newH; }
            },
            end() {}
        });
    }

    function openImageFull(src) {
        const w = window.open('');
        if (w) { w.document.write('<html><head><title>查看图片</title><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#000;display:flex;align-items:center;justify-content:center;min-height:100vh;"><img src="' + src + '" style="max-width:100%;max-height:100vh;"></body></html>'); w.document.close(); }
    }

    function startThinking() {
        stopThinking();
        const el = document.getElementById('wechat-ai-thinking');
        if (!el) return;
        el.style.display = 'flex';
        const textEl = el.querySelector('.wechat-ai-thinking-text');
        if (!textEl) return;
        const dots = ['.', '..', '...']; let idx = 0;
        textEl.textContent = '深度思考中.';
        thinkingTimer = setInterval(() => { idx = (idx + 1) % 3; textEl.textContent = '深度思考中' + dots[idx]; }, 450);
    }

    function stopThinking() {
        if (thinkingTimer) { clearInterval(thinkingTimer); thinkingTimer = null; }
        const el = document.getElementById('wechat-ai-thinking');
        if (el) el.style.display = 'none';
    }

    function checkThinking() {
        const t = getThinking();
        if (t.active) {
            const msgs = getMessages();
            if (Date.now() - t.startTime > 60000 || msgs.length === 0) {
                setThinking({ active: false, duration: 0 }); 
                lastThinkingKey = ''; 
                stopThinking(); 
                return;
            }
            const key = String(t.startTime);
            if (lastThinkingKey !== key) { lastThinkingKey = key; startThinking(); }
        } else if (lastThinkingKey) { lastThinkingKey = ''; stopThinking(); }
    }

    function fallbackCopy(text, btn) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.top = '-9999px';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        try {
            document.execCommand('copy');
            btn.textContent = '已复制';
        } catch (err) {
            btn.textContent = '失败';
        }
        ta.remove();
        setTimeout(() => btn.textContent = '复制', 2000);
    }

    function renderMarkdownContent(container, text) {
        const codeBlockRegex = /```(\w*)\n([\s\S]*?)(?:```|$)/g;
        let lastIndex = 0;
        let match;
        let hasCode = false;

        while ((match = codeBlockRegex.exec(text)) !== null) {
            hasCode = true;
            const textBefore = text.slice(lastIndex, match.index);
            if (textBefore.trim()) {
                const p = document.createElement('div');
                p.style.whiteSpace = 'pre-wrap';
                p.textContent = textBefore;
                container.appendChild(p);
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
            copyBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (navigator.clipboard) {
                    navigator.clipboard.writeText(code).then(() => {
                        copyBtn.textContent = '已复制';
                        setTimeout(() => copyBtn.textContent = '复制', 2000);
                    }).catch(() => {
                        fallbackCopy(code, copyBtn);
                    });
                } else {
                    fallbackCopy(code, copyBtn);
                }
            });

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
                try { window.hljs.highlightElement(codeEl); } catch (e) {}
            }

            lastIndex = match.index + match[0].length;
        }

        const textAfter = text.slice(lastIndex);
        if (textAfter.trim() || !hasCode) {
            const p = document.createElement('div');
            p.style.whiteSpace = 'pre-wrap';
            p.textContent = textAfter || text;
            container.appendChild(p);
        }
    }

    function renderMessage(msg) {
        const c = document.getElementById('wechat-ai-messages');
        if (!c) return;
        const { who, text, images, thinkingMs } = msg;
        if (who === 'system') {
            const s = document.createElement('div'); s.className = 'wechat-ai-system'; s.textContent = text; c.appendChild(s); c.scrollTop = c.scrollHeight; return;
        }
        const cfg = AVATARS[who] || AVATARS.doubao;
        const row = document.createElement('div'); row.className = 'wechat-ai-row wechat-ai-' + who + (who === 'user' ? ' wechat-ai-right' : '');
        const av = document.createElement('div'); av.className = 'wechat-ai-avatar';
        if (cfg.img) av.style.backgroundImage = `url("${cfg.img}")`;
        else { av.style.backgroundColor = cfg.bg; av.textContent = cfg.text; }
        av.addEventListener('click', () => pickAvatar(who, av));
        const b = document.createElement('div'); b.className = 'wechat-ai-bubble';

        if (who === 'deepseek' && thinkingMs > 0) {
            stopThinking(); setThinking({ active: false, duration: thinkingMs }); lastThinkingKey = '';
            const info = document.createElement('div'); info.className = 'wechat-ai-think-info';
            info.textContent = '已思考，用时 ' + Math.round(thinkingMs / 1000) + ' 秒'; b.appendChild(info);
        }

        const cleanText = (text || '').replace(/\n{3,}/g, '\n\n').trim();
        const uniq = [];
        if (images && images.length) { const seen = {}; for (const s of images) if (!seen[s]) { seen[s] = true; uniq.push(s); } }
        const hasText = cleanText.length > 0, hasImages = uniq.length > 0;
        if (!hasText && hasImages && !(who === 'deepseek' && thinkingMs > 0)) b.className += ' wechat-ai-image-only';
        
        if (hasText) {
            renderMarkdownContent(b, cleanText);
        }
        
        if (hasImages) {
            for (const src of uniq) {
                const img = document.createElement('img');
                img.className = 'wechat-ai-img' + (who === 'user' ? ' wechat-ai-img-small' : '');
                img.src = src; img.addEventListener('click', e => { e.stopPropagation(); openImageFull(src); });
                img.onload = () => { c.scrollTop = c.scrollHeight; }; img.onerror = () => img.remove();
                b.appendChild(img);
            }
        }
        row.appendChild(av); row.appendChild(b); c.appendChild(row); c.scrollTop = c.scrollHeight;
    }

    let lastMsgJson = '';
    function flush() {
        const c = document.getElementById('wechat-ai-messages'), msgs = getMessages();
        if (!c) return;

        const currentJson = JSON.stringify(msgs);

        if (msgs.length < rendered) {
            [...c.children].forEach(child => {
                if (child.id !== 'wechat-ai-thinking' && child.id !== 'wechat-ai-pc-refresh-tip') child.remove();
            });
            rendered = 0;
            lastMsgJson = '';
        }

        if (msgs.length > rendered || (msgs.length > 0 && currentJson !== lastMsgJson)) {
            if (msgs.length === rendered && msgs.length > 0) {
                const lastRow = c.querySelector('.wechat-ai-row:last-child');
                if (lastRow && lastRow.id !== 'wechat-ai-thinking') {
                    lastRow.remove();
                    rendered--;
                }
            }
            for (let i = rendered; i < msgs.length; i++) renderMessage(msgs[i]); 
            rendered = msgs.length; 
            lastMsgJson = currentJson;
        }

        const thinking = document.getElementById('wechat-ai-thinking');
        if (thinking) {
            if (!getThinking().active) { if (thinking.style.display !== 'none') stopThinking(); }
            else { 
                const lastEl = c.lastElementChild;
                if (lastEl !== thinking && lastEl?.id !== 'wechat-ai-pc-refresh-tip') {
                    c.appendChild(thinking); 
                    c.scrollTop = c.scrollHeight; 
                }
            }
        }
    }

    function clearChat(silent) {
        GM_setValue(K.MSGS, '[]');
        GM_setValue(K.USER, '');
        GM_setValue(K.TASK, '');
        GM_setValue(K.REPLY, '');
        GM_setValue(K.SESS, '');
        GM_setValue(K.THINKING, '');
        
        rendered = 0;
        lastMsgJson = '';
        const c = document.getElementById('wechat-ai-messages');
        if (c) {
            [...c.children].forEach(child => {
                if (child.id !== 'wechat-ai-thinking' && child.id !== 'wechat-ai-pc-refresh-tip') child.remove();
            });
        }
        stopThinking();
        lastThinkingKey = '';
        
        lastUserTs = 0;
        lastTaskTs = 0;
        lastReplyTs = 0;
        seen.clear();
        lastKey = '';
        stable = 0;
        
        if (!silent) {
            pushMessage('system', 'CLEAR_ALL');
        }
    }

    async function sendUserMessage() {
        const inp = document.getElementById('wechat-ai-input'); const text = inp.value.trim();
        if (!text) return;
        inp.value = ''; inp.blur(); await sleep(50);
        const old = getSession();
        if (old.active && old.round > 0) { pushMessage('system', '上轮对话未结束，已重置为新对话'); flush(); }
        resetSession(); 
        setThinking({ active: false, duration: 0 }); 
        lastThinkingKey = '';
        stopThinking();
        pushMessage('user', text); flush();
        GM_setValue(K.USER, JSON.stringify({ text, ts: Date.now(), source: myRole }));
    }

    function showBgMenu(x, y) {
        ['wechat-ai-bg-mask', 'wechat-ai-bg-menu'].forEach(id => { const el = document.getElementById(id); if (el) el.remove(); });
        const mask = document.createElement('div'); mask.id = 'wechat-ai-bg-mask'; document.body.appendChild(mask);
        const menu = document.createElement('div'); menu.id = 'wechat-ai-bg-menu';
        menu.innerHTML = '<button data-action="change">更换背景</button><button data-action="clear">恢复背景</button><button data-action="clear-chat" style="color:#e53935 !important;">清空对话</button><button data-action="cancel">取消操作</button>';
        
        menu.style.left = Math.min(window.innerWidth - 130, Math.max(10, x)) + 'px';
        menu.style.top = Math.min(window.innerHeight - 160, Math.max(10, y)) + 'px';

        document.body.appendChild(menu);
        const close = () => { mask.remove(); menu.remove(); };
        mask.addEventListener('click', close);
        menu.addEventListener('click', e => {
            const btn = e.target.closest('button'); if (!btn) return;
            const action = btn.getAttribute('data-action'); close();
            if (action === 'change') pickBackground();
            else if (action === 'clear') { const el = document.getElementById('wechat-ai-messages'); if (el) { el.style.backgroundImage = ''; GM_setValue(K.BG, ''); } }
            else if (action === 'clear-chat') { clearChat(); }
        });
    }

    function setupBgPicker() {
        const el = document.getElementById('wechat-ai-messages'); if (!el) return;
        const saved = GM_getValue(K.BG); if (saved) el.style.backgroundImage = `url("${saved}")`;
        
        el.addEventListener('contextmenu', e => {
            if (e.target.closest('.wechat-ai-avatar') || e.target.closest('.wechat-ai-bubble') || e.target.id === 'wechat-ai-pc-refresh-tip') return;
            e.preventDefault();
            showBgMenu(e.clientX, e.clientY);
        });
    }

    function setupScrollRefresh() {
        const scroller = document.getElementById('wechat-ai-messages');
        const tip = document.getElementById('wechat-ai-pc-refresh-tip');
        if (!scroller || !tip) return;
        
        let refreshing = false, scrollAccum = 0, timer = null;

        scroller.addEventListener('wheel', e => {
            if (refreshing) return;
            if (scroller.scrollTop <= 0 && e.deltaY < 0) {
                if (e.cancelable) e.preventDefault();
                scrollAccum -= e.deltaY;
                
                if (scrollAccum > 60) {
                    tip.classList.add('show');
                    if (scrollAccum > 150) {
                        tip.textContent = '松开鼠标刷新';
                        tip.style.background = 'rgba(7,193,96,1)';
                    } else {
                        tip.textContent = '继续上滑刷新';
                        tip.style.background = 'rgba(7,193,96,0.8)';
                    }
                }

                if (timer) clearTimeout(timer);
                timer = setTimeout(() => {
                    if (scrollAccum > 150) {
                        refreshing = true;
                        tip.textContent = '正在刷新...';
                        tip.style.transform = 'translateY(0)';
                        GM_setValue('wechat_ai_cmd_reload', Date.now());
                        setTimeout(() => { try { location.reload(); } catch (e) {} }, 600);
                    } else {
                        scrollAccum = 0;
                        tip.classList.remove('show');
                    }
                }, 300);
            } else {
                if (!refreshing) {
                    scrollAccum = 0;
                    tip.classList.remove('show');
                }
            }
        }, { passive: false });
    }

    function createUI() {
        if (document.getElementById('wechat-ai-ui')) return;
        const div = document.createElement('div'); div.id = 'wechat-ai-ui';
        div.innerHTML = `
            <div id="wechat-ai-dragbar">
                <div id="wechat-ai-dragzone">≡   WeChat.ai </div>
                <div id="wechat-ai-winbtns">
                    <button id="wechat-ai-min" class="wechat-ai-winbtn" data-tip="最小化">—</button>
                    <button id="wechat-ai-max" class="wechat-ai-winbtn" data-tip="最大化">□</button>
                </div>
            </div>
            <div id="wechat-ai-messages">
                <div id="wechat-ai-pc-refresh-tip">上滑刷新</div>
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
            <div id="wechat-ai-tooltip">Alt + w 召出</div>
            <div class="resize-handle rh-n" data-dir="n"></div>
            <div class="resize-handle rh-s" data-dir="s"></div>
            <div class="resize-handle rh-e" data-dir="e"></div>
            <div class="resize-handle rh-w" data-dir="w"></div>
            <div class="resize-handle rh-ne" data-dir="ne"></div>
            <div class="resize-handle rh-nw" data-dir="nw"></div>
            <div class="resize-handle rh-se" data-dir="se"></div>
            <div class="resize-handle rh-sw" data-dir="sw"></div>
        `;
        document.body.appendChild(div);

        const layouts = document.createElement('div');
        layouts.id = 'wechat-ai-snap-layouts';
        layouts.innerHTML = `
            <div class="snap-group-wrap">
                <div class="snap-group">
                    <div class="snap-zone" style="width:calc(50% - 2px);" data-snap="left-half"></div>
                    <div class="snap-zone" style="width:calc(50% - 2px);" data-snap="right-half"></div>
                </div>
                <div class="snap-label">左右平分</div>
            </div>
            <div class="snap-group-wrap">
                <div class="snap-group">
                    <div class="snap-zone" style="width:calc(66.6% - 2px);" data-snap="left-2-3"></div>
                    <div class="snap-zone" style="width:calc(33.3% - 2px);" data-snap="right-1-3"></div>
                </div>
                <div class="snap-label">左宽右窄</div>
            </div>
            <div class="snap-group-wrap">
                <div class="snap-group">
                    <div class="snap-zone" style="width:calc(33.3% - 2px);" data-snap="left-1-3"></div>
                    <div class="snap-zone" style="width:calc(66.6% - 2px);" data-snap="right-2-3"></div>
                </div>
                <div class="snap-label">左窄右宽</div>
            </div>
        `;
        document.body.appendChild(layouts);
        
        document.addEventListener('keydown', e => {
            if (e.altKey && e.key.toLowerCase() === 'w') {
                const ui = document.getElementById('wechat-ai-ui');
                if (!ui) return;
                if (state === 'edge-l' || state === 'edge-r' || state === 'min') {
                    restoreFromEdge(ui, true);
                } else if (ui.style.display === 'none') {
                    ui.style.display = 'flex';
                    document.getElementById('wechat-ai-toggle').style.display = 'none';
                }
            }
        });

        const toggle = document.createElement('button'); toggle.id = 'wechat-ai-toggle'; toggle.textContent = '💬'; document.body.appendChild(toggle);
        toggle.onclick = () => { div.style.display = 'flex'; toggle.style.display = 'none'; };
        document.getElementById('wechat-ai-send').onclick = sendUserMessage;
        document.getElementById('wechat-ai-plus').onclick = pickUserImage;
        document.getElementById('wechat-ai-input').addEventListener('keydown', e => { if (e.key === 'Enter') sendUserMessage(); });
        const minBtn = document.getElementById('wechat-ai-min'), maxBtn = document.getElementById('wechat-ai-max');
        [minBtn, maxBtn].forEach(b => { b.addEventListener('mousedown', e => e.stopPropagation()); });
        minBtn.addEventListener('click', () => toggleMin(div)); maxBtn.addEventListener('click', () => toggleMax(div));
        
        enableDrag(div, document.getElementById('wechat-ai-dragbar'));
        div.querySelectorAll('.resize-handle').forEach(h => enableResize(div, h));
        setupSnapLayouts(div);
        
        setupScrollRefresh(); setupBgPicker(); updateBtns();
        window.addEventListener('resize', () => {
            if (div.style.display === 'none') return;
            if (state === 'edge-l' || state === 'edge-r') {
                const vh = window.innerHeight, h = Math.min(vh * 0.3, 200);
                div.style.top = Math.max(20, (vh - h) / 2) + 'px'; div.style.height = h + 'px'; return;
            }
            if (state !== 'normal') return;
            const r = readRect(div); let nl = r.left, nt = r.top, nw = r.width, nh = r.height, changed = false;
            if (nl + nw > window.innerWidth - 4) { nw = Math.max(280, window.innerWidth - nl - 8); changed = true; }
            if (nt + nh > window.innerHeight - 4) { nh = Math.max(200, window.innerHeight - nt - 8); changed = true; }
            if (nl + nw > window.innerWidth - 4) { nl = Math.max(0, window.innerWidth - nw - 8); changed = true; }
            if (nt + nh > window.innerHeight - 4) { nt = Math.max(0, window.innerHeight - nh - 8); changed = true; }
            if (changed) { Object.assign(div.style, { left: nl + 'px', top: nt + 'px', width: nw + 'px', height: nh + 'px' }); savedRect = { left: nl, top: nt, width: nw, height: nh }; }
        });
    }

    setInterval(() => {
        sessionStorage.setItem('wechat_ai_hb_' + myRole, Date.now());
    }, 3000);
    sessionStorage.setItem('wechat_ai_hb_' + myRole, Date.now());

    setTimeout(() => {
        const otherRole = isDoubao ? 'deepseek' : 'doubao';
        const otherHb = parseInt(sessionStorage.getItem('wechat_ai_hb_' + otherRole) || '0', 10);
        const lastOpen = parseInt(sessionStorage.getItem('wechat_ai_last_open_' + otherRole) || '0', 10);
        
        if (Date.now() - otherHb > 10000 && Date.now() - lastOpen > 30000) {
            sessionStorage.setItem('wechat_ai_last_open_' + otherRole, Date.now());
            const url = isDoubao ? 'https://chat.deepseek.com' : 'https://www.doubao.com/chat/';
            const a = document.createElement('a');
            a.href = url; a.target = '_blank'; a.style.display = 'none';
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
        }
    }, 3000);

    (function waitForPageReady() {
        let attempts = 0;
        const maxAttempts = 30; 
        const timer = setInterval(() => {
            attempts++;
            const hasInput = document.querySelector('div[contenteditable="true"]') || document.querySelector('textarea');
            const rootRendered = document.getElementById('root') && document.getElementById('root').children.length > 0;
            
            if (hasInput || rootRendered) {
                clearInterval(timer);
                createUI();
                setTimeout(() => { flush(); checkThinking(); }, 500);
            } else if (attempts >= maxAttempts) {
                clearInterval(timer);
                createUI(); 
            }
        }, 500);
    })();

    setInterval(flush, 1000);
    setInterval(checkThinking, 1000);

    let executing = false, pendingForward = null, lastUserTs = 0, lastTaskTs = 0, lastReplyTs = 0;
    const seen = new Set(); let lastKey = '', stable = 0;
    let ready = false;
    let currentHref = location.href, urlChangeUntil = 0;

    let initCheckCount = 0;
    let lastInitKey = '';
    const initInterval = setInterval(() => {
        const cur = getReplyData();
        const k = cur.text + '###' + cur.images.join('|');
        if (k && k === lastInitKey) {
            initCheckCount++;
            if (initCheckCount >= 2) {
                seen.add(k); lastKey = k;
                ready = true;
                clearInterval(initInterval);
            }
        } else {
            lastInitKey = k;
            initCheckCount = 0;
        }
    }, 1000);

    setTimeout(() => {
        if (!ready) {
            const cur = getReplyData();
            const k = cur.text + '###' + cur.images.join('|');
            if (k) { seen.add(k); lastKey = k; }
            ready = true;
            clearInterval(initInterval);
        }
    }, 5000);

    function markDeepseekThinkingStart() {
        if (isDoubao) return;
        setThinking({ active: true, startTime: Date.now(), duration: 0 }); lastThinkingKey = '';
    }

    async function handleUser(data) {
        let imagePasted = false;
        if (data.image && isDoubao) { imagePasted = await pasteImageToDoubao(data.image); await sleep(800); }
        const rawText = (data.text || '').trim();
        const hasRealText = rawText && rawText !== '[用户上传了一张图片]';
        let textToSend = '';
        if (hasRealText) textToSend = rawText;
        else if (data.image && !imagePasted) textToSend = '[用户上传了一张图片，请根据上下文回答]';
        else if (!data.image) return;

        if (textToSend) textToSend = GROUP_PROMPT(myLabel) + 'User：' + textToSend;

        if (textToSend) {
            const ok = await typeIntoMyAI(textToSend);
            if (!ok) { pushMessage('system', '[' + myLabel + '] 输入框未就绪'); flush(); return; }
        }
        await sleep(1500);
        const sent = await waitAndClickSend(getMyInputBox(), 5000);
        if (!sent) { pushMessage('system', '[' + myLabel + '] 发送失败'); flush(); return; }

        markDeepseekThinkingStart(); pendingForward = { from: myRole, round: 0, userText: rawText };
    }

    async function handleTask(task) {
        const ok = await typeIntoMyAI(task.text);
        if (!ok) { pushMessage('system', '[' + myLabel + '] 输入框未就绪'); flush(); return; }
        await sleep(1500);
        await waitAndClickSend(getMyInputBox(), 5000);
        markDeepseekThinkingStart(); pendingForward = { from: task.from, round: task.round || 0, userText: '' };
    }

    async function handleReply(d) {
        const ok = await typeIntoMyAI(d.text);
        if (!ok) return;
        await sleep(1500);
        await waitAndClickSend(getMyInputBox(), 5000);
        markDeepseekThinkingStart(); pendingForward = { from: myRole, round: d.round || 0, userText: '' };
    }

    setInterval(async () => {
        if (executing) return;
        if (Date.now() < urlChangeUntil) return;
        
        let action = null;
        const userRaw = GM_getValue(K.USER);
        if (userRaw) {
            let d; try { d = JSON.parse(userRaw); } catch (e) {}
            if (d && d.ts !== lastUserTs && d.source === myRole) { lastUserTs = d.ts; action = { type: 'user', data: d }; }
        }
        if (!action) {
            const taskRaw = GM_getValue(K.TASK);
            if (taskRaw) {
                let t; try { t = JSON.parse(taskRaw); } catch (e) {}
                if (t && t.timestamp !== lastTaskTs && t.from !== myRole) { lastTaskTs = t.timestamp; action = { type: 'task', data: t }; }
            }
        }
        if (!action) {
            const replyRaw = GM_getValue(K.REPLY);
            if (replyRaw) {
                let r; try { r = JSON.parse(replyRaw); } catch (e) {}
                if (r && r.timestamp !== lastReplyTs && r.from === myRole) { lastReplyTs = r.timestamp; action = { type: 'reply', data: r }; }
            }
        }
        if (!action) return;
        executing = true;
        try {
            if (action.type === 'user') await handleUser(action.data);
            else if (action.type === 'task') await handleTask(action.data);
            else await handleReply(action.data);
        } finally { executing = false; }
    }, 1000);

    setInterval(() => {
        if (!ready || Date.now() < urlChangeUntil) return;
        const latest = getReplyData();
        
        if (!latest.text || latest.text.includes('系统提示：当前是一个多AI群聊')) return;
        
        if (latest.text.length < 1 && !latest.images.length) return;
        const key = latest.text + '###' + latest.images.join('|');
        if (key !== lastKey) { lastKey = key; stable = 0; return; }
        stable++;
        if (stable < 3 || seen.has(key)) return;
        seen.add(key); stable = 0;

        let thinkingMs = 0;
        if (!isDoubao) {
            const t = getThinking();
            if (t.active) { thinkingMs = Date.now() - t.startTime; setThinking({ active: false, duration: thinkingMs }); lastThinkingKey = ''; stopThinking(); }
        }
        pushMessage(myRole, latest.text, latest.images, thinkingMs > 0 ? { thinkingMs } : null); flush();

        if (!pendingForward) return;
        const pf = pendingForward; pendingForward = null;
        const session = getSession(); const newRound = pf.round + 1;
        if (newRound >= session.maxRounds * 2) {
            pushMessage('system', '对话结束（' + session.maxRounds + '轮）'); flush(); session.active = false; setSession(session); return;
        }
        setSession(Object.assign({}, session, { round: newRound }));
        const targetKey = pf.from === myRole ? K.TASK : K.REPLY;
        const charHint = session.maxChars > 0 ? '\n\n（请用不超过' + session.maxChars + '字简短回复）' : '';
        const text = GROUP_PROMPT(otherLabel) + (pf.userText
            ? 'User：' + pf.userText + '\n\n' + myLabel + '：' + latest.text + charHint
            : myLabel + '：' + latest.text + charHint);

        GM_setValue(targetKey, JSON.stringify({ text, from: pf.from, round: newRound, timestamp: Date.now() }));
    }, 1000);

    setInterval(() => {
        const msgs = getMessages();
        if (msgs.length === 1 && msgs[0].who === 'system' && msgs[0].text === 'CLEAR_ALL') {
            clearChat(true);
            GM_setValue(K.MSGS, '[]'); 
        }
    }, 1000);

    let lastReloadCmd = GM_getValue('wechat_ai_cmd_reload', 0);
    setInterval(() => {
        const r = GM_getValue('wechat_ai_cmd_reload', 0);
        if (r > lastReloadCmd) {
            lastReloadCmd = r;
            setTimeout(() => { try { location.reload(); } catch (e) {} }, 500 + Math.random() * 500);
        }
    }, 1000);

    setInterval(() => {
        if (location.href === currentHref) return;
        currentHref = location.href;
        
        urlChangeUntil = Date.now() + 3000;
        pendingForward = null; 
        lastKey = ''; stable = 0;

        const capture = () => {
            if (!ready) return;
            const cur = getReplyData();
            if (cur.text || cur.images.length) {
                const k = cur.text + '###' + cur.images.join('|');
                seen.add(k); lastKey = k;
            }
            stable = 0;
        };
        
        setTimeout(capture, 1000);
        setTimeout(capture, 2000);
        setTimeout(capture, 2800);
    }, 500);
})();
