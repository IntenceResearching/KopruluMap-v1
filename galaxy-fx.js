/* Эффекты карты галактики: «лаги» (полосы карты съезжают по горизонтали) и проходящая
   волна деформации, как у ретро-телевизора.

   Работает поверх картинки: над #galaxyMap создаётся слой из N полос с той же картинкой.
   В покое слой скрыт, раз в несколько секунд запускается короткий «всплеск».
   Хотспоты не трогаются (слой pointer-events: none), подписи и квадраты остаются на месте.

   Картинка: ссылка из links.js (galaxyMapImage) или атрибут src у #galaxyMap.
   Файл может лежать на другом домене: эффект использует только CSS background-image,
   пиксели картинки не читаются. */
(function () {
  var stage = document.getElementById('galaxyStage');
  var map = document.getElementById('galaxyMap');
  if (!stage || !map) return;

  var links = window.SITE_LINKS || {};
  if (links.galaxyMapImage) map.setAttribute('src', links.galaxyMapImage);
  var src = map.getAttribute('src');
  if (!src) return;

  // Настройки эффекта
  var N = 24;               // число полос
  var WAVE_MS = 1400;       // время прохода волны сверху вниз
  var WAVE_HALF = 0.2;      // ширина фронта волны (доля высоты карты)
  var WAVE_AMP = 1.6;       // амплитуда волны, % ширины
  var TEAR_STEP = 80;       // мс между перетасовками «лагов»
  var TEAR_CHANCE = 0.3;    // доля полос, которые съезжают в такт
  var TEAR_MIN = 1;         // сдвиг «лага», % ширины
  var TEAR_MAX = 2.5;
  var GAP_MIN = 4000;       // пауза между всплесками, мс
  var GAP_MAX = 9000;

  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

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

  var burst = null;
  var raf = 0;
  var timer = 0;
  var lastTear = 0;

  function rand(a, b) { return a + Math.random() * (b - a); }

  // Во время зума галактики и переходов всплески не запускаем
  function busy() {
    return document.hidden || stage.classList.contains('is-zooming') || !!document.querySelector('.target-dim');
  }

  function clearBands() {
    for (var k = 0; k < N; k++) bands[k].style.transform = '';
  }

  function finish() {
    burst = null;
    cancelAnimationFrame(raf);
    fx.classList.remove('is-on');
    clearBands();
    schedule();
  }

  function tick(now) {
    if (!burst) return;
    var t = now - burst.start;
    if (t >= burst.dur || stage.classList.contains('is-zooming')) { finish(); return; }

    var tear = burst.kind !== 'wave';
    var wave = burst.kind !== 'tear';

    if (tear && now - lastTear >= TEAR_STEP) {
      lastTear = now;
      for (var k = 0; k < N; k++) {
        tearDx[k] = Math.random() < TEAR_CHANCE
          ? (Math.random() < 0.5 ? -1 : 1) * rand(TEAR_MIN, TEAR_MAX)
          : 0;
      }
    }

    var front = wave ? -WAVE_HALF + (1 + 2 * WAVE_HALF) * Math.min(t / WAVE_MS, 1) : 0;
    for (var j = 0; j < N; j++) {
      var dx = tear ? tearDx[j] : 0;
      if (wave) {
        var d = ((j + 0.5) / N - front) / WAVE_HALF;
        if (Math.abs(d) < 1.6) dx += WAVE_AMP * Math.exp(-d * d) * Math.sin(d * Math.PI * 2);
      }
      bands[j].style.transform = dx ? 'translate3d(' + dx.toFixed(2) + '%,0,0)' : '';
    }
    raf = requestAnimationFrame(tick);
  }

  function start() {
    if (burst) return;
    var r = Math.random();
    var kind = r < 0.4 ? 'tear' : (r < 0.7 ? 'wave' : 'both');
    burst = {
      kind: kind,
      start: performance.now(),
      dur: kind === 'tear' ? rand(380, 620) : WAVE_MS
    };
    lastTear = 0;
    fx.classList.add('is-on');
    raf = requestAnimationFrame(tick);
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(function () {
      if (busy()) { schedule(); return; }
      start();
    }, rand(GAP_MIN, GAP_MAX));
  }

  schedule();
})();
