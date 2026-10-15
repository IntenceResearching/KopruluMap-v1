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
  if (map && !isNaN(px) && !isNaN(py)) {
    map.style.transformOrigin = px + '% ' + py + '%';
  }

  var target = hotspot.getAttribute('data-href') || 'index.html';
  var zooming = false;

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
    if (zooming) return;
    showPanel();
  });

  if (closeBtn) closeBtn.addEventListener('click', hidePanel);

  if (iconBtn) {
    iconBtn.addEventListener('click', function (e) {
      e.preventDefault();
      if (zooming) return;
      zooming = true;
      hidePanel();
      stage.classList.add('is-zooming');
      window.setTimeout(function () {
        window.location.href = target;
      }, 900);
    });
  }
})();
