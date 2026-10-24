/* ============================================================================
   study.js — логика раздела «Шпаргалки» для 3D-атласа судна
   ----------------------------------------------------------------------------
   Контент лежит в study-data.js (учебник → глава → тема). Здесь:
     1. чистые функции отображения и поиска (их можно проверять в Node);
     2. прогресс «знаю / трудный / тема выучена» (localStorage + Telegram CloudStorage);
     3. initStudy — панель: экран-лента на каждый учебник (оглавление, поиск по
        всем учебникам, «выучено», запоминание места чтения), «Словарь»,
        «Тренировка» (термины + вопросы по темам) и слоистая карточка термина.
   ============================================================================ */

import { studyData } from './study-data.js';
export { studyData };

/* ============================================================================
   1. ЧИСТЫЕ ФУНКЦИИ
   ============================================================================ */

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const norm = (s) => String(s).toLowerCase().replace(/ё/g, 'е');
const pagesLabel = (t) => (t.pages ? esc(t.pages) : 'стр. —');

/** Плоский список тем в порядке учебников: [{ topic, book, chapter }] */
export const allTopics = (data = studyData) =>
  data.books.flatMap((book) =>
    book.chapters.flatMap((chapter) => chapter.topics.map((topic) => ({ topic, book, chapter }))));

/** Индекс терминов: id → { term, topic, book, chapter } */
export function buildTermIndex(data = studyData) {
  const idx = {};
  allTopics(data).forEach(({ topic, book, chapter }) =>
    topic.terms.forEach((term) => { idx[term.id] = { term, topic, book, chapter }; }));
  return idx;
}

/** Все вопросы по темам: id вида «q:тема:номер» */
export function buildQuizIndex(data = studyData) {
  const out = [];
  allTopics(data).forEach(({ topic, book }) =>
    (topic.quiz || []).forEach((item, i) => out.push({ ...item, id: `q:${topic.id}:${i}`, topic, book })));
  return out;
}

/** Все варианты «образа из жизни»: основной + запасные («Не понял — иначе») */
export const termVariants = (term) => [term.funny, ...(term.again || [])];

/** Строка с разметкой → безопасный HTML: **жирный** и {{id}} → кнопка-термин */
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

/** Строка без разметки (для поиска): {{id}} → название термина */
export function plainText(str, index) {
  return String(str)
    .replace(/\{\{(\w+)\}\}/g, (m, id) => (index[id] ? index[id].term.name : id))
    .replace(/\*\*/g, '');
}

/* ---------- Экран учебника ---------- */

export function bookProgress(book, statusOf) {
  const topics = book.chapters.flatMap((c) => c.topics);
  return { done: topics.filter((t) => statusOf('t:' + t.id) === 'known').length, total: topics.length };
}

/** Оглавление учебника (выпадающая панель) */
export function renderToc(book, statusOf) {
  let n = 0;
  return book.chapters
    .map((ch) => `<div class="toc-ch">${esc(ch.title)}</div>` + ch.topics
      .map((t) => {
        n += 1;
        return `<button type="button" class="toc-it" data-goto="${t.id}" data-st="${statusOf('t:' + t.id)}">
          <span class="toc-n">${n}</span>
          <span class="toc-t">${esc(t.title)}<small>${pagesLabel(t)}${t.draft ? ' · черновик' : ''}</small></span>
          <i class="toc-ck" aria-hidden="true">✓</i></button>`;
      }).join(''))
    .join('');
}

/** Одна тема: заголовок со страницами, конспект и под ним — термины темы с объяснением */
export function renderTopicBlock(topic, book, index, statusOf = () => 'new') {
  const done = statusOf('t:' + topic.id) === 'known';
  const formulas = topic.formulas.length
    ? `<h5 class="s-h">Формулы</h5><div class="s-formulas">${topic.formulas
        .map((x) => `<div class="s-formula"><code>${esc(x.f)}</code><span>${esc(x.note)}</span></div>`)
        .join('')}</div>`
    : '';
  const facts = topic.facts.map((t) => `<li>${richText(t, index)}</li>`).join('');
  const terms = topic.terms.length
    ? `<h5 class="s-h">Термины темы <small>нажми — карточка с примерами</small></h5>
       <div class="tp-terms">${topic.terms.map((t) => `
         <button type="button" class="g-row full" data-term="${t.id}" data-st="${statusOf(t.id)}">
           <span class="g-ic">${t.emoji}</span>
           <span class="g-tx"><b>${esc(t.name)}</b><small>${esc(t.simple)}</small></span>
           <i class="g-dot" aria-hidden="true"></i>
         </button>`).join('')}</div>`
    : '';
  return `
    <article class="topic" id="tp-${topic.id}" data-topic="${topic.id}">
      <header class="tp-head">
        <div class="tp-tt">
          <h4>${esc(topic.title)}</h4>
          <span class="tp-meta">${esc(book.author)} · ${pagesLabel(topic)}${topic.draft ? '<em class="tp-draft">черновик · сверить</em>' : ''}</span>
        </div>
        <button type="button" class="tp-done" data-done="${topic.id}" aria-pressed="${done}">Выучено</button>
      </header>
      <div class="s-quick"><b>⚡ За 10 секунд</b>${esc(topic.quick)}</div>
      ${formulas}
      <h5 class="s-h">Главное</h5>
      <ul class="s-facts">${facts}</ul>
      ${terms}
    </article>`;
}

