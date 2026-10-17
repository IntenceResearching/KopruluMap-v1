/* Прицел перехода к маркеру галактики — в духе брифингов StarCraft II
   (Wings of Liberty, брифинг «Maw of the Void»).

   Перекрестие на всю сцену и полая рамка в точке пересечения; линии упираются
   в рамку и внутрь не заходят. Сценарий перехода:
     1. появление   — рамка мигает в центре сцены, линии выстреливают к краям;
     2. наведение   — перекрестие едет к маркеру (оси чуть вразнобой, лёгкий перелёт);
     3. захват      — рамка поджимается к маркеру и дважды вспыхивает  → onLock(step);
     4. приближение — рамка раскрывается до краёв сцены, карта приближается
                      к маркеру                                         → onZoom(step, ms);
     5. сброс       — маленькая рамка снова в центре, шаги 2–4 повторяются;
     6. финал       — 'dive': уход в темноту (дальше переход на страницу);
                      'error': сбой захвата (Зерус); 'deny': отказ (ОЗД) → onEnd().

   Всё считается от текущего вида: положение и размер маркера читаются из
   opts.target() каждый кадр, поэтому прицел работает при любом зуме и панораме
   и не отстаёт от маркера, пока карта движется. Сама карта двигается в galaxy.js
   (колбэки onZoom / onDeny).

   Рисуется на одном canvas (.target-reticle) поверх карты; рядом — затемнение
   .target-dim (по нему galaxy-fx.js понимает, что идёт переход, и молчит).
   Цвета — CSS-переменные .target-reticle в galaxy.css; при смене класса сцены
   (is-red-target, is-odz-ping) цвет плавно перетекает.

   prefers-reduced-motion: карта не двигается (без приближения), прицел сразу на
   маркере, без мигания — захват и финал.

   Подключение: <script src="galaxy-ping.js"></script> до galaxy.js.

   API: window.GalaxyPing
     start({ stage, target, steps, ending, onLock, onZoom, onDeny, onEnd })
       stage  — элемент сцены (.galaxy-stage)
       target — функция → текущий box маркера на сцене { l, t, r, b, cx, cy, w }
       steps  — сколько раз приближаться после захвата (0 — без приближения)
       ending — 'dive' (по умолчанию) | 'error' | 'deny'
       onLock(step)     — захват на шаге step (0, 1, …)
       onZoom(step, ms) — начало приближения: карту двигает galaxy.js, ms — длительность
       onDeny(ms)       — только 'deny': отказ сразу после захвата, ms — до onEnd
       onEnd()          — конец: переход или сообщение. При 'dive' прицел и темнота
                          остаются на экране, пока страница не уйдёт (или до stop())
     refresh() — вид изменился (совместимость: прицел и так читает target() каждый кадр)
     stop()    — снять прицел и остановить анимацию */
