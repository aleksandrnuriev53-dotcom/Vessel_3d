/* ============================================================================
   3D АТЛАС АНАТОМИИ СУДНА — Telegram Mini App
   ----------------------------------------------------------------------------
   Всё судно строится процедурно из примитивов Three.js (внешних моделей нет):
     1. Корпус — «лофтинг» по сечениям (красная подводная часть + чёрный борт),
        бульб носа и кормы, транец, палуба, бак.
     2. Внутренний набор — двойное дно, флоры, стрингеры, шпангоуты, переборки,
        главный двигатель (виден в режиме «Разрез / Рентген»).
     3. Палубное оборудование — люки, краны, леера, швартовное и якорное
        устройства, вентиляторы.
     4. Надстройка в корме — 4 яруса, мостик, окна, мачта, радары, труба.
   Для мобильных устройств все статические меши после сборки объединяются
   по материалам (mergeGeometries) — это сокращает число draw call до ~40.
   ============================================================================ */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// <<BUILD-START>>  (маркер для автоматической проверки генератора судна)

/* ============================================================================
   1. ПАРАМЕТРЫ СУДНА (единицы условные: 1 ед. ≈ 2 м)
   Ось X — вдоль судна (нос = +X, корма = −X), Y — вверх, Z — поперёк.
   ============================================================================ */
const S = {
  L: 120, HALF: 60,      // длина судна
  BEAM: 10,              // полуширина (ширина = 20)
  DECK: 11,              // высота верхней палубы над килем
  WL: 7,                 // ватерлиния (осадка)
  HOLD_X0: -30,          // начало первого трюма
  PITCH: 17.5,           // шаг между трюмами
  HOLD_LEN: 16,          // длина трюма
  DB_H: 1.7,             // высота двойного дна (уровень танк-топа)
  // Положение поперечных переборок: ахтерпик, МО/трюм №1, между трюмами, таранная
  BULKHEADS: [-57.5, -30.75, -13.25, 4.25, 21.75, 39.25],
};
const holdStart = (k) => S.HOLD_X0 + k * S.PITCH;

/* ---------- Простые помощники для создания мешей ---------- */
const UP = new THREE.Vector3(0, 1, 0);
const mk = (geo, mat, p = [0, 0, 0], r = [0, 0, 0]) => {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(p[0], p[1], p[2]);
  m.rotation.set(r[0], r[1], r[2]);
  return m;
};
const box = (w, h, d, mat, p, r) => mk(new THREE.BoxGeometry(w, h, d), mat, p, r);
const cyl = (rt, rb, h, mat, p, r, seg = 14) => mk(new THREE.CylinderGeometry(rt, rb, h, seg), mat, p, r);
const sph = (rad, mat, p, sc = [1, 1, 1], ws = 16, hs = 12) => {
  const m = mk(new THREE.SphereGeometry(rad, ws, hs), mat, p);
  m.scale.set(sc[0], sc[1], sc[2]);
  return m;
};
/** Цилиндр-стержень между двумя точками (леера, тросы, антенны) */
const rod = (a, b, r, mat, seg = 6) => {
  const va = new THREE.Vector3(a[0], a[1], a[2]);
  const vb = new THREE.Vector3(b[0], b[1], b[2]);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, va.distanceTo(vb), seg), mat);
  m.position.copy(va).add(vb).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(UP, vb.clone().sub(va).normalize());
  return m;
};
const add = (parent, ...objs) => { objs.forEach((o) => parent.add(o)); return parent; };

/* ============================================================================
   2. МАТЕРИАЛЫ
   Материалы «внешней оболочки» помечаются userData.shell = true —
   именно им режим «Разрез / Рентген» меняет прозрачность.
   ============================================================================ */
function createMaterials() {
  const DS = THREE.DoubleSide;
  const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.3, ...o });
  const lamp = (color) => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.6, roughness: 0.4 });

  const M = {
    // --- внешняя оболочка (прозрачнеет в режиме рентгена) ---
    hullRed:   std(0x6e1016, { roughness: 0.55, metalness: 0.25, side: DS }),
    hullBlack: std(0x15171b, { roughness: 0.42, metalness: 0.4, side: DS }),
    deck:      std(0x4c3b37, { roughness: 0.85, metalness: 0.1, side: DS }),
    hatch:     std(0x37594b, { roughness: 0.6, metalness: 0.3 }),
    coaming:   std(0x8b2a23, { roughness: 0.6, metalness: 0.3 }),

    // --- палуба и надстройка (остаются непрозрачными) ---
    redPaint:  std(0x6e1016, { roughness: 0.55 }),
    white:     std(0xf2f5f8, { roughness: 0.5, metalness: 0.08 }),
    trim:      std(0x5c656e, { roughness: 0.55, metalness: 0.5 }),
    glass:     std(0x0b2c47, { roughness: 0.12, metalness: 0.85, emissive: 0x0e4268, emissiveIntensity: 0.55 }),
    black:     std(0x101216, { roughness: 0.5 }),
    funnelRed: std(0xb0201f, { roughness: 0.55 }),
    yellow:    std(0xe0b52a, { roughness: 0.5, metalness: 0.35 }),
    orange:    std(0xf2621c, { roughness: 0.5 }),
    steel:     std(0xb7c0c9, { roughness: 0.35, metalness: 0.85 }),
    darkSteel: std(0x3a4149, { roughness: 0.45, metalness: 0.8 }),
    bronze:    std(0xc59a2e, { roughness: 0.28, metalness: 0.9 }),
    lampRed:   lamp(0xff2a2a),
    lampGreen: lamp(0x22ff66),
    lampWhite: lamp(0xffffff),

    // --- внутренний набор: разные серые/металлические оттенки для контраста ---
    frame:     std(0x9fb6cb, { roughness: 0.32, metalness: 0.85, side: DS }), // шпангоуты — светлая сталь
    bulkhead:  std(0x5d6873, { roughness: 0.5, metalness: 0.7, side: DS }),   // переборки — тёмно-серые
    tanktop:   std(0x7d848c, { roughness: 0.45, metalness: 0.7 }),            // настил второго дна
    girder:    std(0xb5bcc4, { roughness: 0.3, metalness: 0.85, side: DS }),  // днищевые стрингеры, стойки
    stringer:  std(0x8798a8, { roughness: 0.4, metalness: 0.8, side: DS }),   // бортовые стрингеры
    floorPlate:std(0x6a7886, { roughness: 0.45, metalness: 0.75, side: DS }), // флоры
    engine:    std(0x56768f, { roughness: 0.4, metalness: 0.75 }),
    engine2:   std(0x3d566b, { roughness: 0.45, metalness: 0.75 }),
  };

  const shellMats = [M.hullRed, M.hullBlack, M.deck, M.hatch, M.coaming];
  shellMats.forEach((m) => { m.userData.shell = true; });
  return { M, shellMats };
}

/* ============================================================================
   3. ГЕОМЕТРИЯ КОРПУСА: параметры сечения и контуры
   ============================================================================ */

/** Параметры поперечного сечения корпуса в точке x: полуширина, подъём днища, радиус скулы */
function sectionParams(x) {
  const t = (x + S.HALF) / S.L; // 0 — корма, 1 — нос
  let B;
  if (t < 0.14) { const u = t / 0.14; B = S.BEAM * (0.5 + 0.5 * (1 - (1 - u) * (1 - u))); } // транцевая корма
  else if (t <= 0.7) B = S.BEAM;                                                              // параллельная вставка
  else { const u = Math.min((t - 0.7) / 0.3, 1); B = S.BEAM * (1 - Math.pow(u, 2.2)); }       // заострение носа
  B = Math.max(B, 0.12);

  let yb = 0; // подъём днища к оконечностям
  if (t < 0.12) { const u = 1 - t / 0.12; yb = 1.2 * u * u; }
  else if (t > 0.78) { const u = Math.min((t - 0.78) / 0.22, 1); yb = 4.2 * u * u; }

  const rb = Math.max(0.05, Math.min(B * 0.45, (S.WL - yb) * 0.8, 4.5)); // радиус скулы
  return { t, B, yb, rb };
}

/** Кольцо точек [z, y] одного сечения корпуса: от борта палубы вниз, по скуле, и вверх (18 точек) */
function ringPoints(p, yTop) {
  const { B, yb, rb } = p;
  const pts = [[-B, yTop], [-B, S.WL]];
  for (let k = 0; k <= 6; k++) {                       // левая скула
    const th = Math.PI + (Math.PI / 2) * (k / 6);
    pts.push([-B + rb + rb * Math.cos(th), yb + rb + rb * Math.sin(th)]);
  }
  for (let k = 0; k <= 6; k++) {                       // правая скула
    const th = 1.5 * Math.PI + (Math.PI / 2) * (k / 6);
    pts.push([B - rb + rb * Math.cos(th), yb + rb + rb * Math.sin(th)]);
  }
  pts.push([B, S.WL], [B, yTop]);
  return pts;
}