/** Экран учебника: липкая панель (поиск + «Темы»), результаты поиска и лента глав и тем */
export function renderBookPage(book, index, statusOf) {
  const p = bookProgress(book, statusOf);
  const chapters = book.chapters
    .map((ch) => `<section class="chapter" id="ch-${ch.id}">
        <h3 class="ch-title">${esc(ch.title)}</h3>
        ${ch.topics.map((t) => renderTopicBlock(t, book, index, statusOf)).join('')}
      </section>`)
    .join('');
  return `
    <div class="b-top">
      <div class="b-row">
        <input id="b-q" class="g-search" type="search" placeholder="Поиск по учебникам…" autocomplete="off" aria-label="Поиск по всем учебникам">
        <button type="button" id="b-toc" class="toc-btn" aria-expanded="false" aria-controls="b-toc-panel">☰ Темы</button>
      </div>
      <nav class="toc" id="b-toc-panel" hidden>${renderToc(book, statusOf)}</nav>
    </div>
    <div id="b-results" hidden></div>
    <div id="b-content">
      <header class="b-head">
        <h2>${esc(book.title)}</h2>
        <p>${esc(book.source)}</p>
        <div class="b-prog"><div class="b-bar"><i id="b-bar-i" style="width:${p.total ? Math.round((p.done / p.total) * 100) : 0}%"></i></div><span id="b-prog-tx">Выучено ${p.done} из ${p.total} тем</span></div>
      </header>
      ${chapters}
    </div>`;
}

/* ---------- Поиск по всем учебникам ---------- */

function snip(text, q) {
  const i = norm(text).indexOf(q);
  if (i < 0) return text.length > 140 ? text.slice(0, 140) + '…' : text;
  const start = Math.max(0, i - 45);
  const end = Math.min(text.length, i + q.length + 90);
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
}
function hl(text, query) {
  const e = esc(text);
  const q = query.trim();
  if (!q || /[&<>]/.test(q)) return e;
  return e.replace(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), (m) => `<mark>${m}</mark>`);
}

/** Поиск по названиям тем, конспектам, формулам и терминам всех учебников */
export function searchAll(data, index, query) {
  const q = norm(query.trim());
  if (q.length < 2) return { topics: [], terms: [], q };
  const topics = [];
  for (const { topic, book } of allTopics(data)) {
    const fields = [
      topic.quick,
      ...topic.facts.map((f) => plainText(f, index)),
      ...topic.formulas.map((x) => `${x.f} — ${x.note}`),
      ...topic.terms.map((t) => t.name),
    ];
    let score = norm(topic.title).includes(q) ? 5 : 0;
    let snippet = '';
    for (const f of fields) {
      if (norm(f).includes(q)) { score += 1; if (!snippet) snippet = snip(f, q); }
    }
    if (score) topics.push({ topic, book, score, snippet: snippet || topic.quick });
  }
  topics.sort((a, b) => b.score - a.score);
  const terms = Object.values(index).filter(({ term }) =>
    norm(term.name).includes(q) || norm(term.simple).includes(q) || norm(term.formal).includes(q));
  return { topics, terms, q };
}

export function renderSearchResults(res, statusOf, rawQuery = '') {
  if (!res.topics.length && !res.terms.length) {
    return '<p class="g-empty">Ничего не нашлось. Попробуй другое слово или часть слова.</p>';
  }
  const topicRows = res.topics.map(({ topic, book, snippet }) => `
    <button type="button" class="g-row full sr-row" data-goto="${topic.id}">
      <span class="g-ic">${book.icon}</span>
      <span class="g-tx"><b>${hl(topic.title, rawQuery)}</b><small class="sr-meta">${esc(book.short)} · ${pagesLabel(topic)}</small><small>${hl(snippet, rawQuery)}</small></span>
    </button>`).join('');
  const termRows = res.terms.map(({ term, topic, book }) => `
    <button type="button" class="g-row full" data-term="${term.id}" data-st="${statusOf(term.id)}">
      <span class="g-ic">${term.emoji}</span>
      <span class="g-tx"><b>${hl(term.name, rawQuery)}</b><small class="sr-meta">${esc(book.short)} · ${esc(topic.title)}</small><small>${hl(term.simple, rawQuery)}</small></span>
      <i class="g-dot" aria-hidden="true"></i>
    </button>`).join('');
  return `
    ${topicRows ? `<h5 class="s-h">Темы <small>${res.topics.length}</small></h5><div class="g-list">${topicRows}</div>` : ''}
    ${termRows ? `<h5 class="s-h">Термины <small>${res.terms.length}</small></h5><div class="g-list">${termRows}</div>` : ''}`;
}

/* ---------- Карточка термина ---------- */

/** Блок «Образ из жизни» (вариант vi из списка) */
function funInner(term, vi, index) {
  const vs = termVariants(term);
  const label = vi === 0 ? 'Образ из жизни' : 'Другой образ';
  const count = vs.length > 1 ? ` · ${vi + 1}/${vs.length}` : '';
  return `<span class="term-k">${label}${count}</span><p>${richText(vs[vi], index)}</p>`;
}

