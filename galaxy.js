(function () {
  'use strict';

  var stage = document.getElementById('galaxyStage');
  var map = document.getElementById('galaxyMap');
  var hotspot = document.getElementById('sectorHotspot');
  var panel = document.getElementById('sectorPanel');
  var closeBtn = document.getElementById('closeSectorPanel');
  var iconBtn = document.getElementById('sectorIconButton');
  var loader = document.getElementById('timelineLoader');
  var sidebar = document.getElementById('sectorsSidebar');
  var toggle = document.getElementById('sectorsToggle');
  var sectorsList = document.getElementById('sectorsList');

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
  var target = hotspot.getAttribute('data-href') || 'sector.html';
  var animating = false;

  // Position hotspot relative to the rendered image (not the stage container)
  function positionHotspot() {
    if (!map) return;
    var stageRect = stage.getBoundingClientRect();
    var imgRect = map.getBoundingClientRect();
    var x = (isNaN(px) ? 50 : px) / 100 * imgRect.width;
    var y = (isNaN(py) ? 50 : py) / 100 * imgRect.height;
    hotspot.style.left = (imgRect.left - stageRect.left + x) + 'px';
    hotspot.style.top = (imgRect.top - stageRect.top + y) + 'px';
    map.style.transformOrigin = (isNaN(px) ? 50 : px) + '% ' + (isNaN(py) ? 50 : py) + '%';
  }

  function onResize() { positionHotspot(); }
  window.addEventListener('resize', onResize);
  if (map.complete) { positionHotspot(); } else { map.addEventListener('load', positionHotspot); }
  // retry after layout
  window.setTimeout(positionHotspot, 100);
  window.setTimeout(positionHotspot, 500);

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

  // Collapsible sidebar
  if (toggle && sidebar) {
    toggle.addEventListener('click', function () {
      sidebar.classList.toggle('is-collapsed');
      var expanded = !sidebar.classList.contains('is-collapsed');
      toggle.setAttribute('aria-expanded', String(expanded));
    });
  }

  function runSegmentAnimation(txPct, tyPct, href) {
    if (animating) return;
    animating = true;
    hidePanel();

    var txP = (txPct == null || isNaN(txPct)) ? px : txPct;
    var tyP = (tyPct == null || isNaN(tyPct)) ? py : tyPct;
    var targetHref = href || target;

    var w = window.innerWidth;
    var h = window.innerHeight;
    var tx = (isNaN(txP) ? 50 : txP) / 100 * w;
    var ty = (isNaN(tyP) ? 50 : tyP) / 100 * h;

    var segs = [
      { left: 0,   top: 0,   width: tx,     height: ty     },
      { left: tx,  top: 0,   width: w - tx, height: ty     },
      { left: 0,   top: ty,  width: tx,     height: h - ty },
      { left: tx,  top: ty,  width: w - tx, height: h - ty }
    ];

    segs.forEach(function (sg, i) {
      var div = document.createElement('div');
      div.className = 'sector-seg';
      div.style.left = sg.left + 'px';
      div.style.top = sg.top + 'px';
      div.style.width = sg.width + 'px';
      div.style.height = sg.height + 'px';
      div.style.transformOrigin = (sg.left === 0 ? '100%' : '0%') + ' ' + (sg.top === 0 ? '100%' : '0%');
      div.style.animationDelay = (i * 0.38) + 's';
      stage.appendChild(div);
    });

    var total = 4 * 0.38 * 1000 + 420;
    window.setTimeout(function () {
      stage.classList.add('is-zooming');
    }, 4 * 0.38 * 1000);
    window.setTimeout(function () {
      window.location.href = targetHref;
    }, total);
  }

  if (iconBtn) {
    iconBtn.addEventListener('click', function (e) {
      e.preventDefault();
      runSegmentAnimation(px, py, target);
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
      runSegmentAnimation(x, y, href);
    });
  }
})();
