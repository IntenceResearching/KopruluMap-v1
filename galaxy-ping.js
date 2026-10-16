/* Пинг-рамка перехода к маркеру галактики.

   Четыре угловых уголка и внешний контур сужаются от границ карты к маркеру
   за 9 одинаковых этапов, затем — захват (onLock). Рамка всё время следует за
   маркером: при приближении (dive) карта увеличивается вокруг маркера, и уголки
   остаются на его краях, а не уезжают внутрь.

   Подключение: <script src="galaxy-ping.js"></script> до galaxy.js.
   Логику перехода (захват, приближение, навигация) задаёт galaxy.js через колбэки.

   API: window.GalaxyPing
     start({ stage, from, to, lockAt, endAt, onLock, onEnd })
       stage  — элемент сцены (.galaxy-stage), в котором рисуются уголки
       from   — стартовый box {l, t, r, b} (границы карты на экране)
       to     — функция, возвращающая текущий box маркера {l, t, r, b}
       lockAt — мс: вызывается onLock (захват, приближение)
       endAt  — мс: вызывается onEnd (переход или сообщение); до него рамка жива
     refresh() — пересчитать рамку по текущему box (вызывать при смене вида)
     stop()    — снять рамку и остановить анимацию
     Классы подсветки (is-red-target, is-odz-ping, is-locked) ставит galaxy.js. */
(function (global) {
  'use strict';

  // Этапы сужения: 9 равных шагов. Каждый этап — одинаковое смещение к маркеру,
  // одинаковая длительность и одинаковая пауза до следующего.
  var STAGE_COUNT = 9;
  var STAGE_STEP = 150;  // мс от начала одного этапа до начала следующего
  var STAGE_LEN = 130;   // длительность одного этапа, мс
  var STAGE_TO = [];
  for (var i = 0; i < STAGE_COUNT; i++) STAGE_TO.push((i + 1) / STAGE_COUNT);

  // Внешняя рамка: чуть больше основной, догоняет её с отставанием (лаг)
  var OUTER_GAP = 18;            // зазор внешней рамки от основной, px
  var OUTER_TURN = Math.PI / 6;  // 30°: поворот концов линий к центру
  var OUTER_ARM_K = 0.5;         // длина плеч внешней рамки относительно основной
  var OUTER_TAIL_MAX = 22;       // максимальная длина загнутого конца, px
  var SVG_NS = 'http://www.w3.org/2000/svg';

  var run = null;          // текущий переход
  var stageEl = null;      // элемент сцены
  var dimEl = null;        // затемнение
  var corners = [];        // четыре основных уголка
  var outerEl = null;      // SVG внешней рамки
  var outerPath = null;
  var outerBox = null;     // текущий (догоняющий) box внешней рамки
  var mainBox = null;      // основная рамка (цель для догона)
  var outerRaf = 0;

  function expandBox(b, g) { return { l: b.l - g, t: b.t - g, r: b.r + g, b: b.b + g }; }

  function armSizes(l, t, r, b) {
    return {
      w: Math.max(8, Math.min(260, (r - l) * 0.34)),
      h: Math.max(8, Math.min(260, (b - t) * 0.34))
    };
  }

  function sceneSize() { return { w: stageEl.clientWidth, h: stageEl.clientHeight }; }

  function attach(stage) {
    stageEl = stage;
    dimEl = document.createElement('div');
    dimEl.className = 'target-dim';
    stage.appendChild(dimEl);
    corners = ['tc-tl', 'tc-tr', 'tc-bl', 'tc-br'].map(function (cls) {
      var d = document.createElement('div');
      d.className = 'target-corner ' + cls;
      stage.appendChild(d);
      return d;
    });
    // внешняя рамка: SVG с загнутыми концами
    outerEl = document.createElementNS(SVG_NS, 'svg');
    outerEl.setAttribute('class', 'target-outer');
    outerEl.setAttribute('aria-hidden', 'true');
    outerPath = document.createElementNS(SVG_NS, 'path');
    outerEl.appendChild(outerPath);
    stage.appendChild(outerEl);
    window.requestAnimationFrame(function () { if (dimEl) dimEl.classList.add('is-on'); });
  }

  function detach() {
    if (outerRaf) window.cancelAnimationFrame(outerRaf);
    outerRaf = 0;
    if (dimEl && dimEl.parentNode) dimEl.parentNode.removeChild(dimEl);
    corners.forEach(function (c) { if (c.parentNode) c.parentNode.removeChild(c); });
    if (outerEl && outerEl.parentNode) outerEl.parentNode.removeChild(outerEl);
    dimEl = null;
    corners = [];
    outerEl = null;
    outerPath = null;
    outerBox = null;
    mainBox = null;
    stageEl = null;
  }

  // Поставить уголки и запомнить основную рамку для внешней
  function place(l, t, r, b) {
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

  // Прогресс 0..1 по этапам: каждый этап сужает к следующей доле пути
  function progressAt(ms) {
    var prev = 0;
    for (var k = 0; k < STAGE_COUNT; k++) {
      var s0 = k * STAGE_STEP;
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

  // Кадр рамки: интерполяция от старта к текущему маркеру
  function paintAt(ms) {
    if (!run) return;
    var p = progressAt(ms);
    var s0 = run.from;
    var e = run.to();
    place(
      s0.l + p * (e.l - s0.l),
      s0.t + p * (e.t - s0.t),
      s0.r + p * (e.r - s0.r),
      s0.b + p * (e.b - s0.b)
    );
  }

  // Внешняя рамка: догон основной с лагом
  function outerRequest() {
    if (!outerEl || outerRaf) return;
    outerRaf = window.requestAnimationFrame(outerTick);
  }

  function outerTick() {
    outerRaf = 0;
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

  // Четыре угла внешней рамки: от каждого угла два плеча, на концах — загиб 30° к центру
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

  function loop(now) {
    var r = run;
    if (!r) return;
    var ms = now - r.t0;
    paintAt(ms);
    if (!r.locked && ms >= r.lockAt) {
      r.locked = true;
      if (r.onLock) r.onLock();
    }
    if (ms < r.endAt) {
      r.raf = window.requestAnimationFrame(loop);
      return;
    }
    run = null;
    if (r.onEnd) r.onEnd();
  }

  function start(opts) {
    stop();
    attach(opts.stage);
    run = {
      from: opts.from,
      to: opts.to,
      lockAt: opts.lockAt,
      endAt: opts.endAt,
      onLock: opts.onLock || null,
      onEnd: opts.onEnd || null,
      locked: false,
      t0: window.performance.now(),
      raf: 0
    };
    paintAt(0);                                  // сразу в стартовой позиции, без вспышки
    run.raf = window.requestAnimationFrame(loop);
  }

  function refresh() {
    if (run) paintAt(window.performance.now() - run.t0);
  }

  function stop() {
    if (run && run.raf) window.cancelAnimationFrame(run.raf);
    run = null;
    detach();
  }

  global.GalaxyPing = {
    start: start,
    refresh: refresh,
    stop: stop,
    STAGE_COUNT: STAGE_COUNT
  };
})(window);
