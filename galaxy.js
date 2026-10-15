(function () {
  'use strict';

  var stage = document.getElementById('galaxyStage');
  var map = document.getElementById('galaxyMap');
  var hotspot = document.getElementById('sectorHotspot');
  var panel = document.getElementById('sectorPanel');
  var panelTitle = document.getElementById('sectorPanelTitle');
  var panelInfo = document.getElementById('sectorPanelInfo');
  var closeBtn = document.getElementById('closeSectorPanel');
  var iconBtn = document.getElementById('sectorIconButton');
  var loader = document.getElementById('timelineLoader');
  var sidebar = document.getElementById('sectorsSidebar');
  var toggle = document.getElementById('sectorsToggle');
  var sectorsList = document.getElementById('sectorsList');

  /* ---------- loader ---------- */
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

  var px = parseFloat(hotspot.getAttribute('data-x'));
  var py = parseFloat(hotspot.getAttribute('data-y'));
  var sectorName = hotspot.getAttribute('data-name') || 'Сектор';
  var target = hotspot.getAttribute('data-href') || 'sector.html';
  var animating = false;

  /* ---------- view: zoom (wheel) + pan (drag) ---------- */
  var view = { s: 1, tx: 0, ty: 0 };
  var MIN_S = 0.6, MAX_S = 8;

  function clampScale(s) { return Math.min(MAX_S, Math.max(MIN_S, s)); }

  function applyView() {
    map.style.transformOrigin = '0 0';
    map.style.transform =
      'translate(' + view.tx + 'px,' + view.ty + 'px) scale(' + view.s + ')';
    positionHotspot();
  }

  // Fraction of the map (0..1) under a stage-space point, from the rendered rect.
  function mapFractionAt(stageX, stageY) {
    var r = map.getBoundingClientRect();
    var s = stage.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return {
      u: (stageX + s.left - r.left) / r.width,
      v: (stageY + s.top - r.top) / r.height
    };
  }

  // Zoom keeping the map point under (fx, fy) of the element fixed on screen.
  function zoomAt(fx, fy, newScale) {
    newScale = clampScale(newScale);
    var qx = fx * map.offsetWidth;   // point offset inside untransformed element
    var qy = fy * map.offsetHeight;
    view.tx += (view.s - newScale) * qx;
    view.ty += (view.s - newScale) * qy;
    view.s = newScale;
    applyView();
  }

  stage.addEventListener('wheel', function (e) {
    if (animating) return;
    e.preventDefault();
    var s = stage.getBoundingClientRect();
    var f = mapFractionAt(e.clientX - s.left, e.clientY - s.top);
    if (!f) return;
    var k = Math.exp(-e.deltaY * 0.0016);
    zoomAt(f.u, f.v, view.s * k);
  }, { passive: false });

  var drag = null;
  var draggedRecently = false;

  stage.addEventListener('pointerdown', function (e) {
    if (animating) return;
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (e.target.closest && e.target.closest('.sector-panel')) return;
    drag = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty, moved: false };
    map.style.cursor = 'grabbing';
    try { stage.setPointerCapture(e.pointerId); } catch (err) {}
  });

  stage.addEventListener('pointermove', function (e) {
    if (!drag) return;
    var dx = e.clientX - drag.x;
    var dy = e.clientY - drag.y;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 5) drag.moved = true;
    if (drag.moved) {
      view.tx = drag.tx + dx;
      view.ty = drag.ty + dy;
      applyView();
    }
  });

  function endDrag() {
    if (!drag) return;
    draggedRecently = drag.moved;
    drag = null;
    map.style.cursor = '';
    if (draggedRecently) window.setTimeout(function () { draggedRecently = false; }, 50);
  }
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);

  stage.addEventListener('dblclick', function (e) {
    if (animating) return;
    if (e.target.closest && e.target.closest('.sector-hotspot, .sector-panel')) return;
    view = { s: 1, tx: 0, ty: 0 };
    applyView();
  });

  /* ---------- hotspot positioning (relative to the rendered image) ---------- */
  function positionHotspot() {
    var stageRect = stage.getBoundingClientRect();
    var imgRect = map.getBoundingClientRect();
    var x = (isNaN(px) ? 50 : px) / 100 * imgRect.width;
    var y = (isNaN(py) ? 50 : py) / 100 * imgRect.height;
    hotspot.style.left = (imgRect.left - stageRect.left + x) + 'px';
    hotspot.style.top = (imgRect.top - stageRect.top + y) + 'px';
  }

  window.addEventListener('resize', function () {
    // keep view centered-ish on resize: just reposition hotspot
    positionHotspot();
  });
  if (map.complete) { positionHotspot(); } else { map.addEventListener('load', positionHotspot); }
  window.setTimeout(positionHotspot, 100);
  window.setTimeout(positionHotspot, 500);

  /* ---------- panel ---------- */
  function showPanel() {
    if (panel) {
      if (panelTitle) panelTitle.textContent = sectorName;
      if (panelInfo && panelInfo.dataset.filled !== '1') {
        panelInfo.textContent = 'Краткая информация о секторе появится здесь.';
      }
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
    if (animating || draggedRecently) return;
    if (panel && !panel.hidden) { hidePanel(); } else { showPanel(); }
  });

  if (closeBtn) closeBtn.addEventListener('click', hidePanel);

  /* ---------- collapsible (slide-out) sidebar ---------- */
  if (toggle && sidebar) {
    toggle.addEventListener('click', function () {
      sidebar.classList.toggle('is-collapsed');
      var expanded = !sidebar.classList.contains('is-collapsed');
      toggle.setAttribute('aria-expanded', String(expanded));
    });
  }

  /* ---------- transition animation ----------
     Квадрат из 4 угловых сегментов: стартует от границ страницы и в 4 этапа
     сужается точно в квадрат-маркер сектора (48×48) на карте.
     Точка берётся из фактического rect'а хотспота — поэтому сходится
     «чертовски точно» при любом зуме/панораме/letterbox'е.            */
  var STAGE_MS = 300;   // длительность одного этапа
  var PAUSE_MS = 100;   // пауза между этапами
  var ZOOM_MS = 950;    // финальный zoom в точку
  var HOLD_MS = 220;    // пауза перед переходом
  var EASE = [0.4375, 0.75, 0.9375, 1]; // 1 - (1-i/4)^2: быстро вначале, точно в конце

  // Точка сектора в координатах сцены — считается от фактического rect'а
  // отрендеренной картинки, поэтому точна при letterbox'е, зуме и панораме.
  function stagePointFor(xPct, yPct) {
    var s = stage.getBoundingClientRect();
    var r = map.getBoundingClientRect();
    var xp = (xPct == null || isNaN(xPct)) ? (isNaN(px) ? 50 : px) : xPct;
    var yp = (yPct == null || isNaN(yPct)) ? (isNaN(py) ? 50 : py) : yPct;
    return {
      x: r.left - s.left + xp / 100 * r.width,
      y: r.top - s.top + yp / 100 * r.height
    };
  }

  function runFrameAnimation(xPct, yPct, href) {
    if (animating) return;
    animating = true;
    hidePanel();
    var targetHref = href || target;

    var stageRect = stage.getBoundingClientRect();
    var pt = stagePointFor(xPct, yPct);
    var half = hotspot.offsetWidth / 2 || 24; // финишный квадрат = маркер 48×48

    // Старт — границы страницы, финиш — квадрат маркера (совпадает с хотспотом 1:1)
    var start = { l: 0, t: 0, r: stageRect.width, b: stageRect.height };
    var end = {
      l: pt.x - half,
      t: pt.y - half,
      r: pt.x + half,
      b: pt.y + half
    };

    // Затемнение на время анимации
    var dim = document.createElement('div');
    dim.className = 'target-dim';
    stage.appendChild(dim);
    requestAnimationFrame(function () { dim.classList.add('is-on'); });

    // 4 угловых сегмента
    var corners = ['tc-tl', 'tc-tr', 'tc-bl', 'tc-br'].map(function (cls) {
      var d = document.createElement('div');
      d.className = 'target-corner ' + cls;
      stage.appendChild(d);
      return d;
    });

    function layout(e) {
      var l = start.l + e * (end.l - start.l);
      var t = start.t + e * (end.t - start.t);
      var r = start.r + e * (end.r - start.r);
      var b = start.b + e * (end.b - start.b);
      var w = Math.max(8, Math.min(260, (r - l) * 0.34));
      var h = Math.max(8, Math.min(260, (b - t) * 0.34));
      var pos = [
        [l, t],          // TL
        [r - w, t],      // TR
        [l, b - h],      // BL
        [r - w, b - h]   // BR
      ];
      corners.forEach(function (c, i) {
        c.style.left = pos[i][0] + 'px';
        c.style.top = pos[i][1] + 'px';
        c.style.width = w + 'px';
        c.style.height = h + 'px';
      });
    }

    layout(0);
    void dim.offsetWidth; // reflow before transitions kick in

    EASE.forEach(function (e, i) {
      window.setTimeout(function () { layout(e); }, (i + 1) * (STAGE_MS + PAUSE_MS) - PAUSE_MS);
    });

    // последний этап стартует в 1500мс и идёт 300мс → полная блокировка в 1800мс
    var framesDone = 4 * (STAGE_MS + PAUSE_MS) - PAUSE_MS + STAGE_MS + 60;

    // Финал: маркер «захвачен», zoom точно в точку сектора
    window.setTimeout(function () {
      hotspot.classList.add('is-locked');

      // zoom в точку сектора (точка остаётся на месте экрана, масштаб ×2.6)
      var f = mapFractionAt(pt.x, pt.y);
      if (f) {
        var newS = clampScale(view.s * 2.6);
        var qx = f.u * map.offsetWidth;
        var qy = f.v * map.offsetHeight;
        map.classList.add('is-zooming'); // включает CSS transition
        view.tx += (view.s - newS) * qx;
        view.ty += (view.s - newS) * qy;
        view.s = newS;
        map.style.transform =
          'translate(' + view.tx + 'px,' + view.ty + 'px) scale(' + view.s + ')';
      }
    }, framesDone);

    window.setTimeout(function () {
      window.location.href = targetHref;
    }, framesDone + ZOOM_MS + HOLD_MS);
  }

  if (iconBtn) {
    iconBtn.addEventListener('click', function (e) {
      e.preventDefault();
      runFrameAnimation(px, py, target);
    });
  }

  if (sectorsList) {
    sectorsList.addEventListener('click', function (e) {
      var btn = e.target.closest('.sector-list-item');
      if (!btn) return;
      e.preventDefault();
      if (animating) return;
      var x = parseFloat(btn.getAttribute('data-x'));
      var y = parseFloat(btn.getAttribute('data-y'));
      var href = btn.getAttribute('data-href') || target;
      runFrameAnimation(x, y, href);
    });
  }
})();
