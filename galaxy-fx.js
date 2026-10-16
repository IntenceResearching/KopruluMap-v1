/* Эффекты карты галактики.

   1. «Лаги»: полосы карты съезжают по горизонтали короткими всплесками.
   2. Волна: быстрый проход деформации сверху вниз, как у ретро-телевизора.
   3. «Магнитная» линия: медленно проходит сверху вниз и тянет узкую горизонтальную
      полосу карты слегка вправо, как при поднесённом магните или сбое развёртки.

   Работает поверх картинки: над #galaxyMap создаётся слой из N полос с той же картинкой.
   В покое слой скрыт. Хотспоты не трогаются (слой pointer-events: none).

   Картинка: ссылка из links.js (galaxyMapImage) или атрибут src у #galaxyMap.
   Файл может лежать на другом домене: используется только CSS background-image,
   пиксели картинки не читаются. */
(function () {
  var stage = document.getElementById('galaxyStage');
  var map = document.getElementById('galaxyMap');
  if (!stage || !map) return;

  var links = window.SITE_LINKS || {};
  if (links.galaxyMapImage) map.setAttribute('src', links.galaxyMapImage);
  var src = map.getAttribute('src');
  if (!src) return;

  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  // Настройки
  var N = 48;               // число полос (тоньше — точнее линия)
  var GAP_MIN = 4000;       // пауза между «лагами» и волной, мс
  var GAP_MAX = 9000;

  var WAVE_MS = 1400;       // проход волны сверху вниз
  var WAVE_HALF = 0.2;      // ширина фронта волны (доля высоты)
  var WAVE_AMP = 1.6;       // амплитуда волны, % ширины
  var TEAR_STEP = 80;       // мс между перетасовками «лагов»
  var TEAR_CHANCE = 0.3;    // доля полос, которые съезжают в такт
  var TEAR_MIN = 1;         // сдвиг «лага», % ширины
  var TEAR_MAX = 2.5;

  var SWEEP_GAP_MIN = 9000; // пауза между проходами магнитной линии, мс
  var SWEEP_GAP_MAX = 14000;
  var SWEEP_MS = 5200;      // медленный проход сверху вниз
  var SWEEP_EDGE = 0.1;     // линия начинается и заканчивается за краями карты
  var SWEEP_SIGMA = 0.035;  // толщина линии (доля высоты)
  var SWEEP_AMP = 1.1;      // сдвиг вправо в центре линии, % ширины

  // Слой полос: каждая полоса показывает свой кусок картинки на весь размер карты
  var fx = document.createElement('div');
  fx.className = 'map-fx';
  fx.setAttribute('aria-hidden', 'true');
  var bands = [];
  var tearDx = [];
  for (var i = 0; i < N; i++) {
    var band = document.createElement('div');
    band.className = 'map-fx-band';
    band.style.top = (i * 100 / N) + '%';
    band.style.height = (100 / N) + '%';
    band.style.backgroundImage = 'url("' + src + '")';
    band.style.backgroundSize = '100% ' + (N * 100) + '%';
    band.style.backgroundPosition = '0 ' + (i * 100 / (N - 1)) + '%';
    fx.appendChild(band);
    bands.push(band);
    tearDx.push(0);
  }
  map.insertAdjacentElement('afterend', fx);

  var burst = null;   // «лаги» или волна
  var sweep = null;   // магнитная линия
  var raf = 0;
  var timerBurst = 0;
  var timerSweep = 0;
  var lastTear = 0;

  function rand(a, b) { return a + Math.random() * (b - a); }

  // Во время зума галактики и переходов ничего не запускаем
  function busy() {
    return document.hidden || stage.classList.contains('is-zooming') || !!document.querySelector('.target-dim');
  }

  function clearBands() {
    for (var k = 0; k < N; k++) bands[k].style.transform = '';
  }

  function stopAll() {
    cancelAnimationFrame(raf);
    raf = 0;
    burst = null;
    sweep = null;
    fx.classList.remove('is-on');
    clearBands();
  }

  function run() {
    fx.classList.add('is-on');
    if (!raf) raf = requestAnimationFrame(tick);
  }

  function startBurst() {
    if (burst) return;
    var r = Math.random();
    var kind = r < 0.4 ? 'tear' : (r < 0.7 ? 'wave' : 'both');
    burst = {
      kind: kind,
      start: performance.now(),
      dur: kind === 'tear' ? rand(380, 620) : WAVE_MS
    };
    lastTear = 0;
    run();
  }

  function startSweep() {
    if (sweep) return;
    sweep = { start: performance.now() };
    run();
  }

  function scheduleBurst() {
    clearTimeout(timerBurst);
    timerBurst = setTimeout(function () {
      if (busy() || burst) { scheduleBurst(); return; }
      startBurst();
    }, rand(GAP_MIN, GAP_MAX));
  }

  function scheduleSweep() {
    clearTimeout(timerSweep);
    timerSweep = setTimeout(function () {
      if (busy() || sweep) { scheduleSweep(); return; }
      startSweep();
    }, rand(SWEEP_GAP_MIN, SWEEP_GAP_MAX));
  }

  function tick(now) {
    raf = 0;
    if (stage.classList.contains('is-zooming') || document.querySelector('.target-dim')) {
      stopAll();
      scheduleBurst();
      scheduleSweep();
      return;
    }

    var tear = false;
    var wave = false;
    var waveFront = 0;
    if (burst) {
      var t = now - burst.start;
      if (t >= burst.dur) {
        burst = null;
        scheduleBurst();
      } else {
        tear = burst.kind !== 'wave';
        wave = burst.kind !== 'tear';
        waveFront = -WAVE_HALF + (1 + 2 * WAVE_HALF) * Math.min(t / WAVE_MS, 1);
        if (tear && now - lastTear >= TEAR_STEP) {
          lastTear = now;
          for (var k = 0; k < N; k++) {
            tearDx[k] = Math.random() < TEAR_CHANCE
              ? (Math.random() < 0.5 ? -1 : 1) * rand(TEAR_MIN, TEAR_MAX)
              : 0;
          }
        }
      }
    }

    var sweepOn = false;
    var sweepFront = 0;
    if (sweep) {
      var s = (now - sweep.start) / SWEEP_MS;
      if (s >= 1) {
        sweep = null;
        scheduleSweep();
      } else {
        sweepOn = true;
        sweepFront = -SWEEP_EDGE + (1 + 2 * SWEEP_EDGE) * s;
      }
    }

    if (!burst && !sweep) { stopAll(); return; }

    for (var j = 0; j < N; j++) {
      var c = (j + 0.5) / N;
      var dx = tear ? tearDx[j] : 0;
      if (wave) {
        var d = (c - waveFront) / WAVE_HALF;
        if (Math.abs(d) < 1.6) dx += WAVE_AMP * Math.exp(-d * d) * Math.sin(d * Math.PI * 2);
      }
      if (sweepOn) {
        var ds = (c - sweepFront) / SWEEP_SIGMA;
        if (Math.abs(ds) < 3) dx += SWEEP_AMP * Math.exp(-ds * ds);
      }
      bands[j].style.transform = dx ? 'translate3d(' + dx.toFixed(2) + '%,0,0)' : '';
    }
    raf = requestAnimationFrame(tick);
  }

  scheduleBurst();
  scheduleSweep();
})();
