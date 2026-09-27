/* app.js — Thompson Study Companion: router, views, notes, backup, PWA glue */
(function () {
  'use strict';
  const B = window.B;
  const esc = B.esc;

  // ============================== store ==============================
  const KEY = 'thompson-study-v1';
  // storage can be blocked on file:// origins — fall back to memory so the app still works
  let __mem = null, __storageBlocked = false;
  function lsGet(k) {
    try { return localStorage.getItem(k); } catch (e) { __storageBlocked = true; return __mem ? __mem[k] : null; }
  }
  function lsSet(k, v) {
    try { localStorage.setItem(k, v); } catch (e) { __storageBlocked = true; if (!__mem) __mem = {}; __mem[k] = v; }
  }
  const store = {
    notes: {}, favs: {}, hl: {}, settings: { theme: 'auto', popupLang: 'both', rmode: 'both' },
    reader: { b: 43, c: 3 }
  };
  function load() {
    try {
      const raw = lsGet(KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (d.notes) store.notes = d.notes;
        if (d.favs) store.favs = d.favs;
        if (d.hl) store.hl = d.hl;
        if (d.settings) store.settings = Object.assign(store.settings, d.settings);
        if (d.reader) store.reader = Object.assign(store.reader, d.reader);
      }
    } catch (e) { /* fresh start */ }
  }
  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      lsSet(KEY, JSON.stringify(store));
    }, 250);
  }

  // ============================== helpers ==============================
  const $ = function (sel, root) { return (root || document).querySelector(sel); };
  const view = $('#view');
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.hidden = true; }, 2600);
  }
  function fmtDate(ts) {
    try { return new Date(ts).toLocaleString(); } catch (e) { return ''; }
  }
  function topicById(id) {
    const ts = window.NUM_INDEX && window.NUM_INDEX.topics || [];
    for (let i = 0; i < ts.length; i++) if (ts[i].n === id) return ts[i];
    return null;
  }

  // theme
  function applyTheme() {
    const t = store.settings.theme;
    let dark = t === 'dark';
    try { if (t === 'auto' && window.matchMedia) dark = matchMedia('(prefers-color-scheme: dark)').matches; } catch (e) {}
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    document.documentElement.setAttribute('data-lang', store.settings.popupLang);
    document.documentElement.setAttribute('data-rmode', store.settings.rmode);
  }
  try { if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme); } catch (e) {}

  // body-line renderer with verse/topic links
  function lineHTML(text, opts) {
    opts = opts || {};
    let html = B.linkVerses(text);
    if (opts.topicsAll) {
      const parts = html.split(/(<[^>]+>)/);
      for (let i = 0; i < parts.length; i += 2) {
        parts[i] = parts[i].replace(/\b(\d{3,4}[a-z]?)(–\d{3,4}[a-z]?)?\b/g, function (all, a, b2) {
          if (!B.TOPICMAP[a] && !B.CHARMAP[a]) return all;
          return '<a class="tlink" ' + (B.TOPICMAP[a] ? 'data-topic' : 'data-char') + '="' + a + '">' + all + '</a>';
        });
      }
      html = parts.join('');
    } else {
      html = topicLinkGuarded(html, text);
    }
    return html;
  }
  function topicLinkGuarded(html, raw) {
    if (!/^(→|\(M\.|See )|\bSee\b|,\s?\d{3,4}/.test(raw)) return html;
    const parts = html.split(/(<[^>]+>)/);
    for (let i = 0; i < parts.length; i += 2) {
      parts[i] = parts[i].replace(/\b(\d{3,4}[a-z]?)(–\d{3,4}[a-z]?)?\b/g, function (all, a) {
        if (!B.TOPICMAP[a] && !B.CHARMAP[a]) return all;
        return '<a class="tlink" ' + (B.TOPICMAP[a] ? 'data-topic' : 'data-char') + '="' + a + '">' + all + '</a>';
      });
    }
    return parts.join('');
  }

  function bodyLinesHTML(lines, opts) {
    let out = '';
    (lines || []).forEach(function (l) {
      if (/^[a-z]\.\s/.test(l) && l.length < 90) {
        out += '<p class="bodyline subitem"><b>' + lineHTML(l, opts) + '</b></p>';
      } else if (/^\d+\.\s/.test(l) && l.length < 80) {
        out += '<p class="bodyline subitem"><b>' + lineHTML(l, opts) + '</b></p>';
      } else if (l.indexOf('→') === 0) {
        out += '<p class="bodyline chain">' + lineHTML(l, opts) + '</p>';
      } else if (l === l.toUpperCase() && l.length > 3 && l.length < 60 && !/\d/.test(l)) {
        out += '<div class="sec-header">' + esc(l) + '</div>';
      } else if (/\s{3,}/.test(l)) {
        const seg = l.split(/\s{3,}/);
        out += '<div class="toc-item"><span>' + lineHTML(seg[0], opts) + '</span><span>' + lineHTML(seg.slice(1).join(' — '), opts) + '</span></div>';
      } else {
        out += '<p class="bodyline">' + lineHTML(l, opts) + '</p>';
      }
    });
    return out;
  }

  // note editor
  function noteEditorHTML(anchor, label) {
    const n = store.notes[anchor];
    return '<div class="card note-editor" data-note="' + esc(anchor) + '">' +
      '<div class="sec-header">✏️ My note — <span class="note-anchor-label">' + esc(label) + '</span></div>' +
      '<textarea placeholder="Write your study note here… (auto-saved on Save)">' + (n ? esc(n.t) : '') + '</textarea>' +
      '<div class="note-actions">' +
      '<button class="btn note-save">Save</button>' +
      (n ? '<button class="btn secondary note-del">Delete</button>' : '') +
      '<button class="btn secondary note-close">Close</button></div></div>';
  }
  function bindNoteEditor(rootEl) {
    const card = rootEl.querySelector('.note-editor');
    if (!card) return;
    const anchor = card.getAttribute('data-note');
    const label = card.querySelector('.note-anchor-label').textContent;
    const ta = card.querySelector('textarea');
    card.querySelector('.note-save').addEventListener('click', function () {
      const t = ta.value.trim();
      if (t) store.notes[anchor] = { t: t, u: Date.now(), label: label };
      else delete store.notes[anchor];
      save();
      toast('Note saved');
      // refresh editor state (keeps editor open, updates Delete button)
      const mount = card.parentElement;
      card.remove();
      if (mount) {
        mount.insertAdjacentHTML('beforeend', noteEditorHTML(anchor, label));
        bindNoteEditor(mount);
      }
    });
    const del = card.querySelector('.note-del');
    if (del) del.addEventListener('click', function () {
      delete store.notes[anchor]; save(); toast('Note deleted'); location.hash = location.hash;
    });
    card.querySelector('.note-close').addEventListener('click', function () {
      const c = rootEl.querySelector('.note-editor'); if (c) c.remove();
    });
  }

  // favourites button
  function favBtnHTML(anchor, label) {
    const on = !!store.favs[anchor];
    return '<button class="chip fav-btn" data-fav="' + esc(anchor) + '" data-label="' + esc(label) + '">' +
      (on ? '★ Starred' : '☆ Star') + '</button>';
  }

  // ============================== views ==============================
  const SECTIONS = [
    { id: 'topics', ico: '⛓️', name: 'Numerical Index of Topics', desc: 'All 4,000+ chain-reference topics in numerical order, fully cross-linked.' },
    { id: 'outline', ico: '📜', name: 'Condensed Outline of the Bible', desc: 'The whole Bible, book by book, in one compact outline.' },
    { id: 'characters', ico: '👤', name: 'Bible Character Studies', desc: 'Biographical sketches, journeys and harmonies.' },
    { id: 'treasury', ico: '💎', name: 'Topical Treasury', desc: 'Suggested topics for every kind of church meeting.' },
      { id: 'workers', ico: '✝️', name: "Christian Worker’s Text", desc: "Memory verses, helps for sharing the Gospel, worship & festivals." },
    { id: 'concordance', ico: '🔎', name: 'KJV Concordance', desc: 'Complete concordance — every word, every reference.' }
  ];

  function vHome() {
    const favs = Object.keys(store.favs).sort(function (a, b) { return store.favs[b].ts - store.favs[a].ts; });
    const nnotes = Object.keys(store.notes).length;
    let html = '<div class="hero">' +
      '<h2>Thompson Chain-Reference<br>Study Companion</h2>' +
      '<p>KJV study helps + integrated తెలుగు Bible — works offline on PC & mobile.</p>' +
      '<form class="quick" id="quickForm"><input type="search" id="quickQ" placeholder="Search topics, words, or a verse (e.g. John 3:16)…"></form>' +
      '</div>';
    if (window.__deferredInstall) {
      html += '<div class="install-banner">📲 <span><b>Install app</b> — add to your home screen / desktop for full-screen, offline use.</span><button class="btn" id="installBtn">Install</button></div>';
    }
    html += '<div class="grid">' + SECTIONS.map(function (s) {
      return '<a class="tile" href="#/' + s.id + '"><span class="t-ico">' + s.ico + '</span><div class="t-name">' + s.name + '</div><div class="t-desc">' + s.desc + '</div></a>';
    }).join('') +
      '<a class="tile" href="#/bible"><span class="t-ico">📖</span><div class="t-name">Bible Reader</div><div class="t-desc">King James Version + Telugu, side by side.</div></a>' +
      '<a class="tile" href="#/notes"><span class="t-ico">✏️</span><div class="t-name">My Notes</div><div class="t-desc">' + nnotes + ' note' + (nnotes === 1 ? '' : 's') + ' · ' + favs.length + ' starred</div></a>' +
      '</div>';
    if (favs.length) {
      html += '<h3 class="page-title" style="font-size:20px;margin-top:22px">★ Starred</h3><div class="grid">' +
        favs.slice(0, 6).map(function (a) {
          const f = store.favs[a];
          const href = a.indexOf('topic:') === 0 ? '#/topic/' + a.slice(6) : a.indexOf('char:') === 0 ? '#/character/' + a.slice(5) : a.indexOf('word:') === 0 ? '#/word/' + a.slice(5) : '#/bible';
          return '<a class="tile" href="' + href + '"><div class="t-name" style="margin:2px 0">' + esc(f.label || a) + '</div></a>';
        }).join('') + '</div>';
    }
    html += '<p class="page-sub" style="margin-top:22px">Content: Thompson Chain-Reference Bible study helps (from your copy) · KJV & Telugu Bible are in the public domain. For personal study.</p>';
    return html;
  }

  // ---------- topics ----------
  const topicsState = { q: '', shown: 150 };
  function vTopics() {
    return '<h1 class="page-title">Numerical Index of Topics</h1>' +
      '<p class="page-sub">Thompson chain-reference topics, in numerical order. Every verse reference is tappable.</p>' +
      '<div class="searchrow"><input type="search" id="topicQ" placeholder="Filter topics by number or word… (e.g. 3431, prayer, Abraham)" value="' + esc(topicsState.q) + '"></div>' +
      '<ul class="rowlist card" id="topicList" style="padding:6px 12px"></ul>' +
      '<div style="text-align:center;margin:12px"><button class="btn secondary" id="moreTopics">Show more</button></div>';
  }
  function renderTopicList() {
    const q = topicsState.q.trim().toLowerCase();
    const topics = window.NUM_INDEX.topics;
    const matches = [];
    for (let i = 0; i < topics.length; i++) {
      const t = topics[i];
      if (!q || t.n.indexOf(q) === 0 || t.t.toLowerCase().indexOf(q) >= 0) matches.push(t);
    }
    const ul = $('#topicList');
    if (!ul) return;
    if (!matches.length) { ul.innerHTML = '<div class="empty">No topics match “' + esc(q) + '”.</div>'; $('#moreTopics').style.display = 'none'; return; }
    let html = '';
    const n = Math.min(matches.length, topicsState.shown);
    for (let i = 0; i < n; i++) {
      const t = matches[i];
      html += '<li><a class="rowlink" href="#/topic/' + encodeURIComponent(t.n) + '">' +
        '<span class="rn">' + esc(t.n) + '</span><span class="rt">' + esc(t.t) + (store.favs['topic:' + t.n] ? '<span class="fav-star">★</span>' : '') + '</span></a></li>';
    }
    ul.innerHTML = html;
    $('#moreTopics').style.display = matches.length > topicsState.shown ? '' : 'none';
    $('#moreTopics').textContent = 'Show more (' + (matches.length - topicsState.shown) + ' remaining)';
  }

  function vTopic(id) {
    const t = topicById(id);
    if (!t) return '<div class="empty">Topic not found. <a href="#/topics">Back to index</a></div>';
    let html = '<p class="page-sub" style="margin-bottom:4px"><a href="#/topics">← Numerical Index</a></p>' +
      '<h1 class="page-title"><span class="entry-num">' + esc(t.n) + '</span>' + lineHTML(t.t) + '</h1>' +
      '<div style="margin:10px 0">' + favBtnHTML('topic:' + t.n, t.n + ' · ' + t.t.split(',')[0].slice(0, 60)) +
      ' <button class="chip note-open" data-note="topic:' + esc(t.n) + '" data-label="' + esc(t.n + ' · ' + t.t.split(',')[0].slice(0, 60)) + '">✏️ Note' + (store.notes['topic:' + t.n] ? ' ✔' : '') + '</button></div>' +
      '<div class="card doc">' + bodyLinesHTML(t.b) + '</div>' +
      '<div id="noteMount"></div>';
    return html;
  }

  // ---------- outline ----------
  function vOutline() {
    const subs = window.OUTLINE.subs;
    let html = '<h1 class="page-title">Condensed Outline of the Bible</h1>' +
      '<p class="page-sub">The whole Bible at a glance — book by book.</p>';
    subs.forEach(function (s) {
      html += '<h2 class="entry-title" style="margin-top:20px">' + esc(s.n + ' ' + s.t) + '</h2><div class="card doc">' +
        bodyLinesHTML(s.b, { topicsAll: true }) + '</div>';
    });
    return html;
  }

  // ---------- characters ----------
  function vCharacters() {
    const items = window.CHARACTERS.items;
    let html = '<h1 class="page-title">Bible Character Studies</h1>' +
      '<p class="page-sub">Biographical sketches, journeys and harmonies — every reference tappable.</p><div class="card" style="padding:6px 12px"><ul class="rowlist">';
    items.forEach(function (c) {
      html += '<li><a class="rowlink" href="#/character/' + encodeURIComponent(c.n) + '"><span class="rn">' + esc(c.n) + '</span><span class="rt">' + esc(c.t) + (store.favs['char:' + c.n] ? '<span class="fav-star">★</span>' : '') + '</span></a></li>';
    });
    return html + '</ul></div>';
  }
  function vCharacter(id) {
    const items = window.CHARACTERS.items;
    let c = null;
    for (let i = 0; i < items.length; i++) if (items[i].n === id) c = items[i];
    if (!c) return '<div class="empty">Not found. <a href="#/characters">Back</a></div>';
    return '<p class="page-sub"><a href="#/characters">← Character Studies</a></p>' +
      '<h1 class="page-title"><span class="entry-num">' + esc(c.n) + '</span>' + esc(c.t) + '</h1>' +
      '<div style="margin:10px 0">' + favBtnHTML('char:' + c.n, c.t.slice(0, 60)) +
      ' <button class="chip note-open" data-note="char:' + esc(c.n) + '" data-label="' + esc(c.t.slice(0, 60)) + '">✏️ Note' + (store.notes['char:' + c.n] ? ' ✔' : '') + '</button></div>' +
      '<div class="card doc">' + bodyLinesHTML(c.b) + '</div><div id="noteMount"></div>';
  }

  // ---------- treasury ----------
  function vTreasury() {
    let html = '<h1 class="page-title">Topical Treasury</h1>' +
      '<p class="page-sub">Practical helps for Christian workers — suggested topics for meetings. Numbers link straight into the chain index.</p>';
    window.TREASURY.groups.forEach(function (g) {
      html += '<h2 class="entry-title" style="margin-top:18px">' + esc(g.t) + '</h2><div class="card"><div class="wordlist-grid">';
      g.items.forEach(function (it) {
        const nums = it.nums.map(function (n) {
          return '<a class="tlink" data-topic="' + esc(n) + '">' + esc(n) + '</a>';
        }).join(', ');
        html += '<div class="word-pill" style="text-align:left">' + esc(it.label) + ' <small>' + nums + '</small></div>';
      });
      html += '</div>' + bodyLinesHTML(g.body) + '</div>';
    });
    return html;
  }

  // ---------- workers ----------
  function vWorkers() {
    let html = '<h1 class="page-title">The Christian Worker\u2019s Text</h1>' +
      '<p class="page-sub">4306–4311: verses for the unconverted, memory verses, memorization aids, places of worship and Hebrew times & festivals.</p>';
    html += '<div class="card" style="padding:6px 12px"><ul class="rowlist">';
    window.WORKERS.subs.forEach(function (s, i) {
      html += '<li><a class="rowlink" href="#/workers/' + i + '"><span class="rt">' + esc(s.t) + '</span></a></li>';
    });
    return html + '</ul></div>';
  }
  function vWorkersSub(i) {
    const s = window.WORKERS.subs[i];
    if (!s) return '<div class="empty">Not found.</div>';
    return '<p class="page-sub"><a href="#/workers">← Worker\u2019s Text</a></p>' +
      '<h1 class="page-title" style="font-size:22px">' + esc(s.t) + '</h1>' +
      '<div class="card doc">' + bodyLinesHTML(s.b, { topicsAll: true }) + '</div>';
  }

  // ---------- concordance ----------
  const concState = { q: '', letter: '' };
  function vConcordance() {
    return '<h1 class="page-title">KJV Concordance</h1>' +
      '<p class="page-sub">Complete concordance — 1,000+ word studies with every reference linked.</p>' +
      '<div class="searchrow"><input type="search" id="concQ" placeholder="Search a word… (e.g. grace, shepherd, ZEAL)" value="' + esc(concState.q) + '"></div>' +
      '<div class="alpha-jump" id="alphaJump"></div>' +
      '<div class="wordlist-grid" id="concGrid"></div>';
  }
  function renderConcordance() {
    const words = window.CONC.words;
    const q = concState.q.trim().toUpperCase();
    const letters = [];
    for (let i = 0; i < words.length; i++) {
      const L = words[i].w.charAt(0).toUpperCase();
      if (letters.indexOf(L) < 0) letters.push(L);
    }
    const jump = $('#alphaJump');
    if (jump) jump.innerHTML = letters.map(function (L) {
      return '<a data-letter="' + L + '" class="' + (concState.letter === L ? 'active' : '') + '" href="javascript:void 0">' + L + '</a>';
    }).join('');
    const grid = $('#concGrid');
    if (!grid) return;
    let html = '';
    let count = 0;
    for (let i = 0; i < words.length && count < 400; i++) {
      const w = words[i];
      if (q && w.w.indexOf(q) < 0) continue;
      if (!q && concState.letter && w.w.charAt(0).toUpperCase() !== concState.letter) continue;
      html += '<div class="word-pill" data-word="' + i + '">' + esc(w.w) + (store.favs['word:' + i] ? ' ★' : '') + '</div>';
      count++;
    }
    grid.innerHTML = html || '<div class="empty">No words found.</div>';
  }
  function vWord(i) {
    const w = window.CONC.words[i];
    if (!w) return '<div class="empty">Not found. <a href="#/concordance">Back</a></div>';
    return '<p class="page-sub"><a href="#/concordance">← Concordance</a></p>' +
      '<h1 class="page-title" style="font-size:24px">' + esc(w.w) + '</h1>' +
      '<div style="margin:10px 0">' + favBtnHTML('word:' + i, w.w) +
      ' <button class="chip note-open" data-note="word:' + i + '" data-label="Concordance: ' + esc(w.w) + '">✏️ Note' + (store.notes['word:' + i] ? ' ✔' : '') + '</button></div>' +
      '<div class="card doc">' + w.l.map(function (l) {
        return '<div class="conc-entry">' + lineHTML(l) + '</div>';
      }).join('') + '</div><div id="noteMount"></div>';
  }

  // ---------- bible reader ----------
  function vBible(b, c) {
    b = b || store.reader.b || 1; c = c || store.reader.c || 1;
    if (!B.verses(b, c)) c = 1;
    store.reader = { b: b, c: c }; save();
    const bmeta = B.bookById(b);
    let html = '<h1 class="page-title" style="font-size:22px">📖 ' + esc(bmeta.n) +
      ' <span class="tel" style="font-family:var(--telugu);font-weight:400;font-size:18px;color:var(--ink2)">' + esc(bmeta.tel) + '</span></h1>' +
      '<div class="bible-controls">' +
      '<select id="selBook">' + B.BOOKS.map(function (bk) {
        return '<option value="' + bk.id + '"' + (bk.id === b ? ' selected' : '') + '>' + bk.id + '. ' + bk.n + '</option>';
      }).join('') + '</select>' +
      '<select id="selChap">' + Array.from({ length: B.chapters(b) }, function (_, i) {
        return '<option value="' + (i + 1) + '"' + (i + 1 === c ? ' selected' : '') + '>Chapter ' + (i + 1) + '</option>';
      }).join('') + '</select>' +
      '<button class="chip" id="rmodeBtn">' + ({ kjv: 'KJV', tel: 'తెలుగు', both: 'KJV + తెలుగు' }[store.settings.rmode]) + '</button>' +
      '</div><div class="reader" id="reader">';
    for (let v = 1; v <= B.verses(b, c); v++) {
      const k = B.verseKey(b, c, v);
      const hasNote = store.notes['verse:' + k];
      html += '<div class="verse-row' + (store.hl[k] ? ' hl' : '') + '" data-b="' + b + '" data-c="' + c + '" data-v="' + v + '">' +
        '<span class="vn">' + v + (hasNote ? '✎' : '') + '</span><span class="vtexts">' +
        '<span class="kjv">' + esc(B.verseText(b, c, v, 'kjv')) + '</span>' +
        '<span class="tel">' + esc(B.verseText(b, c, v, 'tel')) + '</span></span></div>';
    }
    html += '</div><div style="display:flex;justify-content:space-between;margin:14px 4px">' +
      '<a class="chip" href="#/bible?b=' + b + '&c=' + (c > 1 ? c - 1 : 1) + '">← Previous</a>' +
      '<a class="chip" href="#/bible?b=' + b + '&c=' + (c < B.chapters(b) ? c + 1 : c) + '">Next →</a></div>';
    return html;
  }

  // ---------- notes ----------
  function vNotes() {
    const keys = Object.keys(store.notes).sort(function (a, b) { return store.notes[b].u - store.notes[a].u; });
    let html = '<h1 class="page-title">✏️ My Notes</h1>' +
      '<p class="page-sub">All your study notes. Tap to edit; backup & restore from Settings.</p>' +
      '<button class="btn secondary" id="newNote">+ New free note</button><div id="newNoteMount" style="margin-top:8px"></div>';
    if (!keys.length) return html + '<div class="empty">No notes yet. Open any topic, character, concordance word or verse popup and tap “✏️ Note”.</div>';
    html += keys.map(function (k) {
      const n = store.notes[k];
      return '<div class="card note-card" data-notecard="' + esc(k) + '">' +
        '<div class="note-meta">' + esc(n.label || k) + ' · ' + fmtDate(n.u) + '</div>' +
        '<div class="note-text">' + esc(n.t) + '</div>' +
        '<div class="note-actions"><button class="chip note-open" data-note="' + esc(k) + '" data-label="' + esc(n.label || k) + '">Edit</button>' +
        '<button class="chip notecard-del">Delete</button></div></div>';
    }).join('');
    return html;
  }

  // ---------- search ----------
  function vSearch(q) {
    return '<h1 class="page-title">Search</h1>' +
      '<div class="searchrow"><input type="search" id="searchQ" placeholder="Search everything…" value="' + esc(q || '') + '" autofocus></div>' +
      '<div id="searchResults">' + (q ? searchHTML(q) : '<div class="empty">Search across all topics, characters, concordance words and both Bibles (KJV + Telugu).</div>') + '</div>';
  }
  function searchHTML(q) {
    const ql = q.toLowerCase();
    let html = '';
    // topics
    const topics = [];
    for (const t of window.NUM_INDEX.topics) {
      if (t.t.toLowerCase().indexOf(ql) >= 0 || t.n === q) topics.push(t);
      if (topics.length >= 15) break;
    }
    if (topics.length) {
      html += '<div class="sec-header">Topics</div><div class="card" style="padding:6px 12px"><ul class="rowlist">' +
        topics.map(function (t) { return '<li><a class="rowlink" href="#/topic/' + encodeURIComponent(t.n) + '"><span class="rn">' + esc(t.n) + '</span><span class="rt">' + esc(t.t) + '</span></a></li>'; }).join('') + '</ul></div>';
    }
    // characters
    const chars = window.CHARACTERS.items.filter(function (c) { return c.t.toLowerCase().indexOf(ql) >= 0; }).slice(0, 8);
    if (chars.length) {
      html += '<div class="sec-header">Characters</div><div class="card" style="padding:6px 12px"><ul class="rowlist">' +
        chars.map(function (c) { return '<li><a class="rowlink" href="#/character/' + encodeURIComponent(c.n) + '"><span class="rn">' + esc(c.n) + '</span><span class="rt">' + esc(c.t) + '</span></a></li>'; }).join('') + '</ul></div>';
    }
    // concordance
    const QU = q.toUpperCase();
    const words = [];
    for (let i = 0; i < window.CONC.words.length && words.length < 12; i++) {
      if (window.CONC.words[i].w.indexOf(QU) >= 0) words.push(i);
    }
    if (words.length) {
      html += '<div class="sec-header">Concordance words</div><div class="wordlist-grid">' +
        words.map(function (i) { return '<div class="word-pill" data-word="' + i + '">' + esc(window.CONC.words[i].w) + '</div>'; }).join('') + '</div>';
    }
    // bible kjv + telugu
    const kjvHits = B.searchBible(q, 'kjv', 15);
    const telHits = B.searchBible(q, 'tel', 15);
    if (kjvHits.length) {
      html += '<div class="sec-header">Bible — KJV</div><div class="card doc">' + kjvHits.map(function (h) {
        return '<p class="bodyline"><a class="vref" data-b="' + h.b + '" data-c="' + h.c + '" data-v="' + h.v + '" data-ev="' + h.v + '" data-ec="' + h.c + '">' + esc(B.refLabel(h.b, h.c, h.v)) + '</a> — ' + esc(h.text.slice(0, 140)) + '…</p>';
      }).join('') + '</div>';
    }
    if (telHits.length) {
      html += '<div class="sec-header">Bible — తెలుగు</div><div class="card doc">' + telHits.map(function (h) {
        return '<p class="bodyline" style="font-family:var(--telugu)"><a class="vref" data-b="' + h.b + '" data-c="' + h.c + '" data-v="' + h.v + '" data-ev="' + h.v + '" data-ec="' + h.c + '">' + esc(B.refLabel(h.b, h.c, h.v)) + '</a> — ' + esc(h.text.slice(0, 120)) + '…</p>';
      }).join('') + '</div>';
    }
    return html || '<div class="empty">Nothing found for “' + esc(q) + '”.</div>';
  }

  // ---------- more ----------
  function vMore() {
    const items = [
      ['outline', '📜', 'Condensed Outline of the Bible'],
      ['characters', '👤', 'Bible Character Studies'],
      ['treasury', '💎', 'Topical Treasury'],
      ['workers', '✝️', "Christian Worker's Text"],
      ['notes', '✏️', 'My Notes'],
      ['settings', '⚙️', 'Settings, Backup & Restore']
    ];
    return '<h1 class="page-title">More</h1><div class="more-grid">' +
      items.map(function (it) { return '<a class="tile" href="#/' + it[0] + '"><span class="t-ico">' + it[1] + '</span><div class="t-name">' + it[2] + '</div></a>'; }).join('') + '</div>';
  }

  // ---------- settings ----------
  function vSettings() {
    const s = store.settings;
    return '<h1 class="page-title">Settings</h1>' +
      '<div class="card">' +
      '<div class="settings-row"><div><div class="s-label">Theme</div><div class="s-hint">Light, dark, or follow system</div></div>' +
      '<select id="setTheme" style="width:auto"><option value="auto"' + (s.theme === 'auto' ? ' selected' : '') + '>Auto</option><option value="light"' + (s.theme === 'light' ? ' selected' : '') + '>Light</option><option value="dark"' + (s.theme === 'dark' ? ' selected' : '') + '>Dark</option></select></div>' +
      '<div class="settings-row"><div><div class="s-label">Verse popup shows</div><div class="s-hint">What appears when you tap a reference</div></div>' +
      '<select id="setPopup" style="width:auto"><option value="both"' + (s.popupLang === 'both' ? ' selected' : '') + '>తెలుగు + KJV</option><option value="tel"' + (s.popupLang === 'tel' ? ' selected' : '') + '>తెలుగు only</option><option value="kjv"' + (s.popupLang === 'kjv' ? ' selected' : '') + '>KJV only</option></select></div>' +
      '<div class="settings-row"><div><div class="s-label">Bible reader shows</div></div>' +
      '<select id="setRmode" style="width:auto"><option value="both"' + (s.rmode === 'both' ? ' selected' : '') + '>KJV + తెలుగు</option><option value="kjv"' + (s.rmode === 'kjv' ? ' selected' : '') + '>KJV</option><option value="tel"' + (s.rmode === 'tel' ? ' selected' : '') + '>తెలుగు</option></select></div>' +
      '</div>' +
      '<h2 class="entry-title">💾 Backup & Restore</h2>' +
      '<div class="card">' +
      '<p style="margin-top:0">Saves all your notes, stars, highlights and settings as a single file. When your browser supports it you can choose the exact folder to save in; otherwise the file goes to your Downloads.</p>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
      '<button class="btn" id="backupBtn">⬇️ Backup now</button>' +
      '<button class="btn secondary" id="restoreBtn">⬆️ Restore from file…</button>' +
      '<button class="btn secondary" id="wipeBtn" style="color:#a33">Clear all my data</button></div>' +
      '<p class="s-hint" id="backupHint"></p>' +
      '</div>' +
      '<h2 class="entry-title">ℹ️ About</h2>' +
      '<div class="card"><p style="margin-top:0"><b>Thompson Study Companion</b> bundles the study sections of the Thompson Chain-Reference Bible (Numerical Index of Topics, Condensed Outline, Character Studies, Topical Treasury, Christian Worker\u2019s Text, complete KJV Concordance) with the full King James Version and the Telugu Bible.</p>' +
      '<p>Every verse reference is tappable — it pops up the verse in Telugu and KJV. Numbers like <span class="kbd">1672</span> jump to that chain topic. KJV & Telugu text are public domain. Thompson study material from the user\u2019s own copy — for personal study.</p>' +
      (window.__deferredInstall ? '<button class="btn" id="installBtn2">📲 Install as app</button>' : '<p class="s-hint">To install on mobile: use your browser menu → “Add to Home screen”. On PC (Chrome/Edge): the install icon in the address bar.</p>') +
      '</div>';
  }

  // ============================== router ==============================
  function parseQS(h) {
    const out = {};
    (h.split('?')[1] || '').split('&').forEach(function (kv) {
      if (!kv) return;
      const p = kv.split('=');
      out[p[0]] = decodeURIComponent(p[1] || '');
    });
    return out;
  }
  function render() {
    const h = location.hash.replace(/^#\/?/, '');
    const parts = h.split('?');
    const seg = (parts[0] || '').split('/').filter(Boolean);
    const qs = parseQS(h);
    let html = '', nav = '';
    if (!seg.length) { html = vHome(); nav = 'home'; }
    else switch (seg[0]) {
      case 'topics': html = vTopics(); nav = 'topics'; break;
      case 'topic': html = vTopic(seg[1] || ''); nav = 'topics'; break;
      case 'outline': html = vOutline(); nav = 'outline'; break;
      case 'characters': html = vCharacters(); nav = 'characters'; break;
      case 'character': html = vCharacter(seg[1] || ''); nav = 'characters'; break;
      case 'treasury': html = vTreasury(); nav = 'treasury'; break;
      case 'workers': html = seg[1] !== undefined ? vWorkersSub(+seg[1] || 0) : vWorkers(); nav = 'workers'; break;
      case 'concordance': html = vConcordance(); nav = 'concordance'; break;
      case 'word': html = vWord(+seg[1] || 0); nav = 'concordance'; break;
      case 'bible': html = vBible(+qs.b || 0, +qs.c || 0); nav = 'bible'; break;
      case 'notes': html = vNotes(); nav = 'notes'; break;
      case 'search': html = vSearch(qs.q || ''); nav = ''; break;
      case 'more': html = vMore(); nav = 'more'; break;
      case 'settings': html = vSettings(); nav = 'settings'; break;
      default: html = vHome(); nav = 'home';
    }
    view.innerHTML = html;
    document.querySelectorAll('[data-nav]').forEach(function (a) {
      a.classList.toggle('active', a.getAttribute('data-nav') === nav);
    });
    // per-view bindings
    if (seg[0] === 'topics') {
      renderTopicList();
      const q = $('#topicQ');
      q.addEventListener('input', function () { topicsState.q = q.value; topicsState.shown = 150; renderTopicList(); });
      $('#moreTopics').addEventListener('click', function () { topicsState.shown += 250; renderTopicList(); });
    }
    if (seg[0] === 'concordance') {
      renderConcordance();
      const q = $('#concQ');
      q.addEventListener('input', function () { concState.q = q.value; concState.letter = ''; renderConcordance(); });
      $('#alphaJump').addEventListener('click', function (e) {
        const L = e.target.getAttribute('data-letter');
        if (!L) return;
        concState.letter = concState.letter === L ? '' : L; renderConcordance();
      });
    }
    if (seg[0] === 'bible') bindReader();
    if (seg[0] === 'settings') bindSettings();
    if (seg[0] === 'notes') bindNotes();
    if (seg[0] === 'search') {
      const q = $('#searchQ');
      q.addEventListener('input', function () {
        const v = q.value.trim();
        $('#searchResults').innerHTML = v ? searchHTML(v) : '<div class="empty">Type to search…</div>';
        try { history.replaceState(null, '', '#/search' + (v ? '?q=' + encodeURIComponent(v) : '')); } catch (e2) {}
      });
    }
    const homeForm = $('#quickForm');
    if (homeForm) homeForm.addEventListener('submit', function (e) {
      e.preventDefault();
      location.hash = '#/search?q=' + encodeURIComponent($('#quickQ').value.trim());
    });
    const ib = $('#installBtn'); if (ib) ib.addEventListener('click', doInstall);
    const ib2 = $('#installBtn2'); if (ib2) ib2.addEventListener('click', doInstall);
    // restore scroll
    view.scrollTop = 0; window.scrollTo(0, 0);
    render._after && render._after();
  }

  // ============================== reader bindings ==============================
  function bindReader() {
    const selBook = $('#selBook'), selChap = $('#selChap');
    selBook.addEventListener('change', function () { location.hash = '#/bible?b=' + selBook.value + '&c=1'; });
    selChap.addEventListener('change', function () { location.hash = '#/bible?b=' + selBook.value + '&c=' + selChap.value; });
    $('#rmodeBtn').addEventListener('click', function () {
      const order = ['both', 'kjv', 'tel'];
      store.settings.rmode = order[(order.indexOf(store.settings.rmode) + 1) % 3];
      save(); applyTheme();
      $('#rmodeBtn').textContent = ({ kjv: 'KJV', tel: 'తెలుగు', both: 'KJV + తెలుగు' }[store.settings.rmode]);
    });
    $('#reader').addEventListener('click', function (e) {
      const row = e.target.closest('.verse-row');
      if (!row) return;
      const b = +row.getAttribute('data-b'), c = +row.getAttribute('data-c'), v = +row.getAttribute('data-v');
      if (e.target.classList.contains('vn')) { // toggle highlight
        const k = B.verseKey(b, c, v);
        if (store.hl[k]) delete store.hl[k]; else store.hl[k] = 1;
        save(); row.classList.toggle('hl');
      } else {
        openVersePopup(b, c, v, v, c);
      }
    });
  }

  // ============================== verse popup ==============================
  let popupRef = null;
  function openVersePopup(b, c, v, ev, ec) {
    popupRef = { b: b, c: c, v: v, ev: ev, ec: ec };
    const title = B.refLabel(b, c, v, ev === v ? 0 : ev);
    const bmeta = B.bookById(b);
    $('#vpTitle').innerHTML = esc(title) + '<span class="tel">' + esc(bmeta.tel) + ' ' + c + ':' + v + (ev !== v ? '–' + ev : '') + '</span>';
    const list = B.versesFor(b, c, v, ev, ec);
    let body = '';
    list.forEach(function (cv) {
      const cc = cv[0], vv = cv[1];
      const kjv = B.verseText(b, cc, vv, 'kjv'), tel = B.verseText(b, cc, vv, 'tel');
      body += '<div class="vp-verse" data-b="' + b + '" data-c="' + cc + '" data-v="' + vv + '"><span class="vnum">' + cc + ':' + vv + '</span>' +
        (tel ? '<span class="tel"><span class="vnum">' + cc + ':' + vv + '</span>' + esc(tel) + '</span>' : '') +
        (kjv ? '<span class="kjv"><span class="vnum" style="opacity:.6">KJV </span>' + esc(kjv) + '</span>' : '') +
        '</div>';
    });
    if (list.length >= 24) body += '<p class="empty">Showing first verses of the range — open in reader for all.</p>';
    $('#vpBody').innerHTML = body;
    $('#vpReaderLink').setAttribute('href', '#/bible?b=' + b + '&c=' + c);
    $('#vpNoteBtn').setAttribute('data-note', 'verse:' + B.verseKey(b, c, v));
    $('#vpNoteBtn').setAttribute('data-label', title);
    $('#popupBackdrop').hidden = false;
    document.documentElement.style.overflow = 'hidden';
  }
  function closeVersePopup() {
    $('#popupBackdrop').hidden = true;
    document.documentElement.style.overflow = '';
    popupRef = null;
  }

  // ============================== settings / backup ==============================
  function bindSettings() {
    $('#setTheme').addEventListener('change', function () { store.settings.theme = this.value; save(); applyTheme(); });
    $('#setPopup').addEventListener('change', function () { store.settings.popupLang = this.value; save(); applyTheme(); });
    $('#setRmode').addEventListener('change', function () { store.settings.rmode = this.value; save(); applyTheme(); });
    $('#backupBtn').addEventListener('click', doBackup);
    $('#restoreBtn').addEventListener('click', doRestore);
    $('#wipeBtn').addEventListener('click', function () {
      if (!confirm('Delete ALL notes, stars and highlights? This cannot be undone. (Do a backup first!)')) return;
      store.notes = {}; store.favs = {}; store.hl = {}; save();
      toast('All personal data cleared'); render();
    });
  }
  function backupPayload() {
    return { app: 'thompson-study', version: 1, exported: new Date().toISOString(), data: { notes: store.notes, favs: store.favs, hl: store.hl, settings: store.settings, reader: store.reader } };
  }
  async function doBackup() {
    const payload = JSON.stringify(backupPayload(), null, 2);
    const name = 'thompson-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    try {
      if (window.showSaveFilePicker) {
        const handle = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: 'Thompson Study backup', accept: { 'application/json': ['.json'] } }] });
        const w = await handle.createWritable();
        await w.write(payload); await w.close();
        $('#backupHint').textContent = 'Saved to the folder you chose.';
        toast('Backup saved'); return;
      }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    // fallback download
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
    a.download = name; a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    $('#backupHint').textContent = 'Backup downloaded to your Downloads folder.';
    toast('Backup downloaded');
  }
  function doRestore() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.json,application/json';
    inp.addEventListener('change', function () {
      const f = inp.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = function () {
        let d;
        try { d = JSON.parse(r.result); } catch (e) { alert('That file is not a valid backup.'); return; }
        if (!d || d.app !== 'thompson-study' || !d.data) { alert('That file is not a Thompson Study backup.'); return; }
        const mode = confirm('Tap OK to REPLACE everything with the backup, or Cancel to MERGE it into current data.\n\nEither way, do a fresh backup first if unsure.') ? 'replace' : 'merge';
        const dd = d.data;
        if (mode === 'replace') {
          store.notes = dd.notes || {}; store.favs = dd.favs || {}; store.hl = dd.hl || {};
          if (dd.settings) store.settings = Object.assign(store.settings, dd.settings);
          if (dd.reader) store.reader = dd.reader;
        } else {
          Object.keys(dd.notes || {}).forEach(function (k) {
            const cur = store.notes[k];
            if (!cur || (dd.notes[k].u || 0) >= (cur.u || 0)) store.notes[k] = dd.notes[k];
          });
          Object.assign(store.favs, dd.favs || {});
          Object.assign(store.hl, dd.hl || {});
        }
        save(); applyTheme();
        toast(mode === 'replace' ? 'Backup restored' : 'Backup merged');
        render();
      };
      r.readAsText(f);
    });
    inp.click();
  }

  // ============================== notes bindings ==============================
  function bindNotes() {
    const newBtn = $('#newNote');
    newBtn.addEventListener('click', function () {
      const id = 'free:' + Date.now();
      $('#newNoteMount').innerHTML = noteEditorHTML(id, 'Free note');
      bindNoteEditor($('#newNoteMount'));
      const ta = $('#newNoteMount textarea'); if (ta) ta.focus();
    });
    document.querySelectorAll('.notecard-del').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const k = btn.closest('.note-card').getAttribute('data-notecard');
        if (!confirm('Delete this note?')) return;
        delete store.notes[k]; save(); render();
      });
    });
  }

  // ============================== global events ==============================
  document.addEventListener('click', function (e) {
    const vref = e.target.closest('.vref');
    if (vref) {
      e.preventDefault();
      openVersePopup(+vref.getAttribute('data-b'), +vref.getAttribute('data-c'), +vref.getAttribute('data-v'),
        +vref.getAttribute('data-ev') || +vref.getAttribute('data-v'), +vref.getAttribute('data-ec') || +vref.getAttribute('data-c'));
      return;
    }
    const tl = e.target.closest('.tlink');
    if (tl) {
      if (tl.getAttribute('data-char')) location.hash = '#/character/' + tl.getAttribute('data-char');
      else location.hash = '#/topic/' + tl.getAttribute('data-topic');
      return;
    }
    const wp = e.target.closest('.word-pill[data-word]');
    if (wp) { location.hash = '#/word/' + wp.getAttribute('data-word'); return; }
    const aj = e.target.closest('[data-letter]');
    if (aj) return;
    const fav = e.target.closest('.fav-btn');
    if (fav) {
      const k = fav.getAttribute('data-fav');
      if (store.favs[k]) { delete store.favs[k]; toast('Removed from starred'); }
      else { store.favs[k] = { ts: Date.now(), label: fav.getAttribute('data-label') || k }; toast('Starred ⭐'); }
      save();
      fav.innerHTML = store.favs[k] ? '★ Starred' : '☆ Star';
      return;
    }
    const no = e.target.closest('.note-open');
    if (no) {
      const anchor = no.getAttribute('data-note'), label = no.getAttribute('data-label');
      const mount = $('#noteMount') || $('#newNoteMount');
      if (no.closest('.verse-popup')) {
        // inside popup: swap body to editor
        $('#vpBody').innerHTML = noteEditorHTML(anchor, label) + '<div id="vpOrig"></div>';
        bindNoteEditor($('#vpBody'));
      } else {
        if (!mount) return;
        mount.innerHTML = noteEditorHTML(anchor, label);
        bindNoteEditor(mount);
        if (mount.scrollIntoView) mount.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        const ta = mount.querySelector('textarea'); if (ta) ta.focus();
      }
      return;
    }
  });

  // popup controls
  $('#vpClose').addEventListener('click', closeVersePopup);
  $('#popupBackdrop').addEventListener('click', function (e) { if (e.target === this) closeVersePopup(); });
  $('#vpLangBtn').addEventListener('click', function () {
    const order = ['both', 'tel', 'kjv'];
    store.settings.popupLang = order[(order.indexOf(store.settings.popupLang) + 1) % 3];
    save(); applyTheme();
  });
  $('#vpNoteBtn').addEventListener('click', function () {
    const anchor = $('#vpNoteBtn').getAttribute('data-note'), label = $('#vpNoteBtn').getAttribute('data-label');
    $('#vpBody').innerHTML = noteEditorHTML(anchor, label);
    bindNoteEditor($('#vpBody'));
    $('#vpBody textarea').focus();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { closeVersePopup(); closeSidebar(); }
    if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
      e.preventDefault(); location.hash = '#/search'; setTimeout(function () { const q = $('#searchQ'); if (q) q.focus(); }, 60);
    }
  });

  // topbar
  $('#searchBtn').addEventListener('click', function () { location.hash = '#/search'; setTimeout(function () { const q = $('#searchQ'); if (q) q.focus(); }, 60); });
  $('#themeBtn').addEventListener('click', function () {
    const order = ['auto', 'light', 'dark'];
    store.settings.theme = order[(order.indexOf(store.settings.theme) + 1) % 3];
    save(); applyTheme(); toast('Theme: ' + store.settings.theme);
  });
  function closeSidebar() { $('#sidebar').classList.remove('open'); }
  $('#navToggle').addEventListener('click', function () { $('#sidebar').classList.toggle('open'); });
  $('#sidebar').addEventListener('click', function (e) { if (e.target.tagName === 'A') closeSidebar(); });

  // install prompt
  window.__deferredInstall = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    window.__deferredInstall = e;
    render();
  });
  function doInstall() {
    if (!window.__deferredInstall) return;
    window.__deferredInstall.prompt();
    window.__deferredInstall.userChoice.then(function () { window.__deferredInstall = null; });
  }

  // ============================== boot ==============================
  if (!window.NUM_INDEX || !window.CONC || !window.BIBLE_KJV || !window.BIBLE_TEL) {
    view.innerHTML = '<div class="card" style="margin-top:40px"><h2 style="color:var(--brand)">⚠️ Study data could not load</h2>' +
      '<p>This page needs its companion files (<span class="kbd">data/</span>, <span class="kbd">js/</span>, <span class="kbd">css/</span>).</p>' +
      '<p><b>Most likely:</b> you opened <span class="kbd">index.html</span> directly from inside the ZIP. ' +
      'Please <b>extract the whole ZIP first</b> (right-click → Extract All), or use the single-file version ' +
      '<span class="kbd">Thompson-Study-App.html</span> which works anywhere with one double-click.</p></div>';
    return;
  }
  load();
  if (__storageBlocked) setTimeout(function () {
    toast('⚠️ Browser storage is blocked here — notes work, but won’t persist after closing. (Host the app or use http to fix.)');
  }, 800);
  applyTheme();
  window.addEventListener('hashchange', render);
  render();
})();
