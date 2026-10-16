(function () {
  'use strict';

  var stage = document.getElementById('galaxyStage');
  var layer = document.getElementById('mapLayer');
  var map = document.getElementById('galaxyMap');
  var hotspot = document.getElementById('sectorHotspot');
  var panel = document.getElementById('sectorPanel');
  var panelTitle = document.getElementById('sectorPanelTitle');
  var closeBtn = document.getElementById('closeSectorPanel');
  var iconBtn = document.getElementById('sectorIconButton');
  var loader = document.getElementById('timelineLoader');
  var toggle = document.getElementById('sectorsToggle');
  var sectorsList = document.getElementById('sectorsList');
  var zoomInBtn = document.getElementById('zoomIn');
  var zoomOutBtn = document.getElementById('zoomOut');
  var resetBtn = document.getElementById('resetMap');
  var zoomPercent = document.getElementById('zoomPercent');
  var preview = document.getElementById('sectorPreview');

  /* ---------- loader: полный логотип не меньше 1.6 с ---------- */
  function dismissLoader() {
    window.setTimeout(function () {
      if (loader) loader.style.display = 'none';
      startBootConsole();
    }, 1600);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', dismissLoader);
  } else {
    dismissLoader();
  }

  /* ---------- консоль после загрузки ----------
     Печатает скрипт сверху вниз, синим, на чёрной полупрозрачной подложке.
     Висит 8 с, в конце «Welcome, Commander.». На мобильных в 4 раза быстрее (2 с).
     Скорость печати подстраивается под частоту кадров, а не под число тиков. */
  var BOOT_SCRIPT = [
    'system> init secure_link --atlas timeline',
    'system> auth commander_id=0x7F2A clearance=LEVEL-4 ... ok',
    'system> request access: space-data: xx:xx:2513',
    'system> request access: directorate_fleet/ued_space ... pending',
    'system> -redirect from=<Station_Terminal_№11.>',
    'system> route: Station_Terminal_№11 -> UED_SPACE ... ok',
    'system> scanning registry: 3182 nodes, 19245 links',
    'system> decrypt KopruluSectorData2513 ........ ok',
    'system> bypass firewall proxy=10.431.3182.19245',
    'system> handshake [##########------] 62%',
    'system> handshake [################] 100%',
    'system> session_token = 4f:9c:12:e0:aa:31:0b',
    'system> checksum 02931-8549-2022-301855 ... match',
    'system> mount /zerus/archive/cam#001 ... ok',
    'system> mount /zerus/archive/cam#002 ... ok',
    'system> if (clearance < 4) { deny(); } // skipped',
    'system> for node in registry: sync(node)',
    'system> sync 3182/3182 ... done',
    'system> access granted: space-data',
    '...',
    '...',
    '...',
    'Welcome, Commander.'
  ];
  var BOOT_TOTAL_MS = 8000;
  var BOOT_TOTAL_MOBILE_MS = 2000;
  var BOOT_FADE_MS = 400;
  var BOOT_LINE_PAUSE_MS = 90;
  var BOOT_TICK_MS = 16;
  var bootTimer = null;
  var bootHideTimer = null;
  var bootClosed = false;
  var bootWired = false;

  function closeBootConsole() {
    if (bootClosed) return;
    bootClosed = true;
    if (bootTimer) window.clearTimeout(bootTimer);
    if (bootHideTimer) window.clearTimeout(bootHideTimer);
    var box = document.getElementById('bootConsole');
    if (!box || box.hidden) return;
    box.classList.add('is-out');
    window.setTimeout(function () {
      box.hidden = true;
      box.classList.remove('is-out');
    }, BOOT_FADE_MS);
  }

  function startBootConsole() {
    var box = document.getElementById('bootConsole');
    var body = document.getElementById('bootConsoleBody');
    var closeBtn = document.getElementById('bootConsoleClose');
    if (!box || !body) return;
    if (!bootWired && closeBtn) {
      bootWired = true;
      closeBtn.addEventListener('click', closeBootConsole);
    }

    var mobile = window.matchMedia && window.matchMedia('(max-width: 768px)').matches;
    var total = mobile ? BOOT_TOTAL_MOBILE_MS : BOOT_TOTAL_MS;
    var pause = mobile ? 25 : BOOT_LINE_PAUSE_MS;
    var chars = 0;
    BOOT_SCRIPT.forEach(function (s) { chars += s.length; });
    // 85 % общего времени уходит на печать, остальное — дочитать последнюю строку
    var charMs = Math.max(0.5, (total * 0.85 - BOOT_SCRIPT.length * pause) / chars);

    box.hidden = false;
    body.innerHTML = '';
    var li = 0, ci = 0, row = null, textNode = null;
    var waitUntil = 0, acc = 0, last = performance.now(), done = false;

    function newRow() {
      row = document.createElement('div');
      row.className = 'boot-console-line';
      textNode = document.createTextNode('');
      var cursor = document.createElement('span');
      cursor.className = 'boot-console-cursor';
      cursor.textContent = '▌';
      row.appendChild(textNode);
      row.appendChild(cursor);
      body.appendChild(row);
    }

    function schedule() {
      if (!done) bootTimer = window.setTimeout(tick, BOOT_TICK_MS);
    }

    function tick() {
      bootTimer = null;
      var now = performance.now();
      var dt = now - last;
      last = now;
      if (now < waitUntil) { schedule(); return; }
      acc += dt;
      while (acc >= charMs && !done) {
        acc -= charMs;
        if (li >= BOOT_SCRIPT.length) { done = true; break; }
        if (!row) newRow();
        var text = BOOT_SCRIPT[li];
        if (ci < text.length) {
          ci++;
          textNode.nodeValue = text.slice(0, ci);
        } else {
          // строка готова: следующая начнётся после короткой паузы
          li++;
          ci = 0;
          row = null;
          waitUntil = now + pause;
          acc = 0;
          break;
        }
      }
      body.scrollTop = body.scrollHeight;
      schedule();
    }

    bootHideTimer = window.setTimeout(closeBootConsole, total);
    schedule();
  }

  if (!hotspot || !stage || !map || !layer) return;

  var sectorName = hotspot.getAttribute('data-name') || 'Сектор';
  var defaultHref = (window.SITE_LINKS && SITE_LINKS.sectorPage) || 'sector.html';

  // Параметры — как на странице сектора (app.js → CONFIG.view)
  var CONFIG = {
    minFactor: 0.62,     // отъехать от режима «вся карта»
    maxFactor: 8,        // предел приближения (исходник карты 3000px)
    wheelStep: 0.0016,
    animateMs: 340,
    fitInset: 1,
    panMargin: 0.25,     // край карты может уйти внутрь экрана на эту долю размера сцены
    dive: 2.6,           // финальный «прыжок» к сектору
    diveMs: 950,
    focusStrength: 1,   // первый клик: доля пути до центра видимой области (1 — точно в центр)
    focusAnchorX: 0.4, // первый клик: где по горизонтали ставится квадрат в видимой области (0 — у левого края, 0.5 — по центру, 1 — у правого). Меньше — карта правее, справа видно больше
    focusMs: 520,
    focusZoom: 4.1,       // первый клик: зум до 410% (диапазон 400–420%)
    focusZoomBelow: 4.0,  // зум подтягиваем только если текущий меньше 400%
    focusZoomMs: 650
  };

  /* ---------- вид карты ----------
     Слой карты (#mapLayer) — квадрат со стороной base (= min сторона сцены).
     view.s — масштаб относительно «вся карта», (tx,ty) — левый верхний угол слоя.
     Хотспот живёт внутри слоя, его позиция и размер — в процентах карты,
     поэтому он совпадает с квадратом на карте при любом зуме и панораме. */
  var base = 0;
  var view = { s: 1, tx: 0, ty: 0 };
  var anim = null;
  var busy = false;

  function sceneSize() { return { w: stage.clientWidth, h: stage.clientHeight }; }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  // Края карты не упираются жёстко в экран: запас CONFIG.panMargin от размера сцены.
  function clampAxis(t, side, size) {
    var m = size * CONFIG.panMargin;
    if (side <= size) {
      var c = (size - side) / 2;
      return clamp(t, c - m, c + m);
    }
    return clamp(t, size - side - m, m);
  }

  function clampState(st) {
    var sz = sceneSize();
    var out = { s: clamp(st.s, CONFIG.minFactor, CONFIG.maxFactor), tx: st.tx, ty: st.ty };
    var side = out.s * base;
    out.tx = clampAxis(out.tx, side, sz.w);
    out.ty = clampAxis(out.ty, side, sz.h);
    return out;
  }

  function clampView() {
    var c = clampState(view);
    view.s = c.s; view.tx = c.tx; view.ty = c.ty;
  }

  function fitView() {
    var sz = sceneSize();
    view = { s: 1, tx: (sz.w - base) / 2, ty: (sz.h - base) / 2 };
    clampView();
  }

  // Прямоугольник элемента с data-cx / data-cy / data-size (проценты карты) → координаты сцены
  function boxOf(el) {
    var cx = parseFloat(el.getAttribute('data-cx'));
    var cy = parseFloat(el.getAttribute('data-cy'));
    var size = parseFloat(el.getAttribute('data-size'));
    var side = view.s * base;
    var w = side * size / 100;
    var x = view.tx + side * cx / 100;
    var y = view.ty + side * cy / 100;
    return { l: x - w / 2, t: y - w / 2, r: x + w / 2, b: y + w / 2, cx: x, cy: y, w: w };
  }

  // Слой имеет реальный размер base·s (без CSS scale): картинка рисуется заново
  // в нужном разрешении и не растягивается растром, поэтому не «шакалится».
  // Двигаем только translate, округляя до целых px, чтобы край не мылился.
  function applyView() {
    var side = view.s * base;
    layer.style.width = side + 'px';
    layer.style.height = side + 'px';
    layer.style.transform = 'translate(' + Math.round(view.tx) + 'px,' + Math.round(view.ty) + 'px)';
    layer.style.setProperty('--s', String(view.s));
    zoomPercent.textContent = Math.round(view.s * 100) + '%';
    positionPreview();
    refreshCorners();
    parallaxRequest();
  }

  function layout() {
    var sz = sceneSize();
    var fresh = Math.min(sz.w, sz.h) * CONFIG.fitInset;
    if (!base) {
      base = fresh;
      fitView();
    } else {
      // при ресайзе сохраняем центр просмотра в координатах карты
      var cx = (sz.w / 2 - view.tx) / (view.s * base);
      var cy = (sz.h / 2 - view.ty) / (view.s * base);
      base = fresh;
      view.tx = sz.w / 2 - cx * view.s * base;
      view.ty = sz.h / 2 - cy * view.s * base;
      clampView();
    }
    applyView();
  }

  function zoomAt(x, y, factor) {
    var next = clamp(view.s * factor, CONFIG.minFactor, CONFIG.maxFactor);
    if (next === view.s) return;
    var k = next / view.s;
    // точка под курсором остаётся на месте
    view.tx = x - (x - view.tx) * k;
    view.ty = y - (y - view.ty) * k;
    view.s = next;
    clampView();
    applyView();
  }

  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

  function animateTo(s, tx, ty, ms, done) {
    var from = { s: view.s, tx: view.tx, ty: view.ty };
    var to = clampState({ s: s, tx: tx, ty: ty });
    var token = {};
    var t0 = performance.now();
    anim = token;
    function step(now) {
      if (anim !== token) return;               // отменено пользователем
      var k = easeOutCubic(clamp((now - t0) / ms, 0, 1));
      view.s = from.s + (to.s - from.s) * k;
      view.tx = from.tx + (to.tx - from.tx) * k;
      view.ty = from.ty + (to.ty - from.ty) * k;
      applyView();
      if (k < 1) { window.requestAnimationFrame(step); return; }
      anim = null;
      if (done) done();
    }
    window.requestAnimationFrame(step);
  }

  function cancelAnim() { anim = null; }

  /* ---------- колесо, drag, pinch, двойной клик ---------- */
  function scenePoint(e) {
    var r = stage.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  stage.addEventListener('wheel', function (e) {
    if (busy) return;
    e.preventDefault();
    cancelAnim();
    var p = scenePoint(e);
    zoomAt(p.x, p.y, Math.exp(-e.deltaY * CONFIG.wheelStep));
  }, { passive: false });

  var pointers = {};
  var drag = null;
  var pinchDist = 0;
  var suppressClick = false;   // после реального drag click не считается выбором пустого места

  function isUi(target) {
    return !!(target.closest && target.closest('.sector-panel, .map-controls, .sectors-sidebar, .sectors-curtain, .sectors-backdrop, .map-hint'));
  }

  stage.addEventListener('pointerdown', function (e) {
    suppressClick = false;
    if (busy || isUi(e.target)) return;
    var p = scenePoint(e);
    pointers[e.pointerId] = p;
    cancelAnim();
    if (Object.keys(pointers).length === 1) {
      // Захват указателя ставим только при реальном drag, иначе click уйдёт на сцену
      drag = { id: e.pointerId, sx: p.x, sy: p.y, tx: view.tx, ty: view.ty, moved: false };
    } else {
      drag = null;
      pinchDist = 0;
    }
  });

  stage.addEventListener('pointermove', function (e) {
    if (!pointers[e.pointerId]) return;
    var p = scenePoint(e);
    pointers[e.pointerId] = p;
    var ids = Object.keys(pointers);
    if (ids.length === 2) {
      var a = pointers[ids[0]], b = pointers[ids[1]];
      var d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDist > 0) zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / pinchDist);
      pinchDist = d;
      return;
    }
    if (drag && drag.id === e.pointerId) {
      var dx = p.x - drag.sx, dy = p.y - drag.sy;
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 4) {
        drag.moved = true;
        try { stage.setPointerCapture(e.pointerId); } catch (err) {}
        stage.classList.add('is-dragging');
      }
      if (drag.moved) {
        view.tx = drag.tx + dx;
        view.ty = drag.ty + dy;
        clampView();
        applyView();
      }
    }
  });

  function endPointer(e) {
    delete pointers[e.pointerId];
    if (drag && drag.id === e.pointerId) {
      if (drag.moved) suppressClick = true;
      drag = null;
      stage.classList.remove('is-dragging');
    }
    if (Object.keys(pointers).length < 2) pinchDist = 0;
  }
  stage.addEventListener('pointerup', endPointer);
  stage.addEventListener('pointercancel', endPointer);

  stage.addEventListener('dblclick', function (e) {
    if (busy || isUi(e.target)) return;
    var p = scenePoint(e);
    zoomAt(p.x, p.y, 1.8);
  });

  /* ---------- кнопки и клавиатура (как на странице сектора) ---------- */
  function center() { return { x: sceneSize().w / 2, y: sceneSize().h / 2 }; }

  if (zoomInBtn) zoomInBtn.addEventListener('click', function () {
    if (busy) return; cancelAnim(); var c = center(); zoomAt(c.x, c.y, 1.45);
  });
  if (zoomOutBtn) zoomOutBtn.addEventListener('click', function () {
    if (busy) return; cancelAnim(); var c = center(); zoomAt(c.x, c.y, 1 / 1.45);
  });
  if (resetBtn) resetBtn.addEventListener('click', function () {
    if (busy) return;
    var sz = sceneSize();
    animateTo(1, (sz.w - base) / 2, (sz.h - base) / 2, CONFIG.animateMs);
  });

  document.addEventListener('keydown', function (e) {
    var tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || busy) return;
    if (e.key === 'Escape') { hidePanel(); return; }
    var c = center();
    if (e.key === '+' || e.key === '=') { cancelAnim(); zoomAt(c.x, c.y, 1.35); return; }
    if (e.key === '-' || e.key === '_') { cancelAnim(); zoomAt(c.x, c.y, 1 / 1.35); return; }
    if (e.key === '0') {
      var sz = sceneSize();
      animateTo(1, (sz.w - base) / 2, (sz.h - base) / 2, CONFIG.animateMs);
      return;
    }
    var pan = 60;
    var moved = true;
    cancelAnim();
    if (e.key === 'ArrowLeft') view.tx += pan;
    else if (e.key === 'ArrowRight') view.tx -= pan;
    else if (e.key === 'ArrowUp') view.ty += pan;
    else if (e.key === 'ArrowDown') view.ty -= pan;
    else moved = false;
    if (moved) { clampView(); applyView(); }
  });

  window.addEventListener('resize', layout);
  if (document.readyState === 'complete') layout();
  else window.addEventListener('load', layout);
  document.addEventListener('DOMContentLoaded', layout);

  /* ---------- звёздный фон как у сектора Копрулу ----------
     Повторяет drawSchematic из app.js: цвет #03060c, три цветных облака,
     900 звёзд с тем же генератором (зерно 100000), размер и прозрачность как там.
     Параллакс: фон перерисовывается со смещением от движения карты (view.tx/ty),
     а не от курсора. Смещение заворачивается по размеру холста, поэтому звёзды
     не упираются в край при любом перетаскивании. */
  var starfield = document.getElementById('galaxyStarfield');
  var PAR_PAN = 0.06;                 // звёзды едут в 6 % от сдвига карты
  var parReduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var starState = { w: 0, h: 0, dpr: 1, stars: [] };
  var paintedOff = { x: NaN, y: NaN };
  function starRandom(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }
  function wrapMod(v, m) { return ((v % m) + m) % m; }
  function parallaxOffset() {
    if (parReduce) return { x: 0, y: 0 };
    // округляем до полпикселя, чтобы не перерисовывать на микро-сдвигах
    return { x: Math.round(view.tx * PAR_PAN * 2) / 2, y: Math.round(view.ty * PAR_PAN * 2) / 2 };
  }
  function paintStarfield(ox, oy) {
    if (!starfield || !starfield.getContext || !starState.w) return;
    var w = starState.w, h = starState.h;
    var ctx = starfield.getContext('2d');
    ctx.setTransform(starState.dpr, 0, 0, starState.dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#03060c';
    ctx.fillRect(0, 0, w, h);

    var size = Math.max(w, h);
    var clouds = [
      { x: 0.36, y: 0.30, r: 0.26, color: 'rgba(80,120,190,.16)' },
      { x: 0.62, y: 0.58, r: 0.30, color: 'rgba(180,120,60,.12)' },
      { x: 0.78, y: 0.30, r: 0.22, color: 'rgba(120,90,200,.10)' }
    ];
    clouds.forEach(function (cloud) {
      var radius = cloud.r * size;
      var bx = wrapMod(cloud.x * w + ox, w);
      var by = wrapMod(cloud.y * h + oy, h);
      for (var i = -1; i <= 1; i++) {
        for (var j = -1; j <= 1; j++) {
          var cx = bx + i * w, cy = by + j * h;
          if (cx + radius < 0 || cx - radius > w || cy + radius < 0 || cy - radius > h) continue;
          var gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
          gradient.addColorStop(0, cloud.color);
          gradient.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = gradient;
          ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
        }
      }
    });

    ctx.fillStyle = '#cfe0f5';
    starState.stars.forEach(function (s) {
      var x = wrapMod(s.x + ox, w), y = wrapMod(s.y + oy, h);
      var rr = Math.max(0.5, s.r);
      // звезда у края рисуется и с противоположной стороны (шов не виден)
      var xs = [x];
      if (x < rr + 1) xs.push(x + w);
      if (x > w - rr - 1) xs.push(x - w);
      var ys = [y];
      if (y < rr + 1) ys.push(y + h);
      if (y > h - rr - 1) ys.push(y - h);
      ctx.globalAlpha = s.a;
      xs.forEach(function (px) {
        ys.forEach(function (py) {
          ctx.beginPath();
          ctx.arc(px, py, rr, 0, Math.PI * 2);
          ctx.fill();
        });
      });
    });
    ctx.globalAlpha = 1;
    paintedOff = { x: ox, y: oy };
  }
  function drawStarfield() {
    if (!starfield || !starfield.getContext) return;
    var host = starfield.parentNode;
    var w = host.clientWidth;
    var h = host.clientHeight;
    if (!w || !h) return;
    var dpr = window.devicePixelRatio || 1;
    starfield.width = Math.round(w * dpr);
    starfield.height = Math.round(h * dpr);
    starfield.style.width = w + 'px';
    starfield.style.height = h + 'px';
    // та же последовательность случайных чисел, что и раньше: вид при нулевом смещении не меняется
    var random = starRandom(100000);
    var stars = [];
    for (var i = 0; i < 900; i++) {
      var x = random() * w;
      var y = random() * h;
      var r = 0.4 + random() * 1.5;
      var a = 0.12 + random() * 0.5;
      stars.push({ x: x, y: y, r: r, a: a });
    }
    starState = { w: w, h: h, dpr: dpr, stars: stars };
    var off = parallaxOffset();
    paintStarfield(off.x, off.y);
  }
  window.addEventListener('resize', drawStarfield);
  if (document.readyState === 'complete') drawStarfield();
  else window.addEventListener('load', drawStarfield);
  document.addEventListener('DOMContentLoaded', drawStarfield);

  /* ---------- превью 300×300 при ховере на хотспот ---------- */
  // Ставим слева от квадрата, если места нет — справа; всегда внутри сцены.
  var previewAnchor = hotspot;

  function positionPreview() {
    if (!preview || !preview.classList.contains('is-on')) return;
    var W = preview.offsetWidth, H = preview.offsetHeight, gap = 18, edge = 8;
    var st = stage.getBoundingClientRect();
    var h = (previewAnchor || hotspot).getBoundingClientRect();
    var sw = stage.clientWidth, sh = stage.clientHeight;
    var hl = h.left - st.left, hr = h.right - st.left;
    var hcy = (h.top + h.bottom) / 2 - st.top;
    var left = hl - gap - W;
    if (left < edge) left = hr + gap;
    if (left + W > sw - edge) left = clamp(hl + h.width / 2 - W / 2, edge, sw - W - edge);
    var top = clamp(hcy - H / 2, edge, sh - H - edge);
    preview.style.transform = 'translate(' + Math.round(left) + 'px,' + Math.round(top) + 'px)';
  }

  function showPreview(anchor) {
    anchor = anchor || hotspot;
    if (!preview || (panel && !panel.hidden) || busy) return;
    if (anchor.classList.contains('is-odz-locked')) return;
    previewAnchor = anchor;
    var img = preview.querySelector('img');
    var src = anchor.getAttribute('data-macket');
    if (img && src && img.getAttribute('src') !== src) img.setAttribute('src', src);
    preview.classList.add('is-on');
    positionPreview();
  }
  function hidePreview() {
    if (preview) preview.classList.remove('is-on');
  }

  hotspot.addEventListener('pointerenter', function (e) {
    if (e.pointerType === 'mouse') showPreview();
  });
  hotspot.addEventListener('pointerleave', hidePreview);
  hotspot.addEventListener('focus', function () {
    if (hotspot.matches(':focus-visible')) showPreview();
  });
  hotspot.addEventListener('blur', hidePreview);

  /* ---------- панель сектора: первый клик ---------- */
  // Панель общая для Копрулу и Зеруса. Для Зеруса: описание и картинка заменены на «no-data available».
  var panelInfo = document.getElementById('sectorPanelInfo');
  var noDataBox = document.getElementById('sectorNoData');
  var KOPRULU_INFO = panelInfo ? panelInfo.textContent : '';
  var ZERUS_NAME = 'Пространство Зеруса';
  var ZERUS_NODATA = 'no-data available';

  var ODZ_NAME = 'Пространство Директората';
  var iconImg = iconBtn ? iconBtn.querySelector('img') : null;
  var panelArea = null;   // область, для которой открыта панель

  function showPanel(el) {
    el = el || hotspot;
    var isZerus = el === zerus;
    var isOdz = el === odz;
    panelArea = el;
    hidePreview();
    if (panel) {
      if (panelTitle) panelTitle.textContent = isZerus ? ZERUS_NAME : (isOdz ? ODZ_NAME : sectorName);
      if (panelInfo) {
        panelInfo.textContent = isZerus ? ZERUS_NODATA : KOPRULU_INFO;
        panelInfo.classList.toggle('is-nodata', isZerus);
      }
      if (iconBtn) iconBtn.hidden = isZerus;
      if (iconImg) {
        var macket = el.getAttribute('data-macket');
        if (macket && iconImg.getAttribute('src') !== macket) iconImg.setAttribute('src', macket);
      }
      if (noDataBox) noDataBox.hidden = !isZerus;
      panel.hidden = false;
    }
    [hotspot, zerus, odz].forEach(function (x) {
      if (x && x !== el) x.classList.remove('is-selected');
    });
    el.classList.add('is-selected');
  }
  function hidePanel() {
    if (panel) panel.hidden = true;
    panelArea = null;
    [hotspot, zerus, odz].forEach(function (x) {
      if (x) x.classList.remove('is-selected', 'is-locked');
    });
  }

  // Первый клик: мягко сдвигаем карту, чтобы квадрат оказался ближе к центру
  // видимой области (левее открытой панели). Масштаб не меняем.
  // Если зум меньше focusZoomBelow — доводим до focusZoom и центрируем точно;
  // если уже приближено — только мягкий сдвиг, масштаб не меняем.
  function focusSector() {
    if (busy) return;
    var sz = sceneSize();
    var visibleW = sz.w - (panel && !panel.hidden ? panel.offsetWidth : 0);
    var c = boxOf(hotspot);
    var nx, ny, ns, ms;
    if (view.s < CONFIG.focusZoomBelow) {
      ns = CONFIG.focusZoom;
      var side = ns * base;
      var px = parseFloat(hotspot.getAttribute('data-cx')) / 100 * side;
      var py = parseFloat(hotspot.getAttribute('data-cy')) / 100 * side;
      nx = visibleW * CONFIG.focusAnchorX - px;
      ny = sz.h / 2 - py;
      ms = CONFIG.focusZoomMs;
    } else {
      ns = view.s;
      nx = view.tx + (visibleW * CONFIG.focusAnchorX - c.cx) * CONFIG.focusStrength;
      ny = view.ty + (sz.h / 2 - c.cy) * CONFIG.focusStrength;
      ms = CONFIG.focusMs;
    }
    hotspot.classList.add('is-locked');
    animateTo(ns, nx, ny, ms);
  }

  // Выбор Копрулу: первый вызов — панель + сдвиг; повторный по выбранному — переход.
  // Вызывается и кликом по квадрату на карте, и кликом по пункту в шторке.
  function activateKoprulu() {
    if (busy) return;
    if (hotspot.classList.contains('is-selected')) {
      runTransition(hotspot, defaultHref);
      return;
    }
    showPanel();
    focusSector();
  }

  hotspot.addEventListener('click', function (e) {
    e.preventDefault();
    activateKoprulu();
  });
  if (closeBtn) closeBtn.addEventListener('click', hidePanel);

  // Клик по пустому месту карты снимает выделение: панель закрывается, квадраты
  // возвращаются в обычное состояние. Следующий клик по квадрату снова первый
  // (панель + приближение), а не переход, и ховер работает как прежде.
  // Масштаб и положение карты не меняются.
  function clearSelection() {
    if (busy) return;
    var active = [hotspot, zerus, odz].some(function (x) {
      return x && (x.classList.contains('is-selected') || x.classList.contains('is-locked'));
    });
    if (active) hidePanel();
  }
  stage.addEventListener('click', function (e) {
    if (suppressClick) { suppressClick = false; return; }
    if (e.target.closest && e.target.closest('.sector-hotspot, .sector-preview, .sector-panel, .map-controls, .sectors-sidebar, .sectors-curtain, .sectors-backdrop, .map-hint')) return;
    clearSelection();
  });

  /* ---------- непрерывность блика хотспотов ----------
     Раньше на ховере менялась animation-duration, и браузер пересчитывал позицию
     полосы по тому же времени: полоса прыгала назад и выглядела как перезапуск.
     Теперь длительность не меняется, а скорость проигрывания плавно меняется через
     Web Animations (updatePlaybackRate): текущая позиция сохраняется. */
  var SHEEN_HOT_RATE = 3.6 / 1.4;   // 3.6 s → 1.4 s на ховере/фокусе/выбранном
  function applySheenRate(el) {
    var hot = el.matches(':hover') || el.matches(':focus-visible') || el.classList.contains('is-selected');
    var rate = hot ? SHEEN_HOT_RATE : 1;
    if (!document.getAnimations) return;
    document.getAnimations().forEach(function (a) {
      if (a.animationName === 'sector-sheen' && a.effect && a.effect.target === el && a.playbackRate !== rate) {
        a.updatePlaybackRate(rate);
      }
    });
  }
  document.querySelectorAll('.sector-hotspot').forEach(function (el) {
    el.addEventListener('pointerenter', function () { applySheenRate(el); });
    el.addEventListener('pointerleave', function () { applySheenRate(el); });
    el.addEventListener('focus', function () { applySheenRate(el); });
    el.addEventListener('blur', function () { applySheenRate(el); });
    new MutationObserver(function () { applySheenRate(el); })
      .observe(el, { attributes: true, attributeFilter: ['class'] });
  });


  /* ---------- переход: квадрат из 4 сегментов ----------
     Старт — границы изображения (квадрат карты на экране) → 4 равных этапа
     сужения в квадрат сектора → захват (подсветка) → плавный zoom ×2.6 с фиксацией
     точки сектора → переход на страницу сектора.
     Конечный квадрат берётся из той же геометрии, что и сам хотспот.          */
  var STAGE_START = [0, 400, 800, 1200]; // начало каждого этапа, мс
  var STAGE_LEN = 300;                   // длительность этапа, мс
  var STAGE_TO = [0.25, 0.5, 0.75, 1];   // равные шаги: 4 этапа сужения
  var LOCK_AT = 1500;
  var DIVE_AT = 1500;

  var dim = null;
  var corners = [];

  function setupCorners() {
    dim = document.createElement('div');
    dim.className = 'target-dim';
    stage.appendChild(dim);
    corners = ['tc-tl', 'tc-tr', 'tc-bl', 'tc-br'].map(function (cls) {
      var d = document.createElement('div');
      d.className = 'target-corner ' + cls;
      stage.appendChild(d);
      return d;
    });
    // внешняя рамка: SVG с загнутыми концами (поворот 30° к центру)
    outerEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    outerEl.setAttribute('class', 'target-outer');
    outerEl.setAttribute('aria-hidden', 'true');
    outerPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    outerEl.appendChild(outerPath);
    stage.appendChild(outerEl);
    window.requestAnimationFrame(function () { dim.classList.add('is-on'); });
  }

  function teardownCorners() {
    if (dim && dim.parentNode) dim.parentNode.removeChild(dim);
    corners.forEach(function (c) { if (c.parentNode) c.parentNode.removeChild(c); });
    if (outerEl && outerEl.parentNode) outerEl.parentNode.removeChild(outerEl);
    dim = null;
    corners = [];
    outerEl = null;
    outerPath = null;
    outerBox = null;
    mainBox = null;
  }

  // Состояние рамки, которая следует за картой: {start, p, el}. Пока задано,
  // рамка пересчитывается при каждом изменении вида (applyView), а не на кадр позже.
  var cornerTrack = null;
  function refreshCorners() {
    if (!cornerTrack || !corners.length) return;
    var st = cornerTrack;
    var end = boxOf(st.el);
    var p = st.p;
    var s0 = st.start;
    placeCorners(
      s0.l + p * (end.l - s0.l),
      s0.t + p * (end.t - s0.t),
      s0.r + p * (end.r - s0.r),
      s0.b + p * (end.b - s0.b)
    );
  }

  // Внешняя рамка: чуть больше основной, догоняет её с отставанием (лаг).
  var OUTER_GAP = 18;        // зазор внешней рамки от основной, px
  var OUTER_TURN = Math.PI / 6; // 30°: поворот концов линий к центру
  var OUTER_ARM_K = 0.5;     // длина плеч внешней рамки относительно основной
  var OUTER_TAIL_MAX = 22;   // максимальная длина загнутого конца, px
  var outerEl = null;
  var outerPath = null;
  var outerBox = null;       // текущий (догоняющий) box внешней рамки
  var mainBox = null;        // основная рамка (цель для догона)
  var outerQueued = false;

  function expandBox(b, g) { return { l: b.l - g, t: b.t - g, r: b.r + g, b: b.b + g }; }

  function armSizes(l, t, r, b) {
    return {
      w: Math.max(8, Math.min(260, (r - l) * 0.34)),
      h: Math.max(8, Math.min(260, (b - t) * 0.34))
    };
  }

  function outerRequest() {
    if (!outerEl || outerQueued) return;
    outerQueued = true;
    window.requestAnimationFrame(outerTick);
  }

  function outerTick() {
    outerQueued = false;
    if (!outerEl || !mainBox || !outerBox) return;
    var goal = expandBox(mainBox, OUTER_GAP);
    var k = 0.12;
    outerBox = {
      l: outerBox.l + (goal.l - outerBox.l) * k,
      t: outerBox.t + (goal.t - outerBox.t) * k,
      r: outerBox.r + (goal.r - outerBox.r) * k,
      b: outerBox.b + (goal.b - outerBox.b) * k
    };
    var settled = Math.abs(goal.l - outerBox.l) < 0.3 && Math.abs(goal.t - outerBox.t) < 0.3 &&
                  Math.abs(goal.r - outerBox.r) < 0.3 && Math.abs(goal.b - outerBox.b) < 0.3;
    if (settled) outerBox = goal;
    drawOuter(outerBox);
    if (!settled) outerRequest();
  }

  // Рисует четыре угла внешней рамки. От каждого угла идут два плеча, на концах
  // каждого плеча — загиб на 30° к центру рамки.
  function drawOuter(b) {
    var sz = sceneSize();
    outerEl.setAttribute('viewBox', '0 0 ' + sz.w + ' ' + sz.h);
    // плечи короче основных: внешние углы читаются как уголки, а не как контур
    var base = armSizes(b.l, b.t, b.r, b.b);
    var a = { w: base.w * OUTER_ARM_K, h: base.h * OUTER_ARM_K };
    var tailH = Math.min(OUTER_TAIL_MAX, a.w * 0.4);
    var tailV = Math.min(OUTER_TAIL_MAX, a.h * 0.4);
    var s30 = Math.sin(OUTER_TURN), c30 = Math.cos(OUTER_TURN);
    var d = '';
    // [угол x, угол y, ix (внутрь по x), iy (внутрь по y)]
    [[b.l, b.t, 1, 1], [b.r, b.t, -1, 1], [b.l, b.b, 1, -1], [b.r, b.b, -1, -1]].forEach(function (c) {
      var cx = c[0], cy = c[1], ix = c[2], iy = c[3];
      var eh = [cx + ix * a.w, cy];                 // конец горизонтального плеча
      var ev = [cx, cy + iy * a.h];                 // конец вертикального плеча
      var th = [eh[0] + tailH * ix * c30, eh[1] + tailH * iy * s30];
      var tv = [ev[0] + tailV * ix * s30, ev[1] + tailV * iy * c30];
      d += 'M' + eh[0] + ' ' + eh[1] + 'L' + cx + ' ' + cy + 'L' + ev[0] + ' ' + ev[1];
      d += 'M' + eh[0] + ' ' + eh[1] + 'L' + th[0] + ' ' + th[1];
      d += 'M' + ev[0] + ' ' + ev[1] + 'L' + tv[0] + ' ' + tv[1];
    });
    outerPath.setAttribute('d', d);
  }

  function placeCorners(l, t, r, b) {
    var a = armSizes(l, t, r, b);
    var w = a.w, h = a.h;
    var pos = [[l, t], [r - w, t], [l, b - h], [r - w, b - h]];
    corners.forEach(function (c, i) {
      c.style.left = pos[i][0] + 'px';
      c.style.top = pos[i][1] + 'px';
      c.style.width = w + 'px';
      c.style.height = h + 'px';
    });
    mainBox = { l: l, t: t, r: r, b: b };
    // внешняя рамка стартует заметно больше и догоняет основную
    if (!outerBox) outerBox = expandBox(mainBox, OUTER_GAP * 2);
    outerRequest();
  }

  // прогресс 0..1 → состояние рамки на текущем кадре
  function progressAt(ms) {
    var prev = 0;
    for (var k = 0; k < STAGE_START.length; k++) {
      var s0 = STAGE_START[k];
      var s1 = s0 + STAGE_LEN;
      if (ms < s0) return prev;
      if (ms <= s1) {
        var u = (ms - s0) / STAGE_LEN;
        var q = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
        return prev + (STAGE_TO[k] - prev) * q;
      }
      prev = STAGE_TO[k];
    }
    return 1;
  }

  function resetTransition() {
    busy = false;
    cancelAnim();
    teardownCorners();
    hotspot.classList.remove('is-locked');
  }

  function runTransition(el, href) {
    if (busy) return;
    busy = true;
    cancelAnim();
    hidePanel();
    hidePreview();

    var side = view.s * base;
    var start = { l: view.tx, t: view.ty, r: view.tx + side, b: view.ty + side };
    var end = boxOf(el);
    var NAV_AT = DIVE_AT + CONFIG.diveMs + 150;

    setupCorners();
    placeCorners(start.l, start.t, start.r, start.b); // сразу в стартовой позиции, без вспышки

    var t0 = performance.now();
    var locked = false;
    var diving = false;

    function frame(now) {
      var ms = now - t0;
      var p = progressAt(ms);
      placeCorners(
        start.l + p * (end.l - start.l),
        start.t + p * (end.t - start.t),
        start.r + p * (end.r - start.r),
        start.b + p * (end.b - start.b)
      );

      if (!locked && ms >= LOCK_AT) {
        locked = true;
        hotspot.classList.add('is-locked');
      }

      if (!diving && ms >= DIVE_AT) {
        diving = true;
        // zoom с фиксацией точки сектора на экране
        var c = boxOf(el);
        var nextS = clamp(view.s * CONFIG.dive, CONFIG.minFactor, CONFIG.maxFactor);
        var k = nextS / view.s;
        animateTo(nextS,
          c.cx - (c.cx - view.tx) * k,
          c.cy - (c.cy - view.ty) * k,
          CONFIG.diveMs);
      }

      if (ms < NAV_AT) { window.requestAnimationFrame(frame); return; }
      window.location.href = href;
    }
    window.requestAnimationFrame(frame);
  }

  // Возврат назад (bfcache): сбрасываем переход, а не показываем залипший кадр
  window.addEventListener('pageshow', function (e) {
    if (e.persisted) { resetTransition(); layout(); }
  });

  if (iconBtn) {
    iconBtn.addEventListener('click', function (e) {
      e.preventDefault();
      if (odz && panelArea === odz) {
        commitOdz();
        return;
      }
      runTransition(hotspot, defaultHref);
    });
  }

  /* ---------- шторка списка областей ---------- */
  var backdrop = document.getElementById('sectorsBackdrop');
  var closeList = document.getElementById('sectorsClose');

  function setCurtain(open) {
    if (!sectorsList) return;
    sectorsList.classList.toggle('is-open', open);
    if (backdrop) backdrop.classList.toggle('is-open', open);
    if (toggle) toggle.setAttribute('aria-expanded', String(open));
  }

  if (toggle) {
    toggle.addEventListener('click', function () {
      setCurtain(!sectorsList.classList.contains('is-open'));
    });
  }
  /* Макет Зеруса для миниатюры в списке. Пока пустая строка — остаётся красная заглушка.
     Чтобы вставить картинку, укажите путь, например 'assets/zerus-macket.jpg'. */
  var ZERUS_MACKET = '';
  var zerusThumb = document.querySelector('.sector-list-thumb--zerus');
  if (zerusThumb && ZERUS_MACKET) {
    var zerusImg = document.createElement('img');
    zerusImg.src = ZERUS_MACKET;
    zerusImg.alt = '';
    zerusImg.width = 48;
    zerusImg.height = 48;
    zerusThumb.insertBefore(zerusImg, zerusThumb.firstChild);
  }

  if (closeList) closeList.addEventListener('click', function () { setCurtain(false); });
  if (backdrop) backdrop.addEventListener('click', function () { setCurtain(false); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && sectorsList && sectorsList.classList.contains('is-open')) setCurtain(false);
  });

  if (sectorsList) {
    sectorsList.addEventListener('click', function (e) {
      var btn = e.target.closest('.sector-list-item');
      if (!btn) return;
      e.preventDefault();
      setCurtain(false);
      if (btn.hasAttribute('data-zerus')) {
        activateZerus();
        return;
      }
      if (btn.hasAttribute('data-odz')) {
        activateOdz();
        return;
      }
      activateKoprulu();
    });
  }

  /* ---------- Зерус: красная область без страницы ----------
     Первый клик — приближение к квадрату (как у Копрулу, без панели).
     Второй клик — красный переход из 4 уголков, приближение, затем сообщение
     «Ошибка. Нет данных»: печатается по буквам, точка в конце моргает. */
  var zerus = document.getElementById('zerusHotspot');
  var zerusMsg = document.getElementById('galaxyError');
  var zerusText = document.getElementById('galaxyErrorText');
  var ZERUS_MESSAGE = 'Ошибка. Нет данных';
  var zerusTimer = null;

  function focusArea(el) {
    var sz = sceneSize();
    var visibleW = sz.w - (panel && !panel.hidden ? panel.offsetWidth : 0);
    var c = boxOf(el);
    var nx, ny, ns, ms;
    if (view.s < CONFIG.focusZoomBelow) {
      ns = CONFIG.focusZoom;
      var side = ns * base;
      var px = parseFloat(el.getAttribute('data-cx')) / 100 * side;
      var py = parseFloat(el.getAttribute('data-cy')) / 100 * side;
      nx = visibleW * CONFIG.focusAnchorX - px;
      ny = sz.h / 2 - py;
      ms = CONFIG.focusZoomMs;
    } else {
      ns = view.s;
      nx = view.tx + (visibleW * CONFIG.focusAnchorX - c.cx) * CONFIG.focusStrength;
      ny = view.ty + (sz.h / 2 - c.cy) * CONFIG.focusStrength;
      ms = CONFIG.focusMs;
    }
    el.classList.add('is-locked');
    animateTo(ns, nx, ny, ms);
  }

  var ZERUS_SHOW_MS = 5000;   // сколько сообщение висит на экране
  var ZERUS_FADE_MS = 400;    // длительность затухания
  var zerusHide = null;
  var zerusFade = null;

  function hideZerusError() {
    if (!zerusMsg) return;
    zerusMsg.classList.add('is-out');
    zerusFade = window.setTimeout(function () {
      zerusMsg.hidden = true;
      zerusFade = null;
    }, ZERUS_FADE_MS);
  }

  function showZerusError() {
    if (!zerusMsg || !zerusText) return;
    if (zerusHide) window.clearTimeout(zerusHide);
    if (zerusFade) window.clearTimeout(zerusFade);
    zerusHide = window.setTimeout(hideZerusError, ZERUS_SHOW_MS);
    zerusMsg.classList.remove('is-out');
    zerusMsg.hidden = false;
    zerusMsg.classList.remove('is-done');
    zerusText.textContent = '';
    if (zerusTimer) window.clearInterval(zerusTimer);
    var i = 0;
    zerusTimer = window.setInterval(function () {
      i += 1;
      zerusText.textContent = ZERUS_MESSAGE.slice(0, i);
      if (i >= ZERUS_MESSAGE.length) {
        window.clearInterval(zerusTimer);
        zerusTimer = null;
        zerusMsg.classList.add('is-done');
      }
    }, 45);
  }

  function runZerusTransition(el) {
    if (busy) return;
    busy = true;
    cancelAnim();
    stage.classList.add('is-red-target');
    var side = view.s * base;
    var start = { l: view.tx, t: view.ty, r: view.tx + side, b: view.ty + side };
    var NAV_AT = DIVE_AT + CONFIG.diveMs + 150;

    setupCorners();
    cornerTrack = { start: start, p: 0, el: el };
    refreshCorners();

    var t0 = performance.now();
    var locked = false;
    var diving = false;

    function frame(now) {
      var ms = now - t0;
      cornerTrack.p = progressAt(ms);
      refreshCorners();
      if (!locked && ms >= LOCK_AT) {
        locked = true;
        el.classList.add('is-locked');
      }
      if (!diving && ms >= DIVE_AT) {
        diving = true;
        var c = boxOf(el);
        var nextS = clamp(view.s * CONFIG.dive, CONFIG.minFactor, CONFIG.maxFactor);
        var k = nextS / view.s;
        animateTo(nextS,
          c.cx - (c.cx - view.tx) * k,
          c.cy - (c.cy - view.ty) * k,
          CONFIG.diveMs);
      }
      if (ms < NAV_AT) { window.requestAnimationFrame(frame); return; }
      // вместо перехода — сообщение об ошибке
      busy = false;
      cancelAnim();
      cornerTrack = null;
      teardownCorners();
      stage.classList.remove('is-red-target');
      showZerusError();
    }
    window.requestAnimationFrame(frame);
  }

  // Клик по области Зеруса (на карте или в списке): первый — приближение, второй — переход
  function activateZerus() {
    if (!zerus || busy) return;
    if (zerus.classList.contains('is-selected')) {
      runZerusTransition(zerus);
      return;
    }
    showPanel(zerus);
    focusArea(zerus);
  }

  if (zerus) {
    zerus.addEventListener('click', function (e) {
      e.preventDefault();
      activateZerus();
    });
  }

  /* ---------- Пространство Директората (ОЗД) ----------
     Как Копрулу: первый клик — панель и приближение, второй — переход.
     Переход: рамка сходится к квадрату, квадрат и блик краснеют, камера отдаляется
     до 100 %, затем печатаются 12 строк «ОТКАЗ ДОСТУПА.» … «Файл заблокирован.».
     Строки гаснут через 5 с, после этого кнопка неактивна. Перезагрузка сбрасывает всё. */
  var odz = document.getElementById('odzHotspot');
  var odzMsg = document.getElementById('odzMessage');
  var odzListItem = document.querySelector('.sector-list-item[data-odz]');
  var odzDone = false;          // переход уже запущен: повторно не запускается
  var ODZ_LINES = [];
  for (var li = 0; li < 11; li++) ODZ_LINES.push('ОТКАЗ ДОСТУПА.');
  ODZ_LINES.push('Файл заблокирован.');
  var ODZ_LINE_STEP = 110;      // мс между началом строк (строки пишутся каскадом)
  var ODZ_CHAR_MS = 22;         // мс на символ
  var ODZ_SHOW_MS = 5000;       // строки висят 5 с от первой буквы
  var ODZ_FADE_MS = 400;
  var odzTimers = [];
  var odzHideTimer = null;
  var odzFadeTimer = null;

  function setOdzLocked() {
    if (odz) odz.classList.add('is-odz-locked');
    if (odzListItem) odzListItem.classList.add('is-odz-locked');
  }

  function clearOdzTimers() {
    odzTimers.forEach(function (t) { window.clearTimeout(t); });
    odzTimers = [];
  }

  function hideOdzMessages() {
    clearOdzTimers();
    setOdzLocked();
    if (!odzMsg) return;
    odzMsg.classList.add('is-out');
    odzFadeTimer = window.setTimeout(function () {
      odzMsg.hidden = true;
      odzMsg.classList.remove('is-out');
    }, ODZ_FADE_MS);
  }

  function showOdzMessages() {
    if (!odzMsg) { setOdzLocked(); return; }
    clearOdzTimers();
    if (odzHideTimer) window.clearTimeout(odzHideTimer);
    if (odzFadeTimer) window.clearTimeout(odzFadeTimer);
    odzMsg.innerHTML = '';
    odzMsg.classList.remove('is-out');
    odzMsg.hidden = false;
    ODZ_LINES.forEach(function (text, i) {
      var line = document.createElement('div');
      line.className = 'odz-line';
      odzMsg.appendChild(line);
      for (var k = 1; k <= text.length; k++) {
        (function (n) {
          var at = i * ODZ_LINE_STEP + n * ODZ_CHAR_MS;
          odzTimers.push(window.setTimeout(function () {
            line.textContent = text.slice(0, n);
          }, at));
        })(k);
      }
    });
    odzHideTimer = window.setTimeout(hideOdzMessages, ODZ_SHOW_MS);
  }

  function runOdzTransition(el) {
    odzDone = true;
    busy = true;
    cancelAnim();
    hidePanel();
    // Пинг синий на всём сужении; красным становится только в самом конце (LOCK_AT)
    stage.classList.add('is-odz-ping');
    var reddened = false;
    var side = view.s * base;
    var start = { l: view.tx, t: view.ty, r: view.tx + side, b: view.ty + side };
    var MSG_AT = LOCK_AT + CONFIG.animateMs + 150;

    setupCorners();
    cornerTrack = { start: start, p: 0, el: el };
    refreshCorners();

    var t0 = performance.now();
    var zoomed = false;

    function frame(now) {
      var ms = now - t0;
      cornerTrack.p = progressAt(ms);
      refreshCorners();
      if (!reddened && ms >= LOCK_AT) {
        reddened = true;
        el.classList.add('is-odz-red');      // квадрат и рамка плавно краснеют (CSS transition)
        stage.classList.remove('is-odz-ping');
        stage.classList.add('is-red-target');
      }
      if (!zoomed && ms >= LOCK_AT) {
        zoomed = true;
        el.classList.add('is-locked');
        var sz = sceneSize();
        animateTo(1, (sz.w - base) / 2, (sz.h - base) / 2, CONFIG.animateMs);
      }
      if (ms < MSG_AT) { window.requestAnimationFrame(frame); return; }
      busy = false;
      cancelAnim();
      cornerTrack = null;
      teardownCorners();
      stage.classList.remove('is-red-target', 'is-odz-ping');
      showOdzMessages();
    }
    window.requestAnimationFrame(frame);
  }

  function commitOdz() {
    if (!odz || odzDone || busy) return;
    runOdzTransition(odz);
  }

  function activateOdz() {
    if (!odz || odzDone || busy) return;
    if (odz.classList.contains('is-selected')) {
      commitOdz();
      return;
    }
    showPanel(odz);
    focusArea(odz);
  }

  if (odz) {
    odz.addEventListener('click', function (e) {
      e.preventDefault();
      activateOdz();
    });
    odz.addEventListener('pointerenter', function (e) {
      if (e.pointerType === 'mouse') showPreview(odz);
    });
    odz.addEventListener('pointerleave', hidePreview);
  }

  /* ---------- параллакс звёздного фона: от движения карты ----------
     Курсор не участвует. Перерисовка звёзд запрашивается из applyView, то есть при
     любом сдвиге вида: перетаскивании, зуме, переходе. */
  var parQueued = false;

  function parallaxRequest() {
    if (!starfield || parQueued) return;
    parQueued = true;
    window.requestAnimationFrame(parallaxTick);
  }

  function parallaxTick() {
    parQueued = false;
    if (!starfield) return;
    var off = parallaxOffset();
    if (off.x === paintedOff.x && off.y === paintedOff.y) return;
    paintStarfield(off.x, off.y);
  }
})();