/** Слоистая карточка термина */
export function renderTermCard(term, vi, index, status = 'new') {
  const badge =
    status === 'hard' ? '<span class="term-status st-hard">🤷 трудный</span>'
    : status === 'known' ? '<span class="term-status st-known">✅ знаю</span>' : '';
  const mix = (term.notmix || [])
    .map((m) => {
      const name = m.id && index[m.id]
        ? `<button type="button" class="term-link" data-term="${m.id}">${esc(m.name)}</button>`
        : `<b>${esc(m.name)}</b>`;
      return `<li>${name} — ${richText(m.diff, index)}</li>`;
    })
    .join('');
  return `
    <div class="term-emoji" aria-hidden="true">${term.emoji}</div>
    <h3 id="term-name">${esc(term.name)}${badge}</h3>
    <section class="term-sec lv1"><span class="term-k">Простыми словами</span><p>${richText(term.simple, index)}</p></section>
    <section class="term-sec fun" id="term-fun">${funInner(term, vi, index)}</section>
    <details class="term-det"><summary>⚓ На корабле</summary><p>${richText(term.onship, index)}</p></details>
    <details class="term-det"><summary>🎓 По-научному</summary><p>${richText(term.formal, index)}</p></details>
    ${mix ? `<details class="term-det"><summary>🔀 Не путай с…</summary><ul>${mix}</ul></details>` : ''}
    <section class="term-sec mn"><span class="term-k">Запомни</span><p>${richText(term.mnemo, index)}</p></section>`;
}

/* ---------- Словарь ---------- */

/** Каркас вкладки «Словарь» (поиск + фильтры); список наполняется отдельно */
export function renderGlossaryShell(query, filter) {
  const f = (id, label) =>
    `<button type="button" class="g-chip${filter === id ? ' active' : ''}" data-filter="${id}">${label}</button>`;
  return `
    <div class="g-top">
      <input id="g-q" class="g-search" type="search" placeholder="Найти термин…" autocomplete="off" value="${esc(query)}" aria-label="Поиск по словарю">
      <div class="g-filters">${f('all', 'Все')}${f('hard', '🤷 Трудные')}${f('new', '🆕 Новые')}${f('known', '✅ Знаю')}</div>
    </div>
    <p class="g-count" id="g-count"></p>
    <div class="g-list" id="g-list"></div>`;
}

/** Список терминов словаря: поиск по названию и «простым словам», фильтр по статусу */
export function renderGlossaryList(index, statusOf, query = '', filter = 'all') {
  const q = norm(query.trim());
  const all = Object.values(index)
    .sort((a, b) => a.term.name.localeCompare(b.term.name, 'ru'));
  const shown = all.filter(({ term }) => {
    if (filter !== 'all' && statusOf(term.id) !== filter) return false;
    return !q || norm(term.name).includes(q) || norm(term.simple).includes(q);
  });
  const html = shown.length
    ? shown.map(({ term, topic, book }) => `
        <button type="button" class="g-row" data-term="${term.id}" data-st="${statusOf(term.id)}">
          <span class="g-ic">${term.emoji}</span>
          <span class="g-tx"><b>${esc(term.name)}</b><small>${esc(term.simple)}</small><small class="sr-meta">${esc(book.short)} · ${esc(topic.title)}</small></span>
          <i class="g-dot" aria-hidden="true"></i>
        </button>`).join('')
    : '<p class="g-empty">Ничего не нашлось. Попробуй другое слово.</p>';
  return {
    html,
    shown: shown.length,
    total: all.length,
    known: all.filter(({ term }) => statusOf(term.id) === 'known').length,
    hard: all.filter(({ term }) => statusOf(term.id) === 'hard').length,
  };
}

/* ---------- Тренировка ---------- */

const WEIGHT = { hard: 4, new: 2, known: 1 };
function makeShuffle(rng) {
  return (a) => {
    const x = a.slice();
    for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; }
    return x;
  };
}

/**
 * Следующий вопрос «угадай термин»: «трудные» выпадают чаще, «новые» — средне, «знаю» — реже.
 * Возвращает { answer, options[] } (id терминов); варианты ответа берём из той же темы.
 */
export function pickQuestion(index, statusOf, rng = Math.random, lastId = null) {
  const all = Object.entries(index).map(([id, v]) => ({ id, topicId: v.topic.id }));
  const pool = all.filter((t) => t.id !== lastId);
  const total = pool.reduce((s, t) => s + WEIGHT[statusOf(t.id)], 0);
  let r = rng() * total;
  let ans = pool[pool.length - 1];
  for (const t of pool) { r -= WEIGHT[statusOf(t.id)]; if (r <= 0) { ans = t; break; } }
  const shuffle = makeShuffle(rng);
  const others = all.filter((t) => t.id !== ans.id);
  const same = shuffle(others.filter((t) => t.topicId === ans.topicId)).slice(0, 2);
  const rest = shuffle(others.filter((t) => !same.includes(t))).slice(0, 3 - same.length);
  return { answer: ans.id, options: shuffle([ans, ...same, ...rest]).map((t) => t.id) };
}