/** Внутренний контур сечения, смещённый от обшивки на d (замкнутый многоугольник [z, y]) */
function contour(x, d, yTop, steps = 6) {
  const p = sectionParams(x);
  const B = p.B - d, yb = p.yb + d, rb = Math.max(p.rb - d, 0.05);
  if (B <= 0.2) return null;
  const pts = [[-B, yTop]];
  for (let k = 0; k <= steps; k++) {
    const th = Math.PI + (Math.PI / 2) * (k / steps);
    pts.push([-B + rb + rb * Math.cos(th), yb + rb + rb * Math.sin(th)]);
  }
  for (let k = 0; k <= steps; k++) {
    const th = 1.5 * Math.PI + (Math.PI / 2) * (k / steps);
    pts.push([B - rb + rb * Math.cos(th), yb + rb + rb * Math.sin(th)]);
  }
  pts.push([B, yTop]);
  return pts;
}

/** Полуширина внутреннего контура на высоте y */
function halfWidthAt(x, y, d = 0) {
  const p = sectionParams(x);
  const B = p.B - d, yb = p.yb + d, rb = Math.max(p.rb - d, 0.05);
  const dy = y - yb;
  if (dy <= 0) return 0;
  if (dy >= rb) return B;
  return B - rb + Math.sqrt(Math.max(rb * rb - (rb - dy) * (rb - dy), 0));
}

/** Отсечение многоугольника горизонтальной плоскостью y = yc (Sutherland–Hodgman) */
function clipPoly(poly, yc, keepAbove) {
  const inside = (p) => (keepAbove ? p[1] >= yc : p[1] <= yc);
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ia = inside(a), ib = inside(b);
    if (ia) out.push(a);
    if (ia !== ib) {
      const t = (yc - a[1]) / (b[1] - a[1]);
      out.push([a[0] + (b[0] - a[0]) * t, yc]);
    }
  }
  return out;
}
/** Удаление подряд идущих одинаковых точек (иначе триангуляция может «споткнуться») */
const clean = (poly) => poly.filter((p, i) => {
  const q = poly[(i + poly.length - 1) % poly.length];
  return Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-4;
});
const polyToShape = (poly) => new THREE.Shape(clean(poly).map((p) => new THREE.Vector2(p[0], p[1])));
const polyToPath = (poly) => new THREE.Path(clean(poly).map((p) => new THREE.Vector2(p[0], p[1])));

/** Пластина поперечного сечения (переборка / шпангоут), выдавленная вдоль оси X */
function plateX(poly, holes, thick, x, mat) {
  const sh = polyToShape(poly);
  holes.forEach((h) => sh.holes.push(h));
  const g = new THREE.ExtrudeGeometry(sh, { depth: thick, bevelEnabled: false, curveSegments: 8 });
  g.rotateY(Math.PI / 2);               // форма (z,y) → плоскость YZ, толщина вдоль +X
  g.translate(x - thick / 2, 0, 0);
  return new THREE.Mesh(g, mat);
}

/* ============================================================================
   4. СБОРКА КОРПУСА
   ============================================================================ */
function buildHull(ship, M, refs) {
  const N = 72, R = 18;             // N станций по длине, R точек в сечении
  const pos = [];
  for (let i = 0; i <= N; i++) {
    const x = -S.HALF + (S.L * i) / N;
    for (const [z, y] of ringPoints(sectionParams(x), S.DECK)) pos.push(x, y, z);
  }
  // Индексы: сегменты 0 и R-2 — чёрный борт выше ватерлинии, остальные — красное подводное
  const lower = [], upper = [];
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < R - 1; j++) {
      const a = i * R + j, b = a + 1, c = a + R, d = c + 1;
      (j === 0 || j === R - 2 ? upper : lower).push(a, b, c, b, d, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(lower.concat(upper));
  geo.addGroup(0, lower.length, 0);
  geo.addGroup(lower.length, upper.length, 1);
  geo.computeVertexNormals();
  const hull = new THREE.Mesh(geo, [M.hullRed, M.hullBlack]);
  hull.name = 'hull';
  hull.userData.keep = true;        // не объединять (две группы материалов)
  ship.add(hull);

  // «Чертёжные» линии корпуса — проявляются в режиме рентгена, чтобы виден был контур
  const V = (i, j) => { const k = (i * R + j) * 3; return [pos[k], pos[k + 1], pos[k + 2]]; };
  const lp = [];
  for (let i = 0; i <= N; i += 4) for (let j = 0; j < R - 1; j++) lp.push(...V(i, j), ...V(i, j + 1));
  for (const j of [0, 1, 5, 8, 9, 12, 16, 17]) for (let i = 0; i < N; i++) lp.push(...V(i, j), ...V(i + 1, j));
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
  const lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({
    color: 0x5fd4ff, transparent: true, opacity: 0, depthWrite: false,
  }));
  lines.visible = false;
  lines.name = 'hullLines';
  ship.add(lines);
  refs.hullLines = lines;

  // Транцевая кормовая стенка
  const tr = new THREE.ShapeGeometry(polyToShape(ringPoints(sectionParams(-S.HALF), S.DECK)));
  tr.rotateY(-Math.PI / 2);
  tr.translate(-S.HALF - 0.01, 0, 0);
  ship.add(new THREE.Mesh(tr, M.hullBlack));

  // Верхняя палуба — плоская оболочка по контуру судна
  const outline = [];
  for (let x = -S.HALF; x <= S.HALF + 1e-6; x += 1.5) outline.push(new THREE.Vector2(x, sectionParams(x).B));
  for (let x = S.HALF; x >= -S.HALF - 1e-6; x -= 1.5) outline.push(new THREE.Vector2(x, -sectionParams(x).B));
  const deckGeo = new THREE.ShapeGeometry(new THREE.Shape(outline));
  deckGeo.rotateX(-Math.PI / 2);
  deckGeo.translate(0, S.DECK, 0);
  ship.add(new THREE.Mesh(deckGeo, M.deck));

  // Бак (носовая надстройка высотой 3 ед.): чёрные борта + палубный верх
  const fx0 = 44, fo = [];
  for (let x = fx0; x <= S.HALF - 0.01; x += 1) fo.push(new THREE.Vector2(x, sectionParams(x).B));
  fo.push(new THREE.Vector2(S.HALF - 0.01, sectionParams(S.HALF - 0.01).B));
  for (let i = fo.length - 1; i >= 0; i--) fo.push(new THREE.Vector2(fo[i].x, -fo[i].y));
  const fg = new THREE.ExtrudeGeometry(new THREE.Shape(fo), { depth: 3, bevelEnabled: false });
  fg.rotateX(-Math.PI / 2);
  const fore = new THREE.Mesh(fg, [M.deck, M.hullBlack]);
  fore.position.y = S.DECK;
  fore.name = 'forecastle';
  fore.userData.keep = true;
  ship.add(fore);
}

/* ---------- Бульбы, винт, руль ---------- */
function buildBowStern(ship, M) {
  // Бульб носа (под водой, выступает вперёд за форштевень)
  add(ship, sph(1, M.hullRed, [58.3, 3.3, 0], [3.7, 2.0, 1.6], 24, 16));
  // Кормовой бульб (обтекатель гребного вала)
  add(ship, sph(1, M.hullRed, [-59.4, 2.5, 0], [2.4, 1.3, 1.1], 20, 14));

  // Гребной вал и ступица винта
  add(ship, rod([-50, 2.5, 0], [-62.3, 2.5, 0], 0.28, M.steel, 10));
  add(ship, sph(0.5, M.bronze, [-62.5, 2.5, 0], [1.5, 1, 1], 14, 10));
  // 4 лопасти винта (каждая — эллипсоид на повёрнутом «пивоте»)
  for (let i = 0; i < 4; i++) {
    const pivot = new THREE.Object3D();
    pivot.position.set(-62.5, 2.5, 0);
    pivot.rotation.x = (i * Math.PI) / 2 + 0.35;
    const blade = sph(1, M.bronze, [0, 1.45, 0], [0.14, 1.05, 0.5], 12, 8);
    blade.rotation.y = 0.55; // шаг лопасти
    pivot.add(blade);
    ship.add(pivot);
  }
  // Перо руля, баллер и верхняя опора
  add(ship, box(2.4, 5.2, 0.45, M.redPaint, [-64.2, 3.2, 0]));
  add(ship, cyl(0.22, 0.22, 2.6, M.steel, [-64.0, 7.1, 0]));
  add(ship, rod([-64.0, 8.3, 0], [-59.8, 8.3, 0], 0.22, M.steel, 8));
}

/* ============================================================================
   5. ВНУТРЕННИЙ НАБОР (виден в режиме «Разрез / Рентген»)
   ============================================================================ */
