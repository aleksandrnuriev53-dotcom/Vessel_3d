/* ============================================================================
   study.js — панель «Шпаргалки»: один учебник = одна лента
   Данные: study-data.js (учебник → глава → тема).
   Поиск: search.js (глобальный, по всем учебникам, главам, темам, формулам…).
   Карточка термина — прежняя слоистая.
   ============================================================================ */

import { studyData } from './study-data.js';
import {
  buildSearchIndex, search, highlight, snippet, norm, KIND_LABEL,
} from './search.js';

export { buildSearchIndex };

const LS = {
  book: 'atlas.study.book',
  done: 'atlas.study.done',
  scope: 'atlas.study.searchScope',
  scroll: (id) => `atlas.study.scroll.${id}`,
};

const PAGE = 25; // сколько результатов показывать за раз

const storeGet = (k, fallback = null) => {
  try {
    const v = localStorage.getItem(k);
    return v == null ? fallback : v;
  } catch {
    return fallback;
  }
};
const storeSet = (k, v) => {
  try { localStorage.setItem(k, v); } catch { /* Telegram / private mode */ }
};

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function allTopicRows(data = studyData) {
  const rows = [];
  for (const book of data.books) {
    for (const chapter of book.chapters) {
      for (const topic of chapter.topics) {
        rows.push({ book, chapter, topic });
      }
    }
  }
  return rows;
}

/** id термина → { term, topic, book, chapter } */
export function buildTermIndex(data = studyData) {
  const idx = {};
  for (const row of allTopicRows(data)) {
    for (const term of row.topic.terms || []) {
      idx[term.id] = { ...row, term };
    }
  }
  return idx;
}

export function richText(str, index) {
  return esc(str)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\{\{(\w+)\}\}/g, (m, id) => {
      const hit = index[id];
      return hit
        ? `<button type="button" class="term-link" data-term="${id}">${esc(hit.term.name)}</button>`
        : esc(id);
    });
}

export function pagesLabel(book, topic) {
  const p = topic.pages;
  if (!p || !p.from) return '';
  const range = p.to && p.to !== p.from ? `${p.from}–${p.to}` : String(p.from);
  return `${book.author}, стр. ${range}`;
}

function renderTopic(book, chapter, topic, index, done) {
  const formulas = (topic.formulas || [])
    .map((x, i) => `<div class="s-formula" data-i="${i}"><code>${esc(x.f)}</code><span>${esc(x.note)}</span></div>`)
    .join('');
  const facts = (topic.facts || []).map((t, i) => `<li data-i="${i}">${richText(t, index)}</li>`).join('');
  const chips = (topic.terms || [])
    .map((t) => `<button type="button" class="term-chip" data-term="${t.id}"><i>${t.emoji}</i>${esc(t.name)}</button>`)
    .join('');
  const pages = pagesLabel(book, topic);
  const learned = !!done[topic.id];
  return `
    <article class="s-topic${learned ? ' is-done' : ''}" id="topic-${esc(topic.id)}" data-topic="${esc(topic.id)}" data-chapter="${esc(chapter.id)}">
      <header class="s-topic-head">
        <div class="s-topic-titles">
          <p class="s-chapter">${esc(chapter.title)}</p>
          <h3 class="s-topic-title">${esc(topic.title)}</h3>
          ${pages ? `<p class="s-pages">${esc(pages)}</p>` : ''}
        </div>
        <button type="button" class="s-done" data-done="${esc(topic.id)}" aria-pressed="${learned}">
          ${learned ? 'Выучено' : 'Отметить'}
        </button>
      </header>
      ${topic.quick ? `<div class="s-quick"><b>За 10 секунд</b>${esc(topic.quick)}</div>` : ''}
      ${formulas ? `<h4 class="s-h">Формулы</h4><div class="s-formulas">${formulas}</div>` : ''}
      ${facts ? `<h4 class="s-h">Факты</h4><ul class="s-facts">${facts}</ul>` : ''}
      ${chips ? `<h4 class="s-h">Термины <small>нажми — на пальцах</small></h4><div class="s-terms">${chips}</div>` : ''}
    </article>`;
}