(function (global) {
  'use strict';

  // Длительности этапов, мс
  var T = {
    appear: 190,      // появление: мигание рамки, линии к краям
    trackMin: 380,    // наведение: не короче…
    trackMax: 700,    // …и не длиннее
    trackPerPx: 0.5,  // + столько мс на пиксель пути
    lock: 320,        // первый захват: поджатие и две вспышки
    relock: 240,      // повторный захват после сброса — короче
    zoom: 560,        // раскрытие рамки и приближение карты
    reset: 160,       // сброс: маленькая рамка в центре
    fade: 240,        // 'dive': уход в темноту после последнего приближения
    error: 560,       // 'error': сбой захвата
    deny: 440,        // 'deny': вспышки отказа
    collapse: 280,    // 'error' / 'deny': линии втягиваются, рамка гаснет
    color: 400        // перетекание цвета при смене класса сцены
  };

  // Геометрия — доли меньшей стороны сцены (в брифинге — доли высоты кадра)
  var G = {
    stroke: 0.0115,   // толщина линий и рамки (в брифинге ≈ 1.2 % высоты кадра)
    strokeMin: 3,     // px
    strokeMax: 11,    // px
    boxW: 0.135,      // рамка в покое (в брифинге ≈ 13 × 11 % высоты кадра)
    boxH: 0.115,
    fit: 1.75,        // рамка вокруг маркера: ширина = размер маркера × fit…
    fitMin: 0.085,    // …но не уже…
    fitMax: 0.24,     // …и не шире этих долей
    loose: 1.14,      // до захвата рамка чуть свободнее, при захвате поджимается
    overshoot: 0.06,  // перелёт при наведении, доля пути…
    overshootPx: 14,  // …но не больше стольких px
    frameOver: 1.06,  // раскрытая рамка уходит чуть за края сцены
    glintSpeed: 0.16, // блики бегут по линиям к рамке: доля большей стороны сцены в секунду
    glintGap: 0.3,    // средний шаг бликов, доля большей стороны сцены
    veil: [1, 6, 5]   // цвет ухода в темноту (фон страниц)
  };

  var reduceMotion = !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);

  var run = null;          // текущий переход
  var stageEl = null;      // элемент сцены
  var dimEl = null;        // затемнение
  var canvas = null;
  var ctx = null;
  var cw = 0, ch = 0, dpr = 1;
  var palFrom = null, palTo = null, palT0 = 0, palClass = null;

  /* ---------- математика ---------- */
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function lerp(a, b, k) { return a + (b - a) * k; }
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function easeInCubic(t) { return t * t * t; }
  function easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function easeInOutSine(t) { return -(Math.cos(Math.PI * t) - 1) / 2; }
  function smoothstep(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function pulse(u, a, b) { return u > a && u < b ? Math.sin(Math.PI * (u - a) / (b - a)) : 0; }
  function mod(v, m) { return ((v % m) + m) % m; }
  // Псевдослучайное 0..1 от целого: одно и то же на каждом кадре (сбой, разброс бликов)
  function hash(n) { var x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

  // Наведение «как сервопривод»: плавный разгон, перелёт на ov, мягкий возврат
  function servo(u, ov) {
    if (u <= 0) return 0;
    if (u >= 1) return 1;
    if (u < 0.78) return (1 + ov) * easeInOutCubic(u / 0.78);
    return 1 + ov - ov * easeInOutSine((u - 0.78) / 0.22);
  }

  // Мигание при появлении: вспыхнула — пропала — горит
  function flicker(u) {
    if (reduceMotion) return 1;
    if (u < 0.2) return 0.85;
    if (u < 0.4) return 0;
    return 1;
  }

  /* ---------- цвета из CSS ---------- */
  function readTriplet(cs, name, fallback) {
    var v = String(cs.getPropertyValue(name) || '').split(',').map(parseFloat);
    if (v.length !== 3) return fallback;
    for (var i = 0; i < 3; i++) if (!isFinite(v[i])) return fallback;
    return v;
  }

  function readPalette() {
    var cs = global.getComputedStyle(canvas);
    return {
      core: readTriplet(cs, '--reticle-core', [34, 150, 58]),
      light: readTriplet(cs, '--reticle-light', [176, 255, 186]),
      shadow: readTriplet(cs, '--reticle-shadow', [0, 30, 6]),
      glow: readTriplet(cs, '--reticle-glow', [56, 224, 96])
    };
  }

  function mix(a, b, k) { return [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)]; }
  function rgba(c, a) {
    return 'rgba(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ',' + clamp(a, 0, 1).toFixed(3) + ')';
  }

  function currentPalette(now) {
    var k = palFrom === palTo ? 1 : easeInOutSine(clamp((now - palT0) / T.color, 0, 1));
    if (k >= 1) return palTo;
    return {
      core: mix(palFrom.core, palTo.core, k),
      light: mix(palFrom.light, palTo.light, k),
      shadow: mix(palFrom.shadow, palTo.shadow, k),
      glow: mix(palFrom.glow, palTo.glow, k)
    };
  }

  // Класс сцены сменился (например, ОЗД краснеет при отказе) — цвет перетекает
  function syncPalette(now) {
    if (stageEl.className === palClass) return;
    palClass = stageEl.className;
    palFrom = currentPalette(now);
    palTo = readPalette();
    palT0 = now;
  }

  /* ---------- холст ---------- */
  function fitCanvas() {
    var w = stageEl.clientWidth, h = stageEl.clientHeight;
    var d = Math.min(2, global.devicePixelRatio || 1);
    if (w === cw && h === ch && d === dpr) return;
    cw = w; ch = h; dpr = d;
    canvas.width = Math.max(1, Math.round(w * d));
    canvas.height = Math.max(1, Math.round(h * d));
  }

  function attach(stage) {
    stageEl = stage;
    dimEl = document.createElement('div');
    dimEl.className = 'target-dim';
    stage.appendChild(dimEl);
    canvas = document.createElement('canvas');
    canvas.className = 'target-reticle';
    canvas.setAttribute('aria-hidden', 'true');
    stage.appendChild(canvas);
    ctx = canvas.getContext ? canvas.getContext('2d') : null;
    cw = ch = 0;
    fitCanvas();
    palClass = stage.className;
    palFrom = palTo = readPalette();
    palT0 = 0;
    global.requestAnimationFrame(function () { if (dimEl) dimEl.classList.add('is-on'); });
  }

  function detach() {
    [dimEl, canvas].forEach(function (el) { if (el && el.parentNode) el.parentNode.removeChild(el); });
    dimEl = null;
    canvas = null;
    ctx = null;
    stageEl = null;
  }

  /* ---------- размеры ---------- */
  function metrics() {
    var m = Math.max(1, Math.min(cw, ch));
    return {
      m: m,
      sw: clamp(Math.round(G.stroke * m), G.strokeMin, G.strokeMax),
      rest: { w: G.boxW * m, h: G.boxH * m }
    };
  }

  // Рамка вокруг маркера: пропорции как у рамки в покое
  function fitBox(markerW, m) {
    var w = clamp(markerW * G.fit, G.fitMin * m, G.fitMax * m);
    return { w: w, h: w * G.boxH / G.boxW };
  }

  /* ---------- сценарий ---------- */
  function plan(o) {
    var p = [{ kind: 'appear', ms: T.appear }];
    p.push({ kind: 'track' });
    p.push({ kind: 'lock', step: 0, ms: T.lock });
    if (o.ending === 'deny') {
      p.push({ kind: 'deny', ms: T.deny });
      p.push({ kind: 'collapse', ms: T.collapse });
      return p;
    }
    for (var i = 0; i < o.steps; i++) {
      p.push({ kind: 'zoom', step: i, ms: T.zoom, last: i === o.steps - 1 });
      if (i < o.steps - 1) {
        p.push({ kind: 'reset', ms: T.reset });
        p.push({ kind: 'track' });
        p.push({ kind: 'lock', step: i + 1, ms: T.relock });
      }
    }
    if (o.ending === 'error') {
      if (o.steps > 0) p.push({ kind: 'reset', ms: T.reset });
      p.push({ kind: 'error', ms: T.error });
      p.push({ kind: 'collapse', ms: T.collapse });
    } else {
      p.push({ kind: 'fade', ms: T.fade });
    }
    return p;
  }

  function center() { return { x: cw / 2, y: ch / 2 }; }

  // Начало этапа: снимок состояния и колбэки. false — переход остановлен из колбэка.
  function enter(r, ph) {
    var mt = metrics();
    var tg = r.o.target();
    if (ph.kind === 'appear' || ph.kind === 'reset') {
      var c = center();
      var fb = fitBox(tg.w, mt.m);
      // без анимации движения прицел появляется сразу на маркере
      r.pos = reduceMotion ? { x: tg.cx, y: tg.cy } : c;
      r.box = reduceMotion ? { w: fb.w * G.loose, h: fb.h * G.loose } : { w: mt.rest.w, h: mt.rest.h };
    }
    ph.from = { x: r.pos.x, y: r.pos.y, w: r.box.w, h: r.box.h, alpha: r.alpha, veil: r.veil };
    if (ph.kind === 'track') {
      var dist = Math.hypot(tg.cx - r.pos.x, tg.cy - r.pos.y);
      ph.ms = reduceMotion ? 0 : clamp(T.trackMin + dist * T.trackPerPx, T.trackMin, T.trackMax);
      ph.ov = dist > 1 ? Math.min(G.overshoot, G.overshootPx / dist) : 0;
    }
    var cb = null;
    if (ph.kind === 'lock' && r.o.onLock) cb = function () { r.o.onLock(ph.step); };
    if (ph.kind === 'zoom' && r.o.onZoom) cb = function () { r.o.onZoom(ph.step, ph.ms); };
    if (ph.kind === 'deny' && r.o.onDeny) cb = function () { r.o.onDeny(T.deny + T.collapse); };
    if (cb) cb();
    return run === r;
  }

  // Состояние прицела на этапе ph при прогрессе u (0..1)
  function stateAt(r, ph, u) {
    var mt = metrics();
    var tg = r.o.target();
    var f = ph.from;
    var C = center();
    var st = { x: f.x, y: f.y, w: f.w, h: f.h, reach: 1, alpha: 1, vis: 1, fill: 0, hot: 0 };
    var fb, e, k;
    switch (ph.kind) {
      case 'appear':
      case 'reset':
        st.vis = flicker(u);
        st.reach = reduceMotion ? 1 : easeOutCubic(clamp((u - 0.25) / 0.75, 0, 1));
        break;

      case 'track':
        // оси идут чуть вразнобой: вертикаль догоняет горизонталь
        st.x = lerp(f.x, tg.cx, servo(clamp(u * 1.12, 0, 1), ph.ov));
        st.y = lerp(f.y, tg.cy, servo(clamp(u * 1.12 - 0.12, 0, 1), ph.ov));
        fb = fitBox(tg.w, mt.m);
        e = easeInOutCubic(u);
        st.w = lerp(f.w, fb.w * G.loose, e);
        st.h = lerp(f.h, fb.h * G.loose, e);
        break;

      case 'lock':
        fb = fitBox(tg.w, mt.m);
        k = 1 + (G.loose - 1) * (1 - easeOutCubic(clamp(u / 0.45, 0, 1)));
        st.x = tg.cx; st.y = tg.cy;
        st.w = fb.w * k; st.h = fb.h * k;
        st.fill = pulse(u, 0, 0.42) + pulse(u, 0.5, 0.92);
        st.hot = st.fill;
        break;

      case 'zoom':
        // рамка раскрывается от маркера до краёв сцены; центр едет к центру сцены
        e = easeInOutCubic(u);
        st.x = lerp(tg.cx, C.x, e);
        st.y = lerp(tg.cy, C.y, e);
        st.w = lerp(f.w, cw * G.frameOver, e);
        st.h = lerp(f.h, ch * G.frameOver, e);
        st.alpha = 1 - smoothstep(0.72, 1, u);
        st.hot = 0.45 * (1 - clamp(u / 0.3, 0, 1));
        if (ph.last && r.o.ending !== 'error') r.veil = Math.max(f.veil, 0.85 * smoothstep(0.45, 1, u));
        break;

      case 'fade':
        st.alpha = f.alpha * (1 - u);
        r.veil = lerp(f.veil, 1, easeInOutSine(u));
        break;

      case 'error':
        // захват срывается: рамка дёргается, мигает и прыгает в размере
        var slice = Math.floor(u * 16);
        var h1 = hash(slice + 1), h2 = hash(slice + 101), h3 = hash(slice + 211);
        var amp = reduceMotion ? 0 : 1;
        st.x = f.x + (h1 - 0.5) * 0.034 * mt.m * (1 - u * 0.5) * amp;
        st.y = f.y + (h2 - 0.5) * 0.012 * mt.m * amp;
        k = 1 + (h3 > 0.6 ? (h3 - 0.6) * 0.8 : 0) * amp;
        st.w = f.w * k; st.h = f.h * k;
        if (reduceMotion) {
          // без мигания: одна мягкая вспышка
          st.hot = 0.6 * pulse(u, 0, 1);
          break;
        }
        st.vis = h2 < 0.22 ? 0 : 1;
        st.hot = h1 > 0.72 ? 1 : 0;
        st.fill = h1 > 0.86 ? 0.6 : 0;
        break;

      case 'deny':
        fb = fitBox(tg.w, mt.m);
        st.x = tg.cx; st.y = tg.cy;
        st.w = fb.w; st.h = fb.h;
        st.fill = 0.85 * (pulse(u, 0.04, 0.42) + pulse(u, 0.52, 0.9));
        st.hot = st.fill;
        break;

      case 'collapse':
        // линии втягиваются в рамку, рамка сжимается и гаснет
        e = easeInCubic(clamp(u / 0.75, 0, 1));
        if (r.o.ending === 'deny') { st.x = tg.cx; st.y = tg.cy; }
        st.w = f.w * (1 - 0.25 * e);
        st.h = f.h * (1 - 0.25 * e);
        st.reach = 1 - e;
        st.alpha = f.alpha * (1 - smoothstep(0.4, 1, u));
        break;
    }
    st.veil = r.veil;
    return st;
  }

  /* ---------- рисование ---------- */
  // Прямоугольники прицела: 4 отрезка линий (от рамки к краям) и 4 стороны рамки
  function shapes(st, sw) {
    var l = st.x - st.w / 2, r = st.x + st.w / 2, t = st.y - st.h / 2, b = st.y + st.h / 2;
    var hs = sw / 2;
    var lines = [];
    var x1 = l * (1 - st.reach), x2 = r + (cw - r) * st.reach;
    var y1 = t * (1 - st.reach), y2 = b + (ch - b) * st.reach;
    // { x, y, w, h, v (вертикальный), ex, ey (точка у рамки), dx, dy (наружу), len }
    if (l > 0 && l - x1 > 0.5) lines.push({ x: x1, y: st.y - hs, w: l - x1, h: sw, v: false, ex: l, ey: st.y, dx: -1, dy: 0, len: l - x1 });
    if (r < cw && x2 - r > 0.5) lines.push({ x: r, y: st.y - hs, w: x2 - r, h: sw, v: false, ex: r, ey: st.y, dx: 1, dy: 0, len: x2 - r });
    if (t > 0 && t - y1 > 0.5) lines.push({ x: st.x - hs, y: y1, w: sw, h: t - y1, v: true, ex: st.x, ey: t, dx: 0, dy: -1, len: t - y1 });
    if (b < ch && y2 - b > 0.5) lines.push({ x: st.x - hs, y: b, w: sw, h: y2 - b, v: true, ex: st.x, ey: b, dx: 0, dy: 1, len: y2 - b });
    var bw = Math.max(sw, st.w), bh = Math.max(sw * 2, st.h);
    var box = [
      { x: l, y: t, w: bw, h: sw, v: false },
      { x: l, y: t + bh - sw, w: bw, h: sw, v: false },
      { x: l, y: t + sw, w: sw, h: bh - sw * 2, v: true },
      { x: l + bw - sw, y: t + sw, w: sw, h: bh - sw * 2, v: true }
    ];
    return { lines: lines, box: box, l: l, t: t, w: bw, h: bh };
  }

  function fillRects(list, dx, dy) {
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      ctx.fillRect(s.x + dx, s.y + dy, s.w, s.h);
    }
  }

  // Блики-«бусины»: короткие светлые штрихи бегут по линиям к рамке, разброс неровный
  function drawGlints(lines, sw, a, pal, now) {
    var M = Math.max(cw, ch);
    var P = G.glintGap * M;
    var K = Math.ceil(M / P) + 1;
    var span = K * P;
    var shift = (reduceMotion ? 0 : now) * G.glintSpeed * M / 1000;
    var len = sw * 2.8, th = Math.max(1, sw * 0.46);
    for (var j = 0; j < lines.length; j++) {
      var s = lines[j];
      var seed = (s.dx + 2) * 10 + (s.dy + 2);   // своя раскладка у каждого направления
      for (var k = 0; k < K; k++) {
        var d = mod((k + 0.7 * (hash(seed * 31 + k) - 0.5)) * P + hash(seed) * P - shift, span);
        if (d > s.len) continue;
        var fade = smoothstep(0, sw * 2, d) * smoothstep(0, sw * 2, s.len - d);
        if (fade <= 0.01) continue;
        var cx = s.ex + s.dx * d, cy = s.ey + s.dy * d;
        var g;
        if (s.v) g = ctx.createLinearGradient(0, cy - len / 2, 0, cy + len / 2);
        else g = ctx.createLinearGradient(cx - len / 2, 0, cx + len / 2, 0);
        g.addColorStop(0, rgba(pal.light, 0));
        g.addColorStop(0.5, rgba(pal.light, 0.62 * a * fade));
        g.addColorStop(1, rgba(pal.light, 0));
        ctx.fillStyle = g;
        if (s.v) ctx.fillRect(cx - th / 2, cy - len / 2, th, len);
        else ctx.fillRect(cx - len / 2, cy - th / 2, len, th);
      }
    }
  }

  function draw(st, now) {
    if (!ctx) return;
    var sw = metrics().sw;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    var a = st.alpha * st.vis;
    if (a > 0.003) {
      var pal = currentPalette(now);
      var core = mix(pal.core, pal.light, clamp(st.hot, 0, 1) * 0.72);
      var sh = shapes(st, sw);
      var all = sh.lines.concat(sh.box);
      var edge = Math.max(1, sw * 0.16);

      // 1. свечение
      ctx.save();
      ctx.shadowColor = rgba(pal.glow, 0.55 * a);
      ctx.shadowBlur = sw * 1.1 * dpr;
      ctx.fillStyle = rgba(core, a);
      fillRects(all, 0, 0);
      ctx.restore();
      // 2. тёмная кромка снизу и справа, как в брифинге
      ctx.fillStyle = rgba(pal.shadow, 0.9 * a);
      fillRects(all, edge, edge);
      // 3. основной цвет
      ctx.fillStyle = rgba(core, a);
      fillRects(all, 0, 0);
      // 4. светлая фаска по верхнему / левому краю; у рамки ярче, как в брифинге
      var hl = Math.max(1, sw * 0.2);
      for (var i = 0; i < all.length; i++) {
        var s = all[i];
        ctx.fillStyle = rgba(pal.light, (i < sh.lines.length ? 0.28 : 0.48) * a);
        if (s.v) ctx.fillRect(s.x, s.y, hl, s.h);
        else ctx.fillRect(s.x, s.y, s.w, hl);
      }
      // 5. блики, бегущие к рамке
      drawGlints(sh.lines, sw, a, pal, now);
      // 6. вспышка захвата внутри рамки
      if (st.fill > 0.003) {
        var iw = sh.w - sw * 2, ih = sh.h - sw * 2;
        if (iw > 0 && ih > 0) {
          ctx.save();
          ctx.shadowColor = rgba(pal.light, 0.8 * st.fill * a);
          ctx.shadowBlur = sw * 2.4 * dpr;
          ctx.fillStyle = rgba(pal.light, 0.5 * st.fill * a);
          ctx.fillRect(sh.l + sw, sh.t + sw, iw, ih);
          ctx.restore();
        }
      }
    }
    // уход в темноту — поверх всего
    if (st.veil > 0.003) {
      ctx.fillStyle = rgba(G.veil, st.veil);
      ctx.fillRect(0, 0, cw, ch);
    }
  }

  /* ---------- цикл ---------- */
  function progress(r, ph, now) { return ph.ms > 0 ? (now - r.t0) / ph.ms : 1; }

  function remember(r, st) {
    r.pos = { x: st.x, y: st.y };
    r.box = { w: st.w, h: st.h };
    r.alpha = st.alpha;
  }

  function loop(now) {
    var r = run;
    if (!r) return;
    r.raf = 0;
    fitCanvas();
    syncPalette(now);
    var ph = r.phases[r.i];
    var u = progress(r, ph, now);
    // этап закончился — фиксируем его последнее состояние и входим в следующий
    while (u >= 1) {
      var last = stateAt(r, ph, 1);
      remember(r, last);
      if (r.i === r.phases.length - 1) {
        draw(last, now);
        run = null;                        // прицел остаётся на экране до stop()
        if (r.o.onEnd) r.o.onEnd();
        return;
      }
      r.t0 += ph.ms;
      r.i += 1;
      ph = r.phases[r.i];
      if (!enter(r, ph)) return;           // остановлено из колбэка
      u = progress(r, ph, now);
    }
    var st = stateAt(r, ph, clamp(u, 0, 1));
    remember(r, st);
    draw(st, now);
    r.raf = global.requestAnimationFrame(loop);
  }

  function start(opts) {
    stop();
    if (!opts || !opts.stage || typeof opts.target !== 'function') return;
    attach(opts.stage);
    var o = {
      target: opts.target,
      steps: reduceMotion ? 0 : Math.max(0, opts.steps | 0),
      ending: opts.ending === 'error' || opts.ending === 'deny' ? opts.ending : 'dive',
      onLock: opts.onLock || null,
      onZoom: opts.onZoom || null,
      onDeny: opts.onDeny || null,
      onEnd: opts.onEnd || null
    };
    var c = center();
    var mt = metrics();
    var r = {
      o: o,
      phases: plan(o),
      i: 0,
      t0: global.performance.now(),
      pos: c,
      box: { w: mt.rest.w, h: mt.rest.h },
      alpha: 1,
      veil: 0,
      raf: 0
    };
    run = r;
    if (!enter(r, r.phases[0])) return;
    draw(stateAt(r, r.phases[0], 0), r.t0);   // первый кадр сразу, без пустого мига
    r.raf = global.requestAnimationFrame(loop);
  }

  function refresh() {
    // прицел перерисовывается каждый кадр и сам читает положение маркера;
    // здесь только подгоняем холст, если сцена сменила размер
    if (run && canvas) fitCanvas();
  }

  function stop() {
    if (run && run.raf) global.cancelAnimationFrame(run.raf);
    run = null;
    detach();
  }

  global.GalaxyPing = {
    start: start,
    refresh: refresh,
    stop: stop
  };
})(window);
