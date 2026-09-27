/* bible.js — book metadata, verse-reference detection & linking, Bible text access */
(function () {
  'use strict';

  const BOOKS = window.BOOKS || [];
  const KJV = window.BIBLE_KJV || [];
  const TEL = window.BIBLE_TEL || [];

  // ---- alias -> book id map (normalized: lowercase, no dots, single spaces) ----
  const ALIAS = {};
  function norm(s) { return s.toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim(); }
  BOOKS.forEach(function (b) {
    const keys = [b.n].concat(b.a || []);
    keys.forEach(function (k) { ALIAS[norm(k)] = b.id; });
  });

  const MAXB = BOOKS.length;

  // ---- public helpers ----
  function bookById(id) { return BOOKS[id - 1] || null; }
  function bookName(id) { const b = bookById(id); return b ? b.n : '?'; }
  function bookTel(id) { const b = bookById(id); return b ? b.tel : '?'; }
  function chapters(b) { return (KJV[b - 1] || []).length; }
  function verses(b, c) { return ((KJV[b - 1] || [])[c - 1] || []).length; }
  function verseText(b, c, v, lang) {
    const t = lang === 'tel' ? TEL : KJV;
    const arr = (t[b - 1] || [])[c - 1];
    return arr ? (arr[v - 1] || null) : null;
  }
  function refLabel(b, c, v, e) {
    let s = bookName(b) + ' ' + c + ':' + v;
    if (e && e !== v) s += '–' + e;
    return s;
  }
  function verseKey(b, c, v) { return b + '-' + c + '-' + v; }

  // ---- escape ----
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ---- verse reference scanner ----
  // matches: <book alias> c:v [–v | –c:v]   |   c:v [–v] (inherits book)  |  ", v" (inherits chapter, adjacent only)
  const RX = /(\d?\s?[A-Za-z][A-Za-z.]*)?\.?\s*(\d{1,3}):(\d{1,3})(?:\s?[–—-]\s?(\d{1,3})(?::(\d{1,3}))?)?|,\s*(\d{1,3})(?![\d:])/g;
  // token kinds: B (book+c:v), C (c:v), V (bare verse)

  function linkVerses(text) {
    if (!text) return '';
    RX.lastIndex = 0;
    let out = '', last = 0, m;
    let curBook = 0, curChap = 0, lastRefEnd = -1;
    while ((m = RX.exec(text)) !== null) {
      let ok = false, b = 0, c = 0, v = 0, ev = 0, ec = 0, label = '';
      const idx = m.index, s = m[0];
      if (m[2] !== undefined) { // has chapter:verse
        if (m[1] !== undefined) {
          const cand = norm(m[1]);
          const bid = ALIAS[cand];
          // boundary: char before the book word must not be a letter (avoid "PaulGen 3:2")
          const wstart = idx + (s.length - s.replace(/^\s+/, '').length);
          const prev = wstart > 0 ? text[wstart - 1] : ' ';
          if (bid && !/[A-Za-z0-9]/.test(prev)) {
            b = bid; c = +m[2]; v = +m[3];
            ev = m[4] !== undefined ? +m[4] : v;
            ec = m[5] !== undefined ? +m[5] : c;
            ok = true;
          }
        } else {
          // continuation c:v — needs a current book and a separator before
          const prev = idx > 0 ? text[idx - 1] : '';
          if (curBook && /[,;(\s]/.test(prev)) {
            b = curBook; c = +m[2]; v = +m[3];
            ev = m[4] !== undefined ? +m[4] : v;
            ec = m[5] !== undefined ? +m[5] : c;
            ok = true;
          }
        }
      } else if (m[6] !== undefined) { // bare verse after comma — must directly follow a previous ref
        if (curBook && curChap && lastRefEnd >= idx - 1 && text.charAt(idx) === ',') {
          b = curBook; c = curChap; v = +m[6]; ev = v; ec = c;
          ok = text.charAt(m.index + s.length) !== ':';
        }
      }
      if (ok && verses(b, c) >= v) { // sanity: verse exists in KJV
        out += esc(text.slice(last, idx));
        // keep leading whitespace outside the anchor so words don't glue together
        const trimmed = m[0].replace(/^\s+/, '');
        const lead = m[0].slice(0, m[0].length - trimmed.length);
        if (lead) out += lead;
        label = trimmed;
        out += '<a class="vref" data-b="' + b + '" data-c="' + c + '" data-v="' + v + '" data-ev="' + ev + '" data-ec="' + (ec || c) + '">' + esc(label) + '</a>';
        last = idx + s.length;
        lastRefEnd = last;
        curBook = b; curChap = (ec || c);
      } else if (ok) { // book valid but out-of-range verse; still record context
        curBook = b || curBook; curChap = c || curChap;
      }
      // avoid zero-length loops
      if (RX.lastIndex === idx) RX.lastIndex++;
    }
    out += esc(text.slice(last));
    return out;
  }

  // ---- topic number linking ----
  const TOPICMAP = {};
  (window.NUM_INDEX && window.NUM_INDEX.topics || []).forEach(function (t) { TOPICMAP[t.n] = 1; });
  const CHARMAP = {};
  (window.CHARACTERS && window.CHARACTERS.items || []).forEach(function (c) { CHARMAP[c.n] = 1; });

  function linkTopics(html) {
    // protect existing tags (vref anchors); only chain/see-also style lines
    if (!/^(→|\(M\.|See )|\bSee\b|,\s?\d{3,4}/.test(html)) return html;
    const parts = html.split(/(<[^>]+>)/);
    for (let i = 0; i < parts.length; i += 2) {
      parts[i] = parts[i].replace(/\b(\d{3,4}[a-z]?)(–\d{3,4}[a-z]?)?\b/g, function (all, a, b) {
        if (!TOPICMAP[a] && !CHARMAP[a]) return all;
        if (b && !TOPICMAP[b.replace('–', '')] && !CHARMAP[b.replace('–', '')]) b = null;
        const kind = TOPICMAP[a] ? 'data-topic' : 'data-char';
        return '<a class="tlink" ' + kind + '="' + a + '">' + (b ? a + b : a) + '</a>';
      });
    }
    return parts.join('');
  }

  // combine: escape happens inside linkVerses; topic pass runs on the escaped+linked html
  function linkLine(text) {
    let html = linkVerses(text);
    html = linkTopics(html);
    return html;
  }

  // ---- verse lookup for popup ----
  function versesFor(b, c, v, ev, ec, lang) {
    const out = [];
    ec = ec || c;
    let count = 0;
    if (c === ec) {
      for (let i = v; i <= ev && count < 24; i++, count++) out.push([c, i]);
    } else {
      for (let i = v, done = false; i <= ec && !done; i++) {
        const last = i === ec ? ev : verses(b, i);
        for (let j = (i === v ? v : 1); j <= last && count < 24; j++, count++) {
          out.push([i, j]);
          if (count >= 24) done = true;
        }
      }
    }
    return out;
  }

  // ---- search ----
  function searchBible(q, lang, limit) {
    limit = limit || 40;
    const t = lang === 'tel' ? TEL : KJV;
    const ql = q.toLowerCase();
    const res = [];
    outer:
    for (let b = 1; b <= MAXB; b++) {
      const chs = t[b - 1] || [];
      for (let c = 1; c <= chs.length; c++) {
        const vs = chs[c - 1];
        for (let v = 1; v <= vs.length; v++) {
          if (vs[v - 1].toLowerCase().indexOf(ql) >= 0) {
            res.push({ b: b, c: c, v: v, text: vs[v - 1] });
            if (res.length >= limit) break outer;
          }
        }
      }
    }
    return res;
  }

  window.B = {
    BOOKS: BOOKS, ALIAS: ALIAS,
    bookById: bookById, bookName: bookName, bookTel: bookTel,
    chapters: chapters, verses: verses, verseText: verseText,
    refLabel: refLabel, verseKey: verseKey, esc: esc,
    linkLine: linkLine, linkVerses: linkVerses,
    versesFor: versesFor, searchBible: searchBible,
    TOPICMAP: TOPICMAP, CHARMAP: CHARMAP
  };
})();
