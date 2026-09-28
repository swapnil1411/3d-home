/* 360° House Tour
 * Reads tour.json, turns it into a Pannellum multi-scene config and adds the
 * room menu, loading indicator and (with ?edit=1) the coordinate picker.
 * You should not need to edit this file to add rooms – edit tour.json instead.
 */
(function () {
  'use strict';

  var params = new URLSearchParams(location.search);
  var EDIT_MODE = params.get('edit') === '1';
  var container = document.getElementById('tour');
  var viewer, tour, useMobileImages;

  // ---------- helpers ----------

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function round1(n) {
    return Math.round(n * 10) / 10;
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    var ta = el('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } finally { ta.remove(); }
    return Promise.resolve();
  }

  // Phones (and GPUs that can't handle a 6000px texture) get the lighter image.
  function shouldUseMobileImages() {
    var smallScreen = Math.min(screen.width, screen.height) < 600; // phones are ~360–430px
    var saveData = navigator.connection && navigator.connection.saveData;
    var maxTexture = 0;
    try {
      var gl = document.createElement('canvas').getContext('webgl');
      maxTexture = gl ? gl.getParameter(gl.MAX_TEXTURE_SIZE) : 0;
    } catch (e) { /* ignore */ }
    // Pannellum can show images up to 2× the max texture size.
    var weakGpu = maxTexture > 0 && maxTexture * 2 < 6000;
    return smallScreen || saveData || weakGpu;
  }

  function imageFor(scene) {
    return useMobileImages && scene.imageMobile ? scene.imageMobile : scene.image;
  }

  // ---------- hotspots ----------

  function buildHotspotTooltip(div, args) {
    div.setAttribute('role', 'button');
    div.setAttribute('tabindex', '0');
    div.setAttribute('aria-label', args.label);
    div.appendChild(el('span', 'tour-arrow__icon'));
    if (args.label) div.appendChild(el('span', 'tour-arrow__label', args.label));
    div.addEventListener('keydown', function (e) {
      if ((e.key === 'Enter' || e.key === ' ') && div.onclick) {
        e.preventDefault();
        div.onclick();
      }
    });
  }

  function toPannellumConfig(data) {
    // Portrait phones need a narrower horizontal field of view or the image looks fish-eyed.
    var portrait = container.clientHeight > container.clientWidth;
    var defaultHfov = portrait ? 70 : 100;
    var scenes = {};
    Object.keys(data.scenes).forEach(function (id) {
      var s = data.scenes[id];
      scenes[id] = {
        type: 'equirectangular',
        panorama: imageFor(s),
        yaw: s.startYaw || 0,
        pitch: s.startPitch || 0,
        hfov: s.hfov || defaultHfov,
        hotSpots: (s.hotspots || []).map(function (h) {
          var target = data.scenes[h.to];
          if (!target) console.warn('tour.json: hotspot in "' + id + '" points to unknown scene "' + h.to + '"');
          return {
            type: 'scene',
            sceneId: h.to,
            pitch: h.pitch,
            yaw: h.yaw,
            // Where to face when arriving in the next room.
            targetYaw: h.targetYaw != null ? h.targetYaw : (target && target.startYaw) || 0,
            targetPitch: h.targetPitch != null ? h.targetPitch : (target && target.startPitch) || 0,
            cssClass: 'tour-arrow',
            createTooltipFunc: buildHotspotTooltip,
            createTooltipArgs: { label: h.label || (target ? target.title : h.to) }
          };
        })
      };
    });

    return {
      default: {
        firstScene: data.firstScene,
        sceneFadeDuration: 800,
        autoLoad: true,
        compass: false,
        minHfov: 30,
        showControls: true,
        showZoomCtrl: true,
        showFullscreenCtrl: true,
        mouseZoom: true,
        keyboardZoom: true
      },
      scenes: scenes
    };
  }

  // ---------- overlay UI (lives inside the viewer so it stays visible in fullscreen) ----------

  var ui = {};

  function buildOverlay() {
    var overlay = el('div', 'tour-overlay');

    // Room name + menu (top-left)
    var nav = el('div', 'tour-nav');
    var toggle = el('button', 'tour-nav__toggle');
    toggle.type = 'button';
    toggle.setAttribute('aria-haspopup', 'true');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Choose a room');
    ui.title = el('span', 'tour-nav__title');
    toggle.appendChild(el('span', 'tour-nav__icon'));
    toggle.appendChild(ui.title);
    toggle.appendChild(el('span', 'tour-nav__chevron'));

    var menu = el('ul', 'tour-nav__menu');
    menu.hidden = true;
    ui.menuItems = {};
    Object.keys(tour.scenes).forEach(function (id) {
      var li = el('li');
      var btn = el('button', 'tour-nav__item', tour.scenes[id].title || id);
      btn.type = 'button';
      btn.addEventListener('click', function () {
        closeMenu();
        if (viewer.getScene() !== id) viewer.loadScene(id);
      });
      li.appendChild(btn);
      menu.appendChild(li);
      ui.menuItems[id] = btn;
    });

    function openMenu() { menu.hidden = false; toggle.setAttribute('aria-expanded', 'true'); }
    function closeMenu() { menu.hidden = true; toggle.setAttribute('aria-expanded', 'false'); }
    toggle.addEventListener('click', function (e) {
      e.stopPropagation();
      menu.hidden ? openMenu() : closeMenu();
    });
    document.addEventListener('click', function (e) { if (!nav.contains(e.target)) closeMenu(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeMenu(); });

    nav.appendChild(toggle);
    nav.appendChild(menu);
    overlay.appendChild(nav);

    // Loading indicator
    ui.loading = el('div', 'tour-loading');
    ui.loading.setAttribute('role', 'status');
    ui.loading.appendChild(el('span', 'tour-loading__spinner'));
    ui.loadingText = el('span', 'tour-loading__text', 'Loading…');
    ui.loading.appendChild(ui.loadingText);
    overlay.appendChild(ui.loading);

    container.appendChild(overlay);
  }

  function showLoading(sceneId) {
    var s = tour.scenes[sceneId];
    ui.loadingText.textContent = 'Loading ' + (s ? s.title : '') + '…';
    ui.loading.classList.add('is-visible');
  }

  function hideLoading() {
    ui.loading.classList.remove('is-visible');
  }

  function setCurrentScene(id) {
    var s = tour.scenes[id];
    ui.title.textContent = s ? s.title : id;
    document.title = (s ? s.title + ' – ' : '') + '360° House Tour';
    Object.keys(ui.menuItems).forEach(function (key) {
      ui.menuItems[key].classList.toggle('is-current', key === id);
      ui.menuItems[key].setAttribute('aria-current', key === id ? 'true' : 'false');
    });
    // Keep #scene in the URL so a specific room can be linked to.
    try { history.replaceState(null, '', '#' + id); } catch (e) { /* sandboxed iframe */ }
  }

  // Warm the browser cache for rooms reachable from the current one.
  var preloaded = {};
  function preloadNeighbours(id) {
    var s = tour.scenes[id];
    (s.hotspots || []).forEach(function (h) {
      var target = tour.scenes[h.to];
      var url = target && imageFor(target);
      if (!url || preloaded[url]) return;
      preloaded[url] = true;
      fetch(url).catch(function () { preloaded[url] = false; });
    });
  }

  // ---------- edit mode (?edit=1) ----------

  function setupEditMode() {
    container.classList.add('is-editing');
    var box = el('div', 'tour-edit');
    box.innerHTML =
      '<div class="tour-edit__head">Edit mode <small>– click the panorama to get coordinates</small></div>' +
      '<div class="tour-edit__row"><span>Scene</span><code data-f="scene"></code></div>' +
      '<div class="tour-edit__row"><span>Clicked</span><code data-f="click">–</code></div>' +
      '<pre class="tour-edit__json" data-f="json" hidden></pre>' +
      '<button type="button" class="tour-edit__btn" data-f="copy" disabled>Copy hotspot</button>' +
      '<div class="tour-edit__row"><span>View</span><code data-f="view"></code></div>' +
      '<button type="button" class="tour-edit__btn tour-edit__btn--ghost" data-f="copyView">Copy view yaw (for startYaw / targetYaw)</button>';
    var f = function (name) { return box.querySelector('[data-f="' + name + '"]'); };
    container.querySelector('.tour-overlay').appendChild(box);
    container.querySelector('.tour-overlay').appendChild(el('div', 'tour-edit__crosshair'));

    var lastJson = '';
    function flash(btn, text) {
      var old = btn.textContent;
      btn.textContent = text;
      setTimeout(function () { btn.textContent = old; }, 1200);
    }
    f('copy').addEventListener('click', function () {
      copyText(lastJson).then(function () { flash(f('copy'), 'Copied ✓'); });
    });
    f('copyView').addEventListener('click', function () {
      copyText(String(round1(viewer.getYaw()))).then(function () { flash(f('copyView'), 'Copied ✓'); });
    });

    function updateView() {
      f('scene').textContent = viewer.getScene();
      f('view').textContent = 'yaw ' + round1(viewer.getYaw()) + ', pitch ' + round1(viewer.getPitch());
    }
    viewer.on('load', updateView);
    viewer.on('animatefinished', updateView);
    setInterval(updateView, 250);

    // A click is a pointerdown/up pair that didn't move (so dragging doesn't count).
    var down = null;
    container.addEventListener('pointerdown', function (e) {
      down = { x: e.clientX, y: e.clientY };
    }, true);
    container.addEventListener('pointerup', function (e) {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
      down = null;
      if (e.target.closest('.tour-overlay, .pnlm-controls-container, .pnlm-orientation-button')) return;
      var coords = viewer.mouseEventToCoords(e);
      var pitch = round1(coords[0]);
      var yaw = round1(coords[1]);
      var scene = viewer.getScene();
      f('click').textContent = 'pitch ' + pitch + ', yaw ' + yaw;
      lastJson = '{ "to": "SCENE_ID", "label": "Go to …", "pitch": ' + pitch + ', "yaw": ' + yaw + ' }';
      f('json').textContent = lastJson;
      f('json').hidden = false;
      f('copy').disabled = false;
      try { viewer.removeHotSpot('edit-marker', scene); } catch (err) { /* not there yet */ }
      viewer.addHotSpot({ id: 'edit-marker', pitch: pitch, yaw: yaw, cssClass: 'tour-edit-marker' }, scene);
    }, true);
  }

  // ---------- start ----------

  function start(data) {
    tour = data;
    useMobileImages = shouldUseMobileImages();
    var config = toPannellumConfig(tour);

    // Allow deep links such as index.html#room
    var hashScene = decodeURIComponent(location.hash.slice(1));
    if (tour.scenes[hashScene]) config.default.firstScene = hashScene;

    viewer = pannellum.viewer(container, config);
    window.tourViewer = viewer; // handy for debugging or for a parent page
    buildOverlay();
    setCurrentScene(config.default.firstScene);
    showLoading(config.default.firstScene);

    viewer.on('scenechange', function (id) {
      setCurrentScene(id);
      showLoading(id);
    });
    viewer.on('load', function () {
      hideLoading();
      preloadNeighbours(viewer.getScene());
    });
    viewer.on('error', function () { hideLoading(); });

    if (EDIT_MODE) setupEditMode();
  }

  fetch('tour.json', { cache: 'no-cache' })
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(start)
    .catch(function (err) {
      console.error('Could not load tour.json', err);
      container.appendChild(el('p', 'tour-error',
        'Could not load the tour (tour.json). If you opened index.html directly from disk, ' +
        'serve the folder instead, e.g. "npx serve 360-tour". Details: ' + err.message));
    });
})();
