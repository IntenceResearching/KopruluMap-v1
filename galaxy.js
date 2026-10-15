(function () {
  'use strict';

  var stage = document.getElementById('galaxyStage');
  var map = document.getElementById('galaxyMap');
  var hotspot = document.getElementById('sectorHotspot');
  var panel = document.getElementById('sectorPanel');
  var panelTitle = document.getElementById('sectorPanelTitle');
  var closeBtn = document.getElementById('closeSectorPanel');
  var iconBtn = document.getElementById('sectorIconButton');
  var loader = document.getElementById('timelineLoader');
  var sidebar = document.getElementById('sectorsSidebar');
  var toggle = document.getElementById('sectorsToggle');
  var sectorsList = document.getElementById('sectorsList');
  var zoomInBtn = document.getElementById('zoomIn');
  var zoomOutBtn = document.getElementById('zoomOut');
  var resetBtn = document.getElementById('resetMap');
  var zoomPercent = document.getElementById('zoomPercent');

  /* ---------- loader: полный логотип не меньше 1.6 с ---------- */
  function dismissLoader() {
    if (!loader) return;
    window.setTimeout(function () { loader.style.display = 'none'; }, 1600);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', dismissLoader);
  } else {
    dismissLoader();
  }

  if (!hotspot || !stage || !map) return;

  var px = parseFloat(hotspot.getAttribute('data-x'));   // % от стороны изображения
  var py = parseFloat(hotspot.getAttribute('data-y'));
  var sectorName = hotspot.getAttribute('data-name') || 'Сектор';
  var defaultHref = hotspot.getAttribute('data-href') || 'sector.html';

  // Те же параметры, что на странице сектора (app.js → CONFIG.view)
  var CONFIG = {
    minFactor: 0.62,     // отъехать от режима «вся карта»
    maxFactor: 8,        // предел приближения (исходник карты 3000px)
    wheelStep: 0.0016,
    animateMs: 340,
    fitInset: 1,
    dive: 2.6,           // финальный «прыжок» к сектору
    diveMs: 950
  };

  /* ---------- вид карты ----------
     Карта — квадратный элемент со стороной base (= min сторона сцены).
     view.s — масштаб относительно «вся карта», (tx,ty) — позиция левого верхнего
     угла карты в координатах сцены. Хотспот и переход считаются из тех же чисел. */
  var base = 0;
  var view = { s: 1, tx: 0, ty: 0 };
  var anim = null;

  function sceneSize() { return { w: stage.clientWidth, h: stage.clientHeight }; }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  function clampState(st) {
    var sz = sceneSize();
    var side = st.s * base;
    var out = { s: clamp(st.s, CONFIG.minFactor, CONFIG.maxFactor), tx: st.tx, ty: st.ty };
    side = out.s * base;
    out.tx = side <= sz.w ? (sz.w - side) / 2 : clamp(out.tx, sz.w - side, 0);
    out.ty = side <= sz.h ? (sz.h - side) / 2 : clamp(out.ty, sz.h - side, 0);
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

  // точка на карте (в % стороны изображения) → координаты сцены
  function mapPoint(xp, yp) {
    var side = view.s * base;
    return { x: view.tx + side * xp / 100, y: view.ty + side * yp / 100 };
  }

  function positionHotspot() {
    var p = mapPoint(px, py);
    hotspot.style.left = p.x + 'px';
    hotspot.style.top = p.y + 'px';
  }

  function applyView() {
    map.style.width = base + 'px';
    map.style.height = base + 'px';
    map.style.transform = 'translate(' + view.tx + 'px,' + view.ty + 'px) scale(' + view.s + ')';
    positionHotspot();
    zoomPercent.textContent = Math.round(view.s * 100) + '%';
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

  function isUi(target) {
    return !!(target.closest && target.closest('.sector-panel, .map-controls, .sectors-sidebar, .map-hint'));
  }

  stage.addEventListener('pointerdown', function (e) {
    if (busy || isUi(e.target)) return;
    var p = scenePoint(e);
    pointers[e.pointerId] = p;
    cancelAnim();
    if (Object.keys(pointers).length === 1) {
      // Захват указателя НЕ ставим на нажатии: иначе click уйдёт на сцену,
      // а не на хотспот. Захват включаем только когда начался реальный drag.
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
    var fit = { s: 1, tx: (sz.w - base) / 2, ty: (sz.h - base) / 2 };
    animateTo(fit.s, fit.tx, fit.ty, CONFIG.animateMs);
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

  /* ---------- панель сектора: первый клик ---------- */
  var busy = false;

  function showPanel() {
    if (panel) {
      if (panelTitle) panelTitle.textContent = sectorName;
      panel.hidden = false;
    }
    hotspot.classList.add('is-selected');
  }
  function hidePanel() {
    if (panel) panel.hidden = true;
    hotspot.classList.remove('is-selected');
  }

  hotspot.addEventListener('click', function (e) {
    e.preventDefault();
    if (busy) return;
    showPanel();
  });
  if (closeBtn) closeBtn.addEventListener('click', hidePanel);

  /* ---------- выезжающий список секторов ---------- */
  if (toggle && sidebar) {
    toggle.addEventListener('click', function () {
      sidebar.classList.toggle('is-collapsed');
      toggle.setAttribute('aria-expanded', String(!sidebar.classList.contains('is-collapsed')));
    });
  }

  /* ---------- переход: квадрат из 4 сегментов ----------
     Старт — границы изображения (квадрат карты на экране) → 4 этапа сужения
     в квадрат 48×48, ровно совпадающий с хотспотом → захват (пульс) →
     плавный zoom ×2.6, зафиксированный в точке сектора → переход.
     Всё считается из одних и тех же координат, что и позиция хотспота.      */
  var STAGE_START = [0, 400, 800, 1200]; // начало каждого этапа, мс
  var STAGE_LEN = 300;                   // длительность этапа, мс
  var STAGE_TO = [0.25, 0.5, 0.75, 1]; // равные шаги: 4 этапа сужения
  var LOCK_AT = 1500;
  var DIVE_AT = 1500;
  var NAV_AT = DIVE_AT + CONFIG.diveMs + 150;

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
    window.requestAnimationFrame(function () { dim.classList.add('is-on'); });
  }

  function teardownCorners() {
    if (dim && dim.parentNode) dim.parentNode.removeChild(dim);
    corners.forEach(function (c) { if (c.parentNode) c.parentNode.removeChild(c); });
    dim = null;
    corners = [];
  }

  function placeCorners(l, t, r, b) {
    var w = Math.max(8, Math.min(260, (r - l) * 0.34));
    var h = Math.max(8, Math.min(260, (b - t) * 0.34));
    var pos = [[l, t], [r - w, t], [l, b - h], [r - w, b - h]];
    corners.forEach(function (c, i) {
      c.style.left = pos[i][0] + 'px';
      c.style.top = pos[i][1] + 'px';
      c.style.width = w + 'px';
      c.style.height = h + 'px';
    });
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
        return prev + (STO(k) - prev) * q;
      }
      prev = STO(k);
    }
    return 1;
  }
  function STO(k) { return STAGE_TO[k]; }

  function resetTransition() {
    busy = false;
    cancelAnim();
    teardownCorners();
    hotspot.classList.remove('is-locked');
  }

  function runTransition(xp, yp, href) {
    if (busy) return;
    busy = true;
    cancelAnim();
    hidePanel();

    var side = view.s * base;
    var start = { l: view.tx, t: view.ty, r: view.tx + side, b: view.ty + side };
    var c = mapPoint(xp, yp);
    var half = hotspot.offsetWidth / 2 || 24;
    var end = { l: c.x - half, t: c.y - half, r: c.x + half, b: c.y + half };

    setupCorners();
    placeCorners(start.l, start.t, start.r, start.b); // сразу в стартовой позиции, без кадра-«вспышки»
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
        var hsPoint = mapPoint(xp, yp);
        var nextS = clamp(view.s * CONFIG.dive, CONFIG.minFactor, CONFIG.maxFactor);
        var k = nextS / view.s;
        animateTo(nextS,
          hsPoint.x - (hsPoint.x - view.tx) * k,
          hsPoint.y - (hsPoint.y - view.ty) * k,
          CONFIG.diveMs);
      }

      if (ms < NAV_AT) { window.requestAnimationFrame(frame); return; }
      window.location.href = href;
    }
    window.requestAnimationFrame(frame);
  }

  // Возврат назад (bfcache): сбрасываем состояние перехода, а не показываем залипший кадр
  window.addEventListener('pageshow', function (e) {
    if (e.persisted) { resetTransition(); layout(); }
  });

  if (iconBtn) {
    iconBtn.addEventListener('click', function (e) {
      e.preventDefault();
      runTransition(px, py, defaultHref);
    });
  }

  if (sectorsList) {
    sectorsList.addEventListener('click', function (e) {
      var btn = e.target.closest('.sector-list-item');
      if (!btn) return;
      e.preventDefault();
      var x = parseFloat(btn.getAttribute('data-x'));
      var y = parseFloat(btn.getAttribute('data-y'));
      runTransition(x, y, btn.getAttribute('data-href') || defaultHref);
    });
  }
})();
