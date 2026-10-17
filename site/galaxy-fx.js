/* Эффекты карты галактики.

   1. «Лаги»: полосы карты съезжают по горизонтали короткими всплесками.
   2. Волна: быстрый проход деформации сверху вниз, как у ретро-телевизора.
   3. Линии-преломление: две тонкие горизонтальные полосы идут сверху вниз одна за другой,
      с одинаковой скоростью и формой. Строки внутри полосы стабильно сдвигаются вправо
      на несколько пикселей, края резкие (как в GIF, где буквы заголовка смещены по прямой).

   Работает поверх картинки: над #galaxyMap создаётся слой из N полос с той же картинкой.
   В покое слой скрыт. Хотспоты не трогаются (слой pointer-events: none).

   Картинка: тот же файл, что сейчас показывает #galaxyMap (currentSrc — выбор srcset:
   1200 px на телефоне, 3000 px после приближения), чтобы полосы не догружали отдельный
   файл и не были мутнее карты. Без srcset — ссылка из links.js (galaxyMapImage) или
   атрибут src у #galaxyMap. Файл может лежать на другом домене: используется только
   CSS background-image, пиксели картинки не читаются. */
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
  var N = 240;              // число полос: тонкая линия ≈ 0.4 % высоты карты на полосу
  var TEAR_GROUP = 2;       // «лаги» режутся по 2 полосы, как раньше (зернистость не меняется)
  var GAP_MIN = 4000;       // пауза между «лагами» и волной, мс
  var GAP_MAX = 9000;

  var WAVE_MS = 1400;       // проход волны сверху вниз
  var WAVE_HALF = 0.2;      // ширина фронта волны (доля высоты)
  var WAVE_AMP = 1.6;       // амплитуда волны, % ширины
  var TEAR_STEP = 80;       // мс между перетасовками «лагов»
  var TEAR_CHANCE = 0.3;    // доля групп полос, которые съезжают в такт
  var TEAR_MIN = 1;         // сдвиг «лага», % ширины
  var TEAR_MAX = 2.5;

  var SWEEP_GAP_MIN = 9000; // пауза между парами линий, мс (от конца второй линии)
  var SWEEP_GAP_MAX = 14000;
  var SWEEP_MS = 10000;     // проход одной линии сверху вниз (в 2 раза медленнее прежнего)
  var SWEEP_LAG = 1600;     // отставание второй линии от первой, мс (синхронно, но вслед)
  var SWEEP_EDGE = 0.05;    // линия стартует и заканчивается за краями карты
  var SWEEP_HALF = 0.004;   // половина толщины линии (доля высоты), края резкие
  var SWEEP_AMP = 0.45;     // сдвиг строк линии вправо, % ширины (несколько пикселей)

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
    band.style.backgroundSize = '100% ' + (N * 100) + '%';
    band.style.backgroundPosition = '0 ' + (i * 100 / (N - 1)) + '%';
    fx.appendChild(band);
    bands.push(band);
    tearDx.push(0);
  }
  map.insertAdjacentElement('afterend', fx);

  // Картинка полос подставляется при запуске эффекта: в покое слой скрыт (display: none)
  // и ничего не грузит, а к моменту эффекта srcset мог сменить файл карты
  var bandSrc = '';
  function syncBandSrc() {
    var cur = map.currentSrc || src;
    if (cur === bandSrc) return;
    bandSrc = cur;
    var css = 'url("' + cur.replace(/"/g, '%22') + '")';
    for (var k = 0; k < N; k++) bands[k].style.backgroundImage = css;
  }

  var burst = null;   // «лаги» или волна
  var sweeps = [];    // линии-преломления: [{ start }]
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
    sweeps = [];
    fx.classList.remove('is-on');
    clearBands();
  }

  function run() {
    syncBandSrc();
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

  // Пара линий: первая стартует сейчас, вторая — с отставанием SWEEP_LAG
  function startSweeps() {
    if (sweeps.length) return;
    var now = performance.now();
    sweeps.push({ start: now });
    sweeps.push({ start: now + SWEEP_LAG });
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
      if (busy() || sweeps.length) { scheduleSweep(); return; }
      startSweeps();
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
          // группы по TEAR_GROUP полос съезжают вместе: зернистость «лагов» как раньше
          for (var k = 0; k < N; k += TEAR_GROUP) {
            var v = Math.random() < TEAR_CHANCE
              ? (Math.random() < 0.5 ? -1 : 1) * rand(TEAR_MIN, TEAR_MAX)
              : 0;
            for (var g = 0; g < TEAR_GROUP; g++) tearDx[k + g] = v;
          }
        }
      }
    }

    // Линии: собираем фронты активных (уже стартовавших) линий
    var fronts = [];
    var sweepEnded = false;
    for (var q = sweeps.length - 1; q >= 0; q--) {
      var s = (now - sweeps[q].start) / SWEEP_MS;
      if (s >= 1) {
        sweeps.splice(q, 1);
        sweepEnded = true;
      } else if (s >= 0) {
        fronts.push(-SWEEP_EDGE + (1 + 2 * SWEEP_EDGE) * s);
      }
    }
    // Пауза до следующей пары — от окончания предыдущей (один раз, без сброса таймера каждый кадр)
    if (sweepEnded && !sweeps.length) scheduleSweep();

    if (!burst && !sweeps.length) { stopAll(); return; }

    for (var j = 0; j < N; j++) {
      var c = (j + 0.5) / N;
      var dx = tear ? tearDx[j] : 0;
      if (wave) {
        var d = (c - waveFront) / WAVE_HALF;
        if (Math.abs(d) < 1.6) dx += WAVE_AMP * Math.exp(-d * d) * Math.sin(d * Math.PI * 2);
      }
      // Линии: строки внутри полосы сдвигаются на одинаковую малую величину, края резкие
      for (var f = 0; f < fronts.length; f++) {
        if (Math.abs(c - fronts[f]) < SWEEP_HALF) { dx += SWEEP_AMP; break; }
      }
      bands[j].style.transform = dx ? 'translate3d(' + dx.toFixed(2) + '%,0,0)' : '';
    }
    raf = requestAnimationFrame(tick);
  }

  scheduleBurst();
  scheduleSweep();
})();