/** Следующий вопрос по теме; order — порядок показа вариантов (индексы исходного массива) */
export function pickQuiz(quizzes, statusOf, rng = Math.random, lastId = null) {
  if (!quizzes.length) return null;
  const pool = quizzes.length > 1 ? quizzes.filter((x) => x.id !== lastId) : quizzes;
  const total = pool.reduce((s, x) => s + WEIGHT[statusOf(x.id)], 0);
  let r = rng() * total;
  let pick = pool[pool.length - 1];
  for (const x of pool) { r -= WEIGHT[statusOf(x.id)]; if (r <= 0) { pick = x; break; } }
  const order = makeShuffle(rng)(pick.options.map((_, i) => i));
  return { id: pick.id, order };
}

/* ============================================================================
   2. ПРОГРЕСС: «знаю» / «трудный» / тема «выучена» (localStorage + CloudStorage)
   Ключи: id термина, 't:id темы', 'q:тема:номер' вопроса. Формат в хранилище:
   {"k":[…],"h":[…],"o":{id:n},"t":время}. CloudStorage принимает до 4096 символов
   на ключ — хватит на несколько сотен записей.
   ============================================================================ */
const PKEY = 'atlas.study.progress';

export function createProgress(tg, onRemote) {
  let s = { k: {}, h: {}, o: {}, t: 0 };
  const toMap = (a) => Object.fromEntries((a || []).map((i) => [i, 1]));
  const parse = (raw) => {
    try { const o = JSON.parse(raw); return o ? { k: toMap(o.k), h: toMap(o.h), o: o.o || {}, t: o.t || 0 } : null; }
    catch (e) { return null; }
  };
  const pack = () => JSON.stringify({ k: Object.keys(s.k), h: Object.keys(s.h), o: s.o, t: s.t });

  try { const local = parse(localStorage.getItem(PKEY)); if (local) s = local; } catch (e) { /* нет localStorage */ }

  let cloud = null;
  try { if (tg && tg.CloudStorage && tg.isVersionAtLeast && tg.isVersionAtLeast('6.9')) cloud = tg.CloudStorage; } catch (e) { /* старый клиент */ }
  if (cloud) {
    try {
      cloud.getItem(PKEY, (err, val) => {              // прогресс «ходит» за аккаунтом между устройствами
        if (err || !val) return;
        const c = parse(val);
        if (c && c.t > s.t) {
          s = c;
          try { localStorage.setItem(PKEY, val); } catch (e) { /* без локальной копии */ }
          onRemote && onRemote();
        }
      });
    } catch (e) { /* облако недоступно */ }
  }

  function save() {
    s.t = Date.now();
    const raw = pack();
    try { localStorage.setItem(PKEY, raw); } catch (e) { /* без локальной копии */ }
    try { cloud && cloud.setItem(PKEY, raw, () => {}); } catch (e) { /* без облака */ }
  }

  return {
    status: (id) => (s.h[id] ? 'hard' : s.k[id] ? 'known' : 'new'),
    markKnown(id) { s.k[id] = 1; delete s.h[id]; save(); },
    markHard(id) { s.h[id] = 1; delete s.k[id]; delete s.o[id]; save(); },
    unmark(id) { delete s.k[id]; delete s.h[id]; delete s.o[id]; save(); },
    /** Ответ в тренировке: «знаю» ставим только после двух верных ответов подряд (чтобы не засчитать угадывание) */
    answer(id, ok) {
      if (ok) {
        s.o[id] = (s.o[id] || 0) + 1;
        if (s.o[id] >= 2) { s.k[id] = 1; delete s.h[id]; }
      } else { delete s.o[id]; s.h[id] = 1; delete s.k[id]; }
      save();
    },
  };
}

/* ============================================================================
   3. ПАНЕЛЬ
   hooks: { onOpen, onClose, haptic, tg }
   ============================================================================ */