function buildInterior(ship, M) {
  // --- Двойное дно: продольные днищевые стрингеры (вертикальные килевые балки) ---
  for (const z of [0, -3, 3, -6, 6]) {
    add(ship, box(94, 1.2, 0.2, M.girder, [-7, 1.05, z]));
  }
  // --- Флоры: поперечные плиты двойного дна с вырезами облегчения ---
  for (let x = -53.5; x <= 39.6; x += 3.5) {
    const outer = clipPoly(contour(x, 0.15, 12), S.DB_H - 0.06, false);
    const holes = [];
    const hw = halfWidthAt(x, 0.95, 0.15);
    for (const z of [-7.5, -4.5, -1.5, 1.5, 4.5, 7.5]) {
      if (Math.abs(z) + 0.8 < hw) {
        const h = new THREE.Path();
        h.absarc(z, 0.95, 0.42, 0, Math.PI * 2, false);
        holes.push(h);
      }
    }
    add(ship, plateX(outer, holes, 0.18, x, M.floorPlate));
  }
  // --- Настил второго дна (танк-топ) и «стулья» переборок ---
  const B = S.BULKHEADS;
  for (let i = 0; i < B.length - 1; i++) {
    const a = B[i] + 1.4, b = B[i + 1] - 1.4;
    const w = 2 * Math.min(halfWidthAt(a, S.DB_H, 0.3), halfWidthAt(b, S.DB_H, 0.3)) - 0.1;
    add(ship, box(b - a, 0.14, w, M.tanktop, [(a + b) / 2, S.DB_H, 0]));
  }
  for (const xb of B) {
    const w = 2 * halfWidthAt(xb, S.DB_H + 0.8, 0.25) - 0.1;
    add(ship, box(2.6, 1.6, w, M.tanktop, [xb, S.DB_H + 0.8, 0]));
  }
  // --- Поперечные переборки с вертикальными стойками жёсткости ---
  for (const xb of B) {
    const poly = clipPoly(contour(xb, 0.25, 10.78), 2.4, true);
    add(ship, plateX(poly, [], 0.5, xb, M.bulkhead));
    const hw = halfWidthAt(xb, 2.5, 0.25) - 0.35;
    const n = Math.floor(hw / 1.6);
    for (let i = -n; i <= n; i++) {
      add(ship, box(0.28, 8.0, 0.28, M.girder, [xb - 0.39, 6.6, i * 1.6]),
                box(0.28, 8.0, 0.28, M.girder, [xb + 0.39, 6.6, i * 1.6]));
    }
  }
  // --- Рамные шпангоуты: кольцо из контура корпуса с вырезом внутри ---
  const frameXs = [-55, -51.5, -48, -44.5, -41, -37.5, -34];        // машинное отделение
  for (let k = 0; k < S.HOLDS; k++) {
    for (const o of [4, 8, 12]) frameXs.push(holdStart(k) + o);      // трюмы
  }
  frameXs.push(43.5, 47, 50.5, 54);                                  // форпик
  for (const x of frameXs) {
    const outer = contour(x, 0.3, 10.7);
    const inner = contour(x, 0.95, 10.1);
    if (!outer || !inner) continue;
    add(ship, plateX(clipPoly(outer, S.DB_H, true), [polyToPath(clipPoly(inner, 2.4, true))], 0.22, x, M.frame));
  }
  // --- Бортовые стрингеры (Т-образные балки вдоль борта на трёх уровнях) ---
  for (const side of [-1, 1]) {
    for (const y of [4.2, 7.0, 9.6]) {
      for (let x = -52; x < 39; x += 3.5) {
        const x2 = x + 3.5;
        const za = halfWidthAt(x, y, 0.3) - 0.5, zb = halfWidthAt(x2, y, 0.3) - 0.5;
        const len = Math.hypot(3.5, zb - za) + 0.02;
        const rotY = -Math.atan2(side * (zb - za), 3.5);
        const cx = x + 1.75, cz = (side * (za + zb)) / 2;
        add(ship, box(len, 0.12, 0.9, M.stringer, [cx, y, cz], [0, rotY, 0]),
                  box(len, 0.7, 0.08, M.stringer, [cx, y - 0.35, cz], [0, rotY, 0]));
      }
    }
  }
  // --- Палубные продольные балки под комингсами люков ---
  for (const z of [-6.2, 6.2]) add(ship, box(91, 0.6, 0.16, M.girder, [-6.5, 10.45, z]));

  // --- Главный двигатель и вспомогательное оборудование машинного отделения ---
  add(ship, box(12, 0.4, 4.2, M.darkSteel, [-44, 1.9, 0]));
  add(ship, box(11, 3.0, 3.4, M.engine, [-44, 3.6, 0]));
  for (let i = 0; i < 6; i++) add(ship, box(1.4, 3.0, 2.2, M.engine2, [-48.5 + i * 1.8, 6.7, 0]));
  for (const z of [-3.6, 3.6]) add(ship, box(3, 1.6, 1.6, M.engine, [-36, 2.7, z]));
  add(ship, cyl(0.55, 0.55, 5, M.darkSteel, [-53, 3.5, 3.2], [0, 0, 0], 12));     // цистерна/котёл
}

/* ============================================================================
   6. ПАЛУБА: люки, краны, леера, швартовное и якорное устройства
   ============================================================================ */

/** Грузовой кран: пьедестал, машинное помещение, кабина, стрела, оттяжки, гак */
function buildCrane(ship, M, x, yaw) {
  const g = new THREE.Group();
  g.position.set(x, S.DECK, 0);
  g.rotation.y = yaw;
  add(g,
    cyl(1.1, 1.3, 2.2, M.darkSteel, [0, 1.1, 0], [0, 0, 0], 16),         // пьедестал
    cyl(1.4, 1.4, 0.25, M.steel, [0, 2.3, 0], [0, 0, 0], 16),            // опорно-поворотный круг
    box(3.0, 1.6, 2.6, M.yellow, [0, 3.25, 0]),                          // машинное помещение
    box(1.3, 1.4, 1.2, M.yellow, [0.8, 3.5, 1.9]),                       // кабина оператора
    box(1.0, 0.7, 0.06, M.glass, [0.8, 3.7, 2.52]),                      // окно кабины
    box(0.5, 0.7, 0.7, M.darkSteel, [0.6, 4.0, 0])                       // шарнир стрелы
  );
  // Стрела (шарнир на её конце, наклон вверх)
  const ang = 0.5, len = 14;
  const boomGeo = new THREE.BoxGeometry(len, 0.5, 0.7);
  boomGeo.translate(len / 2, 0, 0);
  const boom = new THREE.Mesh(boomGeo, M.yellow);
  boom.position.set(0.6, 4.0, 0);
  boom.rotation.z = ang;
  g.add(boom);
  const tip = [0.6 + len * Math.cos(ang), 4.0 + len * Math.sin(ang), 0];
  // Мачта-аншпуг, штаг и оттяжка к концу стрелы
  const mastTop = [-1.6, 8.2, 0];
  add(g,
    rod([-0.9, 4.0, 0], mastTop, 0.18, M.darkSteel, 6),
    rod(mastTop, [-2.0, 4.2, 0], 0.08, M.steel, 4),
    rod(mastTop, tip, 0.08, M.steel, 4),
    rod(tip, [tip[0], tip[1] - 7, 0], 0.05, M.black, 4),                 // грузовой трос
    box(0.5, 0.6, 0.4, M.darkSteel, [tip[0], tip[1] - 7.3, 0])           // гак
  );
  ship.add(g);
}

/** Цепь из звеньев-торов вдоль кривой Катмулла–Рома (якорная цепь) */
function buildChain(ship, M, pts, n) {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
  const X = new THREE.Vector3(1, 0, 0);
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const geo = new THREE.TorusGeometry(0.2, 0.055, 5, 10);
    geo.scale(1.5, 1, 1);
    const m = new THREE.Mesh(geo, M.darkSteel);
    m.position.copy(curve.getPointAt(u));
    m.quaternion.setFromUnitVectors(X, curve.getTangentAt(u));
    m.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(X, (i % 2) * Math.PI / 2)); // звенья чередуются
    ship.add(m);
  }
}

