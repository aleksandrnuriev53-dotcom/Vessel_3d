/* ============================================================================
   study.js — логика раздела «Шпаргалки» для 3D-атласа судна
   ----------------------------------------------------------------------------
   Контент лежит в study-data.js. Здесь:
     1. чистые функции отображения (их можно проверять в Node);
     2. прогресс «знаю / трудный» (localStorage + Telegram CloudStorage);
     3. initStudy — панель: темы, словарь, тренировка, слоистая карточка термина
        («Простыми словами» → «Образ из жизни» → «На корабле» → «По-научному»
        → «Не путай с…» → «Запомни») и кнопка «Не понял — иначе».
   ============================================================================ */

import { studyData } from './study-data.js';
export { studyData };

/* ============================================================================
   1. ЧИСТЫЕ ФУНКЦИИ
   ============================================================================ */

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const norm = (s) => String(s).toLowerCase().replace(/ё/g, 'е');

/** Индекс терминов: id → { term, topic } */
export function buildTermIndex(data = studyData) {
  const idx = {};
  data.topics.forEach((topic) => topic.terms.forEach((term) => { idx[term.id] = { term, topic }; }));
  return idx;
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

/** HTML темы: «за 10 секунд», формулы, факты, чипы терминов, источник */
export function renderTopic(topic, index, statusOf = () => 'new') {
  const formulas = topic.formulas.length
    ? `<h3 class="s-h">Формулы</h3><div class="s-formulas">${topic.formulas
        .map((x) => `<div class="s-formula"><code>${esc(x.f)}</code><span>${esc(x.note)}</span></div>`)
        .join('')}</div>`
    : '';
  const facts = topic.facts.map((t) => `<li>${richText(t, index)}</li>`).join('');
  const chips = topic.terms
    .map((t) => `<button type="button" class="term-chip" data-term="${t.id}" data-st="${statusOf(t.id)}"><i>${t.emoji}</i>${esc(t.name)}</button>`)
    .join('');
  return `
    <div class="s-quick"><b>⚡ За 10 секунд</b>${esc(topic.quick)}</div>
    ${formulas}
    <h3 class="s-h">Факты</h3>
    <ul class="s-facts">${facts}</ul>
    <h3 class="s-h">Сложные термины <small>нажми — объясню простыми словами</small></h3>
    <div class="s-terms">${chips}</div>
    <p class="s-src">📖 ${esc(topic.book)}</p>`;
}

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
  const all = Object.values(index).map(({ term }) => term)
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  const shown = all.filter((t) => {
    if (filter !== 'all' && statusOf(t.id) !== filter) return false;
    return !q || norm(t.name).includes(q) || norm(t.simple).includes(q);
  });
  const html = shown.length
    ? shown.map((t) => `
        <button type="button" class="g-row" data-term="${t.id}" data-st="${statusOf(t.id)}">
          <span class="g-ic">${t.emoji}</span>
          <span class="g-tx"><b>${esc(t.name)}</b><small>${esc(t.simple)}</small></span>
          <i class="g-dot" aria-hidden="true"></i>
        </button>`).join('')
    : '<p class="g-empty">Ничего не нашлось. Попробуй другое слово.</p>';
  return {
    html,
    shown: shown.length,
    total: all.length,
    known: all.filter((t) => statusOf(t.id) === 'known').length,
    hard: all.filter((t) => statusOf(t.id) === 'hard').length,
  };
}

/**
 * Следующий вопрос тренировки: «трудные» выпадают чаще, «новые» — средне, «знаю» — реже.
 * Возвращает { answer, options[] } (id терминов); варианты ответа берём из той же темы.
 */
export function pickQuestion(index, statusOf, rng = Math.random, lastId = null) {
  const W = { hard: 4, new: 2, known: 1 };
  const all = Object.entries(index).map(([id, v]) => ({ id, topicId: v.topic.id }));
  const pool = all.filter((t) => t.id !== lastId);
  const total = pool.reduce((s, t) => s + W[statusOf(t.id)], 0);
  let r = rng() * total;
  let ans = pool[pool.length - 1];
  for (const t of pool) { r -= W[statusOf(t.id)]; if (r <= 0) { ans = t; break; } }

  const shuffle = (a) => {
    const x = a.slice();
    for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; }
    return x;
  };
  const others = all.filter((t) => t.id !== ans.id);
  const same = shuffle(others.filter((t) => t.topicId === ans.topicId)).slice(0, 2);
  const rest = shuffle(others.filter((t) => !same.includes(t))).slice(0, 3 - same.length);
  return { answer: ans.id, options: shuffle([ans, ...same, ...rest]).map((t) => t.id) };
}