export function initStudy(hooks = {}) {
  const $ = (s, el = document) => el.querySelector(s);
  const root = $('#study');
  if (!root) return null;

  const btnOpen = $('#btn-study');
  const veil = $('#study-veil');
  const bodyEl = $('#study-body');
  const streamEl = $('#study-stream');
  const dictEl = $('#study-dict');
  const drillEl = $('#study-drill');
  const booksEl = $('#study-books');
  const modesEl = $('#study-modes');
  const closeBtn = $('#study-close');
  const termLayer = $('#term-layer');
  const tocLayer = $('#toc-layer');
  const tocList = $('#toc-list');
  const searchInput = $('#study-q');
  const searchDrop = $('#search-drop');
  const btnToc = $('#btn-toc');

  const books = studyData.books;
  const index = buildTermIndex();
  const searchIndex = buildSearchIndex(studyData);
  const buzz = (k) => { try { hooks.haptic && hooks.haptic(k); } catch { /* нет вибро */ } };

  const bookById = Object.fromEntries(books.map((b) => [b.id, b]));
  let bookId = books[0].id;
  const savedBook = storeGet(LS.book);
  if (savedBook && bookById[savedBook]) bookId = savedBook;

  let done = {};
  try { done = JSON.parse(storeGet(LS.done, '{}')) || {}; } catch { done = {}; }

  let mode = 'read';
  let isOpen = false;
  let termOpen = false;
  let tocOpen = false;
  let drillI = 0;
  let drillReveal = false;
  let scrollTimer = 0;
  let searchTimer = 0;

  // состояние поиска
  let scope = storeGet(LS.scope) === 'book' ? 'book' : 'all'; // «все учебники» по умолчанию
  let found = { hits: [], toks: [], outside: 0 };
  let shown = PAGE;
  let activeHit = -1;

  const book = () => bookById[bookId];
  const persistDone = () => storeSet(LS.done, JSON.stringify(done));
  const persistBook = () => storeSet(LS.book, bookId);
  const saveScroll = () => storeSet(LS.scroll(bookId), String(bodyEl.scrollTop | 0));
  const restoreScroll = () => {
    const y = parseInt(storeGet(LS.scroll(bookId), '0'), 10);
    bodyEl.scrollTop = Number.isFinite(y) ? y : 0;
  };

  $('#study-title').textContent = studyData.meta.title;
  $('#study-disc').textContent = studyData.meta.disclaimer;
  searchInput.placeholder = 'Поиск: главы, темы, формулы, термины';

  function setSub() {
    const b = book();
    $('#study-sub').textContent = `${b.author} · «${b.work}»`;
  }

  function paintBooks() {
    booksEl.innerHTML = books.map((b) =>
      `<button type="button" class="study-book${b.id === bookId ? ' active' : ''}" data-book="${b.id}" aria-pressed="${b.id === bookId}">`
      + `<i>${b.icon}</i>${esc(b.short)}</button>`
    ).join('');
  }

  function paintModes() {
    [...modesEl.querySelectorAll('[data-mode]')].forEach((btn) => {
      const on = btn.dataset.mode === mode;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', String(on));
    });
    streamEl.hidden = mode !== 'read';
    dictEl.hidden = mode !== 'dict';
    drillEl.hidden = mode !== 'drill';
    btnToc.disabled = mode !== 'read';
  }

  function paintStream() {
    const b = book();
    streamEl.innerHTML = b.chapters
      .map((ch) => ch.topics.map((t) => renderTopic(b, ch, t, index, done)).join(''))
      .join('');
  }

  function paintToc() {
    const b = book();
    tocList.innerHTML = b.chapters.map((ch) => {
      const items = ch.topics.map((t) => {
        const on = !!done[t.id];
        const pg = pagesLabel(b, t);
        return `<button type="button" class="toc-item${on ? ' is-done' : ''}" data-jump="${esc(t.id)}">
          <span class="toc-mark" aria-hidden="true">${on ? '✓' : ''}</span>
          <span class="toc-tx"><b>${esc(t.title)}</b>${pg ? `<small>${esc(pg)}</small>` : ''}</span>
        </button>`;
      }).join('');
      return `<section class="toc-ch"><h3>${esc(ch.title)}</h3>${items}</section>`;
    }).join('');
  }

  function paintDict() {
    dictEl.innerHTML = books.map((b) => {
      const terms = b.chapters.flatMap((ch) => ch.topics.flatMap((t) => t.terms || []));
      if (!terms.length) {
        return `<section class="dict-ch"><h3>${esc(b.title)}</h3><p class="s-empty">Терминов пока нет — появятся вместе с конспектом.</p></section>`;
      }
      const chips = terms.map((t) =>
        `<button type="button" class="term-chip" data-term="${t.id}"><i>${t.emoji}</i>${esc(t.name)}</button>`
      ).join('');
      return `<section class="dict-ch"><h3>${esc(b.author)} · ${esc(b.title)}</h3><div class="s-terms">${chips}</div></section>`;
    }).join('');
  }

  function drillPool() {
    return book().chapters.flatMap((ch) =>
      ch.topics.flatMap((t) => (t.questions || []).map((q) => ({ ...q, topic: t })))
    );
  }

  function paintDrill() {
    const pool = drillPool();
    if (!pool.length) {
      drillEl.innerHTML = `<div class="drill-empty">
        <p>Вопросов по «${esc(book().title)}» ещё нет.</p>
        <p class="s-muted">Как только в теме появится массив questions — сюда лягут формулы, правила и числа.</p>
      </div>`;
      return;
    }
    drillI = ((drillI % pool.length) + pool.length) % pool.length;
    const q = pool[drillI];
    const kind = q.kind === 'formula' ? 'Формула' : q.kind === 'number' ? 'Число' : 'Правило';
    drillEl.innerHTML = `
      <p class="drill-meta">${esc(kind)} · ${drillI + 1} / ${pool.length} · ${esc(q.topic.title)}</p>
      <p class="drill-q">${esc(q.prompt)}</p>
      ${drillReveal ? `<p class="drill-a">${esc(q.answer)}</p>` : ''}
      <div class="drill-actions">
        ${drillReveal
          ? `<button type="button" class="ghost-btn" id="drill-next">Дальше</button>`
          : `<button type="button" class="ghost-btn" id="drill-show">Показать ответ</button>`}
      </div>`;
  }

  function openBook(id, { restore = true } = {}) {
    if (!bookById[id]) return;
    if (id !== bookId) saveScroll();
    bookId = id;
    persistBook();
    setSub();
    paintBooks();
    paintStream();
    paintToc();
    paintDrill();
    if (restore) requestAnimationFrame(restoreScroll);
    else bodyEl.scrollTop = 0;
  }

  function setMode(next) {
    if (next === mode) return;
    if (mode === 'read') saveScroll();
    mode = next;
    paintModes();
    if (mode === 'dict') paintDict();
    if (mode === 'drill') paintDrill();
    if (mode === 'read') requestAnimationFrame(restoreScroll);
    else bodyEl.scrollTop = 0;
    buzz('light');
  }

  function jumpToTopic(topicId, after) {
    if (mode !== 'read') {
      mode = 'read';
      paintModes();
    }
    const row = allTopicRows().find((r) => r.topic.id === topicId);
    if (row && row.book.id !== bookId) openBook(row.book.id, { restore: false });
    requestAnimationFrame(() => {
      const el = document.getElementById(`topic-${topicId}`);
      if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
      after && after();
    });
  }

  function openToc() {
    paintToc();
    tocOpen = true;
    tocLayer.classList.add('open');
    tocLayer.setAttribute('aria-hidden', 'false');
    buzz('light');
  }
  function closeToc() {
    if (!tocOpen) return;
    tocOpen = false;
    tocLayer.classList.remove('open');
    tocLayer.setAttribute('aria-hidden', 'true');
  }

  /* ---------- Карточка термина (логика прежняя) ---------- */
  const T = {
    emoji: $('#term-emoji'), name: $('#term-name'),
    formal: $('#term-formal'), funny: $('#term-funny'), mnemo: $('#term-mnemo'),
  };
  function openTerm(id) {
    const hit = index[id];
    if (!hit) return;
    T.emoji.textContent = hit.term.emoji;
    T.name.textContent = hit.term.name;
    T.formal.textContent = hit.term.formal;
    T.funny.textContent = hit.term.funny;
    T.mnemo.textContent = hit.term.mnemo;
    termOpen = true;
    termLayer.classList.add('open');
    termLayer.setAttribute('aria-hidden', 'false');
    termLayer.querySelector('.term-card').scrollTop = 0;
    buzz('medium');
    setTimeout(() => { if (termOpen) $('#term-close').focus({ preventScroll: true }); }, 260);
  }
  function closeTerm() {
    if (!termOpen) return;
    termOpen = false;
    termLayer.classList.remove('open');
    termLayer.setAttribute('aria-hidden', 'true');
    buzz('light');
  }

  /* ==========================================================================
     ГЛОБАЛЬНЫЙ ПОИСК
     ========================================================================== */
  function hideSearch() {
    searchDrop.hidden = true;
    searchDrop.innerHTML = '';
    activeHit = -1;
  }

  const scopeBtn = (v, label) =>
    `<button type="button" data-scope="${v}" class="${scope === v ? 'active' : ''}" aria-pressed="${scope === v}">${esc(label)}</button>`;

  function hitHtml(h, i) {
    const { toks } = found;
    const book_ = bookById[h.bookId];
    const titleMissing = toks.some((t) => !h.tn.includes(t));      // часть слов нашлась только в тексте
    const sn = titleMissing ? highlight(snippet(h.raw, toks), toks) : '';
    return `<button type="button" class="search-hit" role="option" data-i="${i}">
      <span class="sh-kind k-${h.kind}">${KIND_LABEL[h.kind]}</span>
      <span class="sh-tx">
        <b>${highlight(h.title, toks)}</b>
        ${sn ? `<em>${sn}</em>` : ''}
        <small>${esc(h.crumb)}${book_ ? '' : ''}</small>
      </span>
    </button>`;
  }

  function renderSearch() {
    const q = searchInput.value;
    if (norm(q).trim().length < 2) { hideSearch(); return; }

    found = search(searchIndex, q, { bookId: scope === 'book' ? bookId : null });
    const n = found.hits.length;
    const head = `<div class="sd-head">
      <span class="sd-count">${n ? `Найдено: ${n}` : 'Ничего не найдено'}</span>
      <span class="sd-scope" role="group" aria-label="Где искать">${scopeBtn('all', 'Все учебники')}${scopeBtn('book', book().short)}</span>
    </div>`;

    let body;
    if (!n) {
      body = `<div class="sd-list"><p class="search-empty">По запросу «${esc(q.trim())}» ничего нет.</p>`
        + (found.outside
          ? `<button type="button" class="sd-more" data-scope="all">Показать совпадения в других учебниках (${found.outside})</button>`
          : '<p class="search-empty">Попробуй другое слово или часть слова.</p>')
        + '</div>';
    } else {
      const visible = found.hits.slice(0, shown);
      body = `<div class="sd-list" role="listbox">${visible.map(hitHtml).join('')}`
        + (n > shown ? `<button type="button" class="sd-more" data-more>Показать ещё (${n - shown})</button>` : '')
        + (scope === 'book' && found.outside
          ? `<button type="button" class="sd-more" data-scope="all">+ ещё ${found.outside} в других учебниках</button>`
          : '')
        + '</div>';
    }
    searchDrop.hidden = false;
    searchDrop.innerHTML = head + body;
    activeHit = -1;
  }

  function setActive(i) {
    const els = searchDrop.querySelectorAll('.search-hit');
    els.forEach((el, k) => el.classList.toggle('active', k === i));
    activeHit = i;
    if (els[i]) els[i].scrollIntoView({ block: 'nearest' });
  }

  /** Короткая подсветка найденного места после перехода */
  function flash(h) {
    const art = document.getElementById(`topic-${h.topicId}`);
    if (!art) return;
    let el = art;
    if (h.kind === 'formula') el = art.querySelector(`.s-formula[data-i="${h.ref}"]`) || art;
    if (h.kind === 'fact') el = art.querySelector(`.s-facts li[data-i="${h.ref}"]`) || art;
    el.classList.remove('flash');
    void el.offsetWidth;                       // перезапуск анимации
    el.classList.add('flash');
    if (el !== art) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setTimeout(() => el.classList.remove('flash'), 2300);
  }

  function goDrill(h) {
    if (h.bookId !== bookId) { drillI = 0; openBook(h.bookId, { restore: false }); }
    const k = drillPool().findIndex((q) => q.id === h.id);
    drillI = k >= 0 ? k : 0;
    drillReveal = false;
    if (mode !== 'drill') setMode('drill'); else paintDrill();
  }

  function openHit(h) {
    closeToc();
    hideSearch();
    searchInput.blur();
    buzz('light');
    if (h.kind === 'question') { goDrill(h); return; }
    jumpToTopic(h.topicId, () => {
      if (h.kind === 'term') openTerm(h.id);
      else flash(h);
    });
  }

  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { shown = PAGE; renderSearch(); }, 120);
  });
  searchInput.addEventListener('focus', () => {
    if (norm(searchInput.value).trim().length >= 2) renderSearch();
  });
  searchInput.addEventListener('keydown', (e) => {
    if (searchDrop.hidden) return;
    const n = searchDrop.querySelectorAll('.search-hit').length;
    if (e.key === 'ArrowDown') { e.preventDefault(); if (n) setActive((activeHit + 1) % n); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (n) setActive((activeHit - 1 + n) % n); }
    else if (e.key === 'Enter') {
      const h = found.hits[activeHit >= 0 ? activeHit : 0];
      if (h) { e.preventDefault(); openHit(h); }
    }
  });
  searchDrop.addEventListener('click', (e) => {
    const sc = e.target.closest('[data-scope]');
    if (sc) {
      scope = sc.dataset.scope === 'book' ? 'book' : 'all';
      storeSet(LS.scope, scope);
      shown = PAGE;
      renderSearch();
      buzz('light');
      return;
    }
    if (e.target.closest('[data-more]')) {
      shown += PAGE;
      renderSearch();
      return;
    }
    const hit = e.target.closest('.search-hit');
    if (!hit) return;
    const h = found.hits[Number(hit.dataset.i)];
    if (h) openHit(h);
  });

  /* ---------- События панели ---------- */
  booksEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-book]');
    if (!b || b.dataset.book === bookId) return;
    drillI = 0;
    drillReveal = false;
    openBook(b.dataset.book, { restore: true });
    if (!searchDrop.hidden && scope === 'book') renderSearch();
    buzz('light');
  });

  modesEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-mode]');
    if (!b) return;
    closeToc();
    hideSearch();
    drillReveal = false;
    setMode(b.dataset.mode);
  });

  btnToc.addEventListener('click', () => { tocOpen ? closeToc() : openToc(); });
  $('#toc-close').addEventListener('click', closeToc);
  $('#toc-veil').addEventListener('click', closeToc);
  tocList.addEventListener('click', (e) => {
    const item = e.target.closest('[data-jump]');
    if (!item) return;
    closeToc();
    jumpToTopic(item.dataset.jump);
    buzz('light');
  });

  bodyEl.addEventListener('scroll', () => {
    if (mode !== 'read') return;
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(saveScroll, 140);
  }, { passive: true });

  root.addEventListener('click', (e) => {
    const termBtn = e.target.closest('[data-term]');
    if (termBtn) { openTerm(termBtn.dataset.term); return; }
    const doneBtn = e.target.closest('[data-done]');
    if (doneBtn) {
      const id = doneBtn.dataset.done;
      done[id] = !done[id];
      if (!done[id]) delete done[id];
      persistDone();
      const article = document.getElementById(`topic-${id}`);
      if (article) article.classList.toggle('is-done', !!done[id]);
      doneBtn.setAttribute('aria-pressed', String(!!done[id]));
      doneBtn.textContent = done[id] ? 'Выучено' : 'Отметить';
      paintToc();
      buzz('medium');
    }
  });

  drillEl.addEventListener('click', (e) => {
    if (e.target.id === 'drill-show') { drillReveal = true; paintDrill(); buzz('light'); }
    if (e.target.id === 'drill-next') { drillReveal = false; drillI += 1; paintDrill(); buzz('light'); }
  });

  $('#term-close').addEventListener('click', closeTerm);
  $('#term-veil').addEventListener('click', closeTerm);

  function popOverlay() {
    if (termOpen) { closeTerm(); return true; }
    if (tocOpen) { closeToc(); return true; }
    if (!searchDrop.hidden) { hideSearch(); searchInput.blur(); return true; }
    return false;
  }

  const tgBack = hooks.tg && hooks.tg.BackButton;
  function open() {
    if (isOpen) return;
    isOpen = true;
    hooks.onOpen && hooks.onOpen();
    document.body.classList.add('study-open');
    root.classList.add('open');
    root.setAttribute('aria-hidden', 'false');
    btnOpen.setAttribute('aria-expanded', 'true');
    try { tgBack && tgBack.show(); } catch { /* старый клиент */ }
    buzz('medium');
    requestAnimationFrame(restoreScroll);
    setTimeout(() => { if (isOpen) closeBtn.focus({ preventScroll: true }); }, 400);
  }
  function close() {
    if (!isOpen) return;
    popOverlay();
    closeTerm();
    closeToc();
    hideSearch();
    saveScroll();
    isOpen = false;
    document.body.classList.remove('study-open');
    root.classList.remove('open');
    root.setAttribute('aria-hidden', 'true');
    btnOpen.setAttribute('aria-expanded', 'false');
    try { tgBack && tgBack.hide(); } catch { /* старый клиент */ }
    hooks.onClose && hooks.onClose();
    buzz('light');
    btnOpen.focus({ preventScroll: true });
  }

  btnOpen.addEventListener('click', () => (isOpen ? close() : open()));
  closeBtn.addEventListener('click', close);
  veil.addEventListener('click', () => { if (!termOpen && !tocOpen) close(); });

  try {
    tgBack && tgBack.onClick(() => { if (!isOpen) return; popOverlay() || close(); });
  } catch { /* старый клиент */ }

  window.addEventListener('keydown', (e) => {
    if (!isOpen) return;
    if (e.key === 'Escape') popOverlay() || close();
  });

  document.addEventListener('pointerdown', (e) => {
    if (!isOpen || searchDrop.hidden) return;
    if (!e.target.closest('#study-tools')) hideSearch();
  });

  let drag = null;
  ['#study-grab', '#study-head'].forEach((sel) => {
    const h = $(sel);
    h.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      drag = { y: e.clientY, dy: 0 };
      h.setPointerCapture(e.pointerId);
      root.style.transition = 'none';
    });
    h.addEventListener('pointermove', (e) => {
      if (!drag) return;
      drag.dy = Math.max(0, e.clientY - drag.y);
      root.style.transform = `translateY(${drag.dy}px)`;
    });
    const end = () => {
      if (!drag) return;
      const dy = drag.dy;
      drag = null;
      root.style.transition = '';
      root.style.transform = '';
      if (dy > 90) close();
    };
    h.addEventListener('pointerup', end);
    h.addEventListener('pointercancel', end);
  });

  setSub();
  paintBooks();
  paintStream();
  paintToc();
  paintDict();
  paintModes();
  paintDrill();

  return { open, close };
}