function buildDeck(ship, M) {
  const D = S.DECK;

  // --- Люковые закрытия: комингс + две складывающиеся секции с рёбрами ---
  for (let k = 0; k < S.HOLDS; k++) {
    const cx = holdStart(k) + 8;
    add(ship,
      box(14.4, 0.9, 0.25, M.coaming, [cx, D + 0.45, -6.275]),
      box(14.4, 0.9, 0.25, M.coaming, [cx, D + 0.45, 6.275]),
      box(0.25, 0.9, 12.8, M.coaming, [cx - 7.075, D + 0.45, 0]),
      box(0.25, 0.9, 12.8, M.coaming, [cx + 7.075, D + 0.45, 0])
    );
    for (const s of [-1, 1]) {
      add(ship, box(7.0, 0.22, 12.4, M.hatch, [cx + s * 3.6, D + 1.0, 0]));
      for (let r = -2; r <= 2; r++) add(ship, box(0.14, 0.1, 12.2, M.coaming, [cx + s * 3.6 + r * 1.35, D + 1.14, 0]));
    }
  }

  // --- Краны между трюмами (на оси судна) ---
  buildCrane(ship, M, S.BULKHEADS[2], -0.3);
  buildCrane(ship, M, S.BULKHEADS[3], 1.1);
  buildCrane(ship, M, S.BULKHEADS[4], 0.25);

  // --- Леера: поручни по периметру главной палубы (вокруг кормы) и бака ---
  const loop = [];
  for (let x = 43.5; x >= -59.4; x -= 2) loop.push([x, sectionParams(x).B - 0.28]);
  const bT = sectionParams(-S.HALF).B - 0.28;
  for (let z = bT; z >= -bT - 1e-6; z -= bT / 2) loop.push([-59.7, z]);
  for (let x = -59.4; x <= 43.5; x += 2) loop.push([x, -(sectionParams(x).B - 0.28)]);
  const railPath = (pts, y) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      add(ship, rod([a[0], y + 1.05, a[1]], [b[0], y + 1.05, b[1]], 0.06, M.steel, 5),
                rod([a[0], y + 0.55, a[1]], [b[0], y + 0.55, b[1]], 0.05, M.steel, 5));
    }
    for (let i = 0; i < pts.length; i += 2) {
      add(ship, rod([pts[i][0], y, pts[i][1]], [pts[i][0], y + 1.05, pts[i][1]], 0.06, M.steel, 5));
    }
  };
  railPath(loop, D);
  const fl = [];
  for (let x = 44.2; x <= 59.4; x += 1.6) fl.push([x, Math.max(sectionParams(x).B - 0.25, 0.06)]);
  const fl2 = fl.slice().reverse().map((p) => [p[0], -p[1]]);
  railPath(fl.concat(fl2), D + 3);

  // --- Швартовные тумбы (кнехты) ---
  const bollards = [[-56.5, 5.4], [-56.5, -5.4], [-30, 9.1], [-30, -9.1], [20, 9.1], [20, -9.1], [55.3, 1.3], [55.3, -1.3], [50, 3.0], [50, -3.0]];
  for (const [x, z] of bollards) {
    const y = x > 44 ? D + 3 : D;
    add(ship, cyl(0.28, 0.38, 0.75, M.darkSteel, [x, y + 0.375, z]),
              cyl(0.5, 0.5, 0.18, M.darkSteel, [x, y + 0.84, z]));
  }
  // Кормовые швартовные лебёдки
  for (const z of [-3.6, 3.6]) {
    add(ship, box(2.6, 1.0, 1.8, M.darkSteel, [-56.2, D + 0.5, z]),
              cyl(0.55, 0.55, 1.4, M.steel, [-56.2, D + 1.3, z], [0, 0, Math.PI / 2]));
  }
  // Вентиляционные грибки
  for (const [x, z] of [[-27, 8.7], [-27, -8.7], [-8, 8.7], [-8, -8.7], [14, 8.7], [14, -8.7], [34, 7.7], [34, -7.7]]) {
    add(ship, cyl(0.28, 0.28, 1.6, M.funnelRed, [x, D + 0.8, z]),
              cyl(0.85, 0.28, 0.45, M.funnelRed, [x, D + 1.85, z]));
  }

  // --- Якорное устройство на баке ---
  add(ship, box(3.2, 0.9, 2.6, M.darkSteel, [53, D + 3.45, 0]));                           // основание брашпиля
  add(ship, cyl(0.25, 0.25, 3.4, M.steel, [53, D + 4.3, 0], [Math.PI / 2, 0, 0], 10));     // вал
  for (const z of [-1.5, 1.5]) add(ship, cyl(0.8, 0.8, 0.6, M.steel, [53, D + 4.3, z], [Math.PI / 2, 0, 0], 14)); // звёздочки
  add(ship, box(1.2, 0.9, 1.2, M.engine2, [53, D + 4.1, 0]));                              // привод
  // Деревянный-стальной «домик» (кладовая боцмана) на баке
  add(ship, box(3.6, 2.6, 4.2, M.white, [46.2, D + 4.3, 0]),
            box(0.08, 1.5, 0.9, M.darkSteel, [44.35, D + 3.75, 0]),
            box(0.08, 0.6, 0.9, M.glass, [48.03, D + 4.6, 1.0]),
            box(0.08, 0.6, 0.9, M.glass, [48.03, D + 4.6, -1.0]),
            box(3.8, 0.18, 4.4, M.trim, [46.2, D + 5.7, 0]));
  // Клюзы, якоря и цепи по обоим бортам
  const hx = 52, hB = sectionParams(hx).B;
  for (const s of [-1, 1]) {
    add(ship, cyl(0.32, 0.32, 0.12, M.black, [hx, 12.4, s * hB], [Math.PI / 2, 0, 0], 14));       // клюз
    const az = s * (hB + 0.55);
    add(ship,
      box(0.26, 2.5, 0.26, M.darkSteel, [hx, 10.3, az]),                                           // веретено
      box(0.2, 0.2, 1.6, M.darkSteel, [hx, 11.4, az]),                                             // шток
      box(1.0, 0.22, 0.6, M.darkSteel, [hx - 0.55, 9.3, az], [0, 0, 0.5]),                         // лапы
      box(1.0, 0.22, 0.6, M.darkSteel, [hx + 0.55, 9.3, az], [0, 0, -0.5])
    );
    buildChain(ship, M, [
      [53, D + 4.4, s * 1.1], [52.8, D + 3.4, s * 2.7], [52.2, D + 3.2, s * (hB - 0.3)],
      [hx, 12.4, s * (hB + 0.15)], [hx, 11.6, s * (hB + 0.5)],
    ], 24);
  }
}

/* ============================================================================
   7. НАДСТРОЙКА (4 яруса), мостик, мачта, радары, труба, шлюпки
   ============================================================================ */
function buildSuperstructure(ship, M, refs) {
  const tier = (cx, w, d, y0, h) => {
    add(ship, box(w, h, d, M.white, [cx, y0 + h / 2, 0]),
              box(w + 0.5, 0.22, d + 0.5, M.trim, [cx, y0 + h, 0]));  // «козырёк» яруса
  };
  tier(-43, 18, 16, 11, 3.5);    // ярус 1 (главная палуба, служебные помещения)
  tier(-43, 14, 14.4, 14.5, 3.5);// ярус 2 (каюты)
  tier(-43, 12, 12.8, 18, 3.5);  // ярус 3 (каюты командного состава)
  // Ходовой мостик (рубка) с крылом
  add(ship, box(7, 3.0, 10.4, M.white, [-41, 23, 0]),
            box(8, 0.3, 11.6, M.trim, [-41, 24.65, 0]));
  for (const s of [-1, 1]) {
    add(ship, box(3, 0.3, 4.2, M.white, [-41, 21.85, s * 7.3]),     // крыло мостика
              box(3, 0.9, 0.12, M.white, [-41, 22.45, s * 9.4]),
              box(0.12, 0.9, 4.2, M.white, [-42.4, 22.45, s * 7.3]));
    add(ship, sph(0.22, s > 0 ? M.lampGreen : M.lampRed, [-40.4, 22.2, s * 9.2], [1, 1, 1], 8, 6)); // бортовые огни
  }
  // Окна: ряды тёмных стёкол на каждой стороне ярусов
  const win = (x, y, z, w, h, d) => add(ship, box(w, h, d, M.glass, [x, y, z]));
  const row = (n, from, step, fn) => { for (let i = 0; i < n; i++) fn(from + i * step); };
  row(9, -6.4, 1.6, (z) => win(-33.97, 12.9, z, 0.1, 0.9, 1.0));                         // ярус 1, нос
  for (const s of [-1, 1]) row(8, -50, 2, (x) => win(x, 12.9, s * 8.03, 1.1, 0.9, 0.1)); // ярус 1, борта
  row(8, -5.6, 1.6, (z) => win(-35.97, 16.4, z, 0.1, 0.9, 1.0));                         // ярус 2
  for (const s of [-1, 1]) row(6, -48, 2, (x) => win(x, 16.4, s * 7.23, 1.1, 0.9, 0.1));
  row(7, -4.8, 1.6, (z) => win(-36.97, 19.9, z, 0.1, 0.9, 1.0));                         // ярус 3
  for (const s of [-1, 1]) row(5, -47, 2, (x) => win(x, 19.9, s * 6.43, 1.1, 0.9, 0.1));
  row(7, -4.5, 1.5, (z) => win(-37.45, 23.2, z, 0.1, 1.1, 1.3));                         // мостик, нос
  for (const s of [-1, 1]) row(5, -43.8, 1.4, (x) => win(x, 23.2, s * 5.25, 1.1, 1.0, 0.1));

  // Дымовая труба
  add(ship, cyl(1.5, 1.8, 7.5, M.black, [-47.2, 25.25, 0], [0, 0, 0], 22),
            cyl(1.66, 1.7, 1.5, M.funnelRed, [-47.2, 26.1, 0], [0, 0, 0], 22),
            cyl(1.4, 1.5, 0.2, M.darkSteel, [-47.2, 29.1, 0], [0, 0, 0], 22));
  // Мачта с реем, топовым огнём и антеннами
  add(ship, rod([-42.5, 24.8, 0], [-42.5, 31.2, 0], 0.15, M.steel, 8),
            box(0.15, 0.15, 5.0, M.steel, [-42.5, 29.2, 0]),
            sph(0.22, M.lampWhite, [-42.5, 31.4, 0], [1, 1, 1], 8, 6),
            sph(0.18, M.lampWhite, [-42.5, 29.2, 2.4], [1, 1, 1], 8, 6),
            rod([-44, 24.8, 4.8], [-44, 28.8, 4.8], 0.05, M.steel, 4),                  // УКВ-антенны
            rod([-38.8, 24.8, -4.8], [-38.8, 28.5, -4.8], 0.05, M.steel, 4),
            sph(0.4, M.white, [-43.8, 25.2, 3.4], [1, 1, 1], 12, 8),                    // GPS-купола
            sph(0.4, M.white, [-43.8, 25.2, -3.4], [1, 1, 1], 12, 8),
            sph(1.0, M.white, [-45.3, 25.8, -3.2], [1, 1, 1], 14, 10));                  // спутниковый купол
  // Радары: пьедестал статичен (объединится), антенна-сканер вращается в animate()
  for (const [z, w] of [[2.4, 2.6], [-2.4, 3.6]]) {
    add(ship, cyl(0.25, 0.3, 0.9, M.darkSteel, [-40.2, 25.25, z]));
    const pivot = new THREE.Group();
    pivot.position.set(-40.2, 25.9, z);
    const scanner = box(0.3, 0.14, w, M.steel, [0, 0.1, 0]);
    scanner.userData.keep = true;
    pivot.add(scanner);
    ship.add(pivot);
    refs.radars.push(pivot);
  }
  // Спасательные плоты на крыше второго яруса
  for (const s of [-1, 1]) for (const x of [-45.5, -43.5, -41.5]) {
    add(ship, cyl(0.38, 0.38, 1.3, M.orange, [x, 18.4, s * 6.8], [0, 0, Math.PI / 2], 10));
  }
  // Свободнопадающая спасательная шлюпка на корме с направляющими
  add(ship, rod([-52.2, 14.4, 0.7], [-58.5, 11.4, 0.7], 0.12, M.steel, 5),
            rod([-52.2, 14.4, -0.7], [-58.5, 11.4, -0.7], 0.12, M.steel, 5));
  const boat = sph(1, M.orange, [-55, 13.75, 0], [2.7, 0.9, 0.9], 16, 10);
  boat.rotation.z = 0.43;
  add(ship, boat);
}

