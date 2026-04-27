// ─── Halla Gulla — Episode Player (videopreview-*.html) ──────────────────────
// Scrapes the videopreview page for: video URL, season list, all episodes.
// Renders a Netflix-style layout: video top-left, seasons + episodes right/below.
// Switching seasons loads episodes via the site's AJAX. No page reloads.
// Enhanced with proper cleanup, race condition prevention, and error handling

(function () {
  'use strict';

  var Utils = window.HGUtils || {};
  var esc = Utils.esc || function(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };

  // ── State ─────────────────────────────────────────────────────────────────────
  var currentVideoSaveInterval = null;
  var isPlayingEpisode = false;
  var _activeVideoUrl = '';
  var _seasonLoadId = 0;
  var _episodeLoadId = 0;
  var nextEpisodeTimeout = null;
  var nextEpisodeInterval = null;
  var _keyboardHandler = null;
  var _videoElement = null;
  var _videoEndedHandler = null;
  var _videoResumeHandler = null;
  var _skipTimeUpdateHandler = null;
  var _playerPrefs = (Utils.preferences && Utils.preferences.get) ? Utils.preferences.get() : { autoplayNext: true, speed: 1, subtitles: 'off', quality: 'auto' };

  // ── Cleanup Function ──────────────────────────────────────────────────────────
  function cleanup() {
    if (currentVideoSaveInterval) {
      clearInterval(currentVideoSaveInterval);
      currentVideoSaveInterval = null;
    }
    if (nextEpisodeTimeout) {
      clearTimeout(nextEpisodeTimeout);
      nextEpisodeTimeout = null;
    }
    if (nextEpisodeInterval) {
      clearInterval(nextEpisodeInterval);
      nextEpisodeInterval = null;
    }
    if (_keyboardHandler && _videoElement) {
      document.removeEventListener('keydown', _keyboardHandler);
      _keyboardHandler = null;
    }
    if (_videoElement && _videoEndedHandler) {
      _videoElement.removeEventListener('ended', _videoEndedHandler);
      _videoEndedHandler = null;
    }
    if (_videoElement && _videoResumeHandler) {
      _videoElement.removeEventListener('loadedmetadata', _videoResumeHandler);
      _videoResumeHandler = null;
    }
    if (_videoElement && _skipTimeUpdateHandler) {
      _videoElement.removeEventListener('timeupdate', _skipTimeUpdateHandler);
      _skipTimeUpdateHandler = null;
    }
    if (Utils.cleanup) {
      Utils.cleanup();
    }
  }

  // ── Init ──────────────────────────────────────────────────────────────────────
  function init() {
    var data = scrape(document);

    // If no video URL found, bail — let the original page show
    if (!data.videoUrl) {
      return;
    }

    document.body.style.visibility = 'hidden';
    if (_playerPrefs && _playerPrefs.reducedMotion) document.body.classList.add('hg-reduced-motion');
    var shell = buildShell(data);
    document.body.appendChild(shell);
    document.body.style.visibility = 'visible';

    setupKeyboard(shell);
    setupVideoTracking(shell, data);

    if (Utils.watchHistory) {
      Utils.watchHistory.save({
        href: data.currentEpisodeHref,
        title: data.title,
        showName: data.showName,
        posterUrl: data.posterUrl,
        timestamp: Date.now()
      });
    }

    if (data.currentSeason) {
      loadSeason(data.currentSeason, shell, data.currentEpisodeHref);
    }

    // Cleanup on page unload
    window.addEventListener('beforeunload', cleanup);
  }

  // ── Scrape everything needed from the page DOM ───────────────────────────────
  function scrape(doc) {
    var data = {
      title: '',
      showName: '',
      videoUrl: '',
      posterUrl: '',
      downloadUrl: '',
      views: '',
      downloads: '',
      category: '',
      seasons: [],
      currentSeason: '',
      currentEpisodeHref: window.location.href,
      sources: []
    };

    var titleEl = doc.querySelector('.v-title');
    data.title = titleEl ? titleEl.textContent.trim() : doc.title.replace('Halla Gulla | ', '');

    var showEl = doc.querySelector('.v-category a');
    data.showName = showEl ? showEl.textContent.trim() : '';

    // Video source — try multiple selectors since Video.js embeds vary
    var srcEl = doc.querySelector('#video-player source, video source, #video-player video source');
    if (srcEl) {
      data.videoUrl = srcEl.getAttribute('src') || '';
      if (data.videoUrl) data.sources.push({ label: 'Auto', src: data.videoUrl });
    }

    // Fallback: check for src attribute directly on video element
    if (!data.videoUrl) {
      var videoEl = doc.querySelector('#video-player, video');
      if (videoEl) data.videoUrl = videoEl.getAttribute('src') || '';
    }

    // Fallback: check data-setup attribute (Video.js JSON config)
    if (!data.videoUrl) {
      var playerEl = doc.querySelector('#video-player');
      if (playerEl) {
        var dataSetup = playerEl.getAttribute('data-setup') || '';
        if (dataSetup) {
          try {
            var setup = JSON.parse(dataSetup);
            if (setup && setup.sources && setup.sources.length > 0 && setup.sources[0].src) {
              data.videoUrl = setup.sources[0].src;
              data.sources = setup.sources.map(function(s, i) {
                var src = s && s.src ? s.src : '';
                return { label: s && s.label ? s.label : ('Source ' + (i + 1)), src: src };
              }).filter(function(x) { return !!x.src; });
            }
          } catch (e) { /* not valid JSON */ }
        }
      }
    }

    // Fallback: extract from download link (always present)
    if (!data.videoUrl) {
      var dlEl = doc.querySelector('#setCounter[href], a[href*="cdnnow.co"]');
      if (dlEl) {
        var dlHref = dlEl.getAttribute('href') || '';
        if (dlHref) data.videoUrl = dlHref;
      }
    }

    // Poster
    var og = doc.querySelector('meta[property="og:image"]');
    data.posterUrl = og ? og.getAttribute('content') : '';
    if (!data.posterUrl) {
      var thumbImg = doc.querySelector('.v-category img, .thumb img');
      if (thumbImg) {
        var src = thumbImg.getAttribute('src') || '';
        if (src && src.indexOf('no-image') === -1) {
          data.posterUrl = src.startsWith('http') ? src : 'https://hallagulla.club/classic/' + src;
        }
      }
    }

    // Download link
    var dlLink = doc.querySelector('#setCounter[href], a[href*="cdnnow.co"]');
    data.downloadUrl = dlLink ? (dlLink.getAttribute('href') || '') : data.videoUrl;
    if (!data.videoUrl && data.downloadUrl) data.videoUrl = data.downloadUrl;

    // Views / downloads
    doc.querySelectorAll('.v-category2').forEach(function(el) {
      var t = el.textContent.trim();
      if (t.toLowerCase().indexOf('view') === 0) data.views = t.replace(/View\s*:\s*/i, '').trim();
      if (t.toLowerCase().indexOf('download') === 0) data.downloads = t.replace(/Download\s*:\s*/i, '').trim();
    });

    // Category breadcrumb
    var catEl = doc.querySelector('.panel-heading a[href*="cat="]');
    data.category = catEl ? catEl.textContent.trim() : '';

    // Season dropdown
    var sel = doc.querySelector('#seasons_list');
    if (sel) {
      Array.from(sel.options).forEach(function(opt) {
        data.seasons.push({ value: opt.value, label: opt.value, selected: opt.selected });
        if (opt.selected) data.currentSeason = opt.value;
      });
    }

    if (!data.currentSeason && data.showName) {
      data.currentSeason = data.showName;
      data.seasons = [{ value: data.showName, label: data.showName, selected: true }];
    }

    if ((!data.sources || data.sources.length === 0) && data.videoUrl) {
      data.sources = [{ label: 'Auto', src: data.videoUrl }];
    }

    return data;
  }

  // ── Extract video URL from fetched episode page ─────────────────────────────────
  // ── Build the full player shell using DOM methods ──────────────────────────
  function buildShell(data) {
    var wrap = document.createElement('div');
    wrap.id = 'hg-player-app';
    wrap.setAttribute('role', 'main');
    wrap.setAttribute('aria-label', 'Video Player');

    var showDisplay = data.showName
      ? data.showName.replace(/\s*[-\u2013]\s*Season\s+\d+.*/i, '').trim()
      : data.title.replace(/\s*[-\u2013]\s*Season\s+\d+.*/i, '').replace(/\s*Episode\s+\d+.*/i, '').trim();

    // ── Header
    var header = document.createElement('div');
    header.id = 'hg-header';

    var logo = document.createElement('div');
    logo.id = 'hg-logo';
    logo.textContent = 'Halla Gulla';
    header.appendChild(logo);

    var nav = document.createElement('nav');
    nav.id = 'hg-nav';
    [['Home', '/classic/home'], ['Movies', '/classic/movies'], ['TV Shows', '/classic/videos'], ['Music', '/classic/music']].forEach(function(item) {
      var a = document.createElement('a');
      a.href = item[1];
      a.textContent = item[0];
      if (item[0] === 'TV Shows') a.className = 'active';
      nav.appendChild(a);
    });
    header.appendChild(nav);

    var backLink = document.createElement('a');
    backLink.href = '/classic/videos';
    backLink.id = 'hgp-back';
    backLink.textContent = '\u2190 All Shows';
    header.appendChild(backLink);
    wrap.appendChild(header);

    // ── Layout
    var layout = document.createElement('div');
    layout.id = 'hgp-layout';

    // ── Left column
    var mainCol = document.createElement('div');
    mainCol.id = 'hgp-main';

    // Video wrap
    var videoWrap = document.createElement('div');
    videoWrap.id = 'hgp-video-wrap';

    var video = document.createElement('video');
    video.id = 'hgp-video';
    video.src = data.videoUrl;
    if (data.posterUrl) video.poster = data.posterUrl;
    video.controls = true;
    video.autoplay = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.setAttribute('aria-label', 'Episode video player');
    video.addEventListener('contextmenu', function(e) { e.preventDefault(); });
    videoWrap.appendChild(video);
    _videoElement = video;

    // PIP button
    if (Utils.supportsPIP && Utils.supportsPIP()) {
      var pipBtn = document.createElement('button');
      pipBtn.id = 'hgp-pip-btn';
      pipBtn.title = 'Picture-in-Picture (P)';
      pipBtn.setAttribute('aria-label', 'Toggle Picture-in-Picture');
      pipBtn.textContent = 'PiP';
      pipBtn.addEventListener('click', function() {
        if (Utils.togglePIP) Utils.togglePIP(video).catch(function() {});
      });
      videoWrap.appendChild(pipBtn);
    }

    var skipWrap = document.createElement('div');
    skipWrap.id = 'hgp-skip-wrap';
    var skipIntroBtn = document.createElement('button');
    skipIntroBtn.id = 'hgp-skip-intro-btn';
    skipIntroBtn.textContent = 'Skip Intro';
    skipIntroBtn.setAttribute('aria-label', 'Skip intro');
    skipIntroBtn.style.display = 'none';
    skipWrap.appendChild(skipIntroBtn);
    var skipRecapBtn = document.createElement('button');
    skipRecapBtn.id = 'hgp-skip-recap-btn';
    skipRecapBtn.textContent = 'Skip Recap';
    skipRecapBtn.setAttribute('aria-label', 'Skip recap');
    skipRecapBtn.style.display = 'none';
    skipWrap.appendChild(skipRecapBtn);
    videoWrap.appendChild(skipWrap);

    // Loading overlay
    var loadingOverlay = document.createElement('div');
    loadingOverlay.id = 'hgp-loading-overlay';
    loadingOverlay.style.display = 'none';
    loadingOverlay.setAttribute('role', 'status');
    loadingOverlay.setAttribute('aria-live', 'polite');
    loadingOverlay.setAttribute('aria-atomic', 'true');
    var loadingSpinner = document.createElement('div');
    loadingSpinner.className = 'hg-spinner';
    loadingOverlay.appendChild(loadingSpinner);
    var loadingText = document.createElement('span');
    loadingText.textContent = 'Loading video...';
    loadingOverlay.appendChild(loadingText);
    videoWrap.appendChild(loadingOverlay);

    mainCol.appendChild(videoWrap);

    // Info bar
    var infoBar = document.createElement('div');
    infoBar.id = 'hgp-info';

    var infoLeft = document.createElement('div');
    infoLeft.id = 'hgp-info-left';

    if (data.category) {
      var catDiv = document.createElement('div');
      catDiv.id = 'hgp-category';
      catDiv.textContent = data.category;
      infoLeft.appendChild(catDiv);
    }

    var titleEl = document.createElement('h1');
    titleEl.id = 'hgp-title';
    titleEl.textContent = data.title;
    infoLeft.appendChild(titleEl);

    var showNameEl = document.createElement('div');
    showNameEl.id = 'hgp-show-name';
    showNameEl.textContent = showDisplay;
    infoLeft.appendChild(showNameEl);

    var statsEl = document.createElement('div');
    statsEl.id = 'hgp-stats';
    if (data.views) {
      var vSpan = document.createElement('span');
      vSpan.textContent = '\uD83D\uDC41 ' + data.views + ' views';
      statsEl.appendChild(vSpan);
    }
    if (data.downloads) {
      var dSpan = document.createElement('span');
      dSpan.textContent = '\u2B07 ' + data.downloads + ' downloads';
      statsEl.appendChild(dSpan);
    }
    infoLeft.appendChild(statsEl);
    var controlBar = document.createElement('div');
    controlBar.id = 'hgp-control-bar';
    controlBar.innerHTML = '<label>Speed <select id="hgp-speed"><option value="0.75">0.75x</option><option value="1">1x</option><option value="1.25">1.25x</option><option value="1.5">1.5x</option><option value="2">2x</option></select></label><label>Subtitles <select id="hgp-subtitles"><option value="off">Off</option></select></label><label>Quality <select id="hgp-quality"><option value="auto">Auto</option></select></label><label class=\"hgp-auto-next\"><input type=\"checkbox\" id=\"hgp-autonext\"> Auto next</label>';
    infoLeft.appendChild(controlBar);
    var speedEl = controlBar.querySelector('#hgp-speed');
    var subtitlesEl = controlBar.querySelector('#hgp-subtitles');
    var qualityEl = controlBar.querySelector('#hgp-quality');
    var autoNextEl = controlBar.querySelector('#hgp-autonext');
    if (speedEl) speedEl.setAttribute('aria-label', 'Playback speed');
    if (subtitlesEl) subtitlesEl.setAttribute('aria-label', 'Subtitles');
    if (qualityEl) qualityEl.setAttribute('aria-label', 'Video quality');
    if (autoNextEl) autoNextEl.setAttribute('aria-label', 'Auto play next episode');
    infoBar.appendChild(infoLeft);

    if (data.downloadUrl) {
      var dlBtn = document.createElement('a');
      dlBtn.href = data.downloadUrl;
      dlBtn.target = '_blank';
      dlBtn.id = 'hgp-dl-btn';
      dlBtn.textContent = '\u2B07 Download';
      infoBar.appendChild(dlBtn);
    }

    // Next Episode button (will be shown/hidden dynamically)
    var nextBtn = document.createElement('button');
    nextBtn.id = 'hgp-next-ep-btn';
    nextBtn.textContent = 'Next Episode \u2192';
    nextBtn.style.display = 'none';
    nextBtn.addEventListener('click', function() {
      cancelNextEpisode();
      var episodes = shell.querySelectorAll('.hgp-ep-item');
      var currentIdx = -1;
      episodes.forEach(function(ep, i) {
        if (ep.classList.contains('hgp-ep-current')) currentIdx = i;
      });
      if (currentIdx >= 0 && currentIdx < episodes.length - 1) {
        var nextRow = episodes[currentIdx + 1];
        if (nextRow) nextRow.click();
      }
    });
    infoLeft.appendChild(nextBtn);

    mainCol.appendChild(infoBar);
    layout.appendChild(mainCol);

    // ── Right sidebar
    var sidebar = document.createElement('div');
    sidebar.id = 'hgp-sidebar';
    sidebar.setAttribute('role', 'complementary');
    sidebar.setAttribute('aria-label', 'Episode navigation');

    var sidebarHead = document.createElement('div');
    sidebarHead.id = 'hgp-sidebar-head';

    var sidebarShow = document.createElement('div');
    sidebarShow.id = 'hgp-sidebar-show';
    sidebarShow.textContent = showDisplay;
    sidebarHead.appendChild(sidebarShow);

    var epCount = document.createElement('div');
    epCount.id = 'hgp-ep-count';
    epCount.textContent = 'Loading episodes...';
    sidebarHead.appendChild(epCount);

    // Season tabs
    if (data.seasons.length > 0) {
      var seasonTabsDiv = document.createElement('div');
      seasonTabsDiv.id = 'hgp-season-tabs';
      data.seasons.forEach(function(s) {
        var sm = s.label.match(/Season\s+(\d+)/i);
        var tab = document.createElement('button');
        tab.className = 'hgp-season-tab' + (s.selected ? ' active' : '');
        tab.dataset.season = s.value;
        tab.textContent = sm ? 'S' + parseInt(sm[1]) : s.label;
        tab.addEventListener('click', function() {
          seasonTabsDiv.querySelectorAll('.hgp-season-tab').forEach(function(t) { t.classList.remove('active'); });
          this.classList.add('active');
          loadSeason(this.dataset.season, wrap, null);
        });
        seasonTabsDiv.appendChild(tab);
      });
      sidebarHead.appendChild(seasonTabsDiv);
    }

    sidebar.appendChild(sidebarHead);

    // Episodes list
    var episodesList = document.createElement('div');
    episodesList.id = 'hgp-episodes-list';
    episodesList.setAttribute('role', 'list');
    episodesList.setAttribute('aria-label', 'Episodes list');

    var epsLoading = document.createElement('div');
    epsLoading.id = 'hgp-eps-loading';
    var epsSpinner = document.createElement('div');
    epsSpinner.className = 'hg-spinner';
    epsLoading.appendChild(epsSpinner);
    episodesList.appendChild(epsLoading);

    sidebar.appendChild(episodesList);
    layout.appendChild(sidebar);
    wrap.appendChild(layout);

    setupPlayerControls(wrap, data);
    setupSkipMarkers(wrap, data);

    return wrap;
  }

  function setupPlayerControls(shell, data) {
    var video = shell.querySelector('#hgp-video');
    if (!video) return;
    var speedSel = shell.querySelector('#hgp-speed');
    var subSel = shell.querySelector('#hgp-subtitles');
    var qualitySel = shell.querySelector('#hgp-quality');
    var autoNext = shell.querySelector('#hgp-autonext');

    if (speedSel) {
      speedSel.value = String(_playerPrefs.speed || 1);
      video.playbackRate = parseFloat(speedSel.value) || 1;
      speedSel.addEventListener('change', function() {
        var v = parseFloat(speedSel.value) || 1;
        video.playbackRate = v;
        _playerPrefs = Utils.preferences && Utils.preferences.set ? Utils.preferences.set({ speed: v }) : _playerPrefs;
      });
    }

    if (autoNext) {
      autoNext.checked = _playerPrefs.autoplayNext !== false;
      autoNext.addEventListener('change', function() {
        _playerPrefs = Utils.preferences && Utils.preferences.set ? Utils.preferences.set({ autoplayNext: !!autoNext.checked }) : _playerPrefs;
      });
    }

    if (qualitySel) {
      qualitySel.textContent = '';
      var autoOpt = document.createElement('option');
      autoOpt.value = 'auto';
      autoOpt.textContent = 'Auto';
      qualitySel.appendChild(autoOpt);
      var sources = Array.isArray(data.sources) ? data.sources : [];
      var seen = {};
      sources.forEach(function(s, i) {
        var src = s && s.src ? s.src : '';
        if (!src || seen[src]) return;
        seen[src] = true;
        var o = document.createElement('option');
        o.value = src;
        o.textContent = s.label || ('Source ' + (i + 1));
        qualitySel.appendChild(o);
      });
      qualitySel.disabled = qualitySel.options.length <= 1;
      qualitySel.value = (_playerPrefs.quality && (_playerPrefs.quality === 'auto' || seen[_playerPrefs.quality])) ? _playerPrefs.quality : 'auto';
      qualitySel.addEventListener('change', function() {
        var selected = qualitySel.value;
        _playerPrefs = Utils.preferences && Utils.preferences.set ? Utils.preferences.set({ quality: selected }) : _playerPrefs;
        if (selected === 'auto' || selected === video.currentSrc) return;
        var t = video.currentTime || 0;
        video.src = selected;
        video.load();
        video.addEventListener('loadedmetadata', function() {
          video.currentTime = Math.max(0, t - 0.5);
          video.play().catch(function() {});
        }, { once: true });
      });
    }

    if (subSel) {
      var rebuildSubtitles = function() {
        subSel.textContent = '';
        var off = document.createElement('option');
        off.value = 'off';
        off.textContent = 'Off';
        subSel.appendChild(off);
        var tracks = video.textTracks || [];
        for (var i = 0; i < tracks.length; i++) {
          var tr = tracks[i];
          var o = document.createElement('option');
          o.value = String(i);
          o.textContent = tr.label || tr.language || ('Track ' + (i + 1));
          subSel.appendChild(o);
        }
        subSel.disabled = subSel.options.length <= 1;
        subSel.value = _playerPrefs.subtitles || 'off';
      };
      rebuildSubtitles();
      video.addEventListener('loadedmetadata', rebuildSubtitles);
      subSel.addEventListener('change', function() {
        var val = subSel.value;
        var tracks = video.textTracks || [];
        for (var i = 0; i < tracks.length; i++) tracks[i].mode = 'disabled';
        if (val !== 'off' && tracks[parseInt(val, 10)]) tracks[parseInt(val, 10)].mode = 'showing';
        _playerPrefs = Utils.preferences && Utils.preferences.set ? Utils.preferences.set({ subtitles: val }) : _playerPrefs;
      });
    }
  }

  function getSkipMarkers(data) {
    var defaults = { recapEnd: 40, introEnd: 90 };
    if (!data || !data.showName) return defaults;
    var name = String(data.showName || '').toLowerCase();
    if (name.indexOf('talk') !== -1 || name.indexOf('reality') !== -1) return { recapEnd: 25, introEnd: 55 };
    return defaults;
  }

  function setupSkipMarkers(shell, data) {
    var video = shell.querySelector('#hgp-video');
    if (!video) return;
    var introBtn = shell.querySelector('#hgp-skip-intro-btn');
    var recapBtn = shell.querySelector('#hgp-skip-recap-btn');
    var markers = getSkipMarkers(data);

    function refreshSkipButtons() {
      if (!introBtn || !recapBtn) return;
      var t = video.currentTime || 0;
      recapBtn.style.display = t < markers.recapEnd ? '' : 'none';
      introBtn.style.display = (t >= markers.recapEnd && t < markers.introEnd) ? '' : 'none';
    }

    if (recapBtn) recapBtn.addEventListener('click', function() { video.currentTime = markers.recapEnd; });
    if (introBtn) introBtn.addEventListener('click', function() { video.currentTime = markers.introEnd; });
    if (_skipTimeUpdateHandler) video.removeEventListener('timeupdate', _skipTimeUpdateHandler);
    _skipTimeUpdateHandler = refreshSkipButtons;
    video.addEventListener('timeupdate', _skipTimeUpdateHandler);
    refreshSkipButtons();
  }

  // ── Keyboard shortcuts ──────────────────────────────────────────────────────
  function setupKeyboard(shell) {
    if (!Utils.setupKeyboard) return;
    var video = shell.querySelector('#hgp-video');

    _keyboardHandler = function(e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      switch (e.key) {
        case ' ':
          if (video) { e.preventDefault(); if (video.paused) video.play(); else video.pause(); }
          break;
        case 'ArrowRight':
          if (video) video.currentTime = Math.min(video.currentTime + 10, video.duration || 0);
          break;
        case 'ArrowLeft':
          if (video) video.currentTime = Math.max(video.currentTime - 10, 0);
          break;
        case 'ArrowUp':
          if (video) video.volume = Math.min(video.volume + 0.1, 1);
          break;
        case 'ArrowDown':
          if (video) video.volume = Math.max(video.volume - 0.1, 0);
          break;
        case 'f':
          if (video) {
            e.preventDefault();
            if (document.fullscreenElement) document.exitFullscreen();
            else video.requestFullscreen();
          }
          break;
        case 'p':
          if (Utils.supportsPIP && Utils.supportsPIP() && video) {
            e.preventDefault();
            Utils.togglePIP(video).catch(function() {});
          }
          break;
        case 'c':
          var subSel = shell.querySelector('#hgp-subtitles');
          if (subSel && subSel.options.length > 1) {
            e.preventDefault();
            var nextIdx = (subSel.selectedIndex + 1) % subSel.options.length;
            subSel.selectedIndex = nextIdx;
            subSel.dispatchEvent(new Event('change', { bubbles: true }));
          }
          break;
        case 'Escape':
          window.location.href = '/classic/videos';
          break;
      }
    };

    document.addEventListener('keydown', _keyboardHandler);
  }

  // ── Video progress tracking ─────────────────────────────────────────────────
  function setupVideoTracking(shell, data) {
    if (!Utils.videoProgress) return;
    var video = shell.querySelector('#hgp-video');
    if (!video) return;

    _activeVideoUrl = data.videoUrl;

    var savedData = Utils.videoProgress.get(data.videoUrl);
    var savedTime = 0;
    if (typeof savedData === 'object' && savedData !== null) {
      savedTime = savedData.currentTime || 0;
    } else {
      savedTime = typeof savedData === 'number' ? savedData : 0;
    }
    if (_videoResumeHandler) {
      video.removeEventListener('loadedmetadata', _videoResumeHandler);
      _videoResumeHandler = null;
    }
    if (savedTime > 0) {
      _videoResumeHandler = function() {
        if (savedTime < video.duration - 30) {
          video.currentTime = savedTime;
          showResumeNotification(shell, savedTime);
        }
      };
      video.addEventListener('loadedmetadata', _videoResumeHandler, { once: true });
    }

    if (currentVideoSaveInterval) clearInterval(currentVideoSaveInterval);
    currentVideoSaveInterval = setInterval(function() {
      if (video.paused || video.ended) return;
      Utils.videoProgress.save(data.videoUrl, video.currentTime, video.duration);
    }, 10000);

    if (_videoEndedHandler) {
      video.removeEventListener('ended', _videoEndedHandler);
      _videoEndedHandler = null;
    }
    _videoEndedHandler = function() {
      if (currentVideoSaveInterval) {
        clearInterval(currentVideoSaveInterval);
        currentVideoSaveInterval = null;
      }
      Utils.videoProgress.clear(data.videoUrl);
      if (_playerPrefs.autoplayNext !== false) showNextEpisodeToast(shell);
    };
    video.addEventListener('ended', _videoEndedHandler, { once: true });

    window.addEventListener('beforeunload', function() {
      if (currentVideoSaveInterval) {
        clearInterval(currentVideoSaveInterval);
        var v = document.querySelector('#hgp-video');
        if (v && v.currentTime > 0 && v.duration && _activeVideoUrl) {
          Utils.videoProgress.save(_activeVideoUrl, v.currentTime, v.duration);
        }
      }
    });
  }

  // ── Auto-advance to next episode ────────────────────────────────────────────
  function showNextEpisodeToast(shell) {
    var episodes = shell.querySelectorAll('.hgp-ep-item');
    var currentIdx = -1;
    episodes.forEach(function(ep, i) {
      if (ep.classList.contains('hgp-ep-current')) currentIdx = i;
    });

    if (currentIdx < 0 || currentIdx >= episodes.length - 1) return;

    var nextRow = episodes[currentIdx + 1];
    if (!nextRow) return;

    var nextTitle = nextRow.querySelector('.hgp-ep-title');
    var nextThumb = nextRow.querySelector('.hgp-ep-thumb img');
    var nextHref = nextRow.dataset.href || '';

    // Remove any existing toast
    var existing = shell.querySelector('.hgp-next-toast');
    if (existing) existing.remove();

    var videoWrap = shell.querySelector('#hgp-video-wrap');
    if (!videoWrap) return;

    var toast = document.createElement('div');
    toast.className = 'hgp-next-toast';

    var thumbDiv = document.createElement('div');
    thumbDiv.className = 'hgp-next-toast-thumb';
    if (nextThumb) {
      var img = document.createElement('img');
      img.src = nextThumb.src;
      img.alt = '';
      thumbDiv.appendChild(img);
    }
    toast.appendChild(thumbDiv);

    var info = document.createElement('div');
    info.className = 'hgp-next-toast-info';

    var label = document.createElement('div');
    label.className = 'hgp-next-toast-label';
    label.textContent = 'NEXT EPISODE';
    info.appendChild(label);

    var title = document.createElement('div');
    title.className = 'hgp-next-toast-title';
    title.textContent = nextTitle ? nextTitle.textContent : 'Next Episode';
    info.appendChild(title);

    var countdown = document.createElement('div');
    countdown.className = 'hgp-next-toast-countdown';
    countdown.textContent = 'Playing in 5s...';
    info.appendChild(countdown);

    toast.appendChild(info);

    var actions = document.createElement('div');
    actions.className = 'hgp-next-toast-actions';

    var playBtn = document.createElement('button');
    playBtn.className = 'hgp-next-toast-play';
    playBtn.textContent = 'Play Now';
    playBtn.addEventListener('click', function() {
      cancelNextEpisode();
      nextRow.click();
    });
    actions.appendChild(playBtn);

    var cancelBtn = document.createElement('button');
    cancelBtn.className = 'hgp-next-toast-cancel';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', function() {
      cancelNextEpisode();
    });
    actions.appendChild(cancelBtn);

    toast.appendChild(actions);
    videoWrap.appendChild(toast);

    // Countdown
    var secondsLeft = 5;
    nextEpisodeInterval = setInterval(function() {
      secondsLeft--;
      if (countdown.parentNode) {
        countdown.textContent = 'Playing in ' + secondsLeft + 's...';
      }
    }, 1000);

    nextEpisodeTimeout = setTimeout(function() {
      nextRow.click();
    }, 5000);
  }

  function cancelNextEpisode() {
    if (nextEpisodeTimeout) { clearTimeout(nextEpisodeTimeout); nextEpisodeTimeout = null; }
    if (nextEpisodeInterval) { clearInterval(nextEpisodeInterval); nextEpisodeInterval = null; }
    var toast = document.querySelector('.hgp-next-toast');
    if (toast) toast.remove();
  }

  // ── Resume notification ─────────────────────────────────────────────────────
  function showResumeNotification(shell, time) {
    var wrap = shell.querySelector('#hgp-video-wrap');
    if (!wrap) return;

    var notification = document.createElement('div');
    notification.className = 'hgp-resume-notification';

    var timeStr = Utils.formatDuration ? Utils.formatDuration(time) : Math.floor(time / 60) + ':' + String(Math.floor(time % 60)).padStart(2, '0');

    var span = document.createElement('span');
    span.textContent = 'Resumed from ' + timeStr;
    notification.appendChild(span);

    var btn = document.createElement('button');
    btn.textContent = 'Restart';
    btn.addEventListener('click', function() {
      var video = shell.querySelector('#hgp-video');
      if (video) video.currentTime = 0;
      notification.remove();
    });
    notification.appendChild(btn);

    wrap.appendChild(notification);
    setTimeout(function() { notification.remove(); }, 5000);
  }

  // ── Load all episodes for a season via AJAX ─────────────────────────────────
  function loadSeason(seasonName, shell, currentHref) {
    var myLoadId = ++_seasonLoadId;

    var list = shell.querySelector('#hgp-episodes-list');
    list.textContent = '';
    var loading = document.createElement('div');
    loading.id = 'hgp-eps-loading';
    var sp = document.createElement('div');
    sp.className = 'hg-spinner';
    loading.appendChild(sp);
    list.appendChild(loading);

    var url = 'https://hallagulla.club/classic/includes/ajax.php?albumName=' +
      encodeURIComponent(seasonName) + '&req=videos';

    fetch(url, { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } })
      .then(function(res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.text();
      })
      .then(function(html) {
        // Race condition check: ignore stale responses
        if (myLoadId !== _seasonLoadId) return;

        var tempDoc = new DOMParser().parseFromString('<div>' + html + '</div>', 'text/html');
        var items = tempDoc.querySelectorAll('.thumb, .col-item');

        if (items.length === 0) {
          list.textContent = '';
          var noEps = document.createElement('div');
          noEps.className = 'hgp-no-eps';
          noEps.textContent = 'No episodes found.';
          list.appendChild(noEps);
          return;
        }

        var episodes = [];
        items.forEach(function(item) {
          var parentLink = item.parentElement && item.parentElement.tagName === 'A' ? item.parentElement : null;
          var innerLink = item.querySelector('a[href*="videopreview"]');
          var link = parentLink || innerLink;
          if (!link) return;

          var href = link.getAttribute('href') || '';
          var titleEl = item.querySelector('h6');
          var imgEl = item.querySelector('img');
          var infoEls = item.querySelectorAll('.infohd');

          var title = titleEl ? titleEl.textContent.trim() : '';
          var poster = imgEl ? (imgEl.getAttribute('src') || '') : '';
          if (poster.indexOf('no-image') !== -1) poster = '';

          var posterUrl = poster
            ? (poster.startsWith('http') ? poster : 'https://hallagulla.club/classic/' + poster)
            : '';

          var views = '', date = '';
          infoEls.forEach(function(el) {
            var t = el.textContent.trim();
            if (t.match(/^View/i)) views = t.replace(/View\s*:\s*/, '').trim();
            if (t.match(/^AD/i)) date = t.replace('AD:', '').trim();
          });

          var em = title.match(/Episode\s+(\d+)/i);
          var epNum = em ? parseInt(em[1], 10) : 0;
          var epLabel = em ? 'E' + String(epNum).padStart(2, '0') : '';
          var isCurrent = href === currentHref ||
            (currentHref && currentHref.indexOf(href.replace('.html', '')) !== -1);

          episodes.push({ href: href, title: title, posterUrl: posterUrl, views: views, date: date, epNum: epNum, epLabel: epLabel, isCurrent: isCurrent });
        });

        episodes.sort(function(a, b) { return a.epNum - b.epNum; });
        renderEpisodes(episodes, list, shell, currentHref);
      })
      .catch(function(err) {
        // Race condition check: ignore stale error responses
        if (myLoadId !== _seasonLoadId) return;
        console.error('HGP: failed to load season', seasonName, err);
        list.textContent = '';
        var noEps = document.createElement('div');
        noEps.className = 'hgp-no-eps';
        noEps.textContent = 'Failed to load episodes. Please try again.';

        // Add retry button
        var retryBtn = document.createElement('button');
        retryBtn.textContent = 'Retry';
        retryBtn.style.cssText = 'margin-left:8px;color:#00FFD1;cursor:pointer;';
        retryBtn.addEventListener('click', function() {
          loadSeason(seasonName, shell, currentHref);
        });
        noEps.appendChild(retryBtn);
        list.appendChild(noEps);
      });
  }

  // ── Render episode rows ─────────────────────────────────────────────────────
  function renderEpisodes(episodes, list, shell, currentHref) {
    list.textContent = '';

    // Find the index of the current episode
    var currentIdx = -1;
    episodes.forEach(function(ep, i) {
      if (ep.isCurrent) currentIdx = i;
    });

    episodes.forEach(function(ep, i) {
      var url = ep.href.startsWith('http') ? ep.href : 'https://hallagulla.club/classic/' + ep.href;

      var row = document.createElement('div');
      row.className = 'hgp-ep-item' + (ep.isCurrent ? ' hgp-ep-current' : '');
      // Mark next episode as UP NEXT
      if (currentIdx >= 0 && i === currentIdx + 1) {
        row.className += ' hgp-ep-upnext';
      }
      row.dataset.href = url;
      row.setAttribute('role', 'listitem');
      row.setAttribute('tabindex', '0');
      row.setAttribute('aria-current', ep.isCurrent ? 'true' : 'false');
      row.setAttribute('aria-label', ep.title);

      var numDiv = document.createElement('div');
      numDiv.className = 'hgp-ep-num';
      numDiv.textContent = ep.epNum || '?';
      row.appendChild(numDiv);

      var thumbDiv = document.createElement('div');
      thumbDiv.className = 'hgp-ep-thumb';

      // UP NEXT badge
      if (currentIdx >= 0 && i === currentIdx + 1) {
        var badge = document.createElement('div');
        badge.className = 'hgp-ep-upnext-badge';
        badge.textContent = 'UP NEXT';
        thumbDiv.appendChild(badge);
      }

      // Play icon overlay
      var playOverlay = document.createElement('div');
      playOverlay.className = 'hgp-ep-thumb-play';
      var playIcon = document.createElement('div');
      playIcon.className = 'hgp-ep-thumb-play-icon';
      playIcon.textContent = '\u25B6';
      playOverlay.appendChild(playIcon);
      thumbDiv.appendChild(playOverlay);

      if (ep.posterUrl) {
        var thumbImg = document.createElement('img');
        thumbImg.src = ep.posterUrl;
        thumbImg.alt = '';
        thumbImg.loading = 'lazy';
        thumbDiv.appendChild(thumbImg);
      } else {
        var thumbBlank = document.createElement('div');
        thumbBlank.className = 'hgp-ep-thumb-blank';
        var thumbSpan = document.createElement('span');
        thumbSpan.textContent = ep.epNum || '?';
        thumbBlank.appendChild(thumbSpan);
        thumbDiv.appendChild(thumbBlank);
      }

      // Watch progress bar on thumbnail
      if (Utils.videoProgress && url) {
        var progressData = Utils.videoProgress.get(url);
        var progressTime = 0;
        var progressDuration = 0;
        if (typeof progressData === 'object' && progressData !== null) {
          progressTime = progressData.currentTime || 0;
          progressDuration = progressData.duration || 0;
        } else {
          progressTime = typeof progressData === 'number' ? progressData : 0;
        }
        if (progressTime > 0) {
          var progressDiv = document.createElement('div');
          progressDiv.className = 'hgp-ep-progress';
          var progressBar = document.createElement('div');
          progressBar.className = 'hgp-ep-progress-bar';
          var pct = progressDuration > 0 ? (progressTime / progressDuration) * 100 : Math.min((progressTime / 1800) * 100, 95);
          progressBar.style.width = Math.min(pct, 95) + '%';
          progressDiv.appendChild(progressBar);
          thumbDiv.appendChild(progressDiv);
        }
      }

      row.appendChild(thumbDiv);

      var infoDiv = document.createElement('div');
      infoDiv.className = 'hgp-ep-info';

      var titleDiv = document.createElement('div');
      titleDiv.className = 'hgp-ep-title';
      titleDiv.textContent = ep.title;
      infoDiv.appendChild(titleDiv);

      var metaDiv = document.createElement('div');
      metaDiv.className = 'hgp-ep-meta';
      if (ep.epLabel) {
        var codeSpan = document.createElement('span');
        codeSpan.className = 'hgp-ep-code';
        codeSpan.textContent = ep.epLabel;
        metaDiv.appendChild(codeSpan);
      }
      if (ep.views) {
        var viewsSpan = document.createElement('span');
        viewsSpan.textContent = ep.views + ' views';
        metaDiv.appendChild(viewsSpan);
      }
      if (ep.date) {
        var dateSpan = document.createElement('span');
        dateSpan.textContent = ep.date;
        metaDiv.appendChild(dateSpan);
      }
      infoDiv.appendChild(metaDiv);
      row.appendChild(infoDiv);

      var arrow = document.createElement('div');
      arrow.className = 'hgp-ep-arrow';
      arrow.textContent = '\u25B6';
      row.appendChild(arrow);

      row.addEventListener('click', function() { playEpisode(ep, row, shell); });
      row.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); playEpisode(ep, row, shell); }
      });

      list.appendChild(row);
    });

    // Update episode count in sidebar
    var epCountEl = shell.querySelector('#hgp-ep-count');
    if (epCountEl) {
      epCountEl.textContent = episodes.length + ' episode' + (episodes.length !== 1 ? 's' : '');
    }

    // Show/hide "Next Episode" button based on whether there's a next episode
    var nextBtn = shell.querySelector('#hgp-next-ep-btn');
    if (nextBtn) {
      var currentIdx = -1;
      episodes.forEach(function(ep, i) { if (ep.isCurrent) currentIdx = i; });
      nextBtn.style.display = (currentIdx >= 0 && currentIdx < episodes.length - 1) ? '' : 'none';
    }

    var currentRow = list.querySelector('.hgp-ep-current');
    if (currentRow) {
      setTimeout(function() { currentRow.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 200);
    }
  }

  // ── Play episode — swap video source ──────────────────────────────────────
  function playEpisode(ep, row, shell) {
    if (isPlayingEpisode) return;
    isPlayingEpisode = true;

    // Cancel any pending next-episode toast
    cancelNextEpisode();

    // Highlight row
    shell.querySelectorAll('.hgp-ep-item').forEach(function(r) {
      r.classList.remove('hgp-ep-current');
      r.setAttribute('aria-current', 'false');
    });
    if (row) {
      row.classList.add('hgp-ep-current');
      row.setAttribute('aria-current', 'true');
    }

    var url = ep.href.startsWith('http') ? ep.href : 'https://hallagulla.club/classic/' + ep.href;

    // Show loading overlay
    var overlay = shell.querySelector('#hgp-loading-overlay');
    if (overlay) {
      overlay.textContent = '';
      var sp = document.createElement('div');
      sp.className = 'hg-spinner';
      overlay.appendChild(sp);
      var txt = document.createElement('span');
      txt.textContent = 'Loading episode...';
      overlay.appendChild(txt);
      overlay.style.display = 'flex';
    }

    // Use retry logic for more robust fetching
    Utils.fetchWithRetry ? Utils.fetchWithRetry(url, { credentials: 'same-origin' }, 3) :
      fetch(url, { credentials: 'same-origin' })
      .then(function(res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.text();
      })
      .then(function(html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var videoUrl = HGShared.extractVideoUrl(doc);

        var og = doc.querySelector('meta[property="og:image"]');
        var poster = og ? og.getAttribute('content') : '';
        var titleEl = doc.querySelector('.v-title');
        var newTitle = titleEl ? titleEl.textContent.trim() : ep.title;
        var showEl = doc.querySelector('.v-category a');
        var showName = showEl ? showEl.textContent.trim() : '';

        var vcats = doc.querySelectorAll('.v-category2');
        var views = '', downloads = '';
        vcats.forEach(function(el) {
          var t = el.textContent.trim();
          if (t.toLowerCase().indexOf('view') === 0) views = t.replace(/View\s*:\s*/i, '').trim();
          if (t.toLowerCase().indexOf('download') === 0) downloads = t.replace(/Download\s*:\s*/i, '').trim();
        });

        var dlEl = doc.querySelector('#setCounter[href], a[href*="cdnnow.co"]');
        var dlUrl = dlEl ? (dlEl.getAttribute('href') || videoUrl) : videoUrl;

        if (overlay) overlay.style.display = 'none';

        if (!videoUrl) {
          // Show error with download link fallback
          if (overlay) {
            overlay.textContent = '';
            var errSpan = document.createElement('span');
            errSpan.textContent = 'Video not available for streaming';
            overlay.appendChild(errSpan);
            if (dlUrl) {
              var dlLink = document.createElement('a');
              dlLink.href = dlUrl;
              dlLink.target = '_blank';
              dlLink.style.cssText = 'color:#00FFD1;margin-left:12px;text-decoration:underline;';
              dlLink.textContent = 'Download instead';
              overlay.appendChild(dlLink);
            }
            overlay.style.display = 'flex';
          }
          isPlayingEpisode = false;
          return;
        }

        // Swap video — fully stop old stream first
        var video = shell.querySelector('#hgp-video');
        if (video) {
          video.pause();
          video.removeAttribute('src');
          video.load();

          // Clear previous tracking interval
          if (currentVideoSaveInterval) {
            clearInterval(currentVideoSaveInterval);
            currentVideoSaveInterval = null;
          }

          video.src = videoUrl;
          if (poster) video.poster = poster;
          video.load();
          var playPromise = video.play();
          if (playPromise && playPromise.catch) {
            playPromise.catch(function() { /* autoplay blocked */ });
          }
          setupVideoTrackingForUrl(shell, video, videoUrl);
        }

        // Update title
        var titleDisplay = shell.querySelector('#hgp-title');
        if (titleDisplay) titleDisplay.textContent = newTitle;

        // Update show name
        var showDisplay = shell.querySelector('#hgp-show-name');
        var displayShow = showName ? showName.replace(/\s*[-\u2013]\s*Season\s+\d+.*/i, '').trim() : '';
        if (showDisplay && displayShow) showDisplay.textContent = displayShow;

        // Update stats
        var statsEl = shell.querySelector('#hgp-stats');
        if (statsEl) {
          statsEl.textContent = '';
          if (views) { var vs = document.createElement('span'); vs.textContent = '\uD83D\uDC41 ' + views + ' views'; statsEl.appendChild(vs); }
          if (downloads) { var ds = document.createElement('span'); ds.textContent = '\u2B07 ' + downloads + ' downloads'; statsEl.appendChild(ds); }
        }

        // Update download button
        var dlBtn = shell.querySelector('#hgp-dl-btn');
        if (dlBtn) {
          if (dlUrl) { dlBtn.href = dlUrl; dlBtn.style.display = ''; }
          else { dlBtn.style.display = 'none'; }
        }

        // Save to watch history
        if (Utils.watchHistory) {
          Utils.watchHistory.save({
            href: url,
            title: newTitle,
            showName: displayShow || showName,
            posterUrl: poster || '',
            timestamp: Date.now(),
          });
        }

        // Update browser URL (replaceState avoids stacking history entries for each episode switch)
        history.replaceState({}, newTitle, url);
        isPlayingEpisode = false;
      })
      .catch(function(err) {
        console.error('HGP: failed to load episode', err);
        if (overlay) {
          overlay.textContent = '';
          var errSpan = document.createElement('span');
          errSpan.textContent = 'Failed to load episode';
          overlay.appendChild(errSpan);
          var retryLink = document.createElement('a');
          retryLink.href = url;
          retryLink.style.cssText = 'color:#00FFD1;margin-left:12px;';
          retryLink.textContent = 'Open directly';
          overlay.appendChild(retryLink);
          overlay.style.display = 'flex';
        }
        isPlayingEpisode = false;
      });
  }

  // ── Setup video tracking for a specific URL (called on episode switch) ─────
  function setupVideoTrackingForUrl(shell, video, videoUrl) {
    if (!Utils.videoProgress) return;

    _activeVideoUrl = videoUrl;

    if (currentVideoSaveInterval) clearInterval(currentVideoSaveInterval);

    var savedData = Utils.videoProgress.get(videoUrl);
    var savedTime = 0;
    if (typeof savedData === 'object' && savedData !== null) {
      savedTime = savedData.currentTime || 0;
    } else {
      savedTime = typeof savedData === 'number' ? savedData : 0;
    }
    if (_videoResumeHandler) {
      video.removeEventListener('loadedmetadata', _videoResumeHandler);
      _videoResumeHandler = null;
    }
    if (savedTime > 0) {
      _videoResumeHandler = function() {
        if (savedTime < video.duration - 30) {
          video.currentTime = savedTime;
          showResumeNotification(shell, savedTime);
        }
      };
      video.addEventListener('loadedmetadata', _videoResumeHandler, { once: true });
    }

    currentVideoSaveInterval = setInterval(function() {
      if (video.paused || video.ended) return;
      Utils.videoProgress.save(videoUrl, video.currentTime, video.duration);
    }, 10000);

    if (_videoEndedHandler) {
      video.removeEventListener('ended', _videoEndedHandler);
      _videoEndedHandler = null;
    }
    _videoEndedHandler = function() {
      if (currentVideoSaveInterval) {
        clearInterval(currentVideoSaveInterval);
        currentVideoSaveInterval = null;
      }
      Utils.videoProgress.clear(videoUrl);
      if (_playerPrefs.autoplayNext !== false) showNextEpisodeToast(shell);
    };
    video.addEventListener('ended', _videoEndedHandler, { once: true });
  }

  // ── Inject & boot ────────────────────────────────────────────────────────────
  var s = document.createElement('style');
  s.textContent = 'body>*:not(#hg-player-app){display:none!important}body{background:#000!important;margin:0!important;padding:0!important}';
  document.head.appendChild(s);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
