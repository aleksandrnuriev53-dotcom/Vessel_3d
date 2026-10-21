/* ============================================================================
   search.js — глобальный поиск по шпаргалкам (чистая логика, без DOM)
   Ищет по ВСЕМ учебникам: главы, темы, термины, формулы, факты, вопросы.
   Как работает:
     • запрос режется на слова; результат должен содержать ВСЕ слова (И);
     • регистр и «ё/е» не важны; ищем по подстроке, поэтому окончания не мешают
       («девиац» найдёт «девиации»);
     • ранжирование: глава/тема/термин выше формул, формулы выше фактов;
       совпадение в заголовке и в начале слова весит больше, чем в тексте.
   Новые главы и темы в study-data.js попадают в поиск автоматически.
   ============================================================================ */

export const KIND_LABEL = {
  chapter: 'Глава',
  topic: 'Тема',
  term: 'Термин',
  formula: 'Формула',
  question: 'Вопрос',
  fact: 'Факт',
};

const KIND_WEIGHT = { chapter: 60, topic: 50, term: 45, formula: 30, question: 20, fact: 15 };

/** Нижний регистр + ё→е. Длина строки не меняется — это важно для подсветки. */
export const norm = (s) => String(s).toLowerCase().replace(/ё/g, 'е');

const escHtml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Убирает разметку конспекта: **жирный** и {{id термина}} → имя термина */
export function plain(str, names = {}) {
  return String(str)
    .replace(/\*\*/g, '')
    .replace(/\{\{(\w+)\}\}/g, (m, id) => names[id] || id);
}

export function tokenize(query) {
  return norm(query).split(/[\s,;]+/).filter(Boolean);
}

const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

/** Строит плоский индекс из дерева учебник → глава → тема */
export function buildSearchIndex(data) {
  const names = {};
  for (const b of data.books) {
    for (const ch of b.chapters) {
      for (const t of ch.topics) for (const term of t.terms || []) names[term.id] = term.name;
    }
  }

  const items = [];
  let order = 0;
  const push = (it) => {
    const raw = it.raw || it.text || it.title;
    items.push({
      ...it,
      raw,
      tn: norm(it.title),
      xn: norm(it.text || raw),
      order: order++,
    });
  };

  for (const book of data.books) {
    for (const ch of book.chapters) {
      const topics = ch.topics.filter((t) => !/placeholder/.test(t.id)); // заглушки в поиск не берём
      if (!topics.length) continue;

      // Глава: находится и по названию главы, и по названиям её тем
      push({
        kind: 'chapter',
        id: ch.id,
        bookId: book.id,
        chapterId: ch.id,
        topicId: topics[0].id,
        title: ch.title,
        text: [ch.title, ...topics.map((t) => t.title)].join(' · '),
        crumb: `${book.short} · ${topics.length} ${topics.length === 1 ? 'тема' : 'тем'}`,
      });

      for (const topic of topics) {
        const base = { bookId: book.id, chapterId: ch.id, topicId: topic.id };
        const where = `${book.short} · ${ch.title}`;
        const inTopic = `${book.short} · ${topic.title}`;

        push({
          ...base, kind: 'topic', id: topic.id, title: topic.title,
          text: [topic.title, topic.quick].filter(Boolean).join(' — '),
          crumb: where,
        });

        (topic.formulas || []).forEach((x, i) =>
          push({
            ...base, kind: 'formula', id: `${topic.id}#f${i}`, ref: i, title: x.f,
            text: `${x.f} — ${x.note}`, crumb: inTopic,
          }));

        (topic.facts || []).forEach((f, i) => {
          const txt = plain(f, names);
          push({
            ...base, kind: 'fact', id: `${topic.id}#t${i}`, ref: i,
            title: clip(txt, 90), text: txt, crumb: inTopic,
          });
        });

        for (const term of topic.terms || []) {
          push({
            ...base, kind: 'term', id: term.id, title: term.name,
            text: [term.name, term.formal, term.funny, term.mnemo].filter(Boolean).join(' — '),
            raw: term.formal,
            crumb: inTopic,
          });
        }

        for (const q of topic.questions || []) {
          push({
            ...base, kind: 'question', id: q.id, title: q.prompt,
            text: `${q.prompt} → ${q.answer}`, crumb: inTopic,
          });
        }
      }
    }
  }
  return items;
}

const WORD_START = /[\s(«"'—–\-/·,.;:]/;

function score(it, toks) {
  let s = KIND_WEIGHT[it.kind] || 0;
  for (const t of toks) {
    const ti = it.tn.indexOf(t);
    if (ti >= 0) {
      s += ti === 0 || WORD_START.test(it.tn[ti - 1]) ? 40 : 25;
    } else {
      const xi = it.xn.indexOf(t);
      if (xi < 0) return -1;                       // слово нигде не найдено → не подходит
      s += xi === 0 || WORD_START.test(it.xn[xi - 1]) ? 8 : 4;
    }
  }
  if (it.tn === toks.join(' ')) s += 50;           // точное совпадение заголовка
  return s;
}

/**
 * Поиск.
 * @param bookId если задан — только этот учебник; `outside` скажет, сколько совпадений в остальных.
 */
export function search(index, query, { bookId = null, limit = 200 } = {}) {
  const toks = tokenize(query);
  if (norm(query).trim().length < 2) return { toks, hits: [], outside: 0 };

  const scored = [];
  for (const it of index) {
    const s = score(it, toks);
    if (s >= 0) scored.push([s, it]);
  }
  scored.sort((a, b) => b[0] - a[0] || a[1].order - b[1].order);

  const all = scored.map((x) => x[1]);
  const hits = bookId ? all.filter((i) => i.bookId === bookId) : all;
  return { toks, hits: hits.slice(0, limit), outside: all.length - hits.length };
}

/** Экранирует текст и оборачивает найденные слова в <mark class="sm"> */
export function highlight(raw, toks) {
  const s = String(raw);
  const n = norm(s);
  if (n.length !== s.length || !toks.length) return escHtml(s);

  const ranges = [];
  for (const t of toks) {
    let i = 0;
    while ((i = n.indexOf(t, i)) >= 0) { ranges.push([i, i + t.length]); i += t.length; }
  }
  if (!ranges.length) return escHtml(s);

  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [ranges[0].slice()];
  for (const r of ranges.slice(1)) {
    const last = merged[merged.length - 1];
    if (r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push(r.slice());
  }

  let out = '';
  let pos = 0;
  for (const [a, b] of merged) {
    out += escHtml(s.slice(pos, a)) + '<mark class="sm">' + escHtml(s.slice(a, b)) + '</mark>';
    pos = b;
  }
  return out + escHtml(s.slice(pos));
}

/** Короткая выдержка из текста вокруг первого найденного слова */
export function snippet(raw, toks, max = 110) {
  const s = String(raw).replace(/\s+/g, ' ');
  if (s.length <= max) return s;
  const n = norm(s);
  let at = -1;
  for (const t of toks) {
    const i = n.indexOf(t);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (at < 0) return clip(s, max);
  const start = Math.max(0, at - 28);
  const end = Math.min(s.length, start + max);
  return (start > 0 ? '…' : '') + s.slice(start, end).trim() + (end < s.length ? '…' : '');
}