/* ============================================================================
   2. ПРОГРЕСС: «знаю» / «трудный» (localStorage + Telegram CloudStorage)
   Формат в хранилище: {"k":[id…],"h":[id…],"o":{id:n},"t":время}. CloudStorage
   принимает до 4096 символов на ключ — этого хватает на несколько сотен терминов.
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

  const topics = studyData.topics;
  const index = buildTermIndex();
  const buzz = (k) => { try { hooks.haptic && hooks.haptic(k); } catch (e) { /* без вибрации */ } };

  /* ---------- Страницы: темы + «Словарь» + «Тренировка» ---------- */
  const pages = [
    ...topics.map((t) => ({ type: 'topic', topic: t, short: t.short, icon: t.icon })),
    { type: 'glossary', short: 'Словарь', icon: '📚' },
    { type: 'training', short: 'Тренировка', icon: '🎯' },
  ];

  const progress = createProgress(hooks.tg, () => { syncStatus(); if (pages[cur].type === 'glossary') updateGlossary(); });
  const KEY = 'atlas.study.page';
  let cur = 0;
  let isOpen = false;
  try {
    const saved = parseInt(localStorage.getItem(KEY), 10);
    if (saved >= 0 && saved < pages.length) cur = saved;
  } catch (e) { /* ничего страшного */ }

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
  const tr = { asked: 0, right: 0, streak: 0, q: null, answered: false, last: null };

  /** Обновить цветные точки статуса у чипов и строк словаря без перерисовки страницы */
  function syncStatus() {
    contentEl.querySelectorAll('[data-term][data-st]').forEach((el) => { el.dataset.st = progress.status(el.dataset.term); });
  }

  function updateGlossary() {
    const r = renderGlossaryList(index, progress.status, g.q, g.f);
    const list = $('#g-list');
    if (!list) return;
    list.innerHTML = r.html;
    $('#g-count').textContent = `Показано ${r.shown} из ${r.total} · знаю ${r.known} · трудных ${r.hard}`;
  }

  function renderTraining() {
    if (!tr.q) { tr.q = pickQuestion(index, progress.status, Math.random, tr.last); tr.answered = false; }
    const term = index[tr.q.answer].term;
    const opts = tr.q.options
      .map((id) => `<button type="button" class="tr-opt" data-opt="${id}">${esc(index[id].term.name)}</button>`)
      .join('');
    contentEl.innerHTML = `
      <div class="tr-stats" id="tr-stats"></div>
      <div class="tr-card"><span class="tr-k">Что это за термин?</span><p class="tr-q">${esc(term.simple)}</p></div>
      <div class="tr-opts">${opts}</div>
      <div class="tr-fb" id="tr-fb" aria-live="polite"></div>
      <p class="tr-hint">Неверные ответы попадают в «Трудные» и выпадают чаще. «Знаю» ставится после двух верных ответов подряд.</p>`;
    updateTrainingStats();
  }
  function updateTrainingStats() {
    const el = $('#tr-stats');
    if (el) el.innerHTML = `<span>Верно: <b>${tr.right}</b> из <b>${tr.asked}</b></span><span>Серия: <b>${tr.streak}</b> 🔥</span>`;
  }
  function answerTraining(optId) {
    if (tr.answered || !tr.q) return;
    tr.answered = true;
    const correct = tr.q.answer;
    const ok = optId === correct;
    progress.answer(correct, ok);
    tr.asked++;
    if (ok) { tr.right++; tr.streak++; } else { tr.streak = 0; }
    contentEl.querySelectorAll('.tr-opt').forEach((b) => {
      b.disabled = true;
      if (b.dataset.opt === correct) b.classList.add('right');
      else if (b.dataset.opt === optId) b.classList.add('wrong');
    });
    const t = index[correct].term;
    $('#tr-fb').innerHTML = `
      <div class="tr-res ${ok ? 'ok' : 'bad'}">${ok ? '✅ Верно!' : `❌ Это «${esc(t.name)}»`}</div>
      <p class="tr-explain">${richText(t.funny, index)}</p>
      <div class="tr-btns">
        <button type="button" class="ghost-btn" data-term="${correct}">Открыть карточку</button>
        <button type="button" class="ghost-btn primary" data-act="tr-next">Дальше →</button>
      </div>`;
    updateTrainingStats();
    buzz(ok ? 'light' : 'medium');
  }

  /* ---------- Показ страницы ---------- */
  function show(i, dir) {
    cur = (i + pages.length) % pages.length;
    const page = pages[cur];
    if (page.type === 'topic') {
      contentEl.innerHTML = renderTopic(page.topic, index, progress.status);
      contentEl.setAttribute('aria-label', page.topic.title);
    } else if (page.type === 'glossary') {
      contentEl.innerHTML = renderGlossaryShell(g.q, g.f);
      contentEl.setAttribute('aria-label', 'Словарь терминов');
      updateGlossary();
    } else {
      renderTraining();
      contentEl.setAttribute('aria-label', 'Тренировка терминов');
    }
    bodyEl.scrollTop = 0;

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

  // Делегирование кликов внутри страницы: термины, фильтры словаря, тренировка
  bodyEl.addEventListener('click', (e) => {
    const termEl = e.target.closest('[data-term]');
    if (termEl) { openTerm(termEl.dataset.term); return; }
    const filt = e.target.closest('[data-filter]');
    if (filt) {
      g.f = filt.dataset.filter;
      contentEl.querySelectorAll('.g-chip').forEach((c) => c.classList.toggle('active', c === filt));
      updateGlossary();
      return;
    }
    const opt = e.target.closest('[data-opt]');
    if (opt) { answerTraining(opt.dataset.opt); return; }
    if (e.target.closest('[data-act="tr-next"]')) {
      tr.last = tr.q && tr.q.answer; tr.q = null;
      renderTraining();
      bodyEl.scrollTop = 0;
      buzz('light');
    }
  });
  bodyEl.addEventListener('input', (e) => {
    if (e.target.id === 'g-q') { g.q = e.target.value; updateGlossary(); }
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
  return { open, close, show, openTerm };
}