/* ============================================================================
   8. ИМЕНА НА БОРТУ (canvas-текстура) и ОБЪЕДИНЕНИЕ СТАТИЧНОЙ ГЕОМЕТРИИ
   ============================================================================ */
function makeNameTexture(text) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 512, 128);
  g.fillStyle = '#f3f5f7';
  g.font = '700 78px "Arial Black", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 256, 66);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function buildNames(ship, shellMats) {
  const mat = new THREE.MeshBasicMaterial({
    map: makeNameTexture('Dashulya'), transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  mat.userData.shell = true;
  mat.userData.alwaysTransparent = true;   // текст всегда с альфой
  shellMats.push(mat);
  const geo = new THREE.PlaneGeometry(11, 2.75);
  const sideR = new THREE.Mesh(geo, mat); sideR.position.set(16, 9.2, 10.03);
  const sideL = new THREE.Mesh(geo, mat); sideL.position.set(16, 9.2, -10.03); sideL.rotation.y = Math.PI;
  const stern = new THREE.Mesh(geo, mat); stern.position.set(-60.05, 9.0, 0); stern.rotation.y = -Math.PI / 2;
  [sideR, sideL, stern].forEach((m) => { m.userData.keep = true; ship.add(m); });
}

/**
 * Объединяет все статические меши по материалам: сотни мелких мешей → ~40 draw call.
 * Не трогает меши с userData.keep (корпус, бак, вращающиеся радары, таблички).
 */
function mergeStatic(root) {
  root.updateMatrixWorld(true);
  const buckets = new Map();
  const remove = [];
  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || o.userData.keep || Array.isArray(o.material)) return;
    let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    g.clearGroups();
    if (!buckets.has(o.material)) buckets.set(o.material, []);
    buckets.get(o.material).push(g);
    remove.push(o);
  });
  remove.forEach((o) => { o.parent.remove(o); o.geometry.dispose(); });
  for (const [mat, geos] of buckets) {
    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    root.add(new THREE.Mesh(merged, mat));
  }
}

/** Главная функция: собирает судно целиком */
function buildShip() {
  const { M, shellMats } = createMaterials();
  const ship = new THREE.Group();
  ship.name = 'ship';
  const refs = { radars: [], hullLines: null };
  buildHull(ship, M, refs);
  buildBowStern(ship, M);
  buildInterior(ship, M);
  buildDeck(ship, M);
  buildSuperstructure(ship, M, refs);
  buildNames(ship, shellMats);
  mergeStatic(ship);
  return { ship, refs, M, shellMats };
}

// <<BUILD-END>>

/* ============================================================================
   9. ДАННЫЕ МЕТОК + SVG-СХЕМЫ (процедурные «картинки» для карточки)
   ============================================================================ */

/** Подпись с выноской: lines — строки текста, (x,y) — позиция текста, (px,py) — точка на детали */
const L = (lines, x, y, anchor, px, py) => {
  const arr = [].concat(lines);
  const ts = arr.map((s, i) => `<tspan x="${x}" dy="${i ? 10.5 : 0}">${s}</tspan>`).join('');
  const sx = anchor === 'end' ? x + 3 : anchor === 'start' ? x - 3 : x;
  return `<text class="lbl" x="${x}" y="${y}" text-anchor="${anchor}">${ts}</text>` +
         `<line class="lead" x1="${sx}" y1="${y - 3}" x2="${px}" y2="${py}"/><circle class="dot" cx="${px}" cy="${py}" r="2.3"/>`;
};
const GRID = '<defs><pattern id="gp" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="rgba(255,255,255,.07)" stroke-width="1"/></pattern></defs><rect width="320" height="180" fill="url(#gp)"/>';
const svg = (label, inner) => `<svg viewBox="0 0 320 180" role="img" aria-label="${label}" xmlns="http://www.w3.org/2000/svg">${GRID}${inner}</svg>`;
const WAVE = (y) => `<path class="water" d="M8 ${y}Q28 ${y - 6} 48 ${y}T88 ${y}T128 ${y}T168 ${y}T208 ${y}T248 ${y}T288 ${y}T328 ${y}"/>`;

const diagDoubleBottom = () => svg('Поперечный разрез двойного дна', `
  <path class="hullp" d="M76 22V108Q76 150 116 150H204Q244 150 244 108V22"/>
  <path class="steel" d="M84 116H236L232 130Q222 143 206 143H114Q98 143 88 130Z"/>
  <path class="acc" d="M84 116H236"/>
  <path class="thin" d="M126 116V143M160 116V143M194 116V143"/>
  <circle class="dark" cx="108" cy="131" r="4.5"/><circle class="dark" cx="143" cy="131" r="4.5"/>
  <circle class="dark" cx="177" cy="131" r="4.5"/><circle class="dark" cx="212" cy="131" r="4.5"/>
  <text class="lbl" x="160" y="70" text-anchor="middle">Грузовой трюм</text>
  ${L(['Наружная', 'обшивка днища'], 68, 168, 'end', 122, 150)}
  ${L(['Второе дно', '(танк-топ)'], 68, 96, 'end', 92, 116)}
  ${L(['Днищевой', 'стрингер'], 252, 152, 'start', 160, 132)}
  ${L(['Флор с', 'вырезами'], 252, 96, 'start', 212, 131)}
  <text class="lbl" x="160" y="14" text-anchor="middle">Поперечное сечение · вид на флор</text>`);

const diagFrames = () => svg('Поперечный шпангоут', `
  <path class="hullp" d="M76 26V108Q76 150 116 150H204Q244 150 244 108V26"/>
  <path class="thin" d="M70 26H250"/>
  <path class="acc" d="M86 26V106Q86 140 120 140H200Q234 140 234 106V26"/>
  <path class="acc dash" d="M86 38H234"/>
  <path class="accf" d="M86 38H104L86 56Z"/><path class="accf" d="M234 38H216L234 56Z"/>
  <path class="steel" d="M92 120H228"/>
  ${L(['Шпангоут'], 62, 84, 'end', 86, 84)}
  ${L(['Бимс', '(балка палубы)'], 250, 52, 'start', 160, 38)}
  ${L(['Кница'], 62, 50, 'end', 94, 46)}
  ${L(['Палубный', 'настил'], 250, 16, 'start', 210, 26)}
  ${L(['Бортовая', 'обшивка'], 62, 130, 'end', 76, 118)}
  ${L(['Флор'], 250, 150, 'start', 190, 140)}`);

const diagBulkheads = () => svg('Продольный разрез: поперечные переборки', `
  <path class="hullf" d="M18 66H302V76Q292 122 252 140H50L30 128H18Z"/>
  <path class="dash thin" d="M40 124H252"/>
  <rect class="white" x="24" y="40" width="34" height="26"/><rect class="white" x="30" y="30" width="22" height="10"/>
  ${[62, 112, 162, 212, 262].map((x) => `<path class="acc" d="M${x} 68V124"/>`).join('')}
  <text class="lbl" x="40" y="100" text-anchor="middle">МО</text>
  ${[87, 137, 187, 237].map((x, i) => `<text class="lbl" x="${x}" y="98" text-anchor="middle">Трюм ${i + 1}</text>`).join('')}
  ${WAVE(112)}
  ${L(['Поперечные', 'переборки'], 112, 24, 'middle', 112, 70)}
  ${L(['Таранная', 'переборка'], 276, 24, 'middle', 262, 70)}
  ${L(['Двойное дно'], 150, 168, 'middle', 150, 132)}`);

const diagForecastle = () => svg('Носовая часть: бак', `
  <path class="hullf" d="M20 98H150V72H262L250 124L236 148L214 158H30L20 146Z"/>
  <ellipse class="hullf" cx="256" cy="148" rx="24" ry="9"/>
  <rect class="white" x="160" y="56" width="30" height="16"/>
  <rect class="steel" x="206" y="62" width="26" height="10"/><circle class="dark" cx="219" cy="60" r="5"/>
  <circle class="dark" cx="250" cy="108" r="3.5"/><path class="steel" d="M249 112V128M243 130H255"/>
  ${WAVE(130)}
  ${L(['Бак', '(forecastle)'], 130, 38, 'middle', 170, 72)}
  ${L(['Брашпиль'], 232, 36, 'middle', 219, 56)}
  ${L(['Якорь и', 'клюз'], 292, 78, 'middle', 251, 112)}
  ${L(['Бульб'], 292, 168, 'middle', 270, 150)}
  ${L(['Форпик (цистерна)'], 90, 170, 'middle', 100, 140)}`);

