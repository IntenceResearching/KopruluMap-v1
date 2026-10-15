(function () {
  'use strict';

  var stage = document.getElementById('galaxyStage');
  var map = document.getElementById('galaxyMap');
  var hotspot = document.getElementById('sectorHotspot');
  var panel = document.getElementById('sectorPanel');
  var closeBtn = document.getElementById('closeSectorPanel');
  var iconBtn = document.getElementById('sectorIconButton');
  var loader = document.getElementById('timelineLoader');

  function dismissLoader() {
    if (!loader) return;
    window.setTimeout(function () { loader.style.display = 'none'; }, 1600);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', dismissLoader);
  } else {
    dismissLoader();
  }

  if (!hotspot || !stage) return;

  var px = parseFloat(hotspot.getAttribute('data-x'));
  var py = parseFloat(hotspot.getAttribute('data-y'));
  if (!isNaN(px)) hotspot.style.left = px + '%';
  if (!isNaN(py)) hotspot.style.top = py + '%';

  var target = hotspot.getAttribute('data-href') || 'index.html';
  var animating = false;

  function showPanel() {
    if (panel) panel.hidden = false;
    hotspot.classList.add('is-selected');
  }
  function hidePanel() {
    if (panel) panel.hidden = true;
    hotspot.classList.remove('is-selected');
  }

  hotspot.addEventListener('click', function (e) {
    e.preventDefault();
    if (animating) return;
    showPanel();
  });

  if (closeBtn) closeBtn.addEventListener('click', hidePanel);

  // 4-сегментная анимация: квадрат, разделённый на 4 угла,
  // сужается от границ страницы к точке сектора в 4 этапа.
  function runSegmentAnimation() {
    if (animating) return;
    animating = true;
    hidePanel();

    var w = window.innerWidth;
    var h = window.innerHeight;
    var tx = (isNaN(px) ? 50 : px) / 100 * w;
    var ty = (isNaN(py) ? 50 : py) / 100 * h;

    var segs = [
      { left: 0,   top: 0,   width: tx,     height: ty,     origin: '100% 100%' },
      { left: tx,  top: 0,   width: w - tx, height: ty,     origin: '0% 100%'   },
      { left: 0,   top: ty,  width: tx,     height: h - ty, origin: '100% 0%'   },
      { left: tx,  top: ty,  width: w - tx, height: h - ty, origin: '0% 0%'     }
    ];

    segs.forEach(function (sg, i) {
      var div = document.createElement('div');
      div.className = 'sector-seg';
      div.style.left = sg.left + 'px';
      div.style.top = sg.top + 'px';
      div.style.width = sg.width + 'px';
      div.style.height = sg.height + 'px';
      div.style.transformOrigin = sg.origin;
      div.style.animationDelay = (i * 0.38) + 's';
      stage.appendChild(div);
    });

    // 4 этапа * 0.38 + длительность 0.42
    var total = 4 * 0.38 * 1000 + 420;
    window.setTimeout(function () {
      window.location.href = target;
    }, total);
  }

  if (iconBtn) {
    iconBtn.addEventListener('click', function (e) {
      e.preventDefault();
      runSegmentAnimation();
    });
  }
})();
