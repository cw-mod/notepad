// ==UserScript==
// @name         CatWar: Notepad
// @namespace    catwar-notepad
// @version      1.0.0
// @description  Сворачиваемый мини-блокнот с вкладками
// @author       кошечка
// @match        *://catwar.su/*
// @match        *://*.catwar.su/*
// @match        *://catwar.net/*
// @match        *://*.catwar.net/*
// @updateURL    https://cw-mod.github.io/notepad/catwar-notepad.meta.js
// @downloadURL  https://cw-mod.github.io/notepad/catwar-notepad.user.js
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  /* ============================================================
   *  STORAGE HELPERS
   * ============================================================ */
  const store = {
    get(key, def) {
      try {
        if (typeof GM_getValue !== 'undefined') {
          const v = GM_getValue(key);
          if (v === undefined || v === null || v === '') return def;
          return JSON.parse(v);
        }
      } catch (e) {}
      try {
        const v = localStorage.getItem('cwNotepad_' + key);
        return v ? JSON.parse(v) : def;
      } catch (e) { return def; }
    },
    set(key, val) {
      const s = JSON.stringify(val);
      try {
        if (typeof GM_setValue !== 'undefined') { GM_setValue(key, s); return; }
      } catch (e) {}
      try { localStorage.setItem('cwNotepad_' + key, s); } catch (e) {}
    }
  };

  /* ============================================================
   *  DEFAULTS & STATE
   * ============================================================ */
  const DEFAULTS = {
    sections: [
      {
        id: 's1',
        title: 'Заметки 1',
        content: 'Мод для быстрых заметок в игровой, для быстрых переходов в блоги, просмотра расписаний племенной деятельности и т.п. Не забывайте периодически делать бэкап своих заметок через экспорт.'
      }
    ],
    panelPos: { x: 60, y: 80 },
    fabPos: null, // null = fresh install → bottom-right corner (computed on first run)
    locked: false,
    collapsed: false,
    colors: {
      bg:       '#2e2249f0',
      bgInput:  '#b388ff1a',
      text:     '#f0e9ff',
      link:     '#c4a3ff',
      border:   '#7a5cc5',
      header:   '#3a2658f5',
      accent:   '#b388ff',
      accent2:  '#ff7eb3',
      sparkle:  '#ffd6ff'
    },
    fontSize: 15
  };

  // Per-path collapsed state — the notepad remembers whether it should be
  // expanded or collapsed on each specific page (URL path).
  // Default for unrecognised paths: collapsed (true) — so it doesn't bother
  // the user on pages where they haven't explicitly opened it.
  const _pathStates = store.get('pathStates', {});
  const _currentPath = location.pathname;

  const state = {
    sections:  store.get('sections', DEFAULTS.sections) || [],
    panelPos:  store.get('panelPos', DEFAULTS.panelPos),
    fabPos:    store.get('fabPos',   DEFAULTS.fabPos),
    fabRight:  store.get('fabRight',  null),
    fabBottom: store.get('fabBottom', null),
    locked:    store.get('locked',   DEFAULTS.locked),
    collapsed: _currentPath in _pathStates ? _pathStates[_currentPath] : true,
    colors:    Object.assign({}, DEFAULTS.colors, store.get('colors', {})),
    sparklesEnabled: store.get('sparklesEnabled', true),
    fontSize: store.get('fontSize', DEFAULTS.fontSize),
    settingsOpen: false,
    sparkleTimer: null
  };

  // Migrate: if the user never customized colors but has the OLD (too dark,
  // near-black) defaults persisted, silently upgrade to the new palette.
  (function migrateOldDefaultColors() {
    const OLD = { bg: '#1c1624f0', bgInput: '#00000047', text: '#f0e9ff', link: '#c4a3ff',
                  border: '#7a5cc5', header: '#3a2658f5', accent: '#b388ff', accent2: '#ff7eb3', sparkle: '#ffd6ff' };
    const cur = state.colors || {};
    const same = Object.keys(OLD).every(k => cur[k] === OLD[k]);
    if (same) {
      state.colors = Object.assign({}, DEFAULTS.colors);
      store.set('colors', state.colors);
    }
  })();

  // Migrate: if the user has the OLD default font size (14) persisted from
  // v1.0.1's initial release, silently upgrade to the new default (15).
  if (state.fontSize === 14) {
    state.fontSize = DEFAULTS.fontSize;
    store.set('fontSize', state.fontSize);
  }

  // ensure at least one section
  if (!Array.isArray(state.sections) || state.sections.length === 0) {
    state.sections = JSON.parse(JSON.stringify(DEFAULTS.sections));
  }
  // active section id (first by default, or restored)
  state.activeId = store.get('activeId', state.sections[0] && state.sections[0].id);
  // validate activeId
  if (!state.sections.find(s => s.id === state.activeId)) {
    state.activeId = state.sections[0] ? state.sections[0].id : null;
  }

  /* ============================================================
   *  AUTHOR SIGNATURE
   *  Multi-part XOR-encoded — the literal handle doesn't appear in
   *  source, so it can't be grepped or killed by single-line edit.
   * ============================================================ */
  const _cwSig1 = [0x0405, 0x0408, 0x0017];   // "вп "
  const _cwSig2 = [0x0006, 0x0000, 0x0004];   // "173"
  const _cwSig3 = [0x0003, 0x0004, 0x0004];   // "433"
  const _cwKey  = 0x37;
  const _cwAuthor = [..._cwSig1, ..._cwSig2, ..._cwSig3]
    .map(n => String.fromCharCode(n ^ _cwKey)).join('');

  /* ============================================================
   *  INJECT STYLES
   * ============================================================ */
  const css = `
    .cw-np-root *, .cw-np-root *::before, .cw-np-root *::after {
      box-sizing: border-box;
      font-family: 'Segoe UI', 'Inter', system-ui, -apple-system, sans-serif;
    }
    .cw-np-root {
      position: fixed;
      z-index: 2147483646;
      pointer-events: none;
    }

    /* ---------- FAB (toggle button) ---------- */
    .cw-np-fab {
      position: fixed;
      z-index: 2147483647;
      width: 48px; height: 48px;
      border-radius: 50%;
      cursor: grab;
      display: flex; align-items: center; justify-content: center;
      font-size: 22px;
      color: #fff;
      background: var(--cw-accent2);
      box-shadow: 0 0 0 2px rgba(255,255,255,0.25), 0 4px 18px rgba(0,0,0,0.45), 0 0 24px color-mix(in srgb, var(--cw-accent2) 60%, transparent);
      transition: transform .18s ease, box-shadow .18s ease;
      user-select: none;
      pointer-events: auto;
    }
    .cw-np-fab:hover { box-shadow: 0 0 0 3px rgba(255,255,255,0.35), 0 6px 24px rgba(0,0,0,0.55), 0 0 32px color-mix(in srgb, var(--cw-accent2) 80%, transparent); }
    .cw-np-fab:active { cursor: grabbing; }
    .cw-np-fab.locked { cursor: default; }
    .cw-np-fab.locked::after {
      content: ''; position: absolute; right: -2px; bottom: -2px;
      width: 14px; height: 14px; border-radius: 50%;
      background: #2ecc71; border: 2px solid #1a1a2e;
    }

    /* ---------- PANEL ---------- */
    .cw-np-panel {
      position: fixed;
      z-index: 2147483646;
      width: 360px;
      max-height: 90vh;
      display: flex; flex-direction: column;
      background: var(--cw-bg);
      color: var(--cw-text);
      border: 1.5px solid var(--cw-border);
      border-radius: 14px;
      box-shadow: 0 12px 40px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.05) inset;
      overflow: hidden;
      pointer-events: auto;
      backdrop-filter: blur(6px);
    }
    .cw-np-panel.collapsed { display: none; }

    .cw-np-header {
      display: flex; align-items: center; gap: 6px;
      padding: 8px 10px;
      background: var(--cw-header);
      cursor: grab;
      user-select: none;
      border-bottom: 1px solid rgba(255,255,255,0.08);
    }
    .cw-np-header:active { cursor: grabbing; }
    .cw-np-panel.locked .cw-np-header { cursor: default; }

    .cw-np-title {
      font-size: 13px; font-weight: 700; letter-spacing: .3px;
      flex: 1; color: var(--cw-text);
      display: flex; align-items: center; gap: 6px;
    }
    .cw-np-title .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--cw-accent2); box-shadow: 0 0 8px var(--cw-accent2); }

    .cw-np-btn {
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.12);
      color: var(--cw-text);
      border-radius: 7px;
      padding: 4px 7px;
      font-size: 13px; line-height: 1;
      cursor: pointer;
      transition: background .15s ease, transform .12s ease;
      display: inline-flex; align-items: center; gap: 3px;
    }
    .cw-np-btn:hover { background: rgba(255,255,255,0.16); transform: translateY(-1px); }
    .cw-np-btn:active { transform: translateY(0); }
    .cw-np-btn.primary { background: var(--cw-accent2); border-color: transparent; color: #fff; font-weight: 600; }
    .cw-np-btn.primary:hover { filter: brightness(1.1); }
    .cw-np-btn.danger { background: rgba(231,76,60,0.18); border-color: rgba(231,76,60,0.4); }
    .cw-np-iconbtn.danger { background: rgba(231,76,60,0.12); border-color: rgba(231,76,60,0.25); }
    .cw-np-iconbtn.danger:hover { background: rgba(231,76,60,0.55); border-color: rgba(231,76,60,0.5); }
    .cw-np-btn.danger:hover { background: rgba(231,76,60,0.35); }
    .cw-np-btn.active { background: var(--cw-accent2); color: #fff; border-color: transparent; }
    .cw-np-btn.open { background: var(--cw-accent2); color: #fff; border-color: transparent; }

    /* ---------- BODY ---------- */
    .cw-np-body {
      flex: 1; overflow-y: auto; padding: 0;
      scrollbar-width: thin; scrollbar-color: var(--cw-accent2) transparent;
      display: flex; flex-direction: column;
    }
    .cw-np-body::-webkit-scrollbar { width: 6px; }
    .cw-np-body::-webkit-scrollbar-thumb { background: var(--cw-accent2); border-radius: 3px; }

    /* ---------- TAB BAR (sections in a row) ---------- */
    .cw-np-tabbar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 6px 4px 6px;
      background: rgba(0,0,0,0.22);
      border-bottom: 1px solid rgba(255,255,255,0.08);
      flex-shrink: 0;
    }
    /* Single-row tab strip — scrolled sideways by ◀ ▶ arrows when overflowing */
    .cw-np-tab-strip {
      display: flex;
      gap: 4px;
      flex: 1;
      min-width: 0;
      overflow: hidden;
      padding: 0 5px;
    }
    .cw-np-tab-arrow {
      display: inline-flex; align-items: center; justify-content: center;
      width: 20px; height: 24px;
      font-size: 11px; line-height: 1;
      color: var(--cw-text);
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 7px;
      cursor: pointer;
      flex-shrink: 0;
      user-select: none;
      transition: background .15s ease, transform .12s ease;
    }
    .cw-np-tab-arrow:hover { background: rgba(255,255,255,0.16); transform: translateY(-1px); }
    .cw-np-tab-arrow.disabled {
      opacity: 0.2;
      cursor: default;
      pointer-events: none;
    }

    .cw-np-tab {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 4px 8px;
      font-size: 12px; font-weight: 600;
      color: var(--cw-text);
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 7px;
      cursor: pointer;
      white-space: nowrap;
      user-select: none;
      flex-shrink: 0;
      outline: none;
      transition: background .15s ease, transform .12s ease, border-color .15s ease;
    }
    .cw-np-tab:hover { background: rgba(255,255,255,0.14); transform: translateY(-1px); }
    .cw-np-tab.active {
      background: var(--cw-accent);
      color: #fff;
      border-color: transparent;
      box-shadow: 0 0 0 2px color-mix(in srgb, var(--cw-accent) 30%, transparent), 0 0 12px color-mix(in srgb, var(--cw-accent) 50%, transparent);
    }
    .cw-np-tab .cw-np-tab-title {
      max-width: 110px;
      overflow: hidden; text-overflow: ellipsis;
      outline: none;
    }
    /* No focus backdrop on the title — editing happens "inline" without a visible frame. */
    .cw-np-tab .cw-np-tab-close {
      display: inline-flex; align-items: center; justify-content: center;
      width: 14px; height: 14px;
      border-radius: 50%;
      background: rgba(0,0,0,0.25);
      color: var(--cw-text);
      font-size: 11px; line-height: 1;
      cursor: pointer;
      opacity: 0.7;
    }
    .cw-np-tab .cw-np-tab-close:hover { background: rgba(231,76,60,0.7); opacity: 1; }
    .cw-np-tab.active .cw-np-tab-close { background: rgba(0,0,0,0.35); }

    /* ---------- ACTIVE SECTION CONTENT ---------- */
    .cw-np-sec-wrap {
      flex: 1;
      display: flex; flex-direction: column;
      padding: 0;
      min-height: 100px;
      background: var(--cw-bg-input);
    }
    .cw-np-sec-content {
      flex: 1;
      font-size: var(--cw-font-size, 14px); line-height: 1.5;
      white-space: pre-wrap; word-wrap: break-word;
      color: var(--cw-text);
      min-height: 80px;
      max-height: 30vh;
      overflow-y: auto;
      background: transparent;
      border-radius: 0;
      padding: 10px 12px;
    }
    .cw-np-sec-content a {
      color: var(--cw-link);
      text-decoration: underline;
      cursor: pointer;
      word-break: break-all;
    }
    .cw-np-sec-content a:hover { filter: brightness(1.15); }
    .cw-np-sec-content.editing { display: none; }
    .cw-np-sec-textarea {
      width: 100%;
      min-height: 120px;
      height: 240px;
      flex: 0 1 auto;
      resize: vertical;
      background: transparent;
      color: var(--cw-text);
      border: none;
      border-radius: 0;
      padding: 10px 12px;
      font-size: var(--cw-font-size, 14px); line-height: 1.5;
      font-family: inherit;
      display: none;
    }
    .cw-np-sec-textarea.editing { display: block; }
    .cw-np-sec-textarea:focus,
    .cw-np-sec-textarea:hover,
    .cw-np-sec-content:focus,
    .cw-np-sec-content:hover {
      outline: none;
      border: none;
      box-shadow: none;
    }

    /* ---------- BB-CODE TOOLBAR (above textarea) ---------- */
    .cw-np-bbbar {
      display: none; flex-wrap: wrap; gap: 3px;
      padding: 4px 6px;
      margin: 6px 8px;
      background: color-mix(in srgb, var(--cw-bg-input) 80%, transparent);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 6px;
    }
    .cw-np-bbbar.editing { display: flex; }
    .cw-np-bbbtn {
      padding: 3px 7px;
      font-size: 11.5px; line-height: 1;
      background: rgba(255,255,255,0.07);
      border: 1px solid rgba(255,255,255,0.14);
      color: var(--cw-text);
      border-radius: 5px;
      cursor: pointer;
      user-select: none;
      white-space: nowrap;
      transition: background .12s ease, transform .1s ease;
    }
    .cw-np-bbbtn svg { vertical-align: -2px; }
    .cw-np-bbbtn:hover { background: var(--cw-accent2); color: #fff; transform: translateY(-1px); }
    .cw-np-bbbtn:active { transform: translateY(0); }
    .cw-np-bbbtn.sep { background: transparent; border: none; cursor: default; padding: 3px 2px; opacity: 0.4; }
    .cw-np-bbbtn.sep:hover { background: transparent; color: var(--cw-text); transform: none; }
    .cw-np-bb-color-row {
      display: flex; gap: 2px; align-items: center;
    }
    .cw-np-bb-color-row input[type="color"] {
      width: 22px; height: 20px; padding: 0; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; background: transparent; cursor: pointer;
    }

    /* ---------- RENDERED BB-CODE ELEMENTS ---------- */
    .cw-np-sec-content .cw-bb-h1 { font-size: 16px; font-weight: 800; margin: 6px 0 4px 0; color: var(--cw-text); }
    .cw-np-sec-content .cw-bb-h2 { font-size: 14px; font-weight: 700; margin: 5px 0 3px 0; color: var(--cw-text); }
    .cw-np-sec-content .cw-bb-h3 { font-size: 13px; font-weight: 700; margin: 4px 0 2px 0; color: var(--cw-text); opacity: 0.9; }
    .cw-np-sec-content .cw-bb-hr { border: none; border-top: 1px solid rgba(255,255,255,0.18); margin: 6px 0; }
    .cw-np-sec-content .cw-bb-img { max-width: 100%; border-radius: 6px; margin: 4px 0; display: block; }
    .cw-np-sec-content .cw-bb-code {
      background: rgba(0,0,0,0.4);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 6px;
      padding: 6px 8px;
      margin: 4px 0;
      font-family: 'Consolas', 'SFMono-Regular', 'Menlo', monospace;
      font-size: 11.5px;
      color: var(--cw-text);
      white-space: pre-wrap;
      overflow-x: auto;
    }
    .cw-np-sec-content .cw-bb-list { margin: 4px 0; padding-left: 22px; }
    .cw-np-sec-content .cw-bb-list li { margin: 2px 0; }
    .cw-np-sec-content .cw-bb-quote {
      margin: 5px 0;
      padding: 6px 10px;
      background: rgba(0,0,0,0.25);
      border-radius: 6px;
      color: var(--cw-text);
    }
    .cw-np-sec-content .cw-bb-quote .cw-bb-quote-author {
      font-size: 11px; opacity: 0.7; margin-bottom: 4px; font-style: italic;
    }
    .cw-np-sec-content .cw-bb-spoiler {
      margin: 4px 0;
      background: rgba(0,0,0,0.28);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 6px;
      padding: 4px 8px;
    }
    .cw-np-sec-content .cw-bb-spoiler summary {
      cursor: pointer; font-size: 12px; font-weight: 600; color: var(--cw-accent2);
      list-style: none;
    }
    .cw-np-sec-content .cw-bb-spoiler summary::-webkit-details-marker { display: none; }
    .cw-np-sec-content .cw-bb-spoiler summary::before { content: '▸ '; }
    .cw-np-sec-content .cw-bb-spoiler[open] summary::before { content: '▾ '; }
    .cw-np-sec-content .cw-bb-spoiler:not([open]) > *:not(summary) { display: none; }

    /* [copy]text[/copy] — clickable chip; click copies textContent to clipboard */
    .cw-np-sec-content .cw-bb-copy {
      display: inline-block;
      padding: 2px 8px;
      background: color-mix(in srgb, var(--cw-accent2) 18%, transparent);
      border: 1px solid color-mix(in srgb, var(--cw-accent2) 40%, transparent);
      border-radius: 5px;
      color: var(--cw-text);
      cursor: pointer;
      user-select: none;
      font-weight: 600;
      font-size: 11.5px;
      transition: background .12s ease, transform .1s ease, color .12s ease, border-color .12s ease;
    }
    .cw-np-sec-content .cw-bb-copy:hover {
      background: var(--cw-accent2);
      color: #fff;
      border-color: transparent;
      transform: translateY(-1px);
    }
    .cw-np-sec-content .cw-bb-copy:active { transform: translateY(0); }
    .cw-np-sec-content .cw-bb-copy.copied {
      background: transparent;
      color: var(--cw-accent2);
      border-color: var(--cw-accent2);
    }

    .cw-np-empty {
      padding: 20px 10px;
      text-align: center;
      color: var(--cw-text);
      opacity: 0.6;
      font-size: 12.5px;
    }

    .cw-np-footer {
      padding: 8px 10px;
      border-top: 1px solid rgba(255,255,255,0.08);
      background: rgba(0,0,0,0.18);
      display: flex; gap: 6px;
      align-items: center;
    }
    .cw-np-footer .cw-np-btn { justify-content: center; }
    .cw-np-footer-spacer {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      min-width: 0;
      overflow: hidden;
    }
    .cw-np-credit {
      font-size: 10px;
      opacity: 0.45;
      font-style: italic;
      letter-spacing: .3px;
      user-select: text;
      pointer-events: auto;
      white-space: nowrap;
      text-overflow: ellipsis;
      overflow: hidden;
      max-width: 100%;
    }
    .cw-np-credit [data-author] {
      color: var(--cw-accent2);
      font-weight: 600;
      font-style: normal;
      opacity: 0.95;
    }
    .cw-np-iconbtn {
      width: 30px; height: 30px;
      padding: 5px !important;
      display: inline-flex; align-items: center; justify-content: center;
      flex-shrink: 0;
    }
    .cw-np-editbtn {
      width: 38px; height: 30px;
      padding: 5px !important;
      display: inline-flex; align-items: center; justify-content: center;
      flex-shrink: 0;
    }
    .cw-np-iconbtn svg { width: 16px; height: 16px; display: block; }

    /* "+" add-tab button (inline at the end of tab bar) */
    .cw-np-tab-add {
      display: inline-flex; align-items: center; justify-content: center;
      width: 26px; height: 24px;
      font-size: 16px; font-weight: 800; line-height: 1;
      color: var(--cw-accent2);
      background: color-mix(in srgb, var(--cw-accent2) 15%, transparent);
      border: 1px dashed color-mix(in srgb, var(--cw-accent2) 60%, transparent);
      border-radius: 7px;
      cursor: pointer;
      flex-shrink: 0;
      transition: background .15s ease, transform .15s ease, color .15s ease, border-style .15s ease;
      user-select: none;
    }
    .cw-np-tab-add:hover {
      background: var(--cw-accent2);
      color: #fff;
      border-style: solid;
      transform: translateY(-1px) rotate(90deg);
    }

    /* Side dropdown menu — list of all tabs (fully opaque by default) */
    .cw-np-tab-menu {
      position: fixed;
      z-index: 2147483647;
      pointer-events: auto;
      background-image: linear-gradient(var(--cw-bg), var(--cw-bg));
      background-color: #1c1624;
      border: 1px solid var(--cw-border);
      border-radius: 10px;
      padding: 5px;
      max-height: 280px;
      overflow-y: auto;
      min-width: 170px;
      max-width: 240px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.5);
      display: none;
      scrollbar-width: thin;
      scrollbar-color: var(--cw-accent2) transparent;
    }
    .cw-np-tab-menu.open { display: block; }
    .cw-np-tab-menu::-webkit-scrollbar { width: 5px; }
    .cw-np-tab-menu::-webkit-scrollbar-thumb { background: var(--cw-accent2); border-radius: 3px; }
    .cw-np-tab-menu-item {
      padding: 5px 8px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 12px; font-weight: 600;
      color: var(--cw-text);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      display: flex;
      align-items: center;
      gap: 6px;
      user-select: none;
      transition: background .12s ease;
    }
    .cw-np-tab-menu-item:hover { background: rgba(255,255,255,0.1); }
    .cw-np-tab-menu-item.active {
      background: var(--cw-accent);
      color: #fff;
    }
    .cw-np-tab-menu-item-title { flex: 1; overflow: hidden; text-overflow: ellipsis; }
    .cw-np-tab-menu-item-close {
      width: 16px; height: 16px;
      border-radius: 50%;
      background: rgba(0,0,0,0.25);
      color: var(--cw-text);
      font-size: 10px; line-height: 1;
      display: inline-flex; align-items: center; justify-content: center;
      opacity: 0.7;
      flex-shrink: 0;
    }
    .cw-np-tab-menu-item-close:hover { background: rgba(231,76,60,0.7); opacity: 1; }
    .cw-np-tab-menu-item.active .cw-np-tab-menu-item-close { background: rgba(0,0,0,0.35); }

    /* ---------- SETTINGS ---------- */
    .cw-np-settings {
      display: none;
      padding: 10px;
      background: rgba(0,0,0,0.25);
      border-bottom: 1px solid rgba(255,255,255,0.08);
      max-height: 50vh;
      overflow-y: auto;
      scrollbar-width: thin;
      scrollbar-color: var(--cw-accent2) transparent;
    }
    .cw-np-settings::-webkit-scrollbar { width: 5px; }
    .cw-np-settings::-webkit-scrollbar-thumb { background: var(--cw-accent2); border-radius: 3px; }
    .cw-np-settings.open { display: block; }
    .cw-np-set-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; font-size: 15px; }
    .cw-np-set-row label { flex: 1; color: var(--cw-text); }
    .cw-np-set-row input[type="color"] {
      width: 38px; height: 30px; padding: 0; border: 1px solid rgba(255,255,255,0.2); border-radius: 5px; background: transparent; cursor: pointer;
    }
    .cw-np-set-row input[type="text"] {
      width: 90px; flex: none; background: rgba(0,0,0,0.35); color: var(--cw-text); border: 1px solid rgba(255,255,255,0.15); border-radius: 5px; padding: 4px 8px; font-size: 14px; font-family: monospace;
    }
    .cw-np-set-row input[type="range"] {
      flex: 2; height: 26px; accent-color: var(--cw-accent2); cursor: pointer; background: transparent;
    }
    .cw-np-set-fontsize-display {
      font-size: 14px; font-family: monospace; color: var(--cw-text); opacity: 0.85;
      min-width: 44px; text-align: right; flex-shrink: 0;
    }
    .cw-np-set-reset {
      width: 100%; margin-top: 4px; padding: 7px; font-size: 14px;
      background: rgba(231,76,60,0.15); border: 1px solid rgba(231,76,60,0.3); color: var(--cw-text); border-radius: 6px; cursor: pointer;
    }
    .cw-np-set-reset:hover { background: rgba(231,76,60,0.3); }

    /* Clickable on/off text label (e.g. for sparkles toggle) */
    .cw-np-set-toggle-text {
      font-size: 13px; font-weight: 700;
      padding: 4px 9px;
      background: rgba(255,255,255,0.08);
      border: 1px solid rgba(255,255,255,0.18);
      border-radius: 5px;
      color: var(--cw-text);
      cursor: pointer;
      user-select: none;
      flex-shrink: 0;
      letter-spacing: .5px;
      transition: background .12s ease, color .12s ease, opacity .12s ease;
    }
    .cw-np-set-toggle-text:hover { background: rgba(255,255,255,0.16); }
    .cw-np-set-toggle-text.on {
      background: color-mix(in srgb, var(--cw-accent2) 22%, transparent);
      color: var(--cw-accent2);
      border-color: color-mix(in srgb, var(--cw-accent2) 50%, transparent);
    }
    .cw-np-set-toggle-text.off { opacity: 0.5; }

    /* ---------- SPARKLES (Unicode text-based) ---------- */
    .cw-np-sparkle {
      position: fixed;
      z-index: 2147483645;
      pointer-events: none;
      font-family: 'Segoe UI Symbol', 'Apple Symbols', 'Noto Sans Symbols', 'Noto Sans Symbols 2', sans-serif;
      line-height: 1;
      color: var(--cw-sparkle);
      text-shadow:
        0 0 4px var(--cw-sparkle),
        0 0 8px var(--cw-sparkle),
        0 0 12px var(--cw-sparkle);
      opacity: 0;
      will-change: transform, opacity;
      user-select: none;
    }
    @keyframes cwSpkFloat {
      0%   { transform: translate(0,0) scale(0.4) rotate(0deg); opacity: 0; }
      15%  { opacity: 1; }
      80%  { opacity: 1; }
      100% { transform: translate(var(--dx), var(--dy)) scale(1.1) rotate(180deg); opacity: 0; }
    }
  `;
  if (typeof GM_addStyle !== 'undefined') {
    GM_addStyle(css);
  } else {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
  }

  /* ============================================================
   *  ICONS — Lucide (https://lucide.dev), ISC license.
   *  Inlined SVGs: no CDN, works offline.
   * ============================================================ */
  const ICONS = {
    'lock': '<rect width="18" height="11" x="3" y="11" rx="2" ry="2" /> <path d="M7 11V7a5 5 0 0 1 10 0v4" />',
    'lock-open': '<rect width="18" height="11" x="3" y="11" rx="2" ry="2" /> <path d="M7 11V7a5 5 0 0 1 9.9-1" />',
    'settings': '<path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" /> <circle cx="12" cy="12" r="3" />',
    'list': '<path d="M3 5h.01" /> <path d="M3 12h.01" /> <path d="M3 19h.01" /> <path d="M8 5h13" /> <path d="M8 12h13" /> <path d="M8 19h13" />',
    'x': '<path d="M18 6 6 18" /> <path d="m6 6 12 12" />',
    'plus': '<path d="M5 12h14" /> <path d="M12 5v14" />',
    'minus': '<path d="M5 12h14" />',
    'square': '<rect width="18" height="18" x="3" y="3" rx="2" />',
    'chevron-left': '<path d="m15 18-6-6 6-6" />',
    'chevron-right': '<path d="m9 18 6-6-6-6" />',
    'pencil': '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" /> <path d="m15 5 4 4" />',
    'save': '<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" /> <path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7" /> <path d="M7 3v4a1 1 0 0 0 1 1h7" />',
    'trash-2': '<path d="M10 11v6" /> <path d="M14 11v6" /> <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /> <path d="M3 6h18" /> <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />',
    'folder-down': '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" /> <path d="M12 10v6" /> <path d="m15 13-3 3-3-3" />',
    'folder-up': '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" /> <path d="M12 10v6" /> <path d="m9 13 3-3 3 3" />',
    'notebook-pen': '<path d="M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4" /> <path d="M2 6h4" /> <path d="M2 10h4" /> <path d="M2 14h4" /> <path d="M2 18h4" /> <path d="M21.378 5.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z" />',
    'quote': '<path d="M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z" /> <path d="M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z" />',
    'code': '<path d="m16 18 6-6-6-6" /> <path d="m8 6-6 6 6 6" />',
    'eye-off': '<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" /> <path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" /> <path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" /> <path d="m2 2 20 20" />',
    'align-center': '<path d="M21 5H3" /> <path d="M17 12H7" /> <path d="M19 19H5" />',
    'image': '<rect width="18" height="18" x="3" y="3" rx="2" ry="2" /> <circle cx="9" cy="9" r="2" /> <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />',
    'link': '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /> <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />',
    'clipboard': '<rect width="8" height="4" x="8" y="2" rx="1" ry="1" /> <path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2" />',
    'clipboard-check': '<path d="M11.5 16.5 14 19l5-5" /> <path d="M8 21h8a2 2 0 0 0 2-2V7l-2-2H6L4 7v12a2 2 0 0 0 2 2Z" /> <path d="M16 3v4" /> <path d="M8 3v4" />',
    'arrow-down-narrow-wide': '<path d="m3 16 4 4 4-4" /> <path d="M7 20V4" /> <path d="M11 4h10" /> <path d="M11 8h7" /> <path d="M11 12h4" />',
  };

  // Render an icon: icon('lock', 14) -> inline svg markup
  function icon(name, size) {
    size = size || 14;
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || '') + '</svg>';
  }

  /* ============================================================
   *  DOM BUILD
   * ============================================================ */
  const root = document.createElement('div');
  root.className = 'cw-np-root';

  // FAB
  const fab = document.createElement('div');
  fab.className = 'cw-np-fab';
  fab.title = '';
  fab.innerHTML = icon('notebook-pen', 22);

  // Panel
  const panel = document.createElement('div');
  panel.className = 'cw-np-panel' + (state.collapsed ? ' collapsed' : '');
  panel.innerHTML = `
    <div class="cw-np-header" data-drag="panel">
      <div class="cw-np-title"><span class="dot"></span><span>Мини-блокнот</span></div>
      <button class="cw-np-btn" data-act="lock" title="">${icon('lock-open')}</button>
      <button class="cw-np-btn" data-act="settings" title="">${icon('settings')}</button>
      <button class="cw-np-btn" data-act="tabs" title="">${icon('list')}</button>
      <button class="cw-np-btn" data-act="collapse" title="">${icon('minus')}</button>
    </div>
    <div class="cw-np-settings" data-el="settings">
      <div class="cw-np-set-row">
        <label>Фон блокнота</label>
        <input type="color" data-color="bg">
        <input type="text" data-colortext="bg" placeholder="#1c1624f0">
      </div>
      <div class="cw-np-set-row">
        <label>Фон текста</label>
        <input type="color" data-color="bgInput">
        <input type="text" data-colortext="bgInput" placeholder="#00000047">
      </div>
      <div class="cw-np-set-row">
        <label>Цвет текста</label>
        <input type="color" data-color="text">
        <input type="text" data-colortext="text" placeholder="#fff">
      </div>
      <div class="cw-np-set-row">
        <label>Цвет ссылок</label>
        <input type="color" data-color="link">
        <input type="text" data-colortext="link" placeholder="#fff">
      </div>
      <div class="cw-np-set-row">
        <label>Рамка</label>
        <input type="color" data-color="border">
        <input type="text" data-colortext="border" placeholder="#fff">
      </div>
      <div class="cw-np-set-row">
        <label>Шапка</label>
        <input type="color" data-color="header">
        <input type="text" data-colortext="header" placeholder="#3a2658f5">
      </div>
      <div class="cw-np-set-row">
        <label>Акцент</label>
        <input type="color" data-color="accent">
        <input type="text" data-colortext="accent" placeholder="#fff">
      </div>
      <div class="cw-np-set-row">
        <label>Акцент 2</label>
        <input type="color" data-color="accent2">
        <input type="text" data-colortext="accent2" placeholder="#fff">
      </div>
      <div class="cw-np-set-row">
        <label>Блёстки</label>
        <input type="color" data-color="sparkle">
        <input type="text" data-colortext="sparkle" placeholder="#fff">
        <span class="cw-np-set-toggle-text" data-toggle-text="sparkles" title="">ВКЛ</span>
      </div>
      <div class="cw-np-set-row">
        <label>Размер шрифта</label>
        <input type="range" min="10" max="24" step="0.5" value="15" data-fontsize>
        <span class="cw-np-set-fontsize-display" data-fontsize-display>15px</span>
      </div>
      <button class="cw-np-set-reset" data-act="resetColors">Сбросить цвета</button>
    </div>
    <div class="cw-np-body" data-el="body"></div>
    <div class="cw-np-footer">
      <button class="cw-np-btn cw-np-editbtn" data-act="edit" title="">${icon('pencil')}</button>
      <button class="cw-np-btn primary cw-np-editbtn" data-act="save" title="" style="display:none">${icon('save')}</button>
      <div class="cw-np-footer-spacer">
        <span class="cw-np-credit">by <span data-author></span></span>
      </div>
      <button class="cw-np-btn cw-np-iconbtn" data-act="import" title="">${icon('folder-down', 16)}</button>
      <button class="cw-np-btn cw-np-iconbtn" data-act="export" title="">${icon('folder-up', 16)}</button>
      <button class="cw-np-btn cw-np-iconbtn" data-act="sortTabs" title="">${icon('arrow-down-narrow-wide', 16)}</button>
      <button class="cw-np-btn cw-np-iconbtn danger" data-act="clearAll" title="Удалить все вкладки">${icon('trash-2', 16)}</button>
    </div>
  `;
  root.appendChild(fab);
  root.appendChild(panel);
  document.body.appendChild(root);

  // hidden file input for import
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.json,application/json';
  fileInput.style.display = 'none';
  document.body.appendChild(fileInput);

  // tab overflow menu (floating, appended to body so it can extend past panel edges)
  const tabMenu = document.createElement('div');
  tabMenu.className = 'cw-np-tab-menu';
  // Inside root so the menu inherits the --cw-* palette (root gets the vars).
  root.appendChild(tabMenu);
  let tabMenuTrigger = null;

  // Single-row tab strip. When tabs overflow, ◀ ▶ arrows page the strip sideways.
  let _tabStrip = null, _tabArrowL = null, _tabArrowR = null;

  function updateTabScroll() {
    if (!_tabStrip || !_tabArrowL || !_tabArrowR) return;
    const canL = _tabStrip.scrollLeft > 2;
    const canR = _tabStrip.scrollLeft + _tabStrip.clientWidth < _tabStrip.scrollWidth - 2;
    _tabArrowL.classList.toggle('disabled', !canL);
    _tabArrowR.classList.toggle('disabled', !canR);
  }

  function closeTabMenu() {
    tabMenu.classList.remove('open');
    if (tabMenuTrigger) {
      tabMenuTrigger.classList.remove('open');
      tabMenuTrigger = null;
    }
    document.removeEventListener('mousedown', onTabMenuOutsideClick);
    document.removeEventListener('keydown', onTabMenuEsc);
  }

  function onTabMenuOutsideClick(e) {
    if (tabMenu.contains(e.target)) return;
    if (tabMenuTrigger && tabMenuTrigger.contains(e.target)) return;
    closeTabMenu();
  }

  function onTabMenuEsc(e) {
    if (e.key === 'Escape') closeTabMenu();
  }

  function openTabMenu(triggerEl) {
    if (tabMenuTrigger === triggerEl && tabMenu.classList.contains('open')) {
      closeTabMenu();
      return;
    }
    if (tabMenuTrigger) tabMenuTrigger.classList.remove('open');
    tabMenuTrigger = triggerEl;
    triggerEl.classList.add('open');

    tabMenu.innerHTML = '';
    state.sections.forEach(sec => {
      const item = document.createElement('div');
      item.className = 'cw-np-tab-menu-item' + (sec.id === state.activeId ? ' active' : '');
      const title = document.createElement('span');
      title.className = 'cw-np-tab-menu-item-title';
      title.textContent = sec.title;
      item.appendChild(title);
      const close = document.createElement('span');
      close.className = 'cw-np-tab-menu-item-close';
      close.innerHTML = icon('x', 12);
      close.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (confirm(`Удалить раздел "${sec.title}"?`)) {
          const idx = state.sections.findIndex(s => s.id === sec.id);
          state.sections = state.sections.filter(s => s.id !== sec.id);
          if (sec.id === state.activeId) {
            if (state.sections.length === 0) state.activeId = null;
            else state.activeId = state.sections[Math.min(idx, state.sections.length - 1)].id;
          }
          store.set('sections', state.sections);
          store.set('activeId', state.activeId);
          renderSections();
          // Close the menu if nothing left to show, otherwise refresh its contents.
          if (state.sections.length === 0) closeTabMenu();
          else { closeTabMenu(); openTabMenu(triggerEl); }
        }
      });
      item.appendChild(close);
      item.addEventListener('click', () => {
        setActive(sec.id);
        closeTabMenu();
      });
      tabMenu.appendChild(item);
    });

    // position: prefer below the trigger, fall back above if not enough space
    const r = triggerEl.getBoundingClientRect();
    tabMenu.style.visibility = 'hidden';
    tabMenu.classList.add('open');
    const mw = tabMenu.offsetWidth;
    const mh = tabMenu.offsetHeight;
    let left = r.left;
    if (left + mw > window.innerWidth - 8) left = Math.max(8, window.innerWidth - mw - 8);
    let top = r.bottom + 4;
    if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 4);
    tabMenu.style.left = left + 'px';
    tabMenu.style.top = top + 'px';
    tabMenu.style.visibility = '';

    setTimeout(() => {
      document.addEventListener('mousedown', onTabMenuOutsideClick);
      document.addEventListener('keydown', onTabMenuEsc);
    }, 0);
  }

  // element refs
  const body = panel.querySelector('[data-el="body"]');
  const settings = panel.querySelector('[data-el="settings"]');
  const lockBtn = panel.querySelector('[data-act="lock"]');
  const collapseBtn = panel.querySelector('[data-act="collapse"]');

  /* ============================================================
   *  APPLY COLORS
   * ============================================================ */
  function applyColors() {
    const c = state.colors;
    // Full set on root: children that live outside the panel
    // (tab menu, sparkles) also inherit the palette.
    root.style.setProperty('--cw-bg', c.bg);
    root.style.setProperty('--cw-bg-input', c.bgInput);
    root.style.setProperty('--cw-text', c.text);
    root.style.setProperty('--cw-link', c.link);
    root.style.setProperty('--cw-border', c.border);
    root.style.setProperty('--cw-header', c.header);
    root.style.setProperty('--cw-accent', c.accent);
    root.style.setProperty('--cw-accent2', c.accent2);
    root.style.setProperty('--cw-sparkle', c.sparkle);
    panel.style.setProperty('--cw-bg', c.bg);
    panel.style.setProperty('--cw-bg-input', c.bgInput);
    panel.style.setProperty('--cw-text', c.text);
    panel.style.setProperty('--cw-link', c.link);
    panel.style.setProperty('--cw-border', c.border);
    panel.style.setProperty('--cw-header', c.header);
    panel.style.setProperty('--cw-accent', c.accent);
    panel.style.setProperty('--cw-accent2', c.accent2);
    panel.style.setProperty('--cw-sparkle', c.sparkle);
    fab.style.setProperty('--cw-accent', c.accent);
    fab.style.setProperty('--cw-accent2', c.accent2);
    fab.style.setProperty('--cw-sparkle', c.sparkle);
    document.documentElement.style.setProperty('--cw-accent', c.accent);
    document.documentElement.style.setProperty('--cw-accent2', c.accent2);
    document.documentElement.style.setProperty('--cw-sparkle', c.sparkle);
    applyFontSize();

    // color inputs
    settings.querySelectorAll('input[type="color"]').forEach(inp => {
      const key = inp.dataset.color;
      inp.value = toHexColor(c[key]);
    });
    settings.querySelectorAll('input[type="text"]').forEach(inp => {
      const key = inp.dataset.colortext;
      inp.value = c[key];
    });
  }

  function toHexColor(v) {
    if (!v) return '#000000';
    if (v.startsWith('#')) return v.slice(0, 7);
    const m = v.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/);
    if (m) {
      const r = parseInt(m[1]), g = parseInt(m[2]), b = parseInt(m[3]);
      return '#' + [r, g, b].map(n => n.toString(16).padStart(2, '0')).join('');
    }
    return '#000000';
  }

  // Apply font size to content + textarea via the --cw-font-size CSS var.
  // Slider range: 10–24px, default 14 (bumped from 12.5 for readability).
  function applyFontSize() {
    const sz = state.fontSize;
    const val = (typeof sz === 'number' && !isNaN(sz)) ? sz : DEFAULTS.fontSize;
    root.style.setProperty('--cw-font-size', val + 'px');
    panel.style.setProperty('--cw-font-size', val + 'px');
    const slider = settings.querySelector('input[data-fontsize]');
    const display = settings.querySelector('[data-fontsize-display]');
    if (slider) slider.value = val;
    if (display) display.textContent = val + 'px';
  }

  /* ============================================================
   *  POSITIONING
   * ============================================================ */
  function applyPositions() {
    // Panel: left/top, clamp for display only (preferred position preserved).
    const panelDisp = clampPos(panel, state.panelPos.x, state.panelPos.y);
    panel.style.left = panelDisp.x + 'px';
    panel.style.top = panelDisp.y + 'px';

    // FAB: use right/bottom so it stays relative to the viewport edges.
    // When the window resizes, "right: 20px" always means 20px from the
    // right edge — the FAB follows the corner instead of staying at a
    // fixed pixel position that may end up mid-screen on a larger window.
    if (!state.fabRight || typeof state.fabRight !== 'number') {
      // Fresh install or migration from old fabPos — default to bottom-right.
      if (state.fabPos && typeof state.fabPos.x === 'number') {
        state.fabRight = window.innerWidth - state.fabPos.x - fab.offsetWidth;
        state.fabBottom = window.innerHeight - state.fabPos.y - fab.offsetHeight;
      } else {
        state.fabRight = 20;
        state.fabBottom = 20;
      }
      store.set('fabRight', state.fabRight);
      store.set('fabBottom', state.fabBottom);
    }
    fab.style.left = 'auto';
    fab.style.top = 'auto';
    const rMax = Math.max(2, window.innerWidth - fab.offsetWidth - 4);
    const bMax = Math.max(2, window.innerHeight - fab.offsetHeight - 4);
    fab.style.right = Math.max(2, Math.min(state.fabRight, rMax)) + 'px';
    fab.style.bottom = Math.max(2, Math.min(state.fabBottom, bMax)) + 'px';
  }

  function clampPos(el, x, y) {
    const w = el.offsetWidth, h = el.offsetHeight;
    const maxX = window.innerWidth - w - 4;
    const maxY = window.innerHeight - h - 4;
    return { x: Math.max(2, Math.min(x, maxX)), y: Math.max(2, Math.min(y, maxY)) };
  }

  function applyLocked() {
    if (state.locked) {
      fab.classList.add('locked');
      panel.classList.add('locked');
      lockBtn.classList.add('active');
      lockBtn.innerHTML = icon('lock');
    } else {
      fab.classList.remove('locked');
      panel.classList.remove('locked');
      lockBtn.classList.remove('active');
      lockBtn.innerHTML = icon('lock-open');
    }
  }

  function applyCollapsed() {
    if (state.collapsed) {
      panel.classList.add('collapsed');
      collapseBtn.innerHTML = icon('square');
    } else {
      panel.classList.remove('collapsed');
      collapseBtn.innerHTML = icon('minus');
    }
  }

  /* ============================================================
   *  DRAG SYSTEM
   * ============================================================ */
  function makeDraggable(handle, target, kind) {
    let startX, startY, origX, origY, dragging = false;
    let dragStarted = false;
    let totalDistance = 0;

    function onDown(e) {
      if (state.locked) return;
      if (e.target.closest('.cw-np-btn')) return;

      dragging = true;
      dragStarted = false;
      totalDistance = 0;
      const p = e.touches ? e.touches[0] : e;
      startX = p.clientX;
      startY = p.clientY;
      // Read the preferred position but DON'T switch CSS yet — wait until
      // the mouse actually moves past the threshold (5px). This prevents
      // a visual "twitch" on pure clicks (right/bottom → left/top → right/bottom).
      if (kind === 'fab') {
        const r = parseFloat(target.style.right);
        const b = parseFloat(target.style.bottom);
        if (!isNaN(r) && !isNaN(b)) {
          origX = window.innerWidth - r - target.offsetWidth;
          origY = window.innerHeight - b - target.offsetHeight;
        } else {
          origX = window.innerWidth - 20 - target.offsetWidth;
          origY = window.innerHeight - 20 - target.offsetHeight;
        }
      } else {
        origX = parseFloat(target.style.left);
        origY = parseFloat(target.style.top);
        if (isNaN(origX)) origX = 0;
        if (isNaN(origY)) origY = 0;
      }
      e.preventDefault();
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      document.addEventListener('touchmove', onMove, { passive: false });
      document.addEventListener('touchend', onUp);
      document.addEventListener('touchcancel', onUp);
      window.addEventListener('blur', onUp);
    }

    function onMove(e) {
      if (!dragging) return;
      const p = e.touches ? e.touches[0] : e;
      const dx = p.clientX - startX;
      const dy = p.clientY - startY;
      totalDistance = Math.max(totalDistance, Math.sqrt(dx * dx + dy * dy));
      // Only switch to drag mode after movement exceeds threshold
      if (!dragStarted && totalDistance > 5) {
        dragStarted = true;
        target.style.transition = 'none';
        if (kind === 'fab') {
          // Now switch FAB from right/bottom to left/top for dragging
          target.style.right = 'auto';
          target.style.bottom = 'auto';
          target.style.left = origX + 'px';
          target.style.top = origY + 'px';
        }
        spawnSparkleBurst(p.clientX, p.clientY, 4);
      }
      if (!dragStarted) return;
      const newPos = clampPos(target, origX + dx, origY + dy);
      target.style.left = newPos.x + 'px';
      target.style.top = newPos.y + 'px';
      if (Math.random() < 0.25) spawnSparkleBurst(p.clientX, p.clientY, 1);
      e.preventDefault();
    }

    function onUp() {
      if (!dragging) return;
      dragging = false;
      if (dragStarted) {
        target.style.transition = '';
        if (kind === 'fab') {
          const left = parseFloat(target.style.left);
          const top = parseFloat(target.style.top);
          if (!isNaN(left) && !isNaN(top)) {
            const r = window.innerWidth - left - target.offsetWidth;
            const b = window.innerHeight - top - target.offsetHeight;
            state.fabRight = Math.max(2, r);
            state.fabBottom = Math.max(2, b);
            store.set('fabRight', state.fabRight);
            store.set('fabBottom', state.fabBottom);
            target.style.left = 'auto';
            target.style.top = 'auto';
            const rMax = Math.max(2, window.innerWidth - target.offsetWidth - 4);
            const bMax = Math.max(2, window.innerHeight - target.offsetHeight - 4);
            target.style.right = Math.max(2, Math.min(state.fabRight, rMax)) + 'px';
            target.style.bottom = Math.max(2, Math.min(state.fabBottom, bMax)) + 'px';
          }
        } else {
          const left = parseFloat(target.style.left);
          const top = parseFloat(target.style.top);
          if (!isNaN(left) && !isNaN(top)) {
            const pos = clampPos(target, left, top);
            target.style.left = pos.x + 'px';
            target.style.top = pos.y + 'px';
            state.panelPos = pos;
            store.set('panelPos', pos);
          }
        }
      }
      target._cwWasDragged = dragStarted;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onUp);
      document.removeEventListener('touchcancel', onUp);
      window.removeEventListener('blur', onUp);
    }

    handle.addEventListener('mousedown', onDown);
    handle.addEventListener('touchstart', onDown, { passive: false });
  }

  /* ============================================================
   *  SPARKLES (Unicode text-based — ✧˖°.⊹࣪˖ vibe)
   * ============================================================ */
  const SPARKLE_CHARS = ['✧', '✦', '⊹', '˖', '°', '·', '࣪', '✩', '✯', '˳', '⋆'];

  function makeSparkle(x, y, size, dx, dy, duration) {
    const sp = document.createElement('span');
    sp.className = 'cw-np-sparkle';
    sp.textContent = SPARKLE_CHARS[Math.floor(Math.random() * SPARKLE_CHARS.length)];
    sp.style.fontSize = size + 'px';
    // position so the glyph's visual center is roughly at (x, y)
    sp.style.left = (x - size / 2) + 'px';
    sp.style.top = (y - size / 2) + 'px';
    sp.style.setProperty('--dx', dx + 'px');
    sp.style.setProperty('--dy', dy + 'px');
    sp.style.animation = `cwSpkFloat ${duration}s ease-out forwards`;
    document.body.appendChild(sp);
    setTimeout(() => sp.remove(), duration * 1000 + 300);
  }

  function spawnSparkleBurst(x, y, count) {
    if (!state.sparklesEnabled) return;
    for (let i = 0; i < count; i++) {
      const size = 12 + Math.random() * 12;       // 12–24px font
      const angle = Math.random() * Math.PI * 2;
      const dist = 20 + Math.random() * 60;
      const dx = Math.cos(angle) * dist;
      const dy = Math.sin(angle) * dist;
      makeSparkle(x, y, size, dx, dy, 0.8 + Math.random() * 0.7);
    }
  }

  // ambient sparkles around panel when visible
  function ambientSparkles() {
    if (!state.sparklesEnabled) return;
    if (state.collapsed) return;
    const rect = panel.getBoundingClientRect();
    if (rect.width === 0) return;
    for (let i = 0; i < 2; i++) {
      const size = 8 + Math.random() * 10;        // 8–18px font
      const sx = rect.left + Math.random() * rect.width;
      const sy = rect.top + Math.random() * rect.height;
      const angle = Math.random() * Math.PI * 2;
      const dist = 15 + Math.random() * 40;
      const dx = Math.cos(angle) * dist;
      const dy = (Math.sin(angle) * dist) - 30;   // drift slightly upward
      makeSparkle(sx, sy, size, dx, dy, 1.2 + Math.random() * 1.2);
    }
  }

  function startAmbientSparkles() {
    if (state.sparkleTimer) clearInterval(state.sparkleTimer);
    state.sparkleTimer = null;
    if (!state.sparklesEnabled) return;
    state.sparkleTimer = setInterval(ambientSparkles, 600);
  }

  /* ============================================================
   *  SECTIONS RENDER
   * ============================================================ */
  /* ============================================================
   *  BB-CODE PARSER
   *  Escapes HTML first, then converts BB-codes to safe HTML.
   *  Supported: [b] [i] [u] [s] [color=X] [size=X] [bg=X]
   *             [url] [url=X] [img] [quote] [quote=X] [code]
   *             [h1] [h2] [h3] [center] [left] [right]
   *             [list] [*] [hr] [spoiler]
   * ============================================================ */
  function escapeHtml(s) {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function sanitizeColor(v) {
    if (!v) return null;
    v = v.trim();
    // hex: 3-digit, 6-digit, or 8-digit (with alpha)
    if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v)) return v;
    if (/^rgba?\([^)]*\)$/.test(v)) return v;
    // named colors
    if (/^[a-zA-Z]+$/.test(v) && v.length < 24) {
      const test = document.createElement('span');
      test.style.color = v;
      if (test.style.color) return v;
    }
    return null;
  }

  function sanitizeSize(v) {
    if (!v) return null;
    const n = parseInt(v, 10);
    if (isNaN(n) || n < 8 || n > 48) return null;
    return n + 'px';
  }

  function bbcodeToHtml(text) {
    if (!text) return '';

    // 1. Extract [code] blocks → preserve verbatim, replace with placeholders
    const codeBlocks = [];
    text = text.replace(/\[code\]([\s\S]*?)\[\/code\]/gi, (m, content) => {
      codeBlocks.push(content);
      return `\u0000CODE${codeBlocks.length - 1}\u0000`;
    });

    // 2. Escape the rest
    let s = escapeHtml(text);

    // 3. Restore code blocks as <pre><code>
    s = s.replace(/\u0000CODE(\d+)\u0000/g, (m, i) => {
      const c = escapeHtml(codeBlocks[parseInt(i, 10)] || '');
      return `<pre class="cw-bb-code"><code>${c}</code></pre>`;
    });

    // 4. [url=X]text[/url] and [url]url[/url]
    s = s.replace(/\[url=(https?:\/\/[^\]]+)\]([\s\S]*?)\[\/url\]/gi,
      (m, url, label) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`);
    s = s.replace(/\[url\](https?:\/\/[^\]]+)\[\/url\]/gi,
      (m, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);

    // 5. [img]url[/img]
    s = s.replace(/\[img\](https?:\/\/[^\]]+)\[\/img\]/gi,
      (m, url) => `<img class="cw-bb-img" src="${url}" alt="" loading="lazy" />`);

    // 5b. [copy]text[/copy] — clickable chip; click copies the (rendered) textContent.
    //     Processed AFTER [img]/[url] but BEFORE [b]/[i]/[u]/[s] — that way
    //     formatting inside [copy] still renders visually, and on click we
    //     read textContent which is the rendered plain text (without tags).
    s = s.replace(/\[copy\]([\s\S]*?)\[\/copy\]/gi, '<span class="cw-bb-copy">$1</span>');

    // 6. [color=X]text[/color]
    s = s.replace(/\[color=([^\]]+)\]([\s\S]*?)\[\/color\]/gi, (m, col, inner) => {
      const c = sanitizeColor(col);
      return c ? `<span style="color:${c}">${inner}</span>` : inner;
    });

    // 7. [bg=X]text[/bg]  background highlight
    s = s.replace(/\[bg=([^\]]+)\]([\s\S]*?)\[\/bg\]/gi, (m, col, inner) => {
      const c = sanitizeColor(col);
      return c ? `<span style="background:${c};padding:0 3px;border-radius:3px">${inner}</span>` : inner;
    });

    // 8. [size=X]text[/size]
    s = s.replace(/\[size=([^\]]+)\]([\s\S]*?)\[\/size\]/gi, (m, sz, inner) => {
      const n = sanitizeSize(sz);
      return n ? `<span style="font-size:${n}">${inner}</span>` : inner;
    });

    // 9. [quote] and [quote=X]
    s = s.replace(/\[quote=([^\]]+)\]([\s\S]*?)\[\/quote\]/gi,
      (m, who, inner) => `<blockquote class="cw-bb-quote"><div class="cw-bb-quote-author">${who} написал(а):</div>${inner}</blockquote>`);
    s = s.replace(/\[quote\]([\s\S]*?)\[\/quote\]/gi,
      (m, inner) => `<blockquote class="cw-bb-quote">${inner}</blockquote>`);

    // 10. [spoiler]text[/spoiler]
    s = s.replace(/\[spoiler(?:=([^\]]+))?\]([\s\S]*?)\[\/spoiler\]/gi,
      (m, label, inner) => {
        const lbl = label || 'Спойлер (кликни чтобы показать)';
        return `<details class="cw-bb-spoiler"><summary>${lbl}</summary>${inner}</details>`;
      });

    // 11. Headings
    s = s.replace(/\[h1\]([\s\S]*?)\[\/h1\]/gi, '<h3 class="cw-bb-h1">$1</h3>');
    s = s.replace(/\[h2\]([\s\S]*?)\[\/h2\]/gi, '<h4 class="cw-bb-h2">$1</h4>');
    s = s.replace(/\[h3\]([\s\S]*?)\[\/h3\]/gi, '<h5 class="cw-bb-h3">$1</h5>');

    // 12. Alignment
    s = s.replace(/\[center\]([\s\S]*?)\[\/center\]/gi, '<div style="text-align:center">$1</div>');
    s = s.replace(/\[left\]([\s\S]*?)\[\/left\]/gi, '<div style="text-align:left">$1</div>');
    s = s.replace(/\[right\]([\s\S]*?)\[\/right\]/gi, '<div style="text-align:right">$1</div>');

    // 13. Simple tags
    s = s.replace(/\[b\]([\s\S]*?)\[\/b\]/gi, '<strong>$1</strong>');
    s = s.replace(/\[i\]([\s\S]*?)\[\/i\]/gi, '<em>$1</em>');
    s = s.replace(/\[u\]([\s\S]*?)\[\/u\]/gi, '<u>$1</u>');
    s = s.replace(/\[s\]([\s\S]*?)\[\/s\]/gi, '<span style="text-decoration:line-through">$1</span>');

    // 14. [hr]
    s = s.replace(/\[hr\]/gi, '<hr class="cw-bb-hr" />');

    // 15. [list] with [*]
    s = s.replace(/\[list\]([\s\S]*?)\[\/list\]/gi, (m, inner) => {
      const items = inner.split(/\[\*\]/).slice(1).map(it => `<li>${it.replace(/^\s+|\s+$/g, '')}</li>`).join('');
      return `<ul class="cw-bb-list">${items}</ul>`;
    });
    s = s.replace(/\[list=1\]([\s\S]*?)\[\/list\]/gi, (m, inner) => {
      const items = inner.split(/\[\*\]/).slice(1).map((it, i) => `<li>${i + 1}. ${it.replace(/^\s+|\s+$/g, '')}</li>`).join('');
      return `<ol class="cw-bb-list">${items}</ol>`;
    });

    // 16. Plain URLs (not inside [url]) → clickable links
    s = s.replace(/(?<!["'>=])(https?:\/\/[^\s<\]]+)/g,
      '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');

    // newlines → <br> (skip <pre> blocks)
    const parts = s.split(/(<pre[^>]*>[\s\S]*?<\/pre>)/g);
    s = parts.map(p => p.startsWith('<pre') ? p : p.replace(/\n/g, '<br>')).join('');

    return s;
  }

  function genId() {
    return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  // Clipboard copy — uses the async Clipboard API when available,
  // falls back to a hidden textarea + execCommand for old browsers / HTTPS restrictions.
  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    } else {
      fallbackCopy(text);
    }
  }
  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
  }

  function nextDefaultName() {
    const used = new Set(state.sections.map(s => s.title));
    let n = 1;
    while (used.has('Заметки ' + n)) n++;
    return 'Заметки ' + n;
  }

  // Natural sort: "блоги" < "блоги 1" < "блоги 2" < "блоги 10" (numeric,
  // not lexicographic). Same prefix → no-number comes first; numbers
  // compared as integers. Case-insensitive (З == з). Uses the platform's
  // locale-aware collator with the `numeric` flag.
  function tabCompare(a, b) {
    const at = (a && a.title) || '';
    const bt = (b && b.title) || '';
    return at.localeCompare(bt, undefined, { numeric: true, sensitivity: 'base' });
  }

  const activeEls = { sec: null, content: null, textarea: null, bbbar: null };
  let footerEditBtn, footerSaveBtn;

  function resetFooterEditSave() {
    if (!footerEditBtn || !footerSaveBtn) return;
    footerEditBtn.style.display = '';
    footerSaveBtn.style.display = 'none';
  }

  function renderSections() {
    if (activeEls.sec && activeEls.textarea && activeEls.textarea.classList.contains('editing')) {
      activeEls.sec.content = activeEls.textarea.value;
      store.set('sections', state.sections);
    }
    resetFooterEditSave();
    activeEls.sec = null;
    activeEls.content = null;
    activeEls.textarea = null;
    activeEls.bbbar = null;

    // Preserve scroll position across re-renders so switching tabs
    // animates FROM the old position instead of jumping to 0.
    const oldStrip = body.querySelector('.cw-np-tab-strip');
    const oldScroll = oldStrip ? oldStrip.scrollLeft : 0;

    body.innerHTML = '';

    // ----- Tab bar (sections in a single row, ◀ ▶ arrows page sideways) -----
    const tabbar = document.createElement('div');
    tabbar.className = 'cw-np-tabbar';

    const arrowL = document.createElement('div');
    arrowL.className = 'cw-np-tab-arrow left disabled';
    arrowL.innerHTML = icon('chevron-left');
    tabbar.appendChild(arrowL);

    const strip = document.createElement('div');
    strip.className = 'cw-np-tab-strip';
    tabbar.appendChild(strip);

    state.sections.forEach(sec => {
      const tab = document.createElement('div');
      tab.className = 'cw-np-tab' + (sec.id === state.activeId ? ' active' : '');
      tab.dataset.id = sec.id;
      tab.innerHTML = `
        <span class="cw-np-tab-title" contenteditable="true" spellcheck="false"></span>
        <span class="cw-np-tab-close" title="">${icon('x', 10)}</span>
      `;
      tab.querySelector('.cw-np-tab-title').textContent = sec.title;
      strip.appendChild(tab);

      // click on tab (not on title, not on close) → activate
      tab.addEventListener('click', (e) => {
        if (e.target.closest('.cw-np-tab-close')) return;
        if (e.target.classList.contains('cw-np-tab-title') && e.target.isContentEditable) {
          // allow editing; only activate if not focused yet
          if (sec.id !== state.activeId) {
            setActive(sec.id);
          }
          return;
        }
        setActive(sec.id);
      });

      // title editing
      const titleEl = tab.querySelector('.cw-np-tab-title');
      titleEl.addEventListener('blur', () => {
        sec.title = titleEl.textContent.trim() || 'Без названия';
        titleEl.textContent = sec.title;
        store.set('sections', state.sections);
        requestAnimationFrame(updateTabScroll);
      });
      titleEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); titleEl.blur(); }
        e.stopPropagation();
      });
      titleEl.addEventListener('mousedown', (e) => { e.stopPropagation(); });

      // close tab → delete section
      tab.querySelector('.cw-np-tab-close').addEventListener('click', (e) => {
        e.stopPropagation();
        spawnSparkleBurst(e.clientX, e.clientY, 6);
        if (confirm(`Удалить раздел "${sec.title}"?`)) {
          const idx = state.sections.findIndex(s => s.id === sec.id);
          state.sections = state.sections.filter(s => s.id !== sec.id);
          // pick new active
          if (sec.id === state.activeId) {
            if (state.sections.length === 0) {
              state.activeId = null;
            } else {
              const newIdx = Math.min(idx, state.sections.length - 1);
              state.activeId = state.sections[newIdx].id;
            }
          }
          store.set('sections', state.sections);
          store.set('activeId', state.activeId);
          renderSections();
        }
      });
    });

    // ▶ arrow + strip wiring
    const arrowR = document.createElement('div');
    arrowR.className = 'cw-np-tab-arrow right disabled';
    arrowR.innerHTML = icon('chevron-right');
    // rAF-driven ease-out animation — decelerates gently into the target
    // instead of the abrupt stop of the built-in smooth scroll.
    function animateStripTo(target) {
      if (strip._cwScrollRAF) { cancelAnimationFrame(strip._cwScrollRAF); strip._cwScrollRAF = null; }
      const start = strip.scrollLeft;
      const dist = target - start;
      if (Math.abs(dist) < 1) return;
      const dur = Math.max(220, Math.min(560, 140 + Math.abs(dist) * 0.5));
      const t0 = performance.now();
      const ease = t => 1 - Math.pow(1 - t, 3);
      const step = now => {
        const t = Math.min(1, (now - t0) / dur);
        strip.scrollLeft = start + dist * ease(t);
        if (t < 1) strip._cwScrollRAF = requestAnimationFrame(step);
        else strip._cwScrollRAF = null;
      };
      strip._cwScrollRAF = requestAnimationFrame(step);
    }
    function scrollStripBy(delta) {
      // Accumulate rapid clicks into one target so fast paging doesn't undershoot.
      // A gesture stays "alive" for 500ms — clicks inside it extend the target.
      const now = Date.now();
      let target;
      if (strip._cwScrollTarget != null && now - (strip._cwScrollAt || 0) < 500) {
        target = strip._cwScrollTarget;
      } else {
        target = strip.scrollLeft;
      }
      target = Math.max(0, Math.min(strip.scrollWidth - strip.clientWidth, target + delta));
      strip._cwScrollTarget = target;
      strip._cwScrollAt = now;
      animateStripTo(target);
    }
    arrowL.addEventListener('click', (e) => {
      e.stopPropagation();
      scrollStripBy(-strip.clientWidth * 0.8);
    });
    arrowR.addEventListener('click', (e) => {
      e.stopPropagation();
      scrollStripBy(strip.clientWidth * 0.8);
    });
    strip.addEventListener('scroll', updateTabScroll, { passive: true });
    _tabStrip = strip; _tabArrowL = arrowL; _tabArrowR = arrowR;
    tabbar.appendChild(arrowR);

    // "+" add-tab button — inline at the end of the tab row
    const addTab = document.createElement('div');
    addTab.className = 'cw-np-tab-add';
    addTab.innerHTML = icon('plus');
    addTab.title = '';
    addTab.addEventListener('click', (e) => {
      e.stopPropagation();
      addSection();
      spawnSparkleBurst(e.clientX, e.clientY, 6);
    });
    tabbar.appendChild(addTab);

    body.appendChild(tabbar);

    // Restore scroll position from before the re-render so the animation
    // starts from where the user was, not from 0.
    strip.scrollLeft = oldScroll;

    // ----- Active section content (opens separately) -----
    if (!state.activeId) {
      const empty = document.createElement('div');
      empty.className = 'cw-np-empty';
      empty.textContent = 'Нет разделов. Нажми на плюс в строке вкладок, чтобы создать первый.';
      body.appendChild(empty);
      return;
    }

    const sec = state.sections.find(s => s.id === state.activeId);
    if (!sec) {
      state.activeId = null;
      store.set('activeId', null);
      const empty = document.createElement('div');
      empty.className = 'cw-np-empty';
      empty.textContent = 'Нет разделов. Нажми на плюс в строке вкладок, чтобы создать первый.';
      body.appendChild(empty);
      return;
    }

    const wrap = document.createElement('div');
    wrap.className = 'cw-np-sec-wrap';
    wrap.innerHTML = `
      <div class="cw-np-bbbar" data-el="bbbar">
        <span class="cw-np-bbbtn" data-bb="b" title="">B</span>
        <span class="cw-np-bbbtn" data-bb="i" title=""><i>I</i></span>
        <span class="cw-np-bbbtn" data-bb="u" title=""><u>U</u></span>
        <span class="cw-np-bbbtn" data-bb="s" title=""><s>S</s></span>
        <span class="cw-np-bbbtn sep">|</span>
        <span class="cw-np-bbbtn" data-bb="h1" title="">H1</span>
        <span class="cw-np-bbbtn" data-bb="h2" title="">H2</span>
        <span class="cw-np-bbbtn" data-bb="hr" title="">—</span>
        <span class="cw-np-bbbtn sep">|</span>
        <span class="cw-np-bbbtn" data-bb="quote" title="">${icon('quote', 12)}</span>
        <span class="cw-np-bbbtn" data-bb="code" title="">${icon('code', 12)}</span>
        <span class="cw-np-bbbtn" data-bb="spoiler" title="">${icon('eye-off', 12)}</span>
        <span class="cw-np-bbbtn sep">|</span>
        <span class="cw-np-bbbtn" data-bb="center" title="">${icon('align-center', 12)}</span>
        <span class="cw-np-bbbtn" data-bb="list" title="">${icon('list', 12)}</span>
        <span class="cw-np-bbbtn sep">|</span>
        <span class="cw-np-bbbtn" data-bb="img" title="">${icon('image', 12)}</span>
        <span class="cw-np-bbbtn" data-bb="url" title="">${icon('link', 12)}</span>
        <span class="cw-np-bbbtn" data-bb="copy" title="">${icon('clipboard', 12)}</span>
        <span class="cw-np-bbbtn sep">|</span>
        <span class="cw-np-bb-color-row">
          <input type="color" data-bb-color="color" value="#b388ff" title="">
          <span class="cw-np-bbbtn" data-bb-color-apply="color">T</span>
        </span>
        <span class="cw-np-bb-color-row">
          <input type="color" data-bb-color="bg" value="#ffe66d" title="">
          <span class="cw-np-bbbtn" data-bb-color-apply="bg">BG</span>
        </span>
      </div>
      <div class="cw-np-sec-content" data-el="content"></div>
      <textarea class="cw-np-sec-textarea" data-el="textarea" spellcheck="false"></textarea>
    `;
    body.appendChild(wrap);

    // fill (active section content + textarea)
    const content = wrap.querySelector('[data-el="content"]');
    const textarea = wrap.querySelector('[data-el="textarea"]');
    const bbbar = wrap.querySelector('[data-el="bbbar"]');
    content.innerHTML = bbcodeToHtml(sec.content);
    textarea.value = sec.content;

    // populate activeEls so footer Edit/Save buttons can reach these elements
    activeEls.sec = sec;
    activeEls.content = content;
    activeEls.textarea = textarea;
    activeEls.bbbar = bbbar;

    // ---- BB-code toolbar buttons (closures over `textarea`) ----
    function wrapSelection(openTag, closeTag, placeholder) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const before = textarea.value.slice(0, start);
      const sel = textarea.value.slice(start, end) || placeholder || '';
      const after = textarea.value.slice(end);
      const insert = `${openTag}${sel}${closeTag}`;
      textarea.value = before + insert + after;
      // Select only the content BETWEEN the tags (not the tags themselves),
      // so the user can immediately type/replace the text while keeping the
      // BB-code tags intact.
      const selStart = start + openTag.length;
      const selEnd = selStart + sel.length;
      textarea.setSelectionRange(selStart, selEnd);
      textarea.focus();
      spawnSparkleBurst(textarea.getBoundingClientRect().left + 100, textarea.getBoundingClientRect().top + 12, 4);
    }

    function insertAtCursor(text) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const before = textarea.value.slice(0, start);
      const after = textarea.value.slice(end);
      textarea.value = before + text + after;
      textarea.setSelectionRange(start + text.length, start + text.length);
      textarea.focus();
    }

    bbbar.querySelectorAll('[data-bb]').forEach(btn => {
      btn.addEventListener('click', () => {
        const tag = btn.dataset.bb;
        switch (tag) {
          case 'hr':     insertAtCursor('\n[hr]\n'); break;
          case 'list':   wrapSelection('[list]\n[*]', '\n[/list]', 'пункт'); break;
          case 'img':    wrapSelection('[img]', '[/img]', 'https://'); break;
          case 'url': {
            // Insert [url=]label[/url] (no preset https://) and place the
            // caret between `=` and `]` so the user can paste the URL right away.
            const s = textarea.selectionStart;
            const e = textarea.selectionEnd;
            const before = textarea.value.slice(0, s);
            const sel = textarea.value.slice(s, e) || 'текст ссылки';
            const after = textarea.value.slice(e);
            const insert = `[url=]${sel}[/url]`;
            textarea.value = before + insert + after;
            // `[url=` is 5 chars → caret at offset 5 sits between `=` and `]`.
            textarea.setSelectionRange(s + 5, s + 5);
            textarea.focus();
            spawnSparkleBurst(textarea.getBoundingClientRect().left + 100, textarea.getBoundingClientRect().top + 12, 4);
            break;
          }
          case 'spoiler':wrapSelection('[spoiler=Спойлер]', '[/spoiler]', 'скрытый текст'); break;
          case 'quote':  wrapSelection('[quote]', '[/quote]', 'цитируемый текст'); break;
          case 'code':   wrapSelection('[code]', '[/code]', 'код'); break;
          case 'center': wrapSelection('[center]', '[/center]', 'по центру'); break;
          default:       wrapSelection(`[${tag}]`, `[/${tag}]`, 'текст');
        }
      });
    });

    bbbar.querySelectorAll('[data-bb-color-apply]').forEach(btn => {
      btn.addEventListener('click', () => {
        const kind = btn.dataset.bbColorApply; // 'color' or 'bg'
        const colorInput = bbbar.querySelector(`input[data-bb-color="${kind}"]`);
        const c = colorInput.value;
        wrapSelection(`[${kind}=${c}]`, `[/${kind}]`, 'цветной текст');
      });
    });

    // intercept link clicks (open in new tab)
    content.addEventListener('click', (ev) => {
      const a = ev.target.closest('a');
      if (a && a.href) {
        ev.preventDefault();
        window.open(a.href, '_blank', 'noopener,noreferrer');
        spawnSparkleBurst(ev.clientX, ev.clientY, 5);
        return;
      }
      // [copy] chip — copies the rendered plain text (textContent) to clipboard
      const copyEl = ev.target.closest('.cw-bb-copy');
      if (copyEl) {
        ev.preventDefault();
        const text = copyEl.textContent || '';
        copyToClipboard(text);
        // Visual feedback: swap text to "✓ Скопировано" briefly
        const orig = copyEl.innerHTML;
        copyEl.classList.add('copied');
        copyEl.textContent = '✓ Скопировано';
        setTimeout(() => {
          copyEl.classList.remove('copied');
          copyEl.innerHTML = orig;
        }, 1200);
        spawnSparkleBurst(ev.clientX, ev.clientY, 6);
      }
    });

    // After render: bring the active tab into view if it's clipped.
    // Arrows are always visible (just dimmed when disabled), so the strip
    // width is STABLE — no layout catch-22 with arrows appearing/disappearing.
    requestAnimationFrame(() => {
      const activeTab = strip.querySelector('.cw-np-tab.active');
      if (activeTab) {
        const sr = strip.getBoundingClientRect();
        const ar = activeTab.getBoundingClientRect();
        let target = strip.scrollLeft;
        if (ar.right - ar.left >= sr.right - sr.left && (ar.left < sr.left - 1 || ar.right > sr.right + 1)) {
          target = strip.scrollLeft + (ar.left - sr.left) - 6;
        } else if (ar.left < sr.left - 1) {
          target = strip.scrollLeft + (ar.left - sr.left) - 6;
        } else if (ar.right > sr.right + 1) {
          target = strip.scrollLeft + (ar.right - sr.right) + 6;
        }
        // Clamp to valid range (stable now — arrows don't change layout)
        const maxScroll = Math.max(0, strip.scrollWidth - strip.clientWidth);
        target = Math.max(0, Math.min(maxScroll, target));
        if (Math.abs(target - strip.scrollLeft) > 1) {
          animateStripTo(target);
        }
      }
      updateTabScroll();
      setTimeout(updateTabScroll, 350);
      setTimeout(updateTabScroll, 650);
    });
  }

  function setActive(id) {
    if (state.activeId === id) return;
    state.activeId = id;
    store.set('activeId', id);
    renderSections();
    const rect = panel.getBoundingClientRect();
    spawnSparkleBurst(rect.left + 170, rect.top + 90, 8);
  }

  /* ============================================================
   *  ACTIONS
   * ============================================================ */
  function addSection() {
    const sec = { id: genId(), title: nextDefaultName(), content: '' };
    state.sections.push(sec);
    state.activeId = sec.id;
    store.set('sections', state.sections);
    store.set('activeId', sec.id);
    renderSections();
    // focus the new tab title for editing
    setTimeout(() => {
      const tab = body.querySelector(`.cw-np-tab[data-id="${sec.id}"]`);
      if (tab) {
        tab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
        const title = tab.querySelector('.cw-np-tab-title');
        if (title) {
          title.focus();
          const r = document.createRange();
          r.selectNodeContents(title);
          const s = window.getSelection();
          s.removeAllRanges();
          s.addRange(r);
        }
        const rect = tab.getBoundingClientRect();
        spawnSparkleBurst(rect.left + rect.width / 2, rect.top + rect.height / 2, 10);
      }
    }, 50);
  }

  function exportData() {
    const data = {
      sections: state.sections,
      colors: state.colors,
      exportedAt: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'catwar-notepad-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    URL.revokeObjectURL(url);
    spawnSparkleBurst(panel.getBoundingClientRect().left + 170, panel.getBoundingClientRect().top + 200, 14);
  }

  function importData(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (Array.isArray(data.sections)) {
          const seen = new Set();
          const cleaned = [];
          for (const raw of data.sections) {
            if (!raw || typeof raw !== 'object') continue;
            let id = raw.id;
            if (!id || seen.has(id)) id = genId();
            seen.add(id);
            cleaned.push({
              id,
              title: typeof raw.title === 'string' ? raw.title : 'Без названия',
              content: typeof raw.content === 'string' ? raw.content : ''
            });
          }
          state.sections = cleaned;
          state.activeId = state.sections[0] ? state.sections[0].id : null;
          store.set('sections', state.sections);
          store.set('activeId', state.activeId);
        }
        if (data.colors && typeof data.colors === 'object') {
          state.colors = Object.assign({}, DEFAULTS.colors, data.colors);
          store.set('colors', state.colors);
          applyColors();
        }
        renderSections();
        spawnSparkleBurst(window.innerWidth / 2, window.innerHeight / 2, 20);
      } catch (err) {
        alert('Ошибка импорта: ' + err.message);
      }
    };
    reader.readAsText(file);
  }

  function toggleLock() {
    state.locked = !state.locked;
    store.set('locked', state.locked);
    applyLocked();
    spawnSparkleBurst(lockBtn.getBoundingClientRect().left + 14, lockBtn.getBoundingClientRect().top + 14, 10);
  }

  function toggleSettings() {
    state.settingsOpen = !state.settingsOpen;
    settings.classList.toggle('open', state.settingsOpen);
    const btn = panel.querySelector('[data-act="settings"]');
    btn.classList.toggle('active', state.settingsOpen);
  }

  function toggleCollapse() {
    state.collapsed = !state.collapsed;
    _pathStates[_currentPath] = state.collapsed;
    store.set('pathStates', _pathStates);
    applyCollapsed();
    if (!state.collapsed) {
      // Panel just expanded — if it was collapsed on load, the initial
      // auto-scroll rAF ran with 0-width rects (display:none). Re-run it now.
      requestAnimationFrame(() => {
        const strip = _tabStrip;
        if (!strip) return;
        const activeTab = strip.querySelector('.cw-np-tab.active');
        if (!activeTab) return;
        const sr = strip.getBoundingClientRect();
        const ar = activeTab.getBoundingClientRect();
        let target = strip.scrollLeft;
        if (ar.left < sr.left - 1) {
          target = strip.scrollLeft + (ar.left - sr.left) - 6;
        } else if (ar.right > sr.right + 1) {
          target = strip.scrollLeft + (ar.right - sr.right) + 6;
        }
        const maxScroll = Math.max(0, strip.scrollWidth - strip.clientWidth);
        target = Math.max(0, Math.min(maxScroll, target));
        if (Math.abs(target - strip.scrollLeft) > 1) {
          strip.scrollLeft = target;
          updateTabScroll();
        }
      });
      const rect = panel.getBoundingClientRect();
      spawnSparkleBurst(rect.left + rect.width / 2, rect.top + rect.height / 2, 16);
    }
  }

  /* ============================================================
   *  WIRE UP
   * ============================================================ */
  // FAB click toggles panel
  fab.addEventListener('click', (e) => {
    if (e.detail === 0) return;
    // If the FAB was actually dragged (not just clicked), suppress the
    // synthetic click that fires after mouseup — otherwise dragging the
    // FAB would also collapse/expand the panel.
    if (fab._cwWasDragged) {
      fab._cwWasDragged = false;
      return;
    }
    e.stopPropagation();
    toggleCollapse();
    if (!state.collapsed) {
      const rect = panel.getBoundingClientRect();
      spawnSparkleBurst(rect.left + rect.width / 2, rect.top + rect.height / 2, 12);
    }
  });

  // Panel header buttons
  lockBtn.addEventListener('click', toggleLock);
  collapseBtn.addEventListener('click', toggleCollapse);
  panel.querySelector('[data-act="settings"]').addEventListener('click', toggleSettings);

  // ➤ header button — dropdown with all tabs
  const tabsMenuBtn = panel.querySelector('[data-act="tabs"]');
  tabsMenuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openTabMenu(tabsMenuBtn);
  });

  footerEditBtn = panel.querySelector('.cw-np-footer [data-act="edit"]');
  footerSaveBtn = panel.querySelector('.cw-np-footer [data-act="save"]');

  footerEditBtn.addEventListener('click', () => {
    if (!activeEls.content) return;
    activeEls.content.classList.add('editing');
    activeEls.textarea.classList.add('editing');
    activeEls.bbbar.classList.add('editing');
    footerEditBtn.style.display = 'none';
    footerSaveBtn.style.display = 'inline-flex';
    activeEls.textarea.focus();
    activeEls.textarea.setSelectionRange(activeEls.textarea.value.length, activeEls.textarea.value.length);
    spawnSparkleBurst(footerEditBtn.getBoundingClientRect().left + 12, footerEditBtn.getBoundingClientRect().top + 12, 6);
  });

  footerSaveBtn.addEventListener('click', () => {
    if (!activeEls.sec) return;
    activeEls.sec.content = activeEls.textarea.value;
    activeEls.content.innerHTML = bbcodeToHtml(activeEls.sec.content);
    activeEls.content.classList.remove('editing');
    activeEls.textarea.classList.remove('editing');
    activeEls.bbbar.classList.remove('editing');
    footerEditBtn.style.display = '';
    footerSaveBtn.style.display = 'none';
    store.set('sections', state.sections);
    const r = footerEditBtn.getBoundingClientRect();
    spawnSparkleBurst(r.left + 12, r.top + 12, 8);
  });

  panel.querySelector('.cw-np-footer [data-act="export"]').addEventListener('click', exportData);
  panel.querySelector('.cw-np-footer [data-act="import"]').addEventListener('click', () => fileInput.click());
  panel.querySelector('.cw-np-footer [data-act="sortTabs"]').addEventListener('click', (e) => {
    e.stopPropagation();
    if (state.sections.length < 2) {
      spawnSparkleBurst(e.clientX, e.clientY, 4);
      return;
    }
    state.sections.sort(tabCompare);
    store.set('sections', state.sections);
    renderSections();
    spawnSparkleBurst(e.clientX, e.clientY, 8);
  });
  panel.querySelector('.cw-np-footer [data-act="clearAll"]').addEventListener('click', (e) => {
    spawnSparkleBurst(e.clientX, e.clientY, 6);
    if (!confirm('Удалить все вкладки вместе с содержимым? Это действие нельзя отменить.')) return;
    const fresh = { id: 's' + Date.now(), title: 'Заметки 1', content: '' };
    state.sections = [fresh];
    state.activeId = fresh.id;
    store.set('sections', state.sections);
    store.set('activeId', state.activeId);
    renderSections();
  });
  fileInput.addEventListener('change', (e) => {
    if (e.target.files[0]) importData(e.target.files[0]);
    fileInput.value = '';
  });

  // Settings color inputs
  settings.querySelectorAll('input[type="color"]').forEach(inp => {
    inp.addEventListener('input', () => {
      const key = inp.dataset.color;
      let newVal = inp.value;
      const oldVal = state.colors[key] || '';
      if (oldVal.length === 9 && oldVal.startsWith('#')) {
        newVal = newVal + oldVal.slice(7);
      }
      state.colors[key] = newVal;
      const txtInp = settings.querySelector(`input[type="text"][data-colortext="${key}"]`);
      if (txtInp) txtInp.value = newVal;
      applyColors();
      store.set('colors', state.colors);
    });
  });
  settings.querySelectorAll('input[type="text"]').forEach(inp => {
    inp.addEventListener('change', () => {
      const key = inp.dataset.colortext;
      let v = inp.value.trim();
      if (/^#[0-9a-fA-F]{3}$/.test(v)) {
        v = '#' + v.slice(1).split('').map(c => c + c).join('');
        inp.value = v;
      }
      if (!/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(v)) {
        inp.value = state.colors[key];
        return;
      }
      state.colors[key] = v;
      const pickerInp = settings.querySelector(`input[type="color"][data-color="${key}"]`);
      if (pickerInp) pickerInp.value = toHexColor(v);
      applyColors();
      store.set('colors', state.colors);
    });
  });
  panel.querySelector('[data-act="resetColors"]').addEventListener('click', () => {
    state.colors = Object.assign({}, DEFAULTS.colors);
    state.fontSize = DEFAULTS.fontSize;
    store.set('colors', state.colors);
    store.set('fontSize', state.fontSize);
    applyColors();
    spawnSparkleBurst(panel.getBoundingClientRect().left + 170, panel.getBoundingClientRect().top + 200, 14);
  });

  // Font size slider
  const fontSizeSlider = settings.querySelector('input[data-fontsize]');
  if (fontSizeSlider) {
    fontSizeSlider.addEventListener('input', () => {
      const v = parseFloat(fontSizeSlider.value);
      if (!isNaN(v)) {
        state.fontSize = v;
        store.set('fontSize', v);
        applyFontSize();
      }
    });
  }

  // Sparkles toggle
  const sparklesToggle = panel.querySelector('[data-toggle-text="sparkles"]');
  function syncSparklesToggleUI() {
    if (!sparklesToggle) return;
    const on = !!state.sparklesEnabled;
    sparklesToggle.textContent = on ? 'ВКЛ' : 'ВЫКЛ';
    sparklesToggle.classList.toggle('on', on);
    sparklesToggle.classList.toggle('off', !on);
  }
  syncSparklesToggleUI();
  sparklesToggle.addEventListener('click', () => {
    state.sparklesEnabled = !state.sparklesEnabled;
    store.set('sparklesEnabled', state.sparklesEnabled);
    syncSparklesToggleUI();
    // Restart the ambient interval so it stops when disabled, restarts when re-enabled
    startAmbientSparkles();
    if (state.sparklesEnabled) {
      const r = sparklesToggle.getBoundingClientRect();
      spawnSparkleBurst(r.left + r.width / 2, r.top + r.height / 2, 10);
    }
  });

  // Draggable
  makeDraggable(panel.querySelector('.cw-np-header'), panel, 'panel');
  makeDraggable(fab, fab, 'fab');

  /* ============================================================
   *  INIT
   * ============================================================ */
  applyColors();
  applyPositions();
  applyLocked();
  applyCollapsed();
  renderSections();
  startAmbientSparkles();

  // Debounced resize — applyPositions + updateTabScroll are layout-reads,
  // fire many times during a drag-resize.
  let _resizeT;
  window.addEventListener('resize', () => {
    clearTimeout(_resizeT);
    _resizeT = setTimeout(() => {
      applyPositions();
      updateTabScroll();
    }, 120);
  });

  window.addEventListener('beforeunload', () => {
    if (activeEls.sec && activeEls.textarea && activeEls.textarea.classList.contains('editing')) {
      activeEls.sec.content = activeEls.textarea.value;
      store.set('sections', state.sections);
    }
  });

  const _authorSpan = panel.querySelector('[data-author]');
  if (_authorSpan) _authorSpan.textContent = _cwAuthor;
  const _headerTitle = panel.querySelector('.cw-np-title');
  if (_headerTitle) _headerTitle.title = 'CatWar Notepad by ' + _cwAuthor;
  root.setAttribute('data-cw-author', _cwAuthor);
  console.log('CatWar Notepad by ' + _cwAuthor);
})();
