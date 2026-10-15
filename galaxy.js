(function () {
  'use strict';

  var stage = document.getElementById('galaxyStage');
  var hotspot = document.getElementById('sectorHotspot');
  var loader = document.getElementById('timelineLoader');

  function dismissLoader() {
    if (!loader) return;
    window.setTimeout(function () { loader.style.display = 'none'; }, 900);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', dismissLoader);
  } else {
    dismissLoader();
  }

  if (!hotspot || !stage) return;

  // Позиция точки перехода настраивается атрибутами data-x/data-y (в процентах).
  var px = hotspot.getAttribute('data-x');
  var py = hotspot.getAttribute('data-y');
  if (px !== null) hotspot.style.left = px + '%';
  if (py !== null) hotspot.style.top = py + '%';

  var target = hotspot.getAttribute('data-href') || 'index.html';
  var zooming = false;

  hotspot.addEventListener('mouseenter', function () {
    hotspot.classList.add('is-hover');
  });
  hotspot.addEventListener('mouseleave', function () {
    hotspot.classList.remove('is-hover');
  });

  hotspot.addEventListener('click', function (e) {
    e.preventDefault();
    if (zooming) return;
    zooming = true;
    hotspot.disabled = true;
    stage.classList.add('is-zooming');
    window.setTimeout(function () {
      window.location.href = target;
    }, 900);
  });
})();