const diagBulb = () => svg('Бульбообразная оконечность и волны', `
  <path class="hullf" d="M10 50H200Q214 88 205 124L190 140H10Z"/>
  <ellipse class="hullf" cx="216" cy="126" rx="27" ry="11"/>
  <path class="thin dash" d="M10 100H312"/>
  <path class="water" d="M206 100Q226 80 246 100T286 100T326 100"/>
  <path class="warm" d="M206 100Q226 120 246 100T286 100T326 100"/>
  ${L(['Волна корпуса'], 300, 66, 'middle', 246, 90)}
  ${L(['Волна бульба', '(в противофазе)'], 280, 150, 'middle', 245, 110)}
  ${L(['Бульб'], 150, 170, 'middle', 212, 130)}
  <text class="lbl" x="100" y="86" text-anchor="middle">Волны гасят друг друга →</text>
  <text class="lbl" x="100" y="98" text-anchor="middle">меньше сопротивление</text>`);

const diagSuperstructure = () => svg('Надстройка судна', `
  <rect class="white" x="56" y="118" width="170" height="32"/>
  <rect class="white" x="68" y="90" width="146" height="28"/>
  <rect class="white" x="80" y="64" width="122" height="26"/>
  <rect class="white" x="94" y="42" width="84" height="22"/>
  <path class="hullf" d="M40 150H300V160H40Z"/>
  <rect class="glassf" x="152" y="47" width="22" height="12"/><rect class="glassf" x="124" y="47" width="22" height="12"/><rect class="glassf" x="98" y="47" width="22" height="12"/>
  ${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<rect class="glassf" x="${66 + i * 19}" y="127" width="10" height="9"/>`).join('')}
  ${[0, 1, 2, 3, 4, 5].map((i) => `<rect class="glassf" x="${78 + i * 20}" y="99" width="10" height="9"/>`).join('')}
  ${[0, 1, 2, 3, 4].map((i) => `<rect class="glassf" x="${92 + i * 21}" y="72" width="10" height="9"/>`).join('')}
  <path class="steel" d="M138 42V12M122 22H154"/>
  <path class="hullf" d="M60 66L64 30H88L92 66Z"/><path class="hullp" d="M62 44H90"/>
  ${L(['Ходовой мостик'], 262, 40, 'middle', 178, 52)}
  ${L(['Мачта: радар,', 'АИС, GPS, огни'], 262, 14, 'middle', 140, 18)}
  ${L(['Жилые палубы', 'и службы'], 262, 90, 'middle', 214, 104)}
  ${L(['Дымовая', 'труба'], 28, 20, 'middle', 66, 38)}
  ${L(['Над машинным', 'отделением'], 262, 172, 'middle', 226, 150)}`);

const diagCrane = () => svg('Люки и палубный кран', `
  <path class="hullf" d="M10 140H310V156H10Z"/>
  <rect class="steel" x="28" y="126" width="104" height="14"/><rect class="green" x="30" y="120" width="100" height="6"/>
  <rect class="steel" x="190" y="126" width="104" height="14"/><rect class="green" x="192" y="120" width="100" height="6"/>
  <rect class="yellow" x="152" y="118" width="16" height="22"/>
  <rect class="yellow" x="146" y="102" width="32" height="16"/>
  <path class="yellow" d="M164 106L244 36L248 41L168 111Z"/>
  <path class="thin" d="M158 102L186 60L244 38"/>
  <path class="thin" d="M246 40V104"/><path class="steel" d="M240 104H252V110H240Z"/>
  ${L(['Люковая', 'крышка'], 70, 98, 'middle', 80, 120)}
  ${L(['Комингс'], 34, 172, 'middle', 56, 133)}
  ${L(['Палубный', 'кран'], 118, 66, 'middle', 150, 108)}
  ${L(['Стрела'], 214, 22, 'middle', 206, 70)}
  ${L(['Гак'], 284, 100, 'middle', 250, 107)}
  ${L(['Трюм под', 'люком'], 242, 172, 'middle', 242, 134)}`);

const diagPropeller = () => svg('Гребной винт и руль', `
  <path class="hullf" d="M10 50H170L178 96Q178 114 152 120H10Z"/>
  <ellipse class="hullf" cx="178" cy="100" rx="16" ry="12"/>
  <path class="steel" d="M60 100H206" /><path class="thin dash" d="M10 66H312"/>
  <ellipse class="bronze" cx="216" cy="78" rx="5" ry="20"/><ellipse class="bronze" cx="216" cy="122" rx="5" ry="20"/>
  <circle class="bronze" cx="214" cy="100" r="6"/>
  <path class="hullf" d="M258 66L274 66L278 144L252 144Z"/><path class="steel" d="M266 32V66"/>
  ${L(['Гребной винт', '(4 лопасти)'], 190, 34, 'middle', 216, 82)}
  ${L(['Гребной вал'], 100, 140, 'middle', 112, 101)}
  ${L(['Перо руля'], 290, 160, 'middle', 268, 128)}
  ${L(['Баллер'], 298, 38, 'middle', 267, 46)}
  ${L(['Кормовой бульб'], 112, 24, 'middle', 174, 92)}`);

/**
 * Метки (маркеры) на модели.
 * pos — координаты (x, y, z) на судне; cam — смещение камеры относительно метки при «подлёте»;
 * xray — включать ли автоматически режим рентгена для внутренних деталей.
 */
const POINTS = [
  {
    title: 'Двойное дно', en: 'Double bottom',
    pos: [9.25, 1.0, 1.5], cam: [16, 14, 26], xray: true, diagram: diagDoubleBottom,
    text: [
      'Двойное дно — пространство между наружной обшивкой днища и настилом второго дна (танк-топом). Оно тянется почти по всей длине судна и разделено продольными стрингерами и поперечными флорами на отсеки-цистерны.',
      'Назначение: защита трюмов и машинного отделения при посадке на мель или повреждении днища, жёсткость корпуса, а также ёмкости для балласта, топлива и пресной воды. Высота, как правило, 1–2 м.',
    ],
    tags: ['Флор', 'Днищевой стрингер', 'Танк-топ', 'Балластные цистерны'],
  },
  {
    title: 'Шпангоуты', en: 'Frames',
    pos: [-4.5, 6.8, -9.4], cam: [10, 10, 32], xray: true, diagram: diagFrames,
    text: [
      'Шпангоут — поперечная балка набора корпуса, которая подкрепляет бортовую обшивку. Вместе с бимсом (балкой палубы), кницами и флором он образует жёсткое поперечное кольцо — рамный шпангоут.',
      'Расстояние между обычными шпангоутами называют шпацией (на практике около 0,6–0,9 м). В модели рамные шпангоуты показаны с укрупнённым шагом, а вдоль борта идут бортовые стрингеры — продольные балки.',
    ],
    tags: ['Бимс', 'Кница', 'Шпация', 'Бортовой стрингер'],
  },
  {
    title: 'Поперечная переборка', en: 'Transverse bulkhead',
    pos: [4.25, 8.5, 3.0], cam: [26, 10, 22], xray: true, diagram: diagBulkheads,
    text: [
      'Поперечные водонепроницаемые переборки делят корпус на отсеки. Если один отсек получил пробоину, вода не распространяется по всему судну — так обеспечивается непотопляемость.',
      'Переборки повышают поперечную прочность, ограничивают распространение пожара и ограждают машинное отделение. Различают таранную (форпиковую), ахтерпиковую и переборки машинного отделения. У основания переборки стоит «стул» (stool).',
    ],
    tags: ['Непотопляемость', 'Таранная переборка', 'Отсек', 'Стойки жёсткости'],
  },
  {
    title: 'Носовая часть / Бак', en: 'Forecastle',
    pos: [50.5, 16.4, 0], cam: [-22, 14, 26], xray: false, diagram: diagForecastle,
    text: [
      'Бак (forecastle) — приподнятая носовая часть верхней палубы. Он защищает палубу от заливания волной и служит рабочей площадкой швартовно-якорного устройства.',
      'Здесь расположены брашпиль, якорные клюзы и якоря, кнехты и клюзы для швартовных канатов; цепной ящик находится под палубой. Под баком — форпик (носовая балластная цистерна) и кладовая боцмана.',
    ],
    tags: ['Брашпиль', 'Якорь', 'Клюз', 'Форпик'],
  },
  {
    title: 'Бульб носа', en: 'Bulbous bow',
    pos: [60.8, 3.4, 0], cam: [20, 6, 22], xray: true, diagram: diagBulb,
    text: [
      'Бульб — подводный выступ форштевня. Он создаёт собственную систему волн, которая частично гасит носовую волну корпуса, и благодаря этому на расчётной скорости уменьшается волновое сопротивление и расход топлива.',
      'Для штурмана важно помнить: бульб выступает вперёд за форштевень под водой. При швартовке и манёврах вблизи причала, якорей и мелководья это нужно учитывать.',
    ],
    tags: ['Волновое сопротивление', 'Форштевень', 'Расчётная скорость'],
  },
  {
    title: 'Надстройка', en: 'Accommodation block',
    pos: [-40.0, 27.3, 0], cam: [30, 12, 30], xray: false, diagram: diagSuperstructure,
    text: [
      'Надстройка — жилой и служебный блок. На современных балкерах и танкерах она смещена в корму, над машинным отделением: здесь каюты экипажа, столовая, камбуз и помещения управления.',
      'Верхний ярус — ходовой мостик: радары, ЭКНИС, АИС, гирокомпас, рулевое управление, УКВ. По правилам СОЛАС V/22 слепой сектор перед носом не должен превышать двух длин судна или 500 м (берётся меньшее). На мачте — антенны, сканеры радаров и навигационные огни.',
    ],
    tags: ['Ходовой мостик', 'Радар', 'АИС', 'Мачта'],
  },
  {
    title: 'Люки и грузовые краны', en: 'Hatch covers & deck cranes',
    pos: [4.25, 16.8, 0], cam: [26, 10, 26], xray: false, diagram: diagCrane,
    text: [
      'Люковые закрытия (hatch covers) — водонепроницаемые крышки грузовых трюмов. Они лежат на комингсах — приподнятых над палубой стенках люка, которые не дают воде попасть в трюм. Современные крышки складываются секциями или откатываются.',
      'Палубные краны обслуживают грузовые операции на судах без береговых средств перегрузки. Кран поворачивается, изменяет вылет стрелы и подаёт груз в любой трюм; типичная грузоподъёмность — десятки тонн.',
    ],
    tags: ['Комингс', 'Люковая крышка', 'Стрела', 'Грузоподъёмность'],
  },
  {
    title: 'Винт и руль', en: 'Propeller & rudder',
    pos: [-62.5, 2.5, 0], cam: [-16, 8, 22], xray: true, diagram: diagPropeller,
    text: [
      'Движительный комплекс: гребной винт, который вращается от главного двигателя через валопровод, и руль. Винт создаёт упор, а руль в струе за винтом меняет направление движения судна. Обычно у винта 4–5 лопастей.',
      'Руль приводится рулевой машиной в румпельном отделении через баллер. Обводы кормы и бульб направляют воду к винту. При манёврах у причала учитывайте боковое действие винта.',
    ],
    tags: ['Гребной вал', 'Баллер', 'Рулевая машина', 'Боковое действие винта'],
  },
];

/* ============================================================================
   10. СЦЕНА, КАМЕРА, РЕНДЕРЕР
   ============================================================================ */
const $ = (s) => document.querySelector(s);
const canvas = $('#scene');
const host = $('#app');

/* --- Интеграция с Telegram Mini Apps --- */
const tg = window.Telegram && window.Telegram.WebApp;
if (tg) {
  try {
    tg.ready();
    tg.expand();                                   // раскрыть на всю высоту
    if (tg.disableVerticalSwipes) tg.disableVerticalSwipes(); // свайп вниз не должен закрывать приложение при вращении модели
    if (tg.setHeaderColor) tg.setHeaderColor('#07121f');
    if (tg.setBackgroundColor) tg.setBackgroundColor('#07121f');
  } catch (e) { /* старые клиенты Telegram — просто работаем как в браузере */ }
}
const haptic = (kind = 'light') => { try { tg && tg.HapticFeedback && tg.HapticFeedback.impactOccurred(kind); } catch (e) {} };

let renderer;
try {
  renderer = new THREE.WebGLRenderer({
    canvas, antialias: true, alpha: true, powerPreference: 'high-performance',
  });
} catch (e) {
  $('#loader').innerHTML = '<p>Не удалось запустить WebGL. Откройте приложение в другом браузере.</p>';
  throw e;
}
renderer.setClearColor(0x000000, 0);                       // прозрачный фон (alpha: true)
let maxDpr = Math.min(window.devicePixelRatio || 1, 2);    // ограничиваем плотность пикселей
let dpr = maxDpr;
renderer.setPixelRatio(dpr);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, 1, 2000);

// Окружение для красивых бликов на металле (PMREM строится один раз)
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

/* --- Свет --- */
scene.add(new THREE.AmbientLight(0xbfd4ff, 0.35));
scene.add(new THREE.HemisphereLight(0xbfd9ff, 0x0b1320, 0.55));
const sun = new THREE.DirectionalLight(0xfff1dc, 2.3);
sun.position.set(70, 110, 50);
scene.add(sun);
const rim = new THREE.DirectionalLight(0x6fa8ff, 0.8);
rim.position.set(-80, 40, -60);
scene.add(rim);
// Внутренний свет: включается в режиме рентгена и подсвечивает набор
const innerLights = [-18, 25].map((x) => {
  const l = new THREE.PointLight(0xa8dcff, 0, 0, 2);
  l.position.set(x, 6, 0);
  scene.add(l);
  return l;
});

/* --- Вода и сетка (ориентир ватерлинии) --- */
const waterMat = new THREE.MeshStandardMaterial({
  color: 0x0e3a5c, roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.34, depthWrite: false,
});
const water = new THREE.Mesh(new THREE.CircleGeometry(520, 64), waterMat);
water.rotation.x = -Math.PI / 2;
water.position.y = S.WL + 0.05;
scene.add(water);
const grid = new THREE.GridHelper(900, 90, 0x2b6a99, 0x1a4566);
grid.position.y = S.WL + 0.06;
grid.material.transparent = true;
grid.material.opacity = 0.32;
grid.material.depthWrite = false;
scene.add(grid);

/* --- Судно --- */
const { ship, refs, shellMats } = buildShip();
scene.add(ship);

/* --- Управление камерой --- */
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.rotateSpeed = 0.7;
controls.zoomSpeed = 0.9;
controls.screenSpacePanning = true;
controls.minDistance = 12;
controls.maxDistance = 520;
controls.maxPolarAngle = Math.PI * 0.78;          // можно заглянуть чуть снизу
controls.autoRotateSpeed = 0.7;
controls.target.set(3, 9, 0);

/* ============================================================================
   11. ИНТЕРАКТИВНЫЕ МАРКЕРЫ (Raycaster)
   ============================================================================ */
function makeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grd.addColorStop(0, 'rgba(120,245,255,1)');
  grd.addColorStop(0.35, 'rgba(41,217,255,0.55)');
  grd.addColorStop(1, 'rgba(41,217,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const glowTex = makeGlowTexture();
const markerGroup = new THREE.Group();
scene.add(markerGroup);
const hitMeshes = [];

const markers = POINTS.map((p, i) => {
  const pos = new THREE.Vector3(...p.pos);
  // Ядро — светящаяся голубая сфера (рисуется поверх корпуса: depthTest выключен)
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(1, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0x22e6ff, transparent: true, opacity: 0.95, depthTest: false })
  );
  core.renderOrder = 1000;
  // Ореол — аддитивный спрайт со свечением
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color: 0x22e6ff, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  halo.renderOrder = 999;
  // Невидимая увеличенная сфера для удобного попадания пальцем
  const hit = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
  hit.userData.index = i;
  [core, halo, hit].forEach((o) => o.position.copy(pos));
  markerGroup.add(core, halo, hit);
  hitMeshes.push(hit);
  return { core, halo, hit, pos, phase: i * 0.9 };
});

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
function pickMarker(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(hitMeshes, false);
  return hits.length ? hits[0].object.userData.index : -1;
}

// Отличаем «тап» от вращения: смещение < 8 px и короткое касание
let down = null;
canvas.addEventListener('pointerdown', (e) => {
  down = { x: e.clientX, y: e.clientY, t: performance.now() };
  hideHint();
  tween = null; // касание прерывает «подлёт» камеры
});
canvas.addEventListener('pointerup', (e) => {
  if (!down) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
  const dt = performance.now() - down.t;
  down = null;
  if (moved < 8 && dt < 600) {
    const idx = pickMarker(e.clientX, e.clientY);
    if (idx >= 0) selectPoint(idx);
  }
});
canvas.addEventListener('pointermove', (e) => {          // курсор-«рука» на десктопе
  if (e.pointerType === 'mouse' && !down) canvas.style.cursor = pickMarker(e.clientX, e.clientY) >= 0 ? 'pointer' : 'grab';
});

/* ============================================================================
   12. РЕЖИМ «РАЗРЕЗ / РЕНТГЕН»
   Материалам внешней оболочки плавно меняем transparent → true и opacity → 0.15
   ============================================================================ */
const XRAY_OPACITY = 0.15;
let xrayOn = false;
let xrayMix = 0;                                   // 0 — выключен, 1 — полный рентген

function applyXray(mix) {
  const op = THREE.MathUtils.lerp(1, XRAY_OPACITY, mix);
  for (const m of shellMats) {
    const tr = !!m.userData.alwaysTransparent || mix > 0.001;
    if (m.transparent !== tr) { m.transparent = tr; m.needsUpdate = true; }
    m.opacity = op;
    m.depthWrite = mix < 0.35;                      // у прозрачной оболочки не пишем глубину
  }
  waterMat.opacity = THREE.MathUtils.lerp(0.34, 0.07, mix);
  grid.material.opacity = THREE.MathUtils.lerp(0.32, 0.14, mix);
  refs.hullLines.visible = mix > 0.01;
  refs.hullLines.material.opacity = mix * 0.5;
  innerLights.forEach((l) => { l.intensity = mix * 900; });
}

const btnXray = $('#btn-xray');
function setXray(on) {
  xrayOn = on;
  btnXray.setAttribute('aria-pressed', String(on));
  $('#xray-state').textContent = on ? 'Внутренний набор виден' : 'Показать внутренний набор';
}
btnXray.addEventListener('click', () => { setXray(!xrayOn); haptic('medium'); hideHint(); });

/* ============================================================================
   13. КАМЕРА: «домашний» вид и плавный подлёт к метке
   ============================================================================ */
let tween = null;
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function homeView() {
  const fov = THREE.MathUtils.degToRad(camera.fov);
  const asp = Math.max(camera.aspect, 0.3);
  const dist = Math.max(46 / (Math.tan(fov / 2) * Math.min(asp, 1.6)), 110);
  const target = new THREE.Vector3(3, 9, 0);
  const pos = target.clone().add(new THREE.Vector3(0.62, 0.38, 0.78).normalize().multiplyScalar(dist));
  return { pos, target };
}
function flyTo(pos, target, dur = 1.1) {
  tween = {
    t: 0, dur,
    fromPos: camera.position.clone(), toPos: pos,
    fromTarget: controls.target.clone(), toTarget: target,
  };
}
controls.addEventListener('start', () => { tween = null; });

function flyToPoint(i) {
  const p = POINTS[i];
  const T = new THREE.Vector3(...p.pos);
  const C = T.clone().add(new THREE.Vector3(...p.cam));
  // Смещаем точку выше центра экрана, чтобы её не закрывала карточка
  const f = T.clone().sub(C).normalize();
  const right = new THREE.Vector3().crossVectors(f, UP).normalize();
  const upv = new THREE.Vector3().crossVectors(right, f).normalize();
  const dist = T.distanceTo(C);
  const frac = Math.min(0.5, (card.offsetHeight || window.innerHeight * 0.46) / window.innerHeight);
  const shift = upv.multiplyScalar(dist * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * frac);
  flyTo(C.sub(shift), T.clone().sub(shift));
}

$('#btn-reset').addEventListener('click', () => {
  const h = homeView();
  flyTo(h.pos, h.target, 1.0);
  closeCard();
  haptic();
});
const btnRotate = $('#btn-rotate');
btnRotate.addEventListener('click', () => {
  controls.autoRotate = !controls.autoRotate;
  btnRotate.setAttribute('aria-pressed', String(controls.autoRotate));
  haptic();
});

/* ============================================================================
   14. UI: карточка, чипы, подсказки
   ============================================================================ */
const card = $('#card');
const els = {
  badge: $('#card-badge'), title: $('#card-title'), sub: $('#card-sub'),
  diagram: $('#card-diagram'), desc: $('#card-desc'), tags: $('#card-tags'), body: card.querySelector('.card-body'),
};
let selected = -1;

// Чипы быстрого перехода
const chipsEl = $('#chips');
POINTS.forEach((p, i) => {
  const b = document.createElement('button');
  b.className = 'chip';
  b.textContent = p.title;
  b.addEventListener('click', () => { selectPoint(i); haptic(); });
  chipsEl.appendChild(b);
});

function selectPoint(i) {
  const p = POINTS[i];
  selected = i;
  els.badge.textContent = `${i + 1}/${POINTS.length}`;
  els.title.textContent = p.title;
  els.sub.textContent = p.en;
  els.diagram.innerHTML = p.diagram();
  els.desc.innerHTML = p.text.map((t) => `<p>${t}</p>`).join('');
  els.tags.innerHTML = p.tags.map((t) => `<span>${t}</span>`).join('');
  els.body.scrollTop = 0;

  card.classList.add('open');
  card.setAttribute('aria-hidden', 'false');
  document.body.classList.add('card-open');
  requestAnimationFrame(() => {                      // передаём высоту карточки в CSS (док с кнопкой едет вверх)
    document.documentElement.style.setProperty('--card-h', card.offsetHeight + 'px');
    flyToPoint(i);
  });
  [...chipsEl.children].forEach((c, k) => c.classList.toggle('active', k === i));
  if (p.xray && !xrayOn) setXray(true);              // внутренние детали — сразу включаем рентген
  hideHint();
  haptic('light');
  try { if (tg && tg.BackButton && tg.isVersionAtLeast && tg.isVersionAtLeast('6.1')) tg.BackButton.show(); } catch (e) {}
}

function closeCard() {
  selected = -1;
  card.classList.remove('open');
  card.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('card-open');
  [...chipsEl.children].forEach((c) => c.classList.remove('active'));
  try { if (tg && tg.BackButton && tg.isVersionAtLeast && tg.isVersionAtLeast('6.1')) tg.BackButton.hide(); } catch (e) {}
}
$('#card-close').addEventListener('click', () => { closeCard(); haptic(); });
$('#card-prev').addEventListener('click', () => selectPoint((selected - 1 + POINTS.length) % POINTS.length));
$('#card-next').addEventListener('click', () => selectPoint((selected + 1) % POINTS.length));
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeCard(); });
try { if (tg && tg.BackButton) tg.BackButton.onClick(closeCard); } catch (e) {}

// Свайп карточки вниз для закрытия
let drag = null;
['#card-grab', '#card-head'].forEach((sel) => {
  const h = $(sel);
  h.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    drag = { y: e.clientY, dy: 0 };
    h.setPointerCapture(e.pointerId);
    card.style.transition = 'none';
  });
  h.addEventListener('pointermove', (e) => {
    if (!drag) return;
    drag.dy = Math.max(0, e.clientY - drag.y);
    card.style.transform = `translateY(${drag.dy}px)`;
  });
  const end = () => {
    if (!drag) return;
    const dy = drag.dy;
    drag = null;
    card.style.transition = '';
    card.style.transform = '';
    if (dy > 70) closeCard();
  };
  h.addEventListener('pointerup', end);
  h.addEventListener('pointercancel', end);
});

let hintHidden = false;
function hideHint() {
  if (hintHidden) return;
  hintHidden = true;
  $('#hint').classList.add('hide');
}
setTimeout(hideHint, 9000);

/* ============================================================================
   15. РАЗМЕРЫ ЭКРАНА
   ============================================================================ */
let firstFit = true;
function resize() {
  const w = host.clientWidth, h = host.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (firstFit) {                                    // стартовый ракурс подбираем под пропорции экрана
    firstFit = false;
    const hv = homeView();
    camera.position.copy(hv.pos);
    controls.target.copy(hv.target);
  }
}
window.addEventListener('resize', resize);
if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);
if (tg && tg.onEvent) tg.onEvent('viewportChanged', resize);
resize();

/* ============================================================================
   16. ГЛАВНЫЙ ЦИКЛ АНИМАЦИИ
   ============================================================================ */
const clock = new THREE.Clock();
const perf = { acc: 0, n: 0 };
let loaderHidden = false;

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  // Плавный подлёт камеры
  if (tween) {
    tween.t = Math.min(1, tween.t + dt / tween.dur);
    const k = easeInOut(tween.t);
    camera.position.lerpVectors(tween.fromPos, tween.toPos, k);
    controls.target.lerpVectors(tween.fromTarget, tween.toTarget, k);
    if (tween.t >= 1) tween = null;
  }

  // Плавный переход рентгена
  const goal = xrayOn ? 1 : 0;
  if (Math.abs(goal - xrayMix) > 0.0005) {
    xrayMix += (goal - xrayMix) * Math.min(1, dt * 7);
    if (Math.abs(goal - xrayMix) < 0.004) xrayMix = goal;
    applyXray(xrayMix);
  }

  // Пульсация маркеров; размер на экране постоянный (масштаб пропорционален расстоянию до камеры)
  for (let i = 0; i < markers.length; i++) {
    const m = markers[i];
    const s = camera.position.distanceTo(m.pos) * 0.0125;
    const sel = i === selected;
    const pulse = 1 + 0.22 * Math.sin(t * 3.2 + m.phase);
    const pulse2 = 1 + 0.18 * Math.sin(t * 3.2 + m.phase + 1.3);
    m.core.scale.setScalar(s * pulse * (sel ? 1.25 : 1));
    m.halo.scale.setScalar(s * 5.5 * pulse2 * (sel ? 1.3 : 1));
    m.hit.scale.setScalar(s * 2.4);
    m.core.material.color.setHex(sel ? 0xd6fdff : 0x22e6ff);
    m.halo.material.opacity = 0.7 + 0.3 * Math.sin(t * 3.2 + m.phase);
  }

  // Вращающиеся радары на мачте
  refs.radars.forEach((r, i) => { r.rotation.y += dt * (i ? -2.4 : 3.2); });

  controls.update();
  renderer.render(scene, camera);

  // Адаптивная плотность пикселей: если кадры медленные, снижаем разрешение
  perf.acc += dt; perf.n++;
  if (perf.n >= 90) {
    const avg = perf.acc / perf.n;
    perf.acc = 0; perf.n = 0;
    if (avg > 0.026 && dpr > 1) {
      dpr = Math.max(1, dpr - 0.25);
      renderer.setPixelRatio(dpr);
      renderer.setSize(host.clientWidth, host.clientHeight, false);
    }
  }

  if (!loaderHidden) {                               // убираем экран загрузки после первого кадра
    loaderHidden = true;
    $('#loader').classList.add('hide');
  }
});