export function initStudy(hooks = {}) {
  const $ = (s) => document.querySelector(s);
  const root = $('#study');
  if (!root) return null;

  const btnOpen = $('#btn-study');
  const veil = $('#study-veil');
  const tabsEl = $('#study-tabs');
  const bodyEl = $('#study-body');
  const contentEl = $('#study-content');
  const dotsEl = $('#study-dots');
  const prevBtn = $('#study-prev');
  const nextBtn = $('#study-next');
  const closeBtn = $('#study-close');
  const termLayer = $('#term-layer');
  const termContent = $('#term-content');
  const termBack = $('#term-back');

  const index = buildTermIndex();
  const quizzes = buildQuizIndex();
  const buzz = (k) => { try { hooks.haptic && hooks.haptic(k); } catch (e) { /* без вибрации */ } };

  /* ---------- Страницы: учебники + «Словарь» + «Тренировка» ---------- */
  const pages = [
    ...studyData.books.map((book) => ({ type: 'book', book, short: book.short, icon: book.icon })),
    { type: 'glossary', short: 'Словарь', icon: '📚' },
    { type: 'training', short: 'Тренировка', icon: '🎯' },
  ];
  const topicLoc = {};            // id темы → номер страницы-учебника
  pages.forEach((p, i) => {
    if (p.type === 'book') p.book.chapters.forEach((c) => c.topics.forEach((t) => { topicLoc[t.id] = i; }));
  });

  const progress = createProgress(hooks.tg, () => { syncStatus(); if (pages[cur].type === 'glossary') updateGlossary(); });
  const KEY = 'atlas.study.page2';
  const POS = 'atlas.study.pos';
  let cur = 0;
  let isOpen = false;
  let pos = {};                   // учебник → тема, на которой она остановилась
  try {
    const saved = parseInt(localStorage.getItem(KEY), 10);
    if (saved >= 0 && saved < pages.length) cur = saved;
    pos = JSON.parse(localStorage.getItem(POS)) || {};
  } catch (e) { /* ничего страшного */ }
  const savePos = () => { try { localStorage.setItem(POS, JSON.stringify(pos)); } catch (e) { /* без сохранения */ } };

  /* ---------- Шапка и вкладки ---------- */
  $('#study-title').textContent = studyData.meta.title;
  $('#study-sub').textContent = studyData.meta.subtitle;
  $('#study-disc').textContent = studyData.meta.disclaimer;
  tabsEl.innerHTML = pages
    .map((p, i) => `<button type="button" role="tab" class="study-tab" data-i="${i}" aria-selected="false"><i>${p.icon}</i>${esc(p.short)}</button>`)
    .join('');
  dotsEl.innerHTML = pages.map(() => '<span></span>').join('');

  /* ---------- Состояние словаря и тренировки ---------- */
  const g = { q: '', f: 'all' };
  const tr = { mode: 'terms', asked: 0, right: 0, streak: 0, q: null, answered: false, last: null };

  /** Обновить статусы (точки у терминов, галочки тем, прогресс) без перерисовки страницы */
  function syncStatus() {
    contentEl.querySelectorAll('[data-term][data-st]').forEach((el) => { el.dataset.st = progress.status(el.dataset.term); });
    syncBook();
  }
  function syncBook() {
    const page = pages[cur];
    if (page.type !== 'book') return;
    contentEl.querySelectorAll('.tp-done').forEach((b) => {
      b.setAttribute('aria-pressed', String(progress.status('t:' + b.dataset.done) === 'known'));
    });
    contentEl.querySelectorAll('.toc-it').forEach((b) => { b.dataset.st = progress.status('t:' + b.dataset.goto); });
    const p = bookProgress(page.book, progress.status);
    const tx = $('#b-prog-tx'); const bar = $('#b-bar-i');
    if (tx) tx.textContent = `Выучено ${p.done} из ${p.total} тем`;
    if (bar) bar.style.width = (p.total ? Math.round((p.done / p.total) * 100) : 0) + '%';
  }

  /* ---------- Экран учебника: оглавление, поиск, позиция, «выучено» ---------- */
  const topBarH = () => { const t = contentEl.querySelector('.b-top'); return t ? t.offsetHeight : 0; };
  const resultsEl = () => $('#b-results');
  let savedScroll = 0;

  function scrollToTopic(id, flash, smooth) {
    const el = contentEl.querySelector('#tp-' + id);
    if (!el) return;
    const y = el.getBoundingClientRect().top - bodyEl.getBoundingClientRect().top + bodyEl.scrollTop - topBarH() - 10;
    bodyEl.scrollTo({ top: Math.max(0, y), behavior: smooth ? 'smooth' : 'auto' });
    if (flash) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
  }
  function currentTopicId() {
    const line = bodyEl.getBoundingClientRect().top + topBarH() + 24;
    let id = null;
    contentEl.querySelectorAll('.topic').forEach((el) => { if (el.getBoundingClientRect().top <= line) id = el.dataset.topic; });
    return id;
  }
  let scrollTimer = 0;
  bodyEl.addEventListener('scroll', () => {                // запоминаем, на какой теме остановилась
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      const page = pages[cur];
      const res = resultsEl();
      if (page.type !== 'book' || !isOpen || (res && !res.hidden)) return;
      const id = currentTopicId();
      if (id) pos[page.book.id] = id; else delete pos[page.book.id];
      savePos();
    }, 200);
  }, { passive: true });

  const closeToc = () => {
    const panel = $('#b-toc-panel'); const btn = $('#b-toc');
    if (panel) panel.hidden = true;
    if (btn) btn.setAttribute('aria-expanded', 'false');
  };
  function toggleToc() {
    const panel = $('#b-toc-panel'); const btn = $('#b-toc');
    if (!panel) return;
    panel.hidden = !panel.hidden;
    btn.setAttribute('aria-expanded', String(!panel.hidden));
  }

  function runSearch() {
    const input = $('#b-q'); const res = resultsEl(); const content = $('#b-content');
    if (!input || !res) return;
    const q = input.value;
    if (q.trim().length < 2) {                             // запрос очищен — вернуть ленту на прежнее место
      if (!res.hidden) { res.hidden = true; content.hidden = false; bodyEl.scrollTop = savedScroll; }
      return;
    }
    if (res.hidden) { savedScroll = bodyEl.scrollTop; bodyEl.scrollTop = 0; }
    closeToc();
    res.hidden = false; content.hidden = true;
    res.innerHTML = renderSearchResults(searchAll(studyData, index, q), progress.status, q);
  }
  function clearSearch() {
    const input = $('#b-q');
    if (input && input.value) { input.value = ''; runSearch(); }
  }

  /** Перейти к теме: переключить учебник (если нужно), закрыть поиск и оглавление, подсветить тему */
  function goToTopic(id) {
    const page = topicLoc[id];
    if (page === undefined) return;
    const wasHere = cur === page;
    if (!wasHere) show(page, page > cur ? 1 : -1);
    clearSearch();
    closeToc();
    scrollToTopic(id, true, wasHere);
    buzz('light');
  }

  function toggleDone(id) {
    if (progress.status('t:' + id) === 'known') progress.unmark('t:' + id);
    else progress.markKnown('t:' + id);
    syncBook();
    buzz('medium');
  }

  /* ---------- Словарь ---------- */
  function updateGlossary() {
    const r = renderGlossaryList(index, progress.status, g.q, g.f);
    const list = $('#g-list');
    if (!list) return;
    list.innerHTML = r.html;
    $('#g-count').textContent = `Показано ${r.shown} из ${r.total} · знаю ${r.known} · трудных ${r.hard}`;
  }

  /* ---------- Тренировка: «угадай термин» и «вопросы по темам» ---------- */
  function trainingHead() {
    const mode = (id, label) => `<button type="button" class="g-chip${tr.mode === id ? ' active' : ''}" data-mode="${id}">${label}</button>`;
    return `<div class="tr-modes">${mode('terms', '🔤 Термины')}${mode('quiz', '❓ Вопросы по темам')}</div><div class="tr-stats" id="tr-stats"></div>`;
  }
  function renderTraining() {
    if (tr.mode === 'terms') {
      if (!tr.q) { tr.q = pickQuestion(index, progress.status, Math.random, tr.last); tr.answered = false; }
      const term = index[tr.q.answer].term;
      const opts = tr.q.options
        .map((id) => `<button type="button" class="tr-opt" data-opt="${id}">${esc(index[id].term.name)}</button>`)
        .join('');
      contentEl.innerHTML = `${trainingHead()}
        <div class="tr-card"><span class="tr-k">Что это за термин?</span><p class="tr-q">${esc(term.simple)}</p></div>
        <div class="tr-opts">${opts}</div>
        <div class="tr-fb" id="tr-fb" aria-live="polite"></div>
        <p class="tr-hint">Неверные ответы попадают в «Трудные» и выпадают чаще. «Знаю» ставится после двух верных ответов подряд.</p>`;
    } else if (!quizzes.length) {
      contentEl.innerHTML = `${trainingHead()}<p class="g-empty">Вопросов по темам пока нет.</p>`;
    } else {
      if (!tr.q) { tr.q = pickQuiz(quizzes, progress.status, Math.random, tr.last); tr.answered = false; }
      const item = quizzes.find((x) => x.id === tr.q.id);
      const opts = tr.q.order
        .map((i) => `<button type="button" class="tr-opt" data-qi="${i}">${esc(item.options[i])}</button>`)
        .join('');
      contentEl.innerHTML = `${trainingHead()}
        <div class="tr-card"><span class="tr-k">${esc(item.topic.title)}</span><p class="tr-q">${esc(item.q)}</p></div>
        <div class="tr-opts">${opts}</div>
        <div class="tr-fb" id="tr-fb" aria-live="polite"></div>
        <p class="tr-hint">Вопросы берутся из тем. Ошибки возвращаются чаще; после двух верных ответов подряд вопрос реже.</p>`;
    }
    updateTrainingStats();
  }
  function updateTrainingStats() {
    const el = $('#tr-stats');
    if (el) el.innerHTML = `<span>Верно: <b>${tr.right}</b> из <b>${tr.asked}</b></span><span>Серия: <b>${tr.streak}</b> 🔥</span>`;
  }
  /** Общая часть ответа: счётчики, подсветка кнопок */
  function finishAnswer(id, ok, rightSel, chosenSel) {
    tr.answered = true;
    progress.answer(id, ok);
    tr.asked++;
    if (ok) { tr.right++; tr.streak++; } else { tr.streak = 0; }
    contentEl.querySelectorAll('.tr-opt').forEach((b) => {
      b.disabled = true;
      if (b.matches(rightSel)) b.classList.add('right');
      else if (b.matches(chosenSel)) b.classList.add('wrong');
    });
    updateTrainingStats();
    buzz(ok ? 'light' : 'medium');
  }
  function answerTerm(optId) {
    if (tr.answered || !tr.q) return;
    const correct = tr.q.answer;
    const ok = optId === correct;
    finishAnswer(correct, ok, `[data-opt="${correct}"]`, `[data-opt="${optId}"]`);
    const t = index[correct].term;
    $('#tr-fb').innerHTML = `
      <div class="tr-res ${ok ? 'ok' : 'bad'}">${ok ? '✅ Верно!' : `❌ Это «${esc(t.name)}»`}</div>
      <p class="tr-explain">${richText(t.funny, index)}</p>
      <div class="tr-btns">
        <button type="button" class="ghost-btn" data-term="${correct}">Открыть карточку</button>
        <button type="button" class="ghost-btn primary" data-act="tr-next">Дальше →</button>
      </div>`;
  }
  function answerQuiz(i) {
    if (tr.answered || !tr.q) return;
    const item = quizzes.find((x) => x.id === tr.q.id);
    const ok = i === item.answer;
    finishAnswer(item.id, ok, `[data-qi="${item.answer}"]`, `[data-qi="${i}"]`);
    $('#tr-fb').innerHTML = `
      <div class="tr-res ${ok ? 'ok' : 'bad'}">${ok ? '✅ Верно!' : '❌ Не совсем'}</div>
      <p class="tr-explain">${esc(item.explain)}</p>
      <div class="tr-btns">
        <button type="button" class="ghost-btn" data-goto="${item.topic.id}">Открыть тему</button>
        <button type="button" class="ghost-btn primary" data-act="tr-next">Дальше →</button>
      </div>`;
  }

  /* ---------- Показ страницы ---------- */
  function show(i, dir) {
    cur = (i + pages.length) % pages.length;
    const page = pages[cur];
    if (page.type === 'book') {
      contentEl.innerHTML = renderBookPage(page.book, index, progress.status);
      contentEl.setAttribute('aria-label', page.book.title);
    } else if (page.type === 'glossary') {
      contentEl.innerHTML = renderGlossaryShell(g.q, g.f);
      contentEl.setAttribute('aria-label', 'Словарь терминов');
      updateGlossary();
    } else {
      renderTraining();
      contentEl.setAttribute('aria-label', 'Тренировка');
    }
    bodyEl.scrollTop = 0;
    if (page.type === 'book' && pos[page.book.id]) scrollToTopic(pos[page.book.id], false, false);   // вернуться туда, где остановилась

    // Анимация «листания»: новая страница въезжает с той стороны, куда листаем
    contentEl.classList.remove('from-right', 'from-left');
    if (dir) {
      void contentEl.offsetWidth;                          // перезапуск CSS-анимации
      contentEl.classList.add(dir > 0 ? 'from-right' : 'from-left');
    }

    [...tabsEl.children].forEach((b, k) => {
      const on = k === cur;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
      if (on && b.scrollIntoView) b.scrollIntoView({ inline: 'center', block: 'nearest', behavior: dir ? 'smooth' : 'auto' });
    });
    [...dotsEl.children].forEach((d, k) => d.classList.toggle('on', k === cur));
    prevBtn.textContent = '‹ ' + pages[(cur - 1 + pages.length) % pages.length].short;
    nextBtn.textContent = pages[(cur + 1) % pages.length].short + ' ›';
    try { localStorage.setItem(KEY, String(cur)); } catch (e) { /* без сохранения */ }
  }
  const go = (dir) => { show(cur + dir, dir); buzz('light'); };

  tabsEl.addEventListener('click', (e) => {
    const b = e.target.closest('.study-tab');
    if (!b) return;
    const i = +b.dataset.i;
    if (i !== cur) { show(i, i > cur ? 1 : -1); buzz('light'); }
  });
  prevBtn.addEventListener('click', () => go(-1));
  nextBtn.addEventListener('click', () => go(1));

  // Делегирование кликов внутри страницы
  bodyEl.addEventListener('click', (e) => {
    const t = e.target;
    if (!t.closest('.b-top')) closeToc();                  // тап по ленте закрывает оглавление
    const termEl = t.closest('[data-term]');
    if (termEl) { openTerm(termEl.dataset.term); return; }
    const gotoEl = t.closest('[data-goto]');
    if (gotoEl) { goToTopic(gotoEl.dataset.goto); return; }
    const doneEl = t.closest('[data-done]');
    if (doneEl) { toggleDone(doneEl.dataset.done); return; }
    if (t.closest('#b-toc')) { toggleToc(); return; }
    const filt = t.closest('[data-filter]');
    if (filt) {
      g.f = filt.dataset.filter;
      contentEl.querySelectorAll('.g-chip').forEach((c) => c.classList.toggle('active', c === filt));
      updateGlossary();
      return;
    }
    const mode = t.closest('[data-mode]');
    if (mode) { tr.mode = mode.dataset.mode; tr.q = null; tr.last = null; renderTraining(); buzz('light'); return; }
    const opt = t.closest('[data-opt]');
    if (opt) { answerTerm(opt.dataset.opt); return; }
    const qi = t.closest('[data-qi]');
    if (qi) { answerQuiz(+qi.dataset.qi); return; }
    if (t.closest('[data-act="tr-next"]')) {
      tr.last = tr.mode === 'terms' ? tr.q && tr.q.answer : tr.q && tr.q.id;
      tr.q = null;
      renderTraining();
      bodyEl.scrollTop = 0;
      buzz('light');
    }
  });
  bodyEl.addEventListener('input', (e) => {
    if (e.target.id === 'g-q') { g.q = e.target.value; updateGlossary(); }
    else if (e.target.id === 'b-q') runSearch();
  });

  // Свайп влево/вправо по содержимому — соседняя страница
  let sx = 0, sy = 0, st = 0;
  bodyEl.addEventListener('touchstart', (e) => {
    const t = e.touches[0]; sx = t.clientX; sy = t.clientY; st = Date.now();
  }, { passive: true });
  bodyEl.addEventListener('touchend', (e) => {
    if (termStack.length || e.target.closest('input')) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - sx, dy = t.clientY - sy;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.6 && Date.now() - st < 700) go(dx < 0 ? 1 : -1);
  }, { passive: true });

  /* ---------- Карточка термина ---------- */
  let termStack = [];            // история переходов между терминами («Не путай с…»)
  let termVar = 0;               // какой вариант «образа из жизни» показан сейчас
  const curId = () => termStack[termStack.length - 1];

  function renderTerm(keepDetails) {
    const id = curId();
    const open = keepDetails ? [...termContent.querySelectorAll('details')].map((d) => d.open) : [];
    termContent.innerHTML = renderTermCard(index[id].term, termVar, index, progress.status(id));
    termContent.querySelectorAll('details').forEach((d, k) => { d.open = !!open[k]; });
    termBack.hidden = termStack.length < 2;
  }
  function openTerm(id) {
    if (!index[id]) return;
    if (curId() !== id) termStack.push(id);
    termVar = 0;
    renderTerm(false);
    termLayer.classList.add('open');
    termLayer.setAttribute('aria-hidden', 'false');
    termContent.scrollTop = 0;
    buzz('medium');
    setTimeout(() => { if (termStack.length) $('#term-close').focus({ preventScroll: true }); }, 260);
  }
  function closeTerm() {
    if (!termStack.length) return;
    termStack = [];
    termLayer.classList.remove('open');
    termLayer.setAttribute('aria-hidden', 'true');
    syncStatus();
    if (pages[cur].type === 'glossary') updateGlossary();   // статус мог поменяться — фильтр «Трудные»/«Знаю»
    buzz('light');
  }
  function stepBack() {          // «Назад»: на предыдущий термин, а если он первый — закрыть карточку
    if (termStack.length > 1) { termStack.pop(); termVar = 0; renderTerm(false); termContent.scrollTop = 0; buzz('light'); }
    else closeTerm();
  }

  termContent.addEventListener('click', (e) => {              // переход по ссылкам внутри карточки
    const el = e.target.closest('[data-term]');
    if (el) openTerm(el.dataset.term);
  });
  termBack.addEventListener('click', stepBack);
  $('#term-close').addEventListener('click', closeTerm);
  $('#term-veil').addEventListener('click', closeTerm);

  // «Не понял — иначе»: помечаем термин трудным и показываем другой образ
  $('#term-hard').addEventListener('click', () => {
    const id = curId();
    if (!id) return;
    progress.markHard(id);
    termVar = (termVar + 1) % termVariants(index[id].term).length;
    renderTerm(true);
    const fun = $('#term-fun');
    fun.classList.remove('flash'); void fun.offsetWidth; fun.classList.add('flash');
    fun.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    buzz('medium');
  });
  // «Понял»: отмечаем термин изученным и закрываем карточку
  $('#term-ok').addEventListener('click', () => {
    const id = curId();
    if (id) progress.markKnown(id);
    buzz('medium');
    closeTerm();
  });

  /* ---------- Открытие / закрытие панели ---------- */
  const tgBack = hooks.tg && hooks.tg.BackButton;
  function open() {
    if (isOpen) return;
    isOpen = true;
    hooks.onOpen && hooks.onOpen();                         // script.js: закрыть карточку метки, заморозить рендер
    show(cur, 0);
    document.body.classList.add('study-open');             // CSS: блюр 3D-фона + скрытие остального UI
    root.classList.add('open');
    root.setAttribute('aria-hidden', 'false');
    btnOpen.setAttribute('aria-expanded', 'true');
    try { tgBack && tgBack.show(); } catch (e) { /* старый клиент */ }
    buzz('medium');
    setTimeout(() => { if (isOpen) closeBtn.focus({ preventScroll: true }); }, 400);
  }
  function close() {
    if (!isOpen) return;
    closeTerm();
    isOpen = false;
    document.body.classList.remove('study-open');
    root.classList.remove('open');
    root.setAttribute('aria-hidden', 'true');
    btnOpen.setAttribute('aria-expanded', 'false');
    try { tgBack && tgBack.hide(); } catch (e) { /* старый клиент */ }
    hooks.onClose && hooks.onClose();
    buzz('light');
    btnOpen.focus({ preventScroll: true });
  }

  btnOpen.addEventListener('click', () => (isOpen ? close() : open()));
  closeBtn.addEventListener('click', close);
  veil.addEventListener('click', () => { if (!termStack.length) close(); });

  // Кнопка «Назад» в Telegram: шаг назад по терминам, потом закрытие карточки, потом панели
  try {
    tgBack && tgBack.onClick(() => { if (!isOpen) return; termStack.length ? stepBack() : close(); });
  } catch (e) { /* старый клиент */ }

  window.addEventListener('keydown', (e) => {
    if (!isOpen) return;
    if (e.key === 'Escape') { termStack.length ? stepBack() : close(); }
    else if (!termStack.length && !e.target.closest('input')) {
      if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
    }
  });

  // Свайп шторки вниз за «ручку» и шапку — закрыть
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

  show(cur, 0);                                            // первичная отрисовка (панель скрыта)
  return { open, close, show, openTerm, goToTopic };
}
