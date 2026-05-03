// ─── Halla Gulla — Unified Netflix-Style Interface ─────────────────────────
// Replaces both content.js (movies) and videos.js (TV shows) with one
// Netflix-style landing page: horizontal carousels, hero banner, unified modal.

(function () {
  'use strict';

  var Utils = window.HGUtils || {};
  var esc = Utils.esc || function(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };

  // ── Safe HTML Builder ───────────────────────────────────────────────────────
  // Creates HTML elements safely without innerHTML to prevent XSS

  function safeSetHtml(element, html) {
    // For simple cases, prefer textContent
    if (typeof html !== 'string') return;

    // Create a template for controlled HTML parsing
    var template = document.createElement('template');
    template.innerHTML = html;
    var fragment = document.createDocumentFragment();

    // Only allow safe elements (span, a, div, p, br)
    var allowedTags = ['SPAN', 'A', 'DIV', 'P', 'BR', 'STRONG', 'EM'];
    function sanitize(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        return document.createTextNode(node.textContent);
      }
      if (node.nodeType === Node.ELEMENT_NODE && allowedTags.indexOf(node.tagName) !== -1) {
        var clone = document.createElement(node.tagName);
        // Copy only safe attributes
        Array.from(node.attributes).forEach(function(attr) {
          if (attr.name === 'href' || attr.name === 'class' || attr.name === 'target' || attr.name === 'rel') {
            if (attr.name === 'href' && !node.href.startsWith('http') && !node.href.startsWith('/')) {
              return; // Skip javascript: etc
            }
            clone.setAttribute(attr.name, attr.value);
          }
        });
        Array.from(node.childNodes).forEach(function(child) {
          clone.appendChild(sanitize(child));
        });
        return clone;
      }
      return null;
    }

    Array.from(template.content.childNodes).forEach(function(node) {
      var sanitized = sanitize(node);
      if (sanitized) fragment.appendChild(sanitized);
    });

    element.textContent = '';
    element.appendChild(fragment);
  }

  function createSafeLink(href, text, className) {
    var a = document.createElement('a');
    a.href = href;
    a.textContent = text;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    if (className) a.className = className;
    return a;
  }

  function createSafeSpan(text, className) {
    var span = document.createElement('span');
    span.textContent = text;
    if (className) span.className = className;
    return span;
  }

  // Shorthand for the most common utility
  var absUrl = Utils.makeAbsoluteUrl || function(p) { return p; };

  // Extract video source URL from a parsed document (shared by movie & show modals)
  function formatNumber(n) {
    n = parseInt(n, 10);
    if (isNaN(n)) return '';
    if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    return String(n);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DATA LAYER
  // ═══════════════════════════════════════════════════════════════════════════

  var _movieIdCounter = 0;
  var _showIdCounter = 0;
  var MAX_ROW_CARDS = 48;
  var _searchItems = [];
  var _searchRawItems = [];
  var _searchIndex = -1;
  var _searchReqId = 0;
  var _searchCache = Object.create(null);
  var _searchScope = 'all';
  var _searchFacetState = { genre: 'all', year: 'all', language: 'all' };
  var _searchLastQuery = '';
  var _itemRegistry = {};
  var _myListUiState = {
    filter: 'all',
    bulk: false,
    selected: {}
  };
  var UI_STATE_KEY = (window.HGConfig && window.HGConfig.STORAGE && window.HGConfig.STORAGE.LAST_UI_STATE) || 'hg_last_ui_state';

  function getUiState() {
    if (!Utils.storage || !Utils.storage.getJSONSync) return {};
    return Utils.storage.getJSONSync(UI_STATE_KEY, {}) || {};
  }

  function setUiState(nextState) {
    if (!Utils.storage || !Utils.storage.setJSONSync) return;
    var merged = Object.assign({}, getUiState(), nextState || {});
    Utils.storage.setJSONSync(UI_STATE_KEY, merged);
  }

  function syncUrlState(filter, query) {
    try {
      var u = new URL(window.location.href);
      if (filter) u.searchParams.set('view', filter); else u.searchParams.delete('view');
      if (typeof query === 'string') {
        if (query) u.searchParams.set('q', query); else u.searchParams.delete('q');
      }
      history.replaceState(history.state || {}, '', u.pathname + u.search);
    } catch (e) {}
  }

  function parseMoviesFromDoc(doc) {
    var items = [];
    Utils.selectors.queryAll(doc, 'THUMBNAIL').forEach(function(thumb) {
      var link = thumb.querySelector('a');
      if (!link) return;
      var href = link.getAttribute('href') || '';
      if (!href.includes('moviepreview')) return;
      var img = thumb.querySelector('img.poster, img.img-responsive, img');
      var titleEl = thumb.querySelector('h6');
      var ratingEl = thumb.querySelector('.rating-num');
      var title = titleEl ? titleEl.textContent.trim() : 'Unknown';
      var poster = img ? (img.getAttribute('src') || '') : '';
      var rating = ratingEl ? ratingEl.textContent.trim() : '';
      var addedDate = '', views = '';
      thumb.querySelectorAll('.infohd').forEach(function(el) {
        var t = el.textContent.trim();
        if (t.startsWith('AD :') || t.startsWith('AD:')) addedDate = t.replace(/AD\s*:\s*/, '').trim();
        if (t.startsWith('View :') || t.startsWith('View:')) views = t.replace(/View\s*:\s*/, '').trim();
      });
      var posterUrl = poster ? absUrl(poster) : '';
      items.push({
        type: 'movie', id: 'movie-' + (++_movieIdCounter), title: title, posterUrl: posterUrl, href: href,
        rating: rating, views: views, addedDate: addedDate, category: '', genre: '', quality: '', year: '',
        showName: '', seasons: [], totalEpisodes: 0
      });
    });
    return items;
  }

  function parseShowsFromDoc(doc) {
    var episodes = [];
    Utils.selectors.queryAll(doc, 'THUMBNAIL').forEach(function(thumb) {
      var link = thumb.querySelector('a[href*="videopreview"]');
      if (!link) return;
      var href = link.getAttribute('href') || '';
      var titleEl = thumb.querySelector('h6');
      var showEl = thumb.querySelector('.infovideo');
      var imgEl = thumb.querySelector('img');
      var title = titleEl ? titleEl.textContent.trim() : 'Unknown';
      var showName = showEl ? showEl.textContent.trim() : '';
      var poster = imgEl ? (imgEl.getAttribute('src') || '') : '';
      if (poster.indexOf('no-image') !== -1) poster = '';
      var posterUrl = poster ? absUrl(poster) : '';
      var views = 0, rating = 0, dateStr = '';
      thumb.querySelectorAll('.infohd').forEach(function(el) {
        var t = el.textContent.trim();
        var vm = t.match(/View\s*:\s*(\d+)/i); if (vm) views = parseInt(vm[1], 10);
        var dm = t.match(/AD\s*:\s*(.+)/i); if (dm) dateStr = dm[1].trim();
      });
      var rateEl = thumb.querySelector('.div-rate');
      if (rateEl) { var score = parseInt(rateEl.getAttribute('data-score') || '0', 10); if (score > 0) rating = score / 2; }
      var groupKey = (showName || title.replace(/\s*-?\s*Episode\s+\d+.*/i, '')).trim();
      var displayName = groupKey.replace(/\s*[-\u2013]\s*Season\s+\d+.*/i, '').trim() || groupKey;
      var seasonNum = Utils.extractSeasonNum ? Utils.extractSeasonNum(groupKey) : (groupKey.match(/Season\s+(\d+)/i) || [0, 0])[1] * 1 || 0;
      var epNum = Utils.extractEpisodeNum ? Utils.extractEpisodeNum(title) || 999 : (title.match(/Episode\s+(\d+)/i) ? parseInt(title.match(/Episode\s+(\d+)/i)[1], 10) : 999);
      episodes.push({ href: href, title: title, groupKey: displayName, displayName: displayName, seasonNum: seasonNum, seasonName: groupKey, epNum: epNum, posterUrl: posterUrl, views: views, rating: rating, dateStr: dateStr });
    });
    return episodes;
  }

  function mergeEpisodesToShowMap(episodes) {
    var showMap = new Map();
    episodes.forEach(function(ep) {
      if (showMap.has(ep.groupKey)) {
        var show = showMap.get(ep.groupKey);
        show.totalEpisodes++;
        if (ep.epNum < show.firstEpNum) { show.firstEpNum = ep.epNum; show.href = ep.href; }
        var existingSeason = show.seasons.find(function(s) { return s.name === ep.seasonName; });
        if (!existingSeason) show.seasons.push({ num: ep.seasonNum, name: ep.seasonName });
        if (!show.posterUrl && ep.posterUrl) show.posterUrl = ep.posterUrl;
        if (ep.views > show.views) show.views = ep.views;
        if (ep.rating > show.rating) show.rating = ep.rating;
        if (ep.dateStr) show.addedDate = ep.dateStr;
      } else {
        showMap.set(ep.groupKey, {
          type: 'show', id: 'show-' + (++_showIdCounter), title: ep.displayName, posterUrl: ep.posterUrl, href: ep.href,
          rating: ep.rating > 0 ? String(ep.rating) : '', views: String(ep.views), addedDate: ep.dateStr,
          showName: ep.displayName, seasons: [{ num: ep.seasonNum, name: ep.seasonName }], totalEpisodes: 1,
          firstEpNum: ep.epNum, category: '', genre: '', quality: '', year: ''
        });
      }
    });
    return showMap;
  }

  function fetchMoviesPage(page, paramsStr) {
    var p = new URLSearchParams(paramsStr || '');
    if (page > 1) p.set('page', page);
    var url = '/classic/movies' + (p.toString() ? '?' + p.toString() : '');
    return Utils.fetchWithCache(url, { credentials: 'same-origin' }, true)
      .then(function(html) { return parseMoviesFromDoc(new DOMParser().parseFromString(html, 'text/html')); });
  }

  function fetchShowsPage(page, paramsStr) {
    var p = new URLSearchParams(paramsStr || '');
    if (page > 1) p.set('page', page);
    var url = '/classic/videos' + (p.toString() ? '?' + p.toString() : '');
    return Utils.fetchWithCache(url, { credentials: 'same-origin' }, true)
      .then(function(html) {
        var episodes = parseShowsFromDoc(new DOMParser().parseFromString(html, 'text/html'));
        return Array.from(mergeEpisodesToShowMap(episodes).values());
      });
  }

  function fetchMovieDetail(href) {
    var url = href.startsWith('http') ? href : 'https://hallagulla.club/classic/' + href;
    return Utils.fetchWithCache(url, { credentials: 'same-origin' }, false)
      .then(function(html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var r = { description: '', genre: '', length: '', country: '', language: '', actors: '', director: '', quality: '', released: '', videoUrl: '', downloadUrl: '' };
        r.videoUrl = HGShared.extractVideoUrl(doc);
        doc.querySelectorAll('table tr').forEach(function(row) {
          var cells = row.querySelectorAll('td'); if (cells.length < 3) return;
          var label = cells[0].textContent.trim().toLowerCase(); var value = cells[2].textContent.trim();
          if (label === 'description') r.description = value;
          if (label === 'genre') { var genreLinks = cells[2].querySelectorAll('a'); var genreParts = []; genreLinks.forEach(function(a) { genreParts.push(a.textContent.trim()); }); r.genre = genreParts.join(', ') || value; }
          if (label === 'length') r.length = value; if (label === 'country') r.country = value;
          if (label === 'language') r.language = value;
          if (label === 'actors') { var actorLinks = cells[2].querySelectorAll('a'); var actorParts = []; actorLinks.forEach(function(a) { actorParts.push(a.textContent.trim()); }); r.actors = actorParts.join(', ') || value; }
          if (label === 'director') r.director = value; if (label === 'quality') r.quality = value;
          if (label === 'released') r.released = value;
        });
        var dlLink = doc.querySelector('#setCounter[href], a[href*="cdnnow.co"]');
        if (dlLink) r.downloadUrl = dlLink.getAttribute('href') || r.videoUrl;
        if (!r.videoUrl) { doc.querySelectorAll('.btn-warning, .btn-info').forEach(function(btn) { var onclick = btn.getAttribute('onclick') || btn.getAttribute('href') || ''; var m = onclick.match(/window\.open\('([^']+)'\)/); if (m && !r.downloadUrl) r.downloadUrl = m[1]; }); }
        return r;
      });
  }

  function fetchSeasonEpisodes(seasonName) {
    var url = 'https://hallagulla.club/classic/includes/ajax.php?albumName=' + encodeURIComponent(seasonName) + '&req=videos';
    return Utils.fetchWithCache(url, { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } }, true)
      .then(function(html) {
        var doc = new DOMParser().parseFromString('<div>' + html + '</div>', 'text/html');
        var episodes = [];
        var candidates = Utils.selectors.queryAll(doc, 'THUMBNAIL');
        candidates.forEach(function(item) {
          var parentLink = item.parentElement && item.parentElement.tagName === 'A' ? item.parentElement : null;
          var innerLink = item.querySelector('a[href*="videopreview"]');
          var link = parentLink || innerLink; if (!link) return;
          var href = link.getAttribute('href') || '';
          var titleEl = item.querySelector('h6'); var imgEl = item.querySelector('img'); var infoEls = item.querySelectorAll('.infohd');
          var title = titleEl ? titleEl.textContent.trim() : '';
          var poster = imgEl ? (imgEl.getAttribute('src') || '') : '';
          if (poster.indexOf('no-image') !== -1) poster = '';
          var posterUrl = poster ? absUrl(poster) : '';
          var views = '', date = '';
          infoEls.forEach(function(el) { var t = el.textContent.trim(); if (t.match(/^View/i)) views = t.replace(/View\s*:\s*/, '').trim(); if (t.match(/^AD/i)) date = t.replace('AD:', '').trim(); });
          var epNum = Utils.extractEpisodeNum ? Utils.extractEpisodeNum(title) : (title.match(/Episode\s+(\d+)/i) ? parseInt(title.match(/Episode\s+(\d+)/i)[1], 10) : 0);
          var epLabel = epNum ? 'E' + String(epNum).padStart(2, '0') : '';
          episodes.push({ href: href, title: title, posterUrl: posterUrl, views: views, date: date, epNum: epNum, epLabel: epLabel });
        });
        episodes.sort(function(a, b) { return a.epNum - b.epNum; });
        return episodes;
      });
  }

  function fetchAllMovies() {
    return fetchMoviesPage(1, '').then(function(items) {
      return items;
    });
  }

  function fetchAllShows() {
    return fetchShowsPage(1, '').then(function(shows) {
      return shows;
    });
  }

  function buildMyListItems() {
    if (!Utils.myList || !Utils.myList.get) return [];
    var items = Utils.myList.get();
    if (_myListUiState.filter === 'movies') return items.filter(function(i) { return i.type === 'movie'; });
    if (_myListUiState.filter === 'shows') return items.filter(function(i) { return i.type === 'show'; });
    if (_myListUiState.filter === 'watched' || _myListUiState.filter === 'partial' || _myListUiState.filter === 'unwatched') {
      var history = (Utils.watchHistory && Utils.watchHistory.get) ? Utils.watchHistory.get() : [];
      var seenMap = {};
      history.forEach(function(h) { if (h && h.href) seenMap[h.href] = true; });
      if (_myListUiState.filter === 'watched') return items.filter(function(i) { return !!seenMap[i.href || '']; });
      if (_myListUiState.filter === 'unwatched') return items.filter(function(i) { return !seenMap[i.href || '']; });
      return items.filter(function(i) { return !!seenMap[i.href || '']; });
    }
    return items;
  }

  function myListItemKey(item) {
    if (Utils.myList && Utils.myList._itemKey) return Utils.myList._itemKey(item);
    return (item.type || 'mixed') + ':' + (item.href || item.id || item.title || '');
  }

  function renderMyListManager() {
    var panel = document.getElementById('hg-mylist-panel');
    if (!panel) return;
    var select = panel.querySelector('#hg-mylist-select');
    var filter = panel.querySelector('#hg-mylist-filter');
    var grid = panel.querySelector('#hg-mylist-grid');
    var count = panel.querySelector('#hg-mylist-count');
    if (!grid || !select || !filter || !count) return;

    var lists = (Utils.myLists && Utils.myLists.getLists) ? Utils.myLists.getLists() : [{ id: 'default', name: 'My List', count: buildMyListItems().length }];
    var activeId = (Utils.myLists && Utils.myLists.getActiveListId) ? Utils.myLists.getActiveListId() : 'default';
    select.textContent = '';
    lists.forEach(function(l) {
      var opt = document.createElement('option');
      opt.value = l.id;
      opt.textContent = l.name + ' (' + l.count + ')';
      select.appendChild(opt);
    });
    select.value = activeId;
    filter.value = _myListUiState.filter || 'all';

    var items = buildMyListItems();
    count.textContent = items.length + ' title' + (items.length === 1 ? '' : 's');
    grid.textContent = '';
    if (items.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'hg-row-empty';
      empty.textContent = 'This list is empty.';
      grid.appendChild(empty);
      return;
    }

    items.forEach(function(item) {
      var card = buildCard(item);
      card.classList.add('hg-mylist-card');
      var key = myListItemKey(item);
      card.dataset.mlKey = key;
      if (_myListUiState.bulk) {
        card.classList.add('hg-mylist-bulk-mode');
        if (_myListUiState.selected[key]) card.classList.add('hg-mylist-selected');
        var dot = document.createElement('div');
        dot.className = 'hg-mylist-select-dot';
        dot.textContent = _myListUiState.selected[key] ? '\u2713' : '+';
        card.appendChild(dot);
        card.addEventListener('click', function(e) {
          e.preventDefault();
          e.stopPropagation();
          _myListUiState.selected[key] = !_myListUiState.selected[key];
          if (!_myListUiState.selected[key]) delete _myListUiState.selected[key];
          renderMyListManager();
        }, true);
      }
      grid.appendChild(card);
    });
  }

  function renderAccountPanel(panel) {
    if (!panel) return;
    panel.textContent = '';
    var title = document.createElement('h2');
    title.className = 'hg-carousel-label';
    title.textContent = 'Account & Settings';
    panel.appendChild(title);

    var body = document.createElement('div');
    body.className = 'hg-account-body';

    var prefs = (Utils.preferences && Utils.preferences.get) ? Utils.preferences.get() : { autoplayNext: true };
    var prefCard = document.createElement('div');
    prefCard.className = 'hg-account-card';
    prefCard.innerHTML = '<h3>Playback Preferences</h3><label><input type="checkbox" id="hg-pref-autonext"> Auto-play next episode</label><label><input type="checkbox" id="hg-pref-reduced"> Reduced motion</label>';
    body.appendChild(prefCard);

    var dataCard = document.createElement('div');
    dataCard.className = 'hg-account-card';
    dataCard.innerHTML = '<h3>Data Controls</h3><div class="hg-account-actions"><button id="hg-export-data">Export Data</button><button id="hg-clear-history">Clear Watch History</button><button id="hg-clear-search">Clear Search History</button><button id="hg-clear-mylist">Clear Active List</button></div>';
    body.appendChild(dataCard);

    var linksCard = document.createElement('div');
    linksCard.className = 'hg-account-card';
    linksCard.innerHTML = '<h3>Account Links</h3><div class="hg-account-links"><a href="/classic/home" target="_blank" rel="noopener noreferrer">Open Account Home</a><a href="/classic/videos" target="_blank" rel="noopener noreferrer">Manage TV Library</a><a href="/classic/movies" target="_blank" rel="noopener noreferrer">Manage Movie Library</a></div><p class="hg-account-note">Payment mutation is intentionally disabled in this extension.</p>';
    body.appendChild(linksCard);

    panel.appendChild(body);

    var autoNext = panel.querySelector('#hg-pref-autonext');
    var reduced = panel.querySelector('#hg-pref-reduced');
    if (autoNext) autoNext.checked = prefs.autoplayNext !== false;
    if (reduced) reduced.checked = !!prefs.reducedMotion || document.body.classList.contains('hg-reduced-motion');

    if (autoNext) autoNext.addEventListener('change', function() {
      if (Utils.preferences && Utils.preferences.set) Utils.preferences.set({ autoplayNext: !!autoNext.checked });
      if (window.HGShared && HGShared.showToast) HGShared.showToast(document.querySelector('#hg-app') || document.body, 'Preference saved', 'success', 1200);
    });
    if (reduced) reduced.addEventListener('change', function() {
      var next = !!reduced.checked;
      document.body.classList.toggle('hg-reduced-motion', next);
      if (Utils.preferences && Utils.preferences.set) Utils.preferences.set({ reducedMotion: next });
      if (window.HGShared && HGShared.showToast) HGShared.showToast(document.querySelector('#hg-app') || document.body, 'Motion preference updated', 'success', 1200);
    });

    var exportBtn = panel.querySelector('#hg-export-data');
    var clearHistory = panel.querySelector('#hg-clear-history');
    var clearSearch = panel.querySelector('#hg-clear-search');
    var clearMyList = panel.querySelector('#hg-clear-mylist');

    if (exportBtn) exportBtn.addEventListener('click', function() {
      var payload = {
        watchHistory: (Utils.watchHistory && Utils.watchHistory.get) ? Utils.watchHistory.get() : [],
        searchHistory: (Utils.searchHistory && Utils.searchHistory.get) ? Utils.searchHistory.get() : [],
        myLists: (Utils.myLists && Utils.myLists.getLists) ? Utils.myLists.getLists() : [],
        preferences: (Utils.preferences && Utils.preferences.get) ? Utils.preferences.get() : {}
      };
      var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'hg-extension-data.json';
      a.click();
      setTimeout(function() { URL.revokeObjectURL(a.href); }, 1000);
    });
    if (clearHistory) clearHistory.addEventListener('click', function() {
      if (Utils.watchHistory && Utils.watchHistory.clear) Utils.watchHistory.clear();
      if (window.HGShared && HGShared.showToast) HGShared.showToast(document.querySelector('#hg-app') || document.body, 'Watch history cleared', 'info', 1200);
    });
    if (clearSearch) clearSearch.addEventListener('click', function() {
      if (Utils.searchHistory && Utils.searchHistory.clear) Utils.searchHistory.clear();
      if (window.HGShared && HGShared.showToast) HGShared.showToast(document.querySelector('#hg-app') || document.body, 'Search history cleared', 'info', 1200);
    });
    if (clearMyList) clearMyList.addEventListener('click', function() {
      if (Utils.myLists && Utils.myLists.removeFromActiveByKeys) {
        var items = buildMyListItems();
        var keys = items.map(function(i) { return myListItemKey(i); });
        Utils.myLists.removeFromActiveByKeys(keys);
        refreshMyListSection();
      }
      if (window.HGShared && HGShared.showToast) HGShared.showToast(document.querySelector('#hg-app') || document.body, 'Active list cleared', 'info', 1200);
    });
  }

  function buildBecauseWatchedItems() {
    var history = (Utils.watchHistory && Utils.watchHistory.get) ? Utils.watchHistory.get() : [];
    if (!history || history.length === 0) return buildMyListItems().slice(0, 24);
    var listMap = {};
    buildMyListItems().forEach(function(item) {
      if (item && item.href) listMap[item.href] = item;
    });
    var seen = {};
    var out = [];
    history.forEach(function(h) {
      var href = h && h.href ? h.href : '';
      if (!href || seen[href]) return;
      seen[href] = true;
      var fromList = listMap[href];
      out.push({
        type: fromList ? fromList.type : (h.showName ? 'show' : 'movie'),
        id: (fromList && fromList.id) ? fromList.id : ('hist-' + href),
        title: (fromList && fromList.title) ? fromList.title : (h.title || h.showName || 'Untitled'),
        posterUrl: (fromList && fromList.posterUrl) ? fromList.posterUrl : (h.posterUrl || ''),
        href: href,
        rating: (fromList && fromList.rating) ? fromList.rating : '',
        views: (fromList && fromList.views) ? fromList.views : '',
        addedDate: (fromList && fromList.addedDate) ? fromList.addedDate : '',
        showName: (fromList && fromList.showName) ? fromList.showName : (h.showName || ''),
        seasons: (fromList && fromList.seasons) ? fromList.seasons : [],
        totalEpisodes: (fromList && fromList.totalEpisodes) ? fromList.totalEpisodes : 0,
        quality: (fromList && fromList.quality) ? fromList.quality : '',
        genre: (fromList && fromList.genre) ? fromList.genre : ''
      });
    });
    return out.slice(0, 24);
  }

  function setCardMyListState(card, item) {
    if (!card || !Utils.myList || !Utils.myList.has) return;
    card.classList.toggle('hg-card-in-list', Utils.myList.has(item));
  }

  function refreshMyListSection() {
    var section = document.querySelector('.hg-carousel-section[data-row-id="mylist"]');
    if (!section || !section._carousel) return;
    populateCarousel(section, buildMyListItems());
    section._loaded = true;
    renderMyListManager();
  }

  function updateMyListButton(btn, item) {
    if (!btn || !Utils.myList || !Utils.myList.has) return;
    var inList = Utils.myList.has(item);
    btn.classList.toggle('in-list', inList);
    btn.textContent = inList ? '\u2713 My List' : '+ My List';
    btn.setAttribute('aria-pressed', inList ? 'true' : 'false');
  }

  // Infinite-scroll: append next page to "All Movies" / "All TV Shows"
  var INFINITE_SCROLL_MAX_CARDS = 500;
  function appendMoreToSection(section) {
    if (section._loadingMore) return;
    var rowDef = section._rowDef;
    if (!rowDef) return;
    var currentCards = section._carousel.querySelectorAll('.hg-card').length;
    if (currentCards >= INFINITE_SCROLL_MAX_CARDS) {
      section._allLoaded = true;
      if (!section._carousel.querySelector('.hg-section-end')) {
        var endMsg = document.createElement('div'); endMsg.className = 'hg-section-end'; endMsg.textContent = 'You\'ve seen it all';
        section._carousel.appendChild(endMsg);
      }
      return;
    }
    section._currentPage = (section._currentPage || 1) + 1;
    section._loadingMore = true;
    var fetchFn;
    if (rowDef.id === 'allmovies') {
      fetchFn = function() { return fetchMoviesPage(section._currentPage, ''); };
    } else if (rowDef.id === 'allshows') {
      fetchFn = function() { return fetchShowsPage(section._currentPage, ''); };
    } else {
      section._loadingMore = false;
      return;
    }
    fetchFn().then(function(items) {
      section._loadingMore = false;
      if (items.length === 0) {
        section._allLoaded = true;
        if (!section._carousel.querySelector('.hg-section-end')) {
          var endMsg = document.createElement('div'); endMsg.className = 'hg-section-end'; endMsg.textContent = 'You\'ve seen it all';
          section._carousel.appendChild(endMsg);
        }
        return;
      }
      items.forEach(function(item, i) {
        var card = buildCard(item); card.style.animationDelay = (i * 30) + 'ms';
        section._carousel.appendChild(card);
      });
      queuePosterBackfill(items);
    }).catch(function() { section._loadingMore = false; });
  }

  // Backfill missing show posters by fetching detail pages
  // Enhanced with rate limiting, abort capability, and error tracking
  var _posterBackfillQueue = [];
  var _posterBackfillRunning = false;
  var _posterBackfillAbort = false;
  var _posterBackfillErrors = 0;
  var _posterBackfillMaxErrors = 5;
  var _posterBackfillProcessed = 0;
  var _posterBackfillMaxProcessed = 100; // Limit posters per session

  function queuePosterBackfill(items) {
    items.forEach(function(item) {
      if (!item.posterUrl && item.href && item.type === 'show' && _posterBackfillQueue.length < 100) {
        _posterBackfillQueue.push(item);
      }
    });
    if (!_posterBackfillRunning && !_posterBackfillAbort) runPosterBackfill();
  }

  function abortPosterBackfill() {
    _posterBackfillAbort = true;
    _posterBackfillQueue = [];
    _posterBackfillRunning = false;
  }

  function runPosterBackfill() {
    // Check abort flag and limits
    if (_posterBackfillAbort ||
        _posterBackfillQueue.length === 0 ||
        _posterBackfillProcessed >= _posterBackfillMaxProcessed ||
        _posterBackfillErrors >= _posterBackfillMaxErrors) {
      _posterBackfillRunning = false;
      return;
    }

    _posterBackfillRunning = true;
    var item = _posterBackfillQueue.shift();
    var url = item.href.startsWith('http') ? item.href : 'https://hallagulla.club/classic/' + item.href;

    (Utils.fetchWithRetry || fetch)(url, { credentials: 'same-origin' })
      .then(function(html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var og = doc.querySelector('meta[property="og:image"]');
        var poster = og ? (og.getAttribute('content') || '') : '';

        if (poster && !item.posterUrl) {
          item.posterUrl = poster;
          // Update matching cards in the DOM
          var cards = document.querySelectorAll('.hg-card[data-id="' + item.id + '"]');
          cards.forEach(function(card) {
            var posterDiv = card.querySelector('.hg-card-poster');
            if (posterDiv) {
              // Remove placeholder if exists
              var placeholder = posterDiv.querySelector('.hg-card-poster-placeholder');
              if (placeholder) placeholder.remove();

              // Create new image with fade-in
              var img = document.createElement('img');
              img.src = poster;
              img.alt = item.title;
              img.loading = 'lazy';
              img.decoding = 'async';
              img.style.cssText = 'position:relative;z-index:1;opacity:0;transition:opacity 0.3s ease-in-out;';
              img.onload = function() { this.style.opacity = '1'; };

              var noPoster = posterDiv.querySelector('.hg-no-poster');
              if (noPoster) {
                noPoster.parentNode.replaceChild(img, noPoster);
              } else {
                posterDiv.appendChild(img);
              }
            }
          });
        }
        _posterBackfillProcessed++;
        _posterBackfillErrors = 0; // Reset error count on success
      })
      .catch(function(err) {
        console.warn('Poster backfill failed for', item.title, err.message);
        _posterBackfillErrors++;
      })
      .then(function() {
        if (!_posterBackfillAbort) {
          // Increased delay to be gentler on the server (using config value)
          var delay = (window.HGConfig && window.HGConfig.TIMING)
            ? window.HGConfig.TIMING.POSTER_BACKFILL_DELAY
            : 500;
          setTimeout(runPosterBackfill, delay);
        }
      });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ROW DEFINITIONS
  // ═══════════════════════════════════════════════════════════════════════════

  var ROW_DEFS = [
    { id: 'recent',    title: 'Recently Added',       type: 'mixed', fetchFn: function() { return fetchMoviesPage(1, 'Sortby=Recent'); } },
    { id: 'becausewatched', title: 'Because You Watched', type: 'mixed', fetchFn: function() { return Promise.resolve(buildBecauseWatchedItems()); } },
    { id: 'toppicks', title: 'Top Picks', type: 'movie', fetchFn: function() {
      return fetchMoviesPage(1, 'Sortby=View').then(function(items) {
        if (items && items.length > 0) return items;
        return fetchMoviesPage(1, 'Sortby=Recent');
      }).catch(function() { return fetchMoviesPage(1, 'Sortby=Recent'); });
    } },
    { id: 'bollywood',  title: 'Bollywood',            type: 'movie', fetchFn: function() { return fetchMoviesPage(1, 'cat=3'); } },
    { id: 'hollywood',  title: 'Hollywood',            type: 'movie', fetchFn: function() { return fetchMoviesPage(1, 'cat=4'); } },
    { id: 'dualaudio', title: 'Dual Audio',             type: 'movie', fetchFn: function() { return fetchMoviesPage(1, 'cat=26'); } },
    { id: 'action',    title: 'Action & Thriller',     type: 'movie', fetchFn: function() { return fetchMoviesPage(1, 'genre=Action'); } },
    { id: 'comedy',    title: 'Comedy',                type: 'movie', fetchFn: function() { return fetchMoviesPage(1, 'genre=Comedy'); } },
    { id: 'drama',     title: 'Drama',                 type: 'movie', fetchFn: function() { return fetchMoviesPage(1, 'genre=Drama'); } },
    { id: 'kids',      title: 'Kids',                  type: 'movie', fetchFn: function() { return fetchMoviesPage(1, 'cat=25'); } },
    { id: 'tv-new',        title: 'New',                 type: 'show',  fetchFn: function() { return fetchShowsPage(1, 'Sortby=Recent'); } },
    { id: 'tv-webseries',  title: 'Web Series',          type: 'show',  fetchFn: function() { return fetchShowsPage(1, 'cat=3&k='); } },
    { id: 'tv-comedy',     title: 'Comedy',              type: 'show',  fetchFn: function() { return fetchShowsPage(1, 'cat=12&k='); } },
    { id: 'tv-hollywood',  title: 'Hollywood',           type: 'show',  fetchFn: function() { return fetchShowsPage(1, 'cat=10&k='); } },
    { id: 'tv-korean',     title: 'Korean',              type: 'show',  fetchFn: function() { return fetchShowsPage(1, 'cat=17'); } },
    { id: 'tv-reality',    title: 'Reality Shows',       type: 'show',  fetchFn: function() { return fetchShowsPage(1, 'cat=6&k='); } },
    { id: 'tv-talk',       title: 'Talk Shows',          type: 'show',  fetchFn: function() { return fetchShowsPage(1, 'cat=All&k=Talk'); } },
    { id: 'tv-urdu',       title: 'Pakistani / Indian',  type: 'show',  fetchFn: function() { return fetchShowsPage(1, 'cat=9&k='); } },
    { id: 'tv-animated',   title: 'Animated',            type: 'show',  fetchFn: function() { return fetchShowsPage(1, 'cat=15&k='); } },
    { id: 'allmovies', title: 'All Movies',             type: 'movie', fetchFn: function() { return fetchAllMovies(); } },
    { id: 'allshows',  title: 'All TV Shows',           type: 'show',  fetchFn: function() { return fetchAllShows(); } },
  ];

  // ═══════════════════════════════════════════════════════════════════════════
  // CARD COMPONENT
  // ═══════════════════════════════════════════════════════════════════════════

  // Create blurred placeholder for progressive image loading
  function createImagePlaceholder(initialsStr, title) {
    var placeholder = document.createElement('div');
    placeholder.className = 'hg-card-poster-placeholder';
    placeholder.style.cssText = 'position:absolute;inset:0;background:linear-gradient(135deg,#1a1a1a 0%,#2a2a2a 100%);display:flex;align-items:center;justify-content:center;';

    var initials = document.createElement('span');
    initials.textContent = initialsStr;
    initials.style.cssText = 'font-size:24px;font-weight:bold;color:#444;text-transform:uppercase;';
    placeholder.appendChild(initials);

    return placeholder;
  }

  function buildCard(item) {
    if (item && item.id) _itemRegistry[item.id] = item;
    var card = document.createElement('div');
    card.className = 'hg-card';
    card.dataset.type = item.type;
    card.dataset.id = item.id;
    setCardMyListState(card, item);

    var posterDiv = document.createElement('div');
    posterDiv.className = 'hg-card-poster';
    posterDiv.style.position = 'relative';
    var initialsStr = item.title.split(' ').map(function(w) { return w.charAt(0); }).join('').substring(0, 2).toUpperCase();

    // Add placeholder first
    var placeholder = createImagePlaceholder(initialsStr, item.title);
    posterDiv.appendChild(placeholder);

    if (item.posterUrl) {
      var img = document.createElement('img');
      img.src = item.posterUrl;
      img.alt = item.title;
      img.loading = 'lazy';
      img.decoding = 'async';
      img.style.cssText = 'position:relative;z-index:1;opacity:0;transition:opacity 0.3s ease-in-out;';
      img.onload = function() {
        this.style.opacity = '1';
        // Remove placeholder after image loads
        if (placeholder && placeholder.parentNode) {
          placeholder.parentNode.removeChild(placeholder);
        }
      };
      img.onerror = function() {
        this.style.display = 'none';
        // Show fallback on error
        if (placeholder) {
          placeholder.style.background = 'linear-gradient(135deg,#0a0a0a 0%,#1a1a1a 100%)';
        }
      };
      posterDiv.appendChild(img);
    }

    // Type badge
    var typeBadge = document.createElement('span');
    typeBadge.className = 'hg-card-type-badge' + (item.type === 'movie' ? ' hg-card-type-movie' : ' hg-card-type-show');
    typeBadge.textContent = item.type === 'show' ? ((item.seasons && item.seasons.length > 0) ? 'S' + (item.seasons[item.seasons.length - 1].num || 1) : 'SHOW') : 'MOVIE';
    posterDiv.appendChild(typeBadge);

    // Quality badge
    if (item.quality) {
      var qualityBadge = document.createElement('span'); qualityBadge.className = 'hg-card-quality'; qualityBadge.textContent = item.quality;
      posterDiv.appendChild(qualityBadge);
    }

    // Progress bar for continue watching
    if (item._progress && item._progress > 0) {
      var progressDiv = document.createElement('div'); progressDiv.className = 'hg-card-progress';
      var progressBar = document.createElement('div'); progressBar.className = 'hg-card-progress-bar';
      progressBar.style.width = Math.min(item._progress * 100, 95) + '%';
      progressDiv.appendChild(progressBar); posterDiv.appendChild(progressDiv);
    }

    // Hover overlay with Netflix-style action buttons and metadata
    var overlay = document.createElement('div');
    overlay.className = 'hg-card-overlay';

    var hoverInfo = document.createElement('div');
    hoverInfo.className = 'hg-card-hover-info';

    // Action buttons row
    var actions = document.createElement('div');
    actions.className = 'hg-card-actions';

    var playBtn = document.createElement('button');
    playBtn.className = 'hg-card-play-btn';
    playBtn.textContent = '\u25B6';
    playBtn.setAttribute('aria-label', 'Play');
    playBtn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      openModal(item);
    });
    actions.appendChild(playBtn);

    var listBtn = document.createElement('button');
    listBtn.className = 'hg-card-action-btn';
    listBtn.setAttribute('aria-label', 'Add to My List');
    var syncListButtons = function() {
      var inList = Utils.myList && Utils.myList.has ? Utils.myList.has(item) : false;
      listBtn.textContent = inList ? '\u2713' : '+';
      listBtn.classList.toggle('in-list', inList);
      if (inlineListBtn) {
        inlineListBtn.textContent = inList ? '\u2713' : '+';
        inlineListBtn.classList.toggle('in-list', inList);
      }
    };
    listBtn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      if (!Utils.myList || !Utils.myList.toggle) return;
      Utils.myList.toggle(item);
      setCardMyListState(card, item);
      syncListButtons();
      refreshMyListSection();
      var inList = Utils.myList.has(item);
      if (window.HGShared && HGShared.showToast) HGShared.showToast(document.querySelector('#hg-app') || document.body, inList ? 'Added to My List' : 'Removed from My List', inList ? 'success' : 'info', 1600);
    });
    var inlineListBtn = null;
    syncListButtons();
    actions.appendChild(listBtn);

    var infoBtn = document.createElement('button');
    infoBtn.className = 'hg-card-action-btn';
    infoBtn.textContent = '\u2139';
    infoBtn.setAttribute('aria-label', 'More info');
    infoBtn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      openModal(item);
    });
    actions.appendChild(infoBtn);

    hoverInfo.appendChild(actions);

    overlay.appendChild(hoverInfo);
    posterDiv.appendChild(overlay);
    card.appendChild(posterDiv);

    // Card info — always visible below poster (Netflix style)
    var info = document.createElement('div');
    info.className = 'hg-card-info';
    var infoTop = document.createElement('div');
    infoTop.className = 'hg-card-info-top';
    var titleDiv = document.createElement('div');
    titleDiv.className = 'hg-card-title';
    titleDiv.textContent = item.title;
    infoTop.appendChild(titleDiv);
    inlineListBtn = document.createElement('button');
    inlineListBtn.className = 'hg-card-inline-list-btn';
    inlineListBtn.setAttribute('aria-label', 'Toggle My List');
    inlineListBtn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      if (!Utils.myList || !Utils.myList.toggle) return;
      Utils.myList.toggle(item);
      setCardMyListState(card, item);
      syncListButtons();
      refreshMyListSection();
    });
    infoTop.appendChild(inlineListBtn);
    syncListButtons();
    info.appendChild(infoTop);
    var metaDiv = document.createElement('div');
    metaDiv.className = 'hg-card-meta';
    if (item.type === 'show' && item.totalEpisodes) {
      var epSpan = document.createElement('span');
      epSpan.textContent = item.totalEpisodes + ' ep';
      metaDiv.appendChild(epSpan);
    }
    if (item.rating) {
      var ratSpan = document.createElement('span');
      ratSpan.textContent = '\u2605 ' + item.rating;
      metaDiv.appendChild(ratSpan);
    }
    if (item.views) {
      var viewSpan = document.createElement('span');
      viewSpan.textContent = formatNumber(parseInt(item.views, 10)) + ' views';
      metaDiv.appendChild(viewSpan);
    }
    info.appendChild(metaDiv);
    card.appendChild(info);
    card.addEventListener('click', function() { openModal(item); });
    return card;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CAROUSEL ROW SYSTEM
  // ═══════════════════════════════════════════════════════════════════════════

  function buildCarouselSection(rowDef) {
    var isInfinite = rowDef.id === 'allmovies' || rowDef.id === 'allshows';
    var section = document.createElement('section');
    section.className = 'hg-carousel-section' + (isInfinite ? ' hg-section-grid' : '');
    section.dataset.rowId = rowDef.id; section.dataset.type = rowDef.type;
    var label = document.createElement('h2'); label.className = 'hg-carousel-label'; label.textContent = rowDef.title;
    section.appendChild(label);
    var container = document.createElement('div'); container.className = 'hg-carousel-container';
    var leftBtn = document.createElement('button'); leftBtn.className = 'hg-scroll-btn hg-scroll-btn-left'; leftBtn.innerHTML = '&#8249;';
    container.appendChild(leftBtn);
    var carousel = document.createElement('div'); carousel.className = isInfinite ? 'hg-carousel hg-carousel-grid' : 'hg-carousel';
    container.appendChild(carousel);
    var rightBtn = document.createElement('button'); rightBtn.className = 'hg-scroll-btn hg-scroll-btn-right'; rightBtn.innerHTML = '&#8250;';
    container.appendChild(rightBtn);
    section.appendChild(container);
    leftBtn.addEventListener('click', function() { carousel.scrollBy({ left: -600, behavior: 'smooth' }); });
    rightBtn.addEventListener('click', function() { carousel.scrollBy({ left: 600, behavior: 'smooth' }); });
    section._loaded = false; section._carousel = carousel; section._rowDef = rowDef;
    return section;
  }

  function renderRowState(section, message, retryFn) {
    if (!section || !section._carousel) return;
    var carousel = section._carousel;
    if (window.HGShared && HGShared.renderState) {
      HGShared.renderState(carousel, { message: message, onRetry: retryFn });
      return;
    }
    carousel.textContent = '';
    var state = document.createElement('div');
    state.className = 'hg-row-state';
    var text = document.createElement('span');
    text.textContent = message;
    state.appendChild(text);
    carousel.appendChild(state);
  }

  function populateCarousel(section, items) {
    var carousel = section._carousel; carousel.textContent = '';
    var rows = Array.isArray(items) ? items : [];
    if (rows.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'hg-row-empty';
      empty.textContent = section.dataset.rowId === 'mylist' ? 'Your My List is empty.' : 'No titles available right now.';
      carousel.appendChild(empty);
      return;
    }
    var isGrid = section.classList.contains('hg-section-grid');
    var toRender = isGrid ? rows : rows.slice(0, MAX_ROW_CARDS);
    toRender.forEach(function(item, i) {
      var card = buildCard(item); card.style.animationDelay = (i % 12 * 40) + 'ms'; carousel.appendChild(card);
    });
    // Queue poster backfill for shows without thumbnails
    queuePosterBackfill(toRender);
    // Track current page for infinite scroll sections
    if (!section._currentPage) section._currentPage = 1;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SHELL + HERO
  // ═══════════════════════════════════════════════════════════════════════════

  var _heroSlides = []; var _allHeroSlides = []; var _heroIndex = 0; var _heroTimer = null;

  function buildShell() {
    var wrap = document.createElement('div');
    wrap.id = 'hg-app';
    wrap.dataset.filter = 'home';
    wrap.setAttribute('role', 'application');
    wrap.setAttribute('aria-label', 'Halla Gulla Streaming');
    // Header scroll observer — adds .hg-scrolled class for opaque background
    var persistScroll = Utils.throttle ? Utils.throttle(function() {
      setUiState({ scrollTop: wrap.scrollTop });
    }, 200) : function() {};
    wrap.addEventListener('scroll', function() {
      var header = wrap.querySelector('#hg-header');
      if (header) header.classList.toggle('hg-scrolled', wrap.scrollTop > 40);
      persistScroll();
    }, { passive: true });

    // Skip link for keyboard navigation
    var skipLink = document.createElement('a');
    skipLink.href = '#hg-main';
    skipLink.className = 'hg-skip-link';
    skipLink.textContent = 'Skip to main content';
    skipLink.style.cssText = 'position:absolute;left:-9999px;top:auto;width:1px;height:1px;overflow:hidden;z-index:9999;';
    skipLink.addEventListener('focus', function() {
      this.style.cssText = 'position:fixed;top:0;left:0;width:auto;height:auto;padding:8px 16px;background:#000;color:#fff;z-index:9999;text-decoration:none;';
    });
    skipLink.addEventListener('blur', function() {
      this.style.cssText = 'position:absolute;left:-9999px;top:auto;width:1px;height:1px;overflow:hidden;z-index:9999;';
    });
    wrap.appendChild(skipLink);

    var header = document.createElement('header');
    header.id = 'hg-header';
    header.setAttribute('role', 'banner');
    var logo = document.createElement('div');
    logo.id = 'hg-logo';
    logo.textContent = 'Halla Gulla';
    header.appendChild(logo);

    var nav = document.createElement('nav');
    nav.id = 'hg-nav';
    nav.setAttribute('role', 'navigation');
    nav.setAttribute('aria-label', 'Main navigation');
    nav.setAttribute('aria-orientation', 'horizontal');
    var navItems = [
      { label: 'Home', filter: 'home', id: 'home' },
      { label: 'Movies', filter: 'movies', id: 'movies' },
      { label: 'TV Shows', filter: 'shows', id: 'shows' },
      { label: 'My List', filter: 'mylist', id: 'mylist' },
      { label: 'Account', filter: 'account', id: 'account' }
    ];
    navItems.forEach(function(item, i) {
      var btn = document.createElement('button');
      btn.className = 'hg-nav-tab' + (i === 0 ? ' active' : '');
      btn.dataset.filter = item.filter;
      btn.textContent = item.label;
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', i === 0 ? 'true' : 'false');
      btn.setAttribute('aria-controls', 'hg-content');
      btn.setAttribute('tabindex', i === 0 ? '0' : '-1');
      btn.id = 'hg-tab-' + item.id;
      nav.appendChild(btn);
    });
    nav.setAttribute('role', 'tablist');
    header.appendChild(nav);

    var searchWrap = document.createElement('div'); searchWrap.id = 'hg-search-wrap';
    var searchInput = document.createElement('input');
    searchInput.id = 'hg-search';
    searchInput.type = 'text';
    searchInput.placeholder = 'Search movies & shows...';
    searchInput.autocomplete = 'off';
    searchInput.setAttribute('aria-label', 'Search movies and shows');
    searchInput.setAttribute('aria-autocomplete', 'list');
    searchInput.setAttribute('aria-controls', 'hg-search-suggest');
    searchInput.setAttribute('aria-expanded', 'false');
    searchWrap.appendChild(searchInput);
    var searchClear = document.createElement('button');
    searchClear.id = 'hg-search-clear';
    searchClear.type = 'button';
    searchClear.setAttribute('aria-label', 'Clear search');
    searchClear.textContent = '\u2715';
    searchClear.style.display = 'none';
    searchWrap.appendChild(searchClear);
    var searchSuggest = document.createElement('div');
    searchSuggest.id = 'hg-search-suggest';
    searchSuggest.style.display = 'none';
    searchSuggest.setAttribute('role', 'listbox');
    searchSuggest.setAttribute('aria-label', 'Search suggestions');
    searchSuggest.setAttribute('aria-hidden', 'true');
    searchWrap.appendChild(searchSuggest);
    header.appendChild(searchWrap);
    wrap.appendChild(header);

    // Genre filter bar
    var genreBar = document.createElement('div'); genreBar.id = 'hg-genre-bar';
    ['All', 'Action', 'Comedy', 'Drama'].forEach(function(g, i) {
      var pill = document.createElement('button'); pill.className = 'hg-genre-pill' + (i === 0 ? ' active' : '');
      pill.textContent = g; pill.dataset.genre = g.toLowerCase();
      genreBar.appendChild(pill);
    });
    wrap.appendChild(genreBar);

    // Hero
    var hero = document.createElement('div');
    hero.id = 'hg-hero';
    hero.setAttribute('role', 'region');
    hero.setAttribute('aria-label', 'Featured content');
    var slides = document.createElement('div'); slides.className = 'hg-hero-slides'; hero.appendChild(slides);
    var heroContent = document.createElement('div'); heroContent.className = 'hg-hero-content';
    heroContent.setAttribute('role', 'group');
    heroContent.setAttribute('aria-roledescription', 'carousel');
    var heroMeta = document.createElement('div'); heroMeta.className = 'hg-hero-meta';
    var heroCategory = document.createElement('span'); heroCategory.className = 'hg-hero-category';
    heroMeta.appendChild(heroCategory);
    heroContent.appendChild(heroMeta);
    var heroTitle = document.createElement('h1'); heroTitle.className = 'hg-hero-title';
    heroTitle.setAttribute('aria-live', 'polite');
    heroContent.appendChild(heroTitle);
    var heroDesc = document.createElement('p'); heroDesc.className = 'hg-hero-desc';
    heroDesc.setAttribute('aria-live', 'polite');
    heroContent.appendChild(heroDesc);
    var heroMetaRow = document.createElement('div'); heroMetaRow.className = 'hg-hero-meta-row';
    heroContent.appendChild(heroMetaRow);
    var heroButtons = document.createElement('div'); heroButtons.className = 'hg-hero-buttons';
    var heroPlayBtn = document.createElement('button'); heroPlayBtn.className = 'hg-hero-btn hg-hero-btn-primary'; heroPlayBtn.id = 'hg-hero-play'; heroPlayBtn.textContent = '\u25B6 Play';
    heroPlayBtn.setAttribute('aria-label', 'Play featured content');
    heroButtons.appendChild(heroPlayBtn);
    var heroInfoBtn = document.createElement('button'); heroInfoBtn.className = 'hg-hero-btn hg-hero-btn-secondary'; heroInfoBtn.id = 'hg-hero-info'; heroInfoBtn.textContent = 'ⓘ More Info';
    heroInfoBtn.setAttribute('aria-label', 'More information about featured content');
    heroButtons.appendChild(heroInfoBtn);
    heroContent.appendChild(heroButtons);
    hero.appendChild(heroContent);
    var prevBtn = document.createElement('button');
    prevBtn.className = 'hg-hero-arrow hg-hero-arrow-prev';
    prevBtn.textContent = '\u2039';
    prevBtn.setAttribute('aria-label', 'Previous slide');
    hero.appendChild(prevBtn);
    var nextBtn = document.createElement('button');
    nextBtn.className = 'hg-hero-arrow hg-hero-arrow-next';
    nextBtn.textContent = '\u203a';
    nextBtn.setAttribute('aria-label', 'Next slide');
    hero.appendChild(nextBtn);
    var dots = document.createElement('div');
    dots.className = 'hg-hero-dots';
    dots.setAttribute('role', 'tablist');
    dots.setAttribute('aria-label', 'Slide navigation');
    hero.appendChild(dots);
    var progress = document.createElement('div'); progress.className = 'hg-hero-progress';
    var progressBar = document.createElement('div'); progressBar.className = 'hg-hero-progress-bar';
    progress.appendChild(progressBar); hero.appendChild(progress);
    wrap.appendChild(hero);

    // Main content area
    var main = document.createElement('main');
    main.id = 'hg-main';
    main.setAttribute('role', 'main');
    main.setAttribute('aria-label', 'Content');
    var content = document.createElement('div'); content.id = 'hg-content';
    content.setAttribute('role', 'tabpanel');
    content.id = 'hg-content';
    var searchResults = document.createElement('div'); searchResults.id = 'hg-search-results'; searchResults.style.display = 'none';
    searchResults.setAttribute('aria-live', 'polite');
    searchResults.setAttribute('aria-label', 'Search results');
    var searchCount = document.createElement('div');
    searchCount.id = 'hg-search-count';
    searchResults.appendChild(searchCount);
    content.appendChild(searchResults);
    var myListPanel = document.createElement('section');
    myListPanel.id = 'hg-mylist-panel';
    myListPanel.className = 'hg-section-hidden';
    var myListTitle = document.createElement('h2');
    myListTitle.className = 'hg-carousel-label';
    myListTitle.textContent = 'My List Collections';
    myListPanel.appendChild(myListTitle);
    var mlToolbar = document.createElement('div');
    mlToolbar.id = 'hg-mylist-toolbar';
    mlToolbar.innerHTML = '<select id="hg-mylist-select" aria-label="Choose list"></select><button id="hg-mylist-new">New List</button><select id="hg-mylist-filter" aria-label="Filter list"><option value="all">All</option><option value="movies">Movies</option><option value="shows">TV Shows</option><option value="watched">Watched</option><option value="unwatched">Unwatched</option><option value="partial">Partial</option></select><button id="hg-mylist-bulk">Bulk Select</button><button id="hg-mylist-remove">Remove Selected</button><button id="hg-mylist-up">Move Up</button><button id="hg-mylist-down">Move Down</button><span id="hg-mylist-count" aria-live="polite" aria-atomic="true"></span>';
    myListPanel.appendChild(mlToolbar);
    var myListGrid = document.createElement('div');
    myListGrid.id = 'hg-mylist-grid';
    myListGrid.className = 'hg-search-grid';
    myListPanel.appendChild(myListGrid);
    content.appendChild(myListPanel);
    var accountPanel = document.createElement('section');
    accountPanel.id = 'hg-account-panel';
    accountPanel.className = 'hg-section-hidden';
    content.appendChild(accountPanel);
    main.appendChild(content);
    wrap.appendChild(main);

    // Modal
    var modal = document.createElement('div');
    modal.id = 'hg-modal';
    modal.style.display = 'none';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'hg-modal-title');
    modal.setAttribute('aria-hidden', 'true');
    var backdrop = document.createElement('div'); backdrop.id = 'hg-modal-backdrop';
    backdrop.setAttribute('aria-hidden', 'true');
    modal.appendChild(backdrop);
    var modalBox = document.createElement('div'); modalBox.id = 'hg-modal-box';
    modalBox.setAttribute('role', 'document');
    var closeBtn = document.createElement('button');
    closeBtn.id = 'hg-modal-close';
    closeBtn.textContent = '\u2715';
    closeBtn.setAttribute('aria-label', 'Close modal');
    modalBox.appendChild(closeBtn);
    var modalContent = document.createElement('div'); modalContent.id = 'hg-modal-content';
    modalBox.appendChild(modalContent); modal.appendChild(modalBox);
    wrap.appendChild(modal);

    // Event listeners
    nav.querySelectorAll('.hg-nav-tab').forEach(function(tab) {
      tab.addEventListener('click', function() {
        nav.querySelectorAll('.hg-nav-tab').forEach(function(t) {
          t.classList.remove('active');
          t.setAttribute('aria-selected', 'false');
          t.setAttribute('tabindex', '-1');
        });
        this.classList.add('active');
        this.setAttribute('aria-selected', 'true');
        this.setAttribute('tabindex', '0');
        var filter = this.dataset.filter;
        wrap.dataset.filter = filter;
        setUiState({ filter: filter });
        syncUrlState(filter, null);
        applyFilter(wrap, filter);
        // Clear any active search when switching tabs
        if (searchInput.value) {
          searchInput.value = '';
          handleSearch('');
        }
        // Always scroll back to top so content is visible
        wrap.scrollTop = 0;
      });
      tab.addEventListener('keydown', function(e) {
        var tabs = Array.from(nav.querySelectorAll('.hg-nav-tab'));
        var idx = tabs.indexOf(this);
        if (idx < 0) return;
        var next = idx;
        if (e.key === 'ArrowRight') next = (idx + 1) % tabs.length;
        else if (e.key === 'ArrowLeft') next = (idx - 1 + tabs.length) % tabs.length;
        else if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = tabs.length - 1;
        else return;
        e.preventDefault();
        tabs[next].focus();
        tabs[next].click();
      });
    });

    backdrop.addEventListener('click', closeModal);
    closeBtn.addEventListener('click', closeModal);

    var searchTimer;
    function renderSearchSuggestPanel() {
      var q = searchInput.value.trim();
      if (q.length >= 2) {
        searchSuggest.style.display = 'none';
        searchSuggest.textContent = '';
        return;
      }
      var history = (Utils.searchHistory && Utils.searchHistory.get) ? Utils.searchHistory.get() : [];
      var quick = ['action', 'comedy', 'drama', 'korean', 'urdu', 'web series'];
      var all = history.concat(quick.filter(function(x) { return history.indexOf(x) === -1; })).slice(0, 10);
      if (all.length === 0) {
        searchSuggest.style.display = 'none';
        searchSuggest.setAttribute('aria-hidden', 'true');
        searchInput.setAttribute('aria-expanded', 'false');
        searchSuggest.textContent = '';
        return;
      }
      searchSuggest.textContent = '';
      var head = document.createElement('div');
      head.className = 'hg-search-suggest-head';
      var title = document.createElement('span');
      title.textContent = history.length ? 'Recent searches' : 'Try searching';
      head.appendChild(title);
      if (history.length && Utils.searchHistory && Utils.searchHistory.clear) {
        var clearHistory = document.createElement('button');
        clearHistory.textContent = 'Clear';
        clearHistory.addEventListener('click', function(e) {
          e.preventDefault();
          e.stopPropagation();
          Utils.searchHistory.clear();
          renderSearchSuggestPanel();
        });
        head.appendChild(clearHistory);
      }
      searchSuggest.appendChild(head);
      var list = document.createElement('div');
      list.className = 'hg-search-suggest-list';
      all.forEach(function(term) {
        var btn = document.createElement('button');
        btn.className = 'hg-search-suggest-item';
        btn.textContent = term;
        btn.setAttribute('role', 'option');
        btn.addEventListener('click', function() {
          searchInput.value = term;
          searchClear.style.display = 'inline-flex';
          setUiState({ searchQuery: term });
          syncUrlState(null, term);
          handleSearch(term);
          searchSuggest.style.display = 'none';
        });
        list.appendChild(btn);
      });
      searchSuggest.appendChild(list);
      searchSuggest.style.display = 'block';
      searchSuggest.setAttribute('aria-hidden', 'false');
      searchInput.setAttribute('aria-expanded', 'true');
    }

    searchInput.addEventListener('input', function() {
      clearTimeout(searchTimer); var q = searchInput.value.trim();
      searchClear.style.display = q ? 'inline-flex' : 'none';
      setUiState({ searchQuery: q });
      syncUrlState(null, q);
      renderSearchSuggestPanel();
      searchTimer = setTimeout(function() { handleSearch(q); }, 300);
    });
    searchInput.addEventListener('focus', function() {
      renderSearchSuggestPanel();
    });
    searchInput.addEventListener('keydown', function(e) {
      var resultsVisible = searchResults.style.display !== 'none' && _searchItems.length > 0;
      if (!resultsVisible) {
        if (e.key === 'Escape' && searchInput.value) {
          searchInput.value = '';
          searchClear.style.display = 'none';
          handleSearch('');
        }
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        _searchIndex = Math.min(_searchIndex + 1, _searchItems.length - 1);
        updateSearchActiveCard(searchResults, _searchIndex);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        _searchIndex = Math.max(_searchIndex - 1, 0);
        updateSearchActiveCard(searchResults, _searchIndex);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        var selected = _searchItems[_searchIndex] || _searchItems[0];
        if (selected) openModal(selected);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        searchInput.value = '';
        searchClear.style.display = 'none';
        handleSearch('');
      }
    });
    searchClear.addEventListener('click', function() {
      searchInput.value = '';
      searchClear.style.display = 'none';
      handleSearch('');
      searchInput.focus();
      syncUrlState(null, '');
      renderSearchSuggestPanel();
    });
    document.addEventListener('click', function(e) {
      if (!searchWrap.contains(e.target)) {
        searchSuggest.style.display = 'none';
        searchSuggest.setAttribute('aria-hidden', 'true');
        searchInput.setAttribute('aria-expanded', 'false');
      }
    });

    var mlSelect = myListPanel.querySelector('#hg-mylist-select');
    var mlFilter = myListPanel.querySelector('#hg-mylist-filter');
    var mlNew = myListPanel.querySelector('#hg-mylist-new');
    var mlBulk = myListPanel.querySelector('#hg-mylist-bulk');
    var mlRemove = myListPanel.querySelector('#hg-mylist-remove');
    var mlUp = myListPanel.querySelector('#hg-mylist-up');
    var mlDown = myListPanel.querySelector('#hg-mylist-down');

    mlSelect.addEventListener('change', function() {
      if (Utils.myLists && Utils.myLists.setActiveListId) Utils.myLists.setActiveListId(mlSelect.value);
      _myListUiState.selected = {};
      refreshMyListSection();
    });
    mlFilter.addEventListener('change', function() {
      _myListUiState.filter = mlFilter.value || 'all';
      _myListUiState.selected = {};
      refreshMyListSection();
    });
    mlNew.addEventListener('click', function() {
      var name = window.prompt('List name');
      if (!name) return;
      if (Utils.myLists && Utils.myLists.createList) Utils.myLists.createList(name);
      _myListUiState.selected = {};
      refreshMyListSection();
    });
    mlBulk.addEventListener('click', function() {
      _myListUiState.bulk = !_myListUiState.bulk;
      if (!_myListUiState.bulk) _myListUiState.selected = {};
      mlBulk.textContent = _myListUiState.bulk ? 'Done' : 'Bulk Select';
      renderMyListManager();
    });
    mlRemove.addEventListener('click', function() {
      var keys = Object.keys(_myListUiState.selected);
      if (keys.length === 0) return;
      if (Utils.myLists && Utils.myLists.removeFromActiveByKeys) Utils.myLists.removeFromActiveByKeys(keys);
      _myListUiState.selected = {};
      refreshMyListSection();
    });
    mlUp.addEventListener('click', function() {
      var keys = Object.keys(_myListUiState.selected);
      if (keys.length === 0 || !Utils.myLists || !Utils.myLists.moveInActiveByKey) return;
      Utils.myLists.moveInActiveByKey(keys[0], -1);
      refreshMyListSection();
    });
    mlDown.addEventListener('click', function() {
      var keys = Object.keys(_myListUiState.selected);
      if (keys.length === 0 || !Utils.myLists || !Utils.myLists.moveInActiveByKey) return;
      Utils.myLists.moveInActiveByKey(keys[0], 1);
      refreshMyListSection();
    });

    // Simple toast helper
    function showToast(message) {
      if (window.HGShared && HGShared.showToast) HGShared.showToast(wrap, message, 'info', 2200);
    }

    genreBar.querySelectorAll('.hg-genre-pill').forEach(function(pill) {
      pill.addEventListener('click', function() {
        genreBar.querySelectorAll('.hg-genre-pill').forEach(function(p) { p.classList.remove('active'); });
        this.classList.add('active');
        var genre = this.dataset.genre;
        if (genre === 'all') {
          wrap.scrollTo({ top: 0, behavior: 'smooth' });
        } else {
          var targetRow = wrap.querySelector('.hg-carousel-section[data-row-id="' + genre + '"]');
          if (targetRow) {
            targetRow.scrollIntoView({ behavior: 'smooth', block: 'start' });
          } else {
            showToast('Scroll down a bit — that section is loading.');
          }
        }
      });
    });

    prevBtn.addEventListener('click', function() { heroSlide(-1); });
    nextBtn.addEventListener('click', function() { heroSlide(1); });

    // Footer
    var footer = document.createElement('footer');
    footer.id = 'hg-footer';
    footer.setAttribute('role', 'contentinfo');
    var footerInner = document.createElement('div');
    footerInner.className = 'hg-footer-inner';
    var footerLinks = document.createElement('div');
    footerLinks.className = 'hg-footer-links';
    ['About', 'Help Center', 'Terms of Use', 'Privacy', 'Cookie Preferences', 'Contact Us'].forEach(function(text) {
      var a = document.createElement('a');
      a.textContent = text;
      a.href = '#';
      a.className = 'hg-footer-link';
      footerLinks.appendChild(a);
    });
    footerInner.appendChild(footerLinks);
    var footerCopy = document.createElement('div');
    footerCopy.className = 'hg-footer-copy';
    footerCopy.textContent = '© ' + new Date().getFullYear() + ' Halla Gulla. All rights reserved.';
    footerInner.appendChild(footerCopy);
    footer.appendChild(footerInner);
    wrap.appendChild(footer);

    return wrap;
  }

  function applyFilter(wrap, filter) {
    var hero = wrap.querySelector('#hg-hero');
    var genreBar = wrap.querySelector('#hg-genre-bar');
    var sections = wrap.querySelectorAll('.hg-carousel-section');
    var myListPanel = wrap.querySelector('#hg-mylist-panel');
    var accountPanel = wrap.querySelector('#hg-account-panel');
    // Reset all sections and cards visible
    sections.forEach(function(s) { s.classList.remove('hg-section-hidden'); });
    wrap.querySelectorAll('.hg-card').forEach(function(c) { c.style.display = ''; });
    if (myListPanel) myListPanel.classList.add('hg-section-hidden');
    if (accountPanel) accountPanel.classList.add('hg-section-hidden');

    // Show/hide genre bar based on tab — genre pills only make sense on Home
    if (genreBar) genreBar.style.display = (filter === 'home') ? '' : 'none';

    if (filter === 'movies') {
      // Hide show-only rows entirely
      sections.forEach(function(s) {
        if (s.dataset.type === 'show') s.classList.add('hg-section-hidden');
      });
      // Within mixed rows, hide show cards
      wrap.querySelectorAll('.hg-carousel-section:not(.hg-section-hidden) .hg-card[data-type="show"]').forEach(function(c) { c.style.display = 'none'; });
    } else if (filter === 'shows') {
      // Hide movie rows and non-continue mixed rows on TV tab
      sections.forEach(function(s) {
        if (s.dataset.type === 'movie') s.classList.add('hg-section-hidden');
        if (s.dataset.type === 'mixed' && s.dataset.rowId !== 'mylist') s.classList.add('hg-section-hidden');
      });
      wrap.querySelectorAll('.hg-carousel-section:not(.hg-section-hidden) .hg-card[data-type="movie"]').forEach(function(c) { c.style.display = 'none'; });
    } else if (filter === 'mylist') {
      sections.forEach(function(s) { s.classList.add('hg-section-hidden'); });
      if (hero) hero.style.display = 'none';
      if (genreBar) genreBar.style.display = 'none';
      if (myListPanel) {
        myListPanel.classList.remove('hg-section-hidden');
        renderMyListManager();
      }
    } else if (filter === 'account') {
      sections.forEach(function(s) { s.classList.add('hg-section-hidden'); });
      if (hero) hero.style.display = 'none';
      if (genreBar) genreBar.style.display = 'none';
      if (accountPanel) {
        accountPanel.classList.remove('hg-section-hidden');
        renderAccountPanel(accountPanel);
      }
    }

    // Filter hero slides by tab
    if (filter === 'movies') {
      var heroMovies = _allHeroSlides.filter(function(item) { return item.type === 'movie'; });
      if (heroMovies.length > 0) { populateHero(heroMovies); if (hero) hero.style.display = ''; }
      else { if (hero) hero.style.display = 'none'; }
    } else if (filter === 'shows') {
      var heroShows = _allHeroSlides.filter(function(item) { return item.type === 'show'; });
      if (heroShows.length > 0) { populateHero(heroShows); if (hero) hero.style.display = ''; }
      else { if (hero) hero.style.display = 'none'; }
    } else {
      if (hero) hero.style.display = '';
      if (_allHeroSlides.length > 0) populateHero(_allHeroSlides);
    }
  }

  function populateHero(items) {
    _heroSlides = items.slice(0, 6);
    clearInterval(_heroTimer); _heroTimer = null;
    var hero = document.querySelector('#hg-hero'); if (!hero) return;
    var slidesContainer = hero.querySelector('.hg-hero-slides');
    var dotsContainer = hero.querySelector('.hg-hero-dots');
    slidesContainer.textContent = ''; dotsContainer.textContent = '';
    _heroSlides.forEach(function(item, i) {
      var slide = document.createElement('div'); slide.className = 'hg-hero-slide' + (i === 0 ? ' active' : '');
      if (item.posterUrl) {
        // Keep a visible fallback gradient layer under every hero image.
        slide.style.backgroundImage = 'linear-gradient(110deg, rgba(229,9,20,0.14) 0%, rgba(20,20,20,0.35) 55%, rgba(0,0,0,0.55) 100%), url(' + item.posterUrl + ')';
      } else {
        slide.classList.add('no-image');
      }
      slidesContainer.appendChild(slide);
      var dot = document.createElement('button'); dot.className = 'hg-hero-dot' + (i === 0 ? ' active' : '');
      dot.addEventListener('click', function() { heroGoTo(i); }); dotsContainer.appendChild(dot);
    });
    if (_heroSlides.length > 0) updateHeroContent(0);
    startHeroAutoplay();
  }

  function updateHeroContent(index) {
    var item = _heroSlides[index]; if (!item) return;
    var content = document.querySelector('.hg-hero-content'); if (!content) return;
    var hero = document.querySelector('#hg-hero');
    if (hero) {
      hero.classList.toggle('hg-hero-show', item.type === 'show');
      hero.classList.toggle('hg-hero-no-image', !item.posterUrl);
    }
    content.classList.add('transitioning');
    setTimeout(function() {
      var catEl = content.querySelector('.hg-hero-category');
      var titleEl = content.querySelector('.hg-hero-title');
      var descEl = content.querySelector('.hg-hero-desc');
      var metaRowEl = content.querySelector('.hg-hero-meta-row');
      if (catEl) catEl.textContent = item.type === 'show' ? 'TV SHOW' : 'MOVIE';
      if (titleEl) titleEl.textContent = item.title;
      if (metaRowEl) {
        metaRowEl.textContent = '';
        if (item.rating) {
          var match = Math.min(Math.round(parseFloat(item.rating) * 10), 99);
          metaRowEl.appendChild(createSafeSpan(match + '% Match', 'hg-hero-match'));
        }
        if (item.type === 'show' && item.totalEpisodes) {
          metaRowEl.appendChild(createSafeSpan(item.totalEpisodes + ' Episodes', 'hg-hero-meta-badge'));
        }
        if (item.quality) {
          metaRowEl.appendChild(createSafeSpan(item.quality, 'hg-hero-meta-badge'));
        }
        if (item.views) {
          metaRowEl.appendChild(createSafeSpan(formatNumber(item.views) + ' views', 'hg-hero-meta-badge'));
        }
      }
      if (descEl) {
        if (item.type === 'show') {
          var seasonCount = item.seasons ? item.seasons.length : 0;
          var descParts = [];
          if (item.totalEpisodes) descParts.push(item.totalEpisodes + ' episodes' + (seasonCount > 1 ? ' across ' + seasonCount + ' seasons' : ''));
          descParts.push(item.showName ? 'Watch ' + item.showName + ' now.' : 'Watch all episodes now.');
          descEl.textContent = descParts.join('. ');
        } else {
          descEl.textContent = item.description || item.quality || 'Stream now in HD.';
        }
      }
      content.classList.remove('transitioning');
    }, 300);
    document.querySelectorAll('.hg-hero-dot').forEach(function(d, i) { d.classList.toggle('active', i === index); });
    document.querySelectorAll('.hg-hero-slide').forEach(function(s, i) { s.classList.toggle('active', i === index); });
  }

  function heroSlide(dir) { _heroIndex = (_heroIndex + dir + _heroSlides.length) % _heroSlides.length; updateHeroContent(_heroIndex); resetHeroAutoplay(); }
  function heroGoTo(index) { _heroIndex = index; updateHeroContent(_heroIndex); resetHeroAutoplay(); }

  function startHeroAutoplay() {
    if (_heroSlides.length <= 1) return;
    _heroTimer = setInterval(function() { heroSlide(1); }, 8000);
    var bar = document.querySelector('.hg-hero-progress-bar');
    if (bar) { bar.style.transition = 'none'; bar.style.width = '0%'; requestAnimationFrame(function() { bar.style.transition = 'width 8s linear'; bar.style.width = '100%'; }); }
  }
  function resetHeroAutoplay() { clearInterval(_heroTimer); startHeroAutoplay(); }

  // ═══════════════════════════════════════════════════════════════════════════
  // CUSTOM VIDEO CONTROLS
  // ═══════════════════════════════════════════════════════════════════════════

  function buildVideoControls(video, videoWrap, opts) {
    opts = opts || {};
    video.controls = false;

    /* ── helpers ── */
    function mkSvg(d) {
      var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', '20'); s.setAttribute('height', '20');
      s.setAttribute('fill', 'currentColor'); s.setAttribute('aria-hidden', 'true');
      var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', d); s.appendChild(p); return s;
    }
    function mkBtn(cls, label, titleStr) {
      var b = document.createElement('button'); b.className = 'hgc-btn ' + cls;
      b.setAttribute('aria-label', label); b.title = titleStr || label; return b;
    }
    function fmtTime(s) {
      if (!s || !isFinite(s)) return '--:--';
      var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
      if (h > 0) return h + ':' + (m < 10 ? '0' : '') + m + ':' + (sec < 10 ? '0' : '') + sec;
      return m + ':' + (sec < 10 ? '0' : '') + sec;
    }

    /* ── shell ── */
    var ctrl = document.createElement('div'); ctrl.className = 'hgc-controls';

    /* ── progress bar ── */
    var progWrap = document.createElement('div'); progWrap.className = 'hgc-progress-wrap';
    var progBg   = document.createElement('div'); progBg.className   = 'hgc-progress-bg';
    var progFill = document.createElement('div'); progFill.className = 'hgc-progress-fill';
    var progThumb= document.createElement('div'); progThumb.className= 'hgc-progress-thumb';
    progBg.appendChild(progFill); progBg.appendChild(progThumb);
    progWrap.appendChild(progBg); ctrl.appendChild(progWrap);

    /* ── bottom row ── */
    var bottom = document.createElement('div'); bottom.className = 'hgc-bottom';
    var leftG  = document.createElement('div'); leftG.className  = 'hgc-left';
    var rightG = document.createElement('div'); rightG.className = 'hgc-right';

    /* play / pause */
    var playBtn   = mkBtn('hgc-play', 'Play', 'Play / Pause  (Space)');
    var PLAY_ICO  = mkSvg('M8 5v14l11-7z');
    var PAUSE_ICO = mkSvg('M6 19h4V5H6v14zm8-14v14h4V5h-4z');
    playBtn.appendChild(PLAY_ICO.cloneNode(true));

    /* rewind 10s */
    var bkBtn = mkBtn('hgc-seek', 'Rewind 10 seconds', 'Rewind 10s  (\u2190)');
    bkBtn.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/><text x="12" y="17" text-anchor="middle" font-size="5.5" font-weight="700" font-family="system-ui,sans-serif" fill="currentColor">10</text></svg>';

    /* forward 10s */
    var fwBtn = mkBtn('hgc-seek', 'Forward 10 seconds', 'Forward 10s  (\u2192)');
    fwBtn.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M12 5V1l5 5-5 5V7c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6h2c0 4.42-3.58 8-8 8s-8-3.58-8-8 3.58-8 8-8z"/><text x="12" y="17" text-anchor="middle" font-size="5.5" font-weight="700" font-family="system-ui,sans-serif" fill="currentColor">10</text></svg>';

    /* time display */
    var timeEl = document.createElement('span'); timeEl.className = 'hgc-time'; timeEl.textContent = '0:00 / --:--';

    /* volume */
    var volWrap   = document.createElement('div'); volWrap.className   = 'hgc-vol-wrap';
    var volBtn    = mkBtn('hgc-vol', 'Toggle mute', 'Mute / Unmute  (M)');
    var VOL_ICO   = mkSvg('M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z');
    var MUTE_ICO  = mkSvg('M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z');
    volBtn.appendChild(VOL_ICO.cloneNode(true));
    var volSlider = document.createElement('input'); volSlider.type = 'range';
    volSlider.className = 'hgc-vol-slider'; volSlider.min = 0; volSlider.max = 1; volSlider.step = 0.02;
    volSlider.value = video.muted ? 0 : (video.volume || 1);
    volWrap.appendChild(volBtn); volWrap.appendChild(volSlider);

    leftG.appendChild(playBtn); leftG.appendChild(bkBtn); leftG.appendChild(fwBtn);
    leftG.appendChild(timeEl); leftG.appendChild(volWrap);

    /* audio language (hidden until multiple tracks detected) */
    var audioBtn = mkBtn('hgc-audio', 'Switch audio language', 'Switch Audio Language');
    audioBtn.style.display = 'none';
    rightG.appendChild(audioBtn);

    /* PiP */
    if (Utils.supportsPIP && Utils.supportsPIP()) {
      var pipBtn2 = mkBtn('hgc-pip', 'Picture-in-Picture', 'Picture-in-Picture  (P)');
      pipBtn2.innerHTML = '<svg viewBox="0 0 24 20" width="20" height="20" fill="currentColor" aria-hidden="true"><rect x="2" y="2" width="20" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><rect x="8" y="11" width="10" height="7" rx="1" fill="currentColor"/></svg>';
      pipBtn2.addEventListener('click', function(e) { e.stopPropagation(); if (Utils.togglePIP) Utils.togglePIP(video).catch(function() {}); });
      rightG.appendChild(pipBtn2);
    }

    /* cinema mode */
    var cinemaBtn = mkBtn('hgc-cinema', 'Toggle cinema mode', 'Cinema Mode  (C)');
    cinemaBtn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M3 5v4h2V5h4V3H5c-1.1 0-2 .9-2 2zm2 10H3v4c0 1.1.9 2 2 2h4v-2H5v-4zm14 4h-4v2h4c1.1 0 2-.9 2-2v-4h-2v4zm0-16h-4v2h4v4h2V5c0-1.1-.9-2-2-2z"/></svg>';
    rightG.appendChild(cinemaBtn);

    /* fullscreen */
    var fsBtn  = mkBtn('hgc-fs', 'Toggle fullscreen', 'Fullscreen  (F)');
    var FS_IN  = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>';
    var FS_OUT = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/></svg>';
    fsBtn.innerHTML = FS_IN;
    rightG.appendChild(fsBtn);

    bottom.appendChild(leftG); bottom.appendChild(rightG);
    ctrl.appendChild(bottom); videoWrap.appendChild(ctrl);

    /* ── progress scrubbing ── */
    var _scrubbing = false;
    function seekTo(e) {
      var rect = progBg.getBoundingClientRect();
      var pct  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      if (video.duration) video.currentTime = pct * video.duration;
    }
    progWrap.addEventListener('mousedown', function(e) { _scrubbing = true; seekTo(e); e.preventDefault(); e.stopPropagation(); });
    document.addEventListener('mousemove', function(e)  { if (_scrubbing) seekTo(e); });
    document.addEventListener('mouseup',   function()   { _scrubbing = false; });

    /* ── progress update ── */
    video.addEventListener('timeupdate', function() {
      if (_scrubbing) return;
      var pct = video.duration ? (video.currentTime / video.duration) * 100 : 0;
      progFill.style.width = pct + '%';
      progThumb.style.left = pct + '%';
      timeEl.textContent   = fmtTime(video.currentTime) + ' / ' + fmtTime(video.duration);
    });
    video.addEventListener('loadedmetadata', function() {
      timeEl.textContent = fmtTime(0) + ' / ' + fmtTime(video.duration);
      var tracks = video.audioTracks;
      if (tracks && tracks.length > 1) {
        var _ti = 0;
        for (var i = 0; i < tracks.length; i++) tracks[i].enabled = (i === 0);
        audioBtn.textContent = (tracks[0].label || 'Hindi') + ' \u25BE';
        audioBtn.style.display = '';
        audioBtn.onclick = function(e) {
          e.stopPropagation();
          _ti = (_ti + 1) % tracks.length;
          for (var i = 0; i < tracks.length; i++) tracks[i].enabled = (i === _ti);
          audioBtn.textContent = (tracks[_ti].label || ('Track ' + (_ti + 1))) + ' \u25BE';
        };
      }
    });

    /* ── play / pause state ── */
    var _hideTimer;
    function showCtrl() {
      ctrl.classList.add('hgc-visible');
      clearTimeout(_hideTimer);
      if (!video.paused) _hideTimer = setTimeout(function() { ctrl.classList.remove('hgc-visible'); }, 3000);
    }
    function syncPlay() {
      playBtn.innerHTML = '';
      if (video.paused) {
        playBtn.appendChild(PLAY_ICO.cloneNode(true));
        playBtn.title = 'Play  (Space)';
        ctrl.classList.add('hgc-visible');
        clearTimeout(_hideTimer);
      } else {
        playBtn.appendChild(PAUSE_ICO.cloneNode(true));
        playBtn.title = 'Pause  (Space)';
        showCtrl();
      }
    }
    video.addEventListener('play',  syncPlay);
    video.addEventListener('pause', syncPlay);
    video.addEventListener('ended', syncPlay);

    /* click video to play/pause */
    video.addEventListener('click', function() {
      if (video.paused) video.play().catch(function() {}); else video.pause();
    });

    playBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      if (video.paused) video.play().catch(function() {}); else video.pause();
    });
    bkBtn.addEventListener('click', function(e) { e.stopPropagation(); video.currentTime = Math.max(0, video.currentTime - 10); });
    fwBtn.addEventListener('click', function(e) { e.stopPropagation(); video.currentTime = Math.min(video.currentTime + 10, video.duration || Infinity); });

    /* ── volume ── */
    var _prevVol = 1;
    function syncVol() {
      volBtn.innerHTML = '';
      volBtn.appendChild((video.muted || video.volume === 0) ? MUTE_ICO.cloneNode(true) : VOL_ICO.cloneNode(true));
      volSlider.value = video.muted ? 0 : video.volume;
    }
    video.addEventListener('volumechange', syncVol);
    volBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      if (video.muted) { video.muted = false; video.volume = _prevVol || 0.8; }
      else { _prevVol = video.volume; video.muted = true; }
    });
    volSlider.addEventListener('input', function(e) {
      e.stopPropagation();
      var v = parseFloat(this.value); video.volume = v; video.muted = v === 0;
      if (v > 0) _prevVol = v;
    });
    volSlider.addEventListener('click', function(e) { e.stopPropagation(); });

    /* ── cinema mode ── */
    var _modal = opts.modal || document.getElementById('hg-modal');
    cinemaBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      if (_modal) {
        var on = _modal.classList.toggle('hg-cinema-mode');
        cinemaBtn.classList.toggle('hgc-cinema-on', on);
        cinemaBtn.title = on ? 'Exit Cinema Mode  (C)' : 'Cinema Mode  (C)';
      }
    });

    /* ── fullscreen ── */
    fsBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      if (document.fullscreenElement) document.exitFullscreen().catch(function() {});
      else (videoWrap.requestFullscreen ? videoWrap : video).requestFullscreen().catch(function() {});
    });
    document.addEventListener('fullscreenchange', function() {
      fsBtn.innerHTML = document.fullscreenElement ? FS_OUT : FS_IN;
    });

    /* ── auto-hide on mouse activity ── */
    videoWrap.addEventListener('mousemove',  showCtrl);
    videoWrap.addEventListener('mouseenter', showCtrl);
    videoWrap.addEventListener('mouseleave', function() {
      clearTimeout(_hideTimer);
      if (!video.paused) ctrl.classList.remove('hgc-visible');
    });

    /* initial state */
    syncPlay(); syncVol();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MOVIE MODAL
  // ═══════════════════════════════════════════════════════════════════════════

  var _modalFetchId = 0;

  function copyToClipboard(text) {
    var value = String(text || '');
    if (!value) return Promise.resolve(false);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(value).then(function() { return true; }).catch(function() { return false; });
    }
    return Promise.resolve(false);
  }

  function getMoreLikeThisItems(currentItem) {
    var out = [];
    var seen = {};
    var currentHref = currentItem && currentItem.href ? currentItem.href : '';
    var add = function(item) {
      if (!item || !item.href || item.href === currentHref) return;
      var key = (item.type || 'mixed') + ':' + item.href;
      if (seen[key]) return;
      seen[key] = true;
      out.push(item);
    };
    buildMyListItems().forEach(add);
    var history = (Utils.watchHistory && Utils.watchHistory.get) ? Utils.watchHistory.get() : [];
    history.forEach(function(h) {
      add({
        type: currentItem.type === 'show' ? 'show' : (h.showName ? 'show' : 'movie'),
        id: 'hist-' + (h.href || h.title || ''),
        title: h.title || h.showName || 'Untitled',
        posterUrl: h.posterUrl || '',
        href: h.href || '',
        showName: h.showName || '',
        seasons: [],
        totalEpisodes: 0,
        rating: '',
        views: '',
        addedDate: ''
      });
    });
    Object.keys(_itemRegistry).forEach(function(k) {
      add(_itemRegistry[k]);
    });
    return out.filter(function(i) { return i.type === currentItem.type; }).slice(0, 8);
  }

  function appendMoreLikeThis(container, item) {
    if (!container) return;
    var related = getMoreLikeThisItems(item);
    if (!related.length) return;
    var sec = document.createElement('section');
    sec.className = 'hg-modal-related';
    var title = document.createElement('h3');
    title.className = 'hg-modal-related-title';
    title.textContent = 'More Like This';
    sec.appendChild(title);
    var row = document.createElement('div');
    row.className = 'hg-modal-related-grid';
    related.forEach(function(rel) {
      var card = buildCard(rel);
      row.appendChild(card);
    });
    sec.appendChild(row);
    container.appendChild(sec);
  }

  function buildMovieModal(item) {
    var content = document.getElementById('hg-modal-content'); content.textContent = '';
    var layout = document.createElement('div'); layout.id = 'hg-modal-layout-movie';

    var videoWrap = document.createElement('div'); videoWrap.id = 'hg-modal-video-wrap';
    var video = document.createElement('video'); video.id = 'hg-video'; video.autoplay = true; video.playsInline = true;
    videoWrap.appendChild(video);
    var overlay = document.createElement('div'); overlay.id = 'hg-modal-poster-overlay';
    if (item.posterUrl) overlay.style.backgroundImage = 'url(' + item.posterUrl + ')';
    overlay.style.display = 'flex'; videoWrap.appendChild(overlay);
    buildVideoControls(video, videoWrap, { modal: document.getElementById('hg-modal') });
    layout.appendChild(videoWrap);

    var meta = document.createElement('div'); meta.id = 'hg-modal-meta';
    var left = document.createElement('div'); left.id = 'hg-modal-left';
    var titleEl = document.createElement('h2'); titleEl.id = 'hg-modal-title'; titleEl.textContent = item.title; left.appendChild(titleEl);
    var badgesEl = document.createElement('div'); badgesEl.id = 'hg-modal-badges'; left.appendChild(badgesEl);
    var actionsEl = document.createElement('div'); actionsEl.id = 'hg-modal-actions';
    var myListBtn = document.createElement('button');
    myListBtn.className = 'hg-mylist-btn';
    actionsEl.appendChild(myListBtn);
    var resumeBtn = document.createElement('button');
    resumeBtn.className = 'hg-mylist-btn';
    resumeBtn.textContent = 'Resume';
    resumeBtn.disabled = true;
    actionsEl.appendChild(resumeBtn);
    var restartBtn = document.createElement('button');
    restartBtn.className = 'hg-mylist-btn';
    restartBtn.textContent = 'Start Over';
    actionsEl.appendChild(restartBtn);
    var shareBtn = document.createElement('button');
    shareBtn.className = 'hg-mylist-btn';
    shareBtn.textContent = 'Share';
    actionsEl.appendChild(shareBtn);
    var movieDlBtn = document.createElement('a');
    movieDlBtn.className = 'hg-dl-btn hg-modal-dl-btn';
    movieDlBtn.target = '_blank';
    movieDlBtn.rel = 'noopener noreferrer';
    movieDlBtn.style.display = 'none';
    movieDlBtn.textContent = '\u2B07 Download';
    actionsEl.appendChild(movieDlBtn);
    left.appendChild(actionsEl);
    var descEl = document.createElement('p'); descEl.id = 'hg-modal-desc'; descEl.textContent = 'Loading...'; left.appendChild(descEl);
    var detailsEl = document.createElement('div'); detailsEl.id = 'hg-modal-details'; left.appendChild(detailsEl);
    meta.appendChild(left);

    var right = document.createElement('div'); right.id = 'hg-modal-right';
    var castLabel = document.createElement('div'); castLabel.id = 'hg-modal-cast-label'; castLabel.textContent = 'Cast'; right.appendChild(castLabel);
    var castEl = document.createElement('div'); castEl.id = 'hg-modal-cast'; right.appendChild(castEl);
    meta.appendChild(right); layout.appendChild(meta); content.appendChild(layout);

    var myFetchId = ++_modalFetchId;
    updateMyListButton(myListBtn, item);
    myListBtn.addEventListener('click', function() {
      if (!Utils.myList || !Utils.myList.toggle) return;
      Utils.myList.toggle(item);
      updateMyListButton(myListBtn, item);
      document.querySelectorAll('.hg-card[data-id="' + item.id + '"]').forEach(function(card) {
        setCardMyListState(card, item);
      });
      refreshMyListSection();
    });
    shareBtn.addEventListener('click', function() {
      var link = item.href && item.href.startsWith('http') ? item.href : ('https://hallagulla.club/classic/' + (item.href || ''));
      copyToClipboard(link).then(function(ok) {
        if (window.HGShared && HGShared.showToast) HGShared.showToast(document.querySelector('#hg-app') || document.body, ok ? 'Link copied' : 'Unable to copy link', ok ? 'success' : 'error', 1500);
      });
    });

    fetchMovieDetail(item.href).then(function(detail) {
      if (myFetchId !== _modalFetchId) return;
      descEl.textContent = detail.description || 'No description available.';

      // Build badges safely
      badgesEl.textContent = '';
      if (item.rating) {
        var ratingBadge = createSafeSpan('\u2605 ' + item.rating, 'hg-badge hg-badge-rating');
        badgesEl.appendChild(ratingBadge);
      }
      if (detail.quality) {
        badgesEl.appendChild(createSafeSpan(detail.quality, 'hg-badge'));
      }
      if (detail.released) {
        badgesEl.appendChild(createSafeSpan(detail.released, 'hg-badge'));
      }
      if (detail.length) {
        badgesEl.appendChild(createSafeSpan(detail.length, 'hg-badge'));
      }

      // Build details safely
      detailsEl.textContent = '';
      if (detail.genre) {
        var genreRow = document.createElement('div'); genreRow.className = 'hg-detail-row';
        var genreLabel = document.createElement('span'); genreLabel.textContent = 'Genre';
        genreRow.appendChild(genreLabel);
        genreRow.appendChild(document.createTextNode(esc(detail.genre)));
        detailsEl.appendChild(genreRow);
      }
      if (detail.director) {
        var directorRow = document.createElement('div'); directorRow.className = 'hg-detail-row';
        var directorLabel = document.createElement('span'); directorLabel.textContent = 'Director';
        directorRow.appendChild(directorLabel);
        directorRow.appendChild(document.createTextNode(esc(detail.director)));
        detailsEl.appendChild(directorRow);
      }
      if (detail.country) {
        var countryRow = document.createElement('div'); countryRow.className = 'hg-detail-row';
        var countryLabel = document.createElement('span'); countryLabel.textContent = 'Country';
        countryRow.appendChild(countryLabel);
        countryRow.appendChild(document.createTextNode(esc(detail.country)));
        detailsEl.appendChild(countryRow);
      }
      if (detail.language) {
        var languageRow = document.createElement('div'); languageRow.className = 'hg-detail-row';
        var languageLabel = document.createElement('span'); languageLabel.textContent = 'Language';
        languageRow.appendChild(languageLabel);
        languageRow.appendChild(document.createTextNode(esc(detail.language)));
        detailsEl.appendChild(languageRow);
      }
      if (item.views) {
        var viewsRow = document.createElement('div'); viewsRow.className = 'hg-detail-row';
        var viewsLabel = document.createElement('span'); viewsLabel.textContent = 'Views';
        viewsRow.appendChild(viewsLabel);
        viewsRow.appendChild(document.createTextNode(esc(item.views)));
        detailsEl.appendChild(viewsRow);
      }

      // Build cast list safely
      if (detail.actors) {
        castEl.textContent = '';
        detail.actors.split(',').forEach(function(n) {
          var name = n.trim();
          if (name) castEl.appendChild(createSafeSpan(name, 'hg-actor'));
        });
      }

      if (detail.videoUrl) {
        var startMoviePlayback = function() {
          setVideoOverlayState(loadingOverlay, 'loading');
          video.pause();
          video.removeAttribute('src');
          video.load();
          video.src = detail.videoUrl;
          video.poster = item.posterUrl;
          overlay.style.display = 'none';
          bindVideoPlaybackUI(video, loadingOverlay, startMoviePlayback);
          video.play().catch(function() {});
        };
        startMoviePlayback();
        setupVideoTracking(video, detail.videoUrl);
        var savedProgress = Utils.videoProgress && Utils.videoProgress.get ? Utils.videoProgress.get(detail.videoUrl) : 0;
        var resumeTime = (savedProgress && typeof savedProgress === 'object') ? (savedProgress.currentTime || 0) : (savedProgress || 0);
        resumeBtn.disabled = !(resumeTime > 0);
        resumeBtn.addEventListener('click', function() {
          if (resumeTime > 0) {
            video.currentTime = Math.max(0, resumeTime - 1);
            video.play().catch(function() {});
          }
        });
        restartBtn.addEventListener('click', function() {
          video.currentTime = 0;
          if (Utils.videoProgress && Utils.videoProgress.clear) Utils.videoProgress.clear(detail.videoUrl);
          video.play().catch(function() {});
        });
      } else {
        setVideoOverlayState(loadingOverlay, 'hidden');
        overlay.textContent = '';
        var noStreamDiv = document.createElement('div'); noStreamDiv.className = 'hg-no-stream';
        var noStreamP = document.createElement('p'); noStreamP.textContent = 'Direct stream not available.';
        noStreamDiv.appendChild(noStreamP);
        if (detail.downloadUrl) {
          var dlBtn = createSafeLink(detail.downloadUrl, '\u2B07 Download', 'hg-dl-btn');
          noStreamDiv.appendChild(dlBtn);
        }
        overlay.appendChild(noStreamDiv);
        overlay.style.display = 'flex';
        resumeBtn.disabled = true;
        restartBtn.disabled = true;
      }

      var movieDlUrl = detail.downloadUrl || detail.videoUrl || '';
      if (movieDlUrl) {
        movieDlBtn.href = movieDlUrl;
        movieDlBtn.style.display = 'inline-flex';
      } else {
        movieDlBtn.style.display = 'none';
      }
      appendMoreLikeThis(left, item);
    }).catch(function(err) { console.error('HG: movie detail failed', err); descEl.textContent = 'Failed to load movie details.'; });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SHOW MODAL
  // ═══════════════════════════════════════════════════════════════════════════

  var _seasonRequestId = 0; var _episodeLoadId = 0; var _videoTrackingInterval = null;

  function setVideoOverlayState(overlay, state) {
    if (!overlay) return;
    overlay.textContent = '';
    if (state === 'hidden') {
      overlay.style.display = 'none';
      return;
    }
    overlay.style.display = 'flex';
    var spinner = document.createElement('div');
    spinner.className = 'hg-spinner';
    var message = document.createElement('span');
    if (state === 'buffering') {
      message.textContent = 'Buffering video...';
    } else if (state === 'preparing') {
      message.textContent = 'Preparing stream...';
    } else {
      message.textContent = 'Loading video...';
    }
    overlay.appendChild(spinner);
    overlay.appendChild(message);
  }

  function setVideoOverlayError(overlay, message, onRetry) {
    if (!overlay) return;
    overlay.textContent = '';
    overlay.style.display = 'flex';
    var text = document.createElement('span');
    text.textContent = message || 'Failed to load video.';
    overlay.appendChild(text);
    if (typeof onRetry === 'function') {
      var btn = document.createElement('button');
      btn.className = 'hg-video-retry-btn';
      btn.textContent = 'Retry';
      btn.addEventListener('click', onRetry);
      overlay.appendChild(btn);
    }
  }

  function bindVideoPlaybackUI(video, overlay, onRetry) {
    if (!video || !overlay) return;
    if (video._hgDetachUiHandlers) video._hgDetachUiHandlers();

    var loadingTimeout = null;
    function clearLoadingTimeout() {
      if (loadingTimeout) {
        clearTimeout(loadingTimeout);
        loadingTimeout = null;
      }
    }
    function showSlowNetwork() {
      if (video.paused && video.readyState < 2) {
        setVideoOverlayError(overlay, 'This stream is taking longer than usual.', onRetry);
      }
    }
    function onWaiting() { setVideoOverlayState(overlay, 'buffering'); }
    function onLoadStart() { setVideoOverlayState(overlay, 'loading'); }
    function onCanPlay() {
      if (video.paused && video.autoplay) video.play().catch(function() {});
      if (video.readyState >= 3) setVideoOverlayState(overlay, 'hidden');
    }
    function onPlaying() {
      clearLoadingTimeout();
      setVideoOverlayState(overlay, 'hidden');
    }
    function onError() {
      clearLoadingTimeout();
      setVideoOverlayError(overlay, 'Could not play this stream.', onRetry);
    }

    video.addEventListener('waiting', onWaiting);
    video.addEventListener('loadstart', onLoadStart);
    video.addEventListener('canplay', onCanPlay);
    video.addEventListener('playing', onPlaying);
    video.addEventListener('error', onError);

    loadingTimeout = setTimeout(showSlowNetwork, 12000);

    video._hgDetachUiHandlers = function() {
      clearLoadingTimeout();
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('loadstart', onLoadStart);
      video.removeEventListener('canplay', onCanPlay);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('error', onError);
      video._hgDetachUiHandlers = null;
    };
  }

  function bindSeasonTabs(seasonTabsDiv, content) {
    seasonTabsDiv.querySelectorAll('.hgp-season-tab').forEach(function(tab) {
      tab.addEventListener('click', function() {
        seasonTabsDiv.querySelectorAll('.hgp-season-tab').forEach(function(t) { t.classList.remove('active'); });
        this.classList.add('active');
        loadSeason(this.dataset.season, content, null);
      });
    });
  }

  function renderSeasonTabs(seasonTabsDiv, seasons, activeSeason) {
    seasonTabsDiv.textContent = '';
    seasons.sort(function(a, b) { return (a.num || 999) - (b.num || 999); }).forEach(function(s, i) {
      var isActive = activeSeason ? s.name === activeSeason : i === 0;
      var tab = document.createElement('button');
      tab.className = 'hgp-season-tab' + (isActive ? ' active' : '');
      tab.dataset.season = s.name;
      tab.textContent = s.num ? 'S' + s.num : ('S' + (i + 1));
      seasonTabsDiv.appendChild(tab);
    });
  }

  function resolveShowSeasonsFromEpisode(episodeHref) {
    if (!episodeHref) return Promise.resolve(null);
    var url = episodeHref.startsWith('http') ? episodeHref : 'https://hallagulla.club/classic/' + episodeHref;
    return Utils.fetchWithCache(url, { credentials: 'same-origin' }, true).then(function(html) {
      var doc = new DOMParser().parseFromString(html, 'text/html');
      var seasons = [];
      var currentSeason = '';
      var sel = doc.querySelector('#seasons_list');

      if (sel) {
        Array.from(sel.options).forEach(function(opt) {
          var seasonName = (opt.value || opt.textContent || '').trim();
          if (!seasonName) return;
          seasons.push({
            num: Utils.extractSeasonNum ? (Utils.extractSeasonNum(seasonName) || 0) : 0,
            name: seasonName
          });
          if (opt.selected) currentSeason = seasonName;
        });
      }

      if (!currentSeason) {
        var showEl = doc.querySelector('.v-category a');
        var showName = showEl ? showEl.textContent.trim() : '';
        if (showName) {
          currentSeason = showName;
          seasons.push({
            num: Utils.extractSeasonNum ? (Utils.extractSeasonNum(showName) || 0) : 0,
            name: showName
          });
        }
      }

      var seen = {};
      var deduped = [];
      seasons.forEach(function(s) {
        if (!s.name || seen[s.name]) return;
        seen[s.name] = true;
        deduped.push(s);
      });

      if (!currentSeason && deduped.length > 0) currentSeason = deduped[0].name;
      return { seasons: deduped, currentSeason: currentSeason };
    });
  }

  function buildShowModal(item) {
    var content = document.getElementById('hg-modal-content'); content.textContent = '';
    var continueItem = Utils.watchHistory && Utils.watchHistory.getContinueWatching ? Utils.watchHistory.getContinueWatching(item.showName || item.title) : null;
    var resumeHref = (continueItem && continueItem.href) ? continueItem.href : item.href;
    var seasonTabsDiv = document.createElement('div'); seasonTabsDiv.id = 'hgp-season-tabs';
    if (item.seasons && item.seasons.length > 0) {
      item.seasons.sort(function(a, b) { return (a.num || 999) - (b.num || 999); }).forEach(function(s, i) {
        var tab = document.createElement('button'); tab.className = 'hgp-season-tab' + (i === 0 ? ' active' : '');
        tab.dataset.season = s.name; tab.textContent = s.num ? 'S' + s.num : 'S1';
        tab.title = s.name || ('Season ' + (s.num || i + 1));
        seasonTabsDiv.appendChild(tab);
      });
    }

    var layout = document.createElement('div'); layout.id = 'hgp-layout';
    var mainCol = document.createElement('div'); mainCol.id = 'hgp-main';
    var videoWrap = document.createElement('div'); videoWrap.id = 'hgp-video-wrap';
    var video = document.createElement('video'); video.id = 'hgp-video'; video.playsInline = true; video.preload = 'auto';
    video.addEventListener('contextmenu', function(e) { e.preventDefault(); });
    videoWrap.appendChild(video);

    var loadingOverlay = document.createElement('div'); loadingOverlay.id = 'hgp-loading-overlay';
    var spinner = document.createElement('div'); spinner.className = 'hg-spinner'; loadingOverlay.appendChild(spinner);
    var loadingText = document.createElement('span'); loadingText.textContent = 'Loading video...'; loadingOverlay.appendChild(loadingText);
    videoWrap.appendChild(loadingOverlay);
    buildVideoControls(video, videoWrap, { modal: document.getElementById('hg-modal') });
    mainCol.appendChild(videoWrap);

    var infoBar = document.createElement('div'); infoBar.id = 'hgp-info';
    var infoLeft = document.createElement('div'); infoLeft.id = 'hgp-info-left';
    var titleEl = document.createElement('h1'); titleEl.id = 'hgp-title'; titleEl.textContent = 'Loading...'; infoLeft.appendChild(titleEl);
    var showNameEl = document.createElement('div'); showNameEl.id = 'hgp-show-name'; showNameEl.textContent = item.showName || item.title; infoLeft.appendChild(showNameEl);
    var statsEl = document.createElement('div'); statsEl.id = 'hgp-stats'; infoLeft.appendChild(statsEl);
    infoBar.appendChild(infoLeft);
    var infoActions = document.createElement('div');
    infoActions.id = 'hgp-info-actions';
    var myListBtn = document.createElement('button');
    myListBtn.className = 'hg-mylist-btn';
    infoActions.appendChild(myListBtn);
    var restartBtn = document.createElement('button');
    restartBtn.className = 'hg-mylist-btn';
    restartBtn.textContent = 'Start Over';
    infoActions.appendChild(restartBtn);
    var shareBtn = document.createElement('button');
    shareBtn.className = 'hg-mylist-btn';
    shareBtn.textContent = 'Share';
    infoActions.appendChild(shareBtn);
    var dlBtn = document.createElement('a'); dlBtn.id = 'hgp-dl-btn'; dlBtn.target = '_blank'; dlBtn.style.display = 'none'; dlBtn.textContent = '\u2B07 Download';
    infoActions.appendChild(dlBtn);
    infoBar.appendChild(infoActions); mainCol.appendChild(infoBar); layout.appendChild(mainCol);

    var sidebar = document.createElement('div'); sidebar.id = 'hgp-sidebar';
    sidebar.setAttribute('role', 'complementary'); sidebar.setAttribute('aria-label', 'Episode navigation');
    var sidebarHead = document.createElement('div'); sidebarHead.id = 'hgp-sidebar-head';
    var sidebarShow = document.createElement('div'); sidebarShow.id = 'hgp-sidebar-show'; sidebarShow.textContent = item.showName || item.title;
    sidebarHead.appendChild(sidebarShow);
    if (seasonTabsDiv.childNodes.length > 0) sidebarHead.appendChild(seasonTabsDiv);
    sidebar.appendChild(sidebarHead);

    var episodesList = document.createElement('div'); episodesList.id = 'hgp-episodes-list';
    episodesList.setAttribute('role', 'list'); episodesList.setAttribute('aria-label', 'Episodes list');
    var epsLoading = document.createElement('div'); epsLoading.id = 'hgp-eps-loading';
    var epsSpinner = document.createElement('div'); epsSpinner.className = 'hg-spinner'; epsLoading.appendChild(epsSpinner);
    episodesList.appendChild(epsLoading); sidebar.appendChild(episodesList); layout.appendChild(sidebar); content.appendChild(layout);

    bindSeasonTabs(seasonTabsDiv, content);

    updateMyListButton(myListBtn, item);
    myListBtn.addEventListener('click', function() {
      if (!Utils.myList || !Utils.myList.toggle) return;
      Utils.myList.toggle(item);
      updateMyListButton(myListBtn, item);
      document.querySelectorAll('.hg-card[data-id="' + item.id + '"]').forEach(function(card) {
        setCardMyListState(card, item);
      });
      refreshMyListSection();
    });
    restartBtn.addEventListener('click', function() {
      var v = content.querySelector('#hgp-video');
      if (!v) return;
      var src = v.getAttribute('src') || '';
      v.currentTime = 0;
      if (Utils.videoProgress && Utils.videoProgress.clear && src) Utils.videoProgress.clear(src);
      v.play().catch(function() {});
    });
    shareBtn.addEventListener('click', function() {
      var link = resumeHref && resumeHref.startsWith('http') ? resumeHref : ('https://hallagulla.club/classic/' + (resumeHref || item.href || ''));
      copyToClipboard(link).then(function(ok) {
        if (window.HGShared && HGShared.showToast) HGShared.showToast(document.querySelector('#hg-app') || document.body, ok ? 'Link copied' : 'Unable to copy link', ok ? 'success' : 'error', 1500);
      });
    });

    if (item.seasons && item.seasons.length > 0) {
      if (resumeHref && resumeHref !== item.href) {
        resolveShowSeasonsFromEpisode(resumeHref).then(function(meta) {
          var targetSeason = (meta && meta.currentSeason) ? meta.currentSeason : item.seasons[0].name;
          loadSeason(targetSeason, content, resumeHref);
        }).catch(function() {
          loadSeason(item.seasons[0].name, content, resumeHref);
        });
      } else {
        loadSeason(item.seasons[0].name, content, resumeHref);
      }
    } else if (item.href) {
      // Some show entries may not include season metadata.
      // Fallback to playing the saved episode directly so playback always starts.
      var fallbackEpNum = Utils.extractEpisodeNum ? (Utils.extractEpisodeNum(item.title) || 0) : 0;
      playEpisode({
        href: resumeHref || item.href,
        title: item.title || 'Episode',
        posterUrl: item.posterUrl || '',
        views: item.views || '',
        date: item.addedDate || '',
        epNum: fallbackEpNum,
        epLabel: fallbackEpNum ? ('E' + String(fallbackEpNum).padStart(2, '0')) : ''
      }, null, content);

      // Also hydrate season tabs + episode list from the current episode page.
      resolveShowSeasonsFromEpisode(resumeHref || item.href).then(function(meta) {
        if (!meta || !meta.currentSeason) {
          var noList = content.querySelector('#hgp-episodes-list');
          if (noList && noList.querySelector('#hgp-eps-loading')) {
            noList.textContent = '';
            var noEps = document.createElement('div');
            noEps.className = 'hgp-no-eps';
            noEps.textContent = 'Episode list unavailable for this title.';
            noList.appendChild(noEps);
          }
          return;
        }

        if (meta.seasons && meta.seasons.length > 0) {
          renderSeasonTabs(seasonTabsDiv, meta.seasons, meta.currentSeason);
          if (!sidebarHead.contains(seasonTabsDiv)) sidebarHead.appendChild(seasonTabsDiv);
          bindSeasonTabs(seasonTabsDiv, content);
        }

        loadSeason(meta.currentSeason, content, resumeHref || item.href);
      }).catch(function(err) {
        console.error('HG: failed to resolve season list from episode', err);
        var failedList = content.querySelector('#hgp-episodes-list');
        if (failedList && failedList.querySelector('#hgp-eps-loading')) {
          failedList.textContent = '';
          var failedMsg = document.createElement('div');
          failedMsg.className = 'hgp-no-eps';
          failedMsg.textContent = 'Failed to load episode list.';
          failedList.appendChild(failedMsg);
        }
      });
    }

    if (Utils.watchHistory) {
      Utils.watchHistory.save({ href: item.href.startsWith('http') ? item.href : 'https://hallagulla.club/classic/' + item.href,
        title: item.title, showName: item.showName || item.title, posterUrl: item.posterUrl, timestamp: Date.now() });
    }
    appendMoreLikeThis(content, item);
    setupModalKeyboard(content, video);
  }

  function loadSeason(seasonName, content, currentHref) {
    var myRequestId = ++_seasonRequestId;
    var list = content.querySelector('#hgp-episodes-list'); list.textContent = '';
    var loading = document.createElement('div'); loading.id = 'hgp-eps-loading';
    var sp = document.createElement('div'); sp.className = 'hg-spinner'; loading.appendChild(sp); list.appendChild(loading);
    fetchSeasonEpisodes(seasonName).then(function(episodes) {
      if (myRequestId !== _seasonRequestId) return;
      if (episodes.length === 0) { list.textContent = ''; var noEps = document.createElement('div'); noEps.className = 'hgp-no-eps'; noEps.textContent = 'No episodes found.'; list.appendChild(noEps); return; }
      renderEpisodes(episodes, list, content, currentHref);
      if (currentHref || episodes.length > 0) {
        var firstEp = episodes.find(function(ep) { return ep.href === currentHref || (currentHref && currentHref.indexOf(ep.href.replace('.html', '')) !== -1); }) || episodes[0];
        if (firstEp) { firstEp.isCurrent = true; playEpisode(firstEp, list.querySelector('.hgp-ep-item'), content); }
      }
    }).catch(function(err) {
      if (myRequestId !== _seasonRequestId) return;
      console.error('HG: failed to load season', seasonName, err);
      list.textContent = ''; var noEps = document.createElement('div'); noEps.className = 'hgp-no-eps'; noEps.textContent = 'Failed to load episodes.'; list.appendChild(noEps);
    });
  }

  function renderEpisodes(episodes, list, content, currentHref) {
    list.textContent = '';
    episodes.forEach(function(ep) {
      var url = ep.href.startsWith('http') ? ep.href : 'https://hallagulla.club/classic/' + ep.href;
      var row = document.createElement('div');
      row.className = 'hgp-ep-item' + (ep.isCurrent ? ' hgp-ep-current' : '');
      row.setAttribute('role', 'listitem'); row.setAttribute('tabindex', '0'); row.setAttribute('aria-label', ep.title);

      var numDiv = document.createElement('div'); numDiv.className = 'hgp-ep-num'; numDiv.textContent = ep.epNum || '?'; row.appendChild(numDiv);
      var thumbDiv = document.createElement('div'); thumbDiv.className = 'hgp-ep-thumb';
      if (ep.posterUrl) { var thumbImg = document.createElement('img'); thumbImg.src = ep.posterUrl; thumbImg.alt = ''; thumbImg.loading = 'lazy'; thumbDiv.appendChild(thumbImg); }
      else { var thumbBlank = document.createElement('div'); thumbBlank.className = 'hgp-ep-thumb-blank'; var thumbSpan = document.createElement('span'); thumbSpan.textContent = ep.epNum || '?'; thumbBlank.appendChild(thumbSpan); thumbDiv.appendChild(thumbBlank); }
      row.appendChild(thumbDiv);

      var infoDiv = document.createElement('div'); infoDiv.className = 'hgp-ep-info';
      var titleDiv = document.createElement('div'); titleDiv.className = 'hgp-ep-title'; titleDiv.textContent = ep.title; infoDiv.appendChild(titleDiv);
      var metaDiv = document.createElement('div'); metaDiv.className = 'hgp-ep-meta';
      if (ep.epLabel) { var codeSpan = document.createElement('span'); codeSpan.className = 'hgp-ep-code'; codeSpan.textContent = ep.epLabel; metaDiv.appendChild(codeSpan); }
      if (ep.views) { var viewsSpan = document.createElement('span'); viewsSpan.textContent = ep.views + ' views'; metaDiv.appendChild(viewsSpan); }
      if (ep.date) { var dateSpan = document.createElement('span'); dateSpan.textContent = ep.date; metaDiv.appendChild(dateSpan); }
      infoDiv.appendChild(metaDiv); row.appendChild(infoDiv);
      var arrow = document.createElement('div'); arrow.className = 'hgp-ep-arrow'; arrow.textContent = '\u25B6'; row.appendChild(arrow);

      row.addEventListener('click', function() { playEpisode(ep, row, content); });
      row.addEventListener('keydown', function(e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); playEpisode(ep, row, content); } });
      list.appendChild(row);
    });
    var currentRow = list.querySelector('.hgp-ep-current');
    if (currentRow) setTimeout(function() { currentRow.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 200);
  }

  function playEpisode(ep, row, content) {
    var myLoadId = ++_episodeLoadId;
    var url = ep.href.startsWith('http') ? ep.href : 'https://hallagulla.club/classic/' + ep.href;
    content.querySelectorAll('.hgp-ep-item').forEach(function(r) { r.classList.remove('hgp-ep-current'); r.setAttribute('aria-current', 'false'); });
    if (row) { row.classList.add('hgp-ep-current'); row.setAttribute('aria-current', 'true'); }

    var overlay = content.querySelector('#hgp-loading-overlay');
    if (overlay) setVideoOverlayState(overlay, 'loading');

    Utils.fetchWithCache(url, { credentials: 'same-origin' }, true).then(function(html) {
      if (myLoadId !== _episodeLoadId) return;
      var doc = new DOMParser().parseFromString(html, 'text/html');
      var videoUrl = HGShared.extractVideoUrl(doc);
      var og = doc.querySelector('meta[property="og:image"]'); var poster = og ? og.getAttribute('content') : '';
      var titleEl = doc.querySelector('.v-title'); var newTitle = titleEl ? titleEl.textContent.trim() : ep.title;
      var showEl = doc.querySelector('.v-category a'); var showName = showEl ? showEl.textContent.trim() : '';
      var vcats = doc.querySelectorAll('.v-category2'); var views = '', downloads = '';
      vcats.forEach(function(el) { var t = el.textContent.trim(); if (t.toLowerCase().indexOf('view') === 0) views = t.replace(/View\s*:\s*/i, '').trim(); if (t.toLowerCase().indexOf('download') === 0) downloads = t.replace(/Download\s*:\s*/i, '').trim(); });
      var dlEl = doc.querySelector('#setCounter[href], a[href*="cdnnow.co"]'); var dlUrl = dlEl ? (dlEl.getAttribute('href') || videoUrl) : videoUrl;
      var video = content.querySelector('#hgp-video');
      if (video && videoUrl) {
        var retryPlay = function() { playEpisode(ep, row, content); };
        setVideoOverlayState(overlay, 'preparing');
        video.pause(); video.removeAttribute('src'); video.load();
        if (_videoTrackingInterval) { clearInterval(_videoTrackingInterval); _videoTrackingInterval = null; }
        video.src = videoUrl; if (poster) video.poster = poster; video.load();
        bindVideoPlaybackUI(video, overlay, retryPlay);
        video.play().catch(function() {});
        setupVideoTracking(video, videoUrl);
      } else if (overlay) { setVideoOverlayError(overlay, 'Video not available for streaming', function() { playEpisode(ep, row, content); }); }

      var titleDisplay = content.querySelector('#hgp-title'); if (titleDisplay) titleDisplay.textContent = newTitle;
      var showDisplay = content.querySelector('#hgp-show-name'); var displayShow = showName ? showName.replace(/\s*[-\u2013]\s*Season\s+\d+.*/i, '').trim() : '';
      if (showDisplay && displayShow) showDisplay.textContent = displayShow;

      var statsEl = content.querySelector('#hgp-stats');
      if (statsEl) { statsEl.textContent = ''; if (views) { var vS = document.createElement('span'); vS.textContent = '\uD83D\uDC41 ' + views + ' views'; statsEl.appendChild(vS); } if (downloads) { var dS = document.createElement('span'); dS.textContent = '\u2B07 ' + downloads + ' downloads'; statsEl.appendChild(dS); } }
      var dlBtn = content.querySelector('#hgp-dl-btn'); if (dlBtn) { if (dlUrl) { dlBtn.href = dlUrl; dlBtn.style.display = ''; } else { dlBtn.style.display = 'none'; } }

      if (Utils.watchHistory) { Utils.watchHistory.save({ href: url, title: newTitle, showName: displayShow || showName, posterUrl: poster || '', timestamp: Date.now() }); }
      history.replaceState({ ep: url }, newTitle, window.location.pathname + window.location.search);
    }).catch(function(err) {
      if (myLoadId !== _episodeLoadId) return;
      console.error('HG: failed to load episode', err);
      if (overlay) { setVideoOverlayError(overlay, 'Failed to load video', function() { playEpisode(ep, row, content); }); }
    });
  }

  function setupVideoTracking(video, videoUrl) {
    if (!Utils.videoProgress) return;
    if (_videoTrackingInterval) { clearInterval(_videoTrackingInterval); _videoTrackingInterval = null; }
    var savedData = Utils.videoProgress.get(videoUrl); var savedTime = 0;
    if (typeof savedData === 'object' && savedData !== null) { savedTime = savedData.currentTime || 0; } else { savedTime = typeof savedData === 'number' ? savedData : 0; }
    if (savedTime > 0) { video.addEventListener('loadedmetadata', function() { if (savedTime < video.duration - 30) { video.currentTime = savedTime; showResumeNotification(video, savedTime); } }, { once: true }); }
    _videoTrackingInterval = setInterval(function() { if (video.paused || video.ended) return; Utils.videoProgress.save(videoUrl, video.currentTime, video.duration); }, 10000);
    video.addEventListener('ended', function() { if (_videoTrackingInterval) { clearInterval(_videoTrackingInterval); _videoTrackingInterval = null; } Utils.videoProgress.clear(videoUrl); }, { once: true });
  }

  function showResumeNotification(video, time) {
    var content = document.querySelector('#hg-modal-content'); if (!content) return;
    var wrap = content.querySelector('#hgp-video-wrap'); if (!wrap) return;
    var notification = document.createElement('div'); notification.className = 'hgp-resume-notification';
    var timeStr = Utils.formatDuration ? Utils.formatDuration(time) : Math.floor(time / 60) + ':' + String(Math.floor(time % 60)).padStart(2, '0');
    var span = document.createElement('span'); span.textContent = 'Resumed from ' + timeStr; notification.appendChild(span);
    var btn = document.createElement('button'); btn.textContent = 'Restart'; btn.addEventListener('click', function() { video.currentTime = 0; notification.remove(); });
    notification.appendChild(btn); wrap.appendChild(notification); setTimeout(function() { notification.remove(); }, 5000);
  }

  function setupModalKeyboard(content, video) {
    content._keyHandler = function(e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      switch (e.key) {
        case ' ': if (video) { e.preventDefault(); if (video.paused) video.play(); else video.pause(); } break;
        case 'ArrowRight': if (video) { e.preventDefault(); video.currentTime = Math.min(video.currentTime + 10, video.duration || 0); } break;
        case 'ArrowLeft': if (video) { e.preventDefault(); video.currentTime = Math.max(video.currentTime - 10, 0); } break;
        case 'ArrowUp': if (video) { e.preventDefault(); video.volume = Math.min(video.volume + 0.1, 1); } break;
        case 'ArrowDown': if (video) { e.preventDefault(); video.volume = Math.max(video.volume - 0.1, 0); } break;
        case 'f': if (video) { e.preventDefault(); if (document.fullscreenElement) document.exitFullscreen(); else video.requestFullscreen(); } break;
        case 'p': if (Utils.supportsPIP && Utils.supportsPIP() && video) { e.preventDefault(); Utils.togglePIP(video).catch(function() {}); } break;
        case 'c': { e.preventDefault(); var _m = document.getElementById('hg-modal'); if (_m) { var _on = _m.classList.toggle('hg-cinema-mode'); var _cb = _m.querySelector('.hgc-cinema'); if (_cb) { _cb.classList.toggle('hgc-cinema-on', _on); _cb.title = _on ? 'Exit Cinema Mode  (C)' : 'Cinema Mode  (C)'; } } break; }
        case 'm': if (video) { e.preventDefault(); video.muted = !video.muted; } break;
      }
    };
    document.addEventListener('keydown', content._keyHandler);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UNIFIED MODAL
  // ═══════════════════════════════════════════════════════════════════════════

  // Track last focused element for focus restoration
  var _lastFocusedElement = null;
  var _focusTrapHandler = null;

  // Get focusable elements within modal
  function getFocusableElements(modal) {
    var focusableSelectors = [
      'button:not([disabled])',
      'a[href]',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
      'video',
      'audio'
    ];
    return Array.from(modal.querySelectorAll(focusableSelectors.join(', ')));
  }

  // Focus trap to keep focus within modal
  function setupFocusTrap(modal) {
    var focusableElements = getFocusableElements(modal);
    if (focusableElements.length === 0) return;

    var firstFocusable = focusableElements[0];
    var lastFocusable = focusableElements[focusableElements.length - 1];

    _focusTrapHandler = function(e) {
      if (e.key !== 'Tab') return;

      if (e.shiftKey) {
        // Shift + Tab
        if (document.activeElement === firstFocusable) {
          e.preventDefault();
          lastFocusable.focus();
        }
      } else {
        // Tab
        if (document.activeElement === lastFocusable) {
          e.preventDefault();
          firstFocusable.focus();
        }
      }
    };

    modal.addEventListener('keydown', _focusTrapHandler);

    // Focus first focusable element
    firstFocusable.focus();
  }

  function removeFocusTrap(modal) {
    if (_focusTrapHandler) {
      modal.removeEventListener('keydown', _focusTrapHandler);
      _focusTrapHandler = null;
    }
  }

  // Announce changes to screen readers
  function announceToScreenReader(message) {
    var announcer = document.getElementById('hg-sr-announcer');
    if (!announcer) {
      announcer = document.createElement('div');
      announcer.id = 'hg-sr-announcer';
      announcer.setAttribute('role', 'status');
      announcer.setAttribute('aria-live', 'polite');
      announcer.setAttribute('aria-atomic', 'true');
      announcer.style.cssText = 'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;';
      document.body.appendChild(announcer);
    }
    announcer.textContent = '';
    setTimeout(function() { announcer.textContent = message; }, 100);
  }

  function openModal(item) {
    var modal = document.getElementById('hg-modal'); if (!modal) return;
    var oldContent = modal.querySelector('#hg-modal-content');
    if (oldContent && oldContent._keyHandler) { document.removeEventListener('keydown', oldContent._keyHandler); oldContent._keyHandler = null; }
    if (_videoTrackingInterval) { clearInterval(_videoTrackingInterval); _videoTrackingInterval = null; }

    // Store last focused element for restoration
    _lastFocusedElement = document.activeElement;

    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    // Set aria-hidden on main content
    var main = document.getElementById('hg-main');
    if (main) main.setAttribute('aria-hidden', 'true');

    // Set focus to modal
    modal.setAttribute('aria-hidden', 'false');

    if (item.type === 'show') buildShowModal(item); else buildMovieModal(item);

    // Setup focus trap after content is rendered
    setTimeout(function() {
      setupFocusTrap(modal);
      announceToScreenReader('Modal opened. ' + (item.type === 'show' ? 'TV Show episodes loaded.' : 'Movie details loaded.'));
    }, 100);
  }

  function closeModal() {
    var modal = document.getElementById('hg-modal'); if (!modal || modal.style.display === 'none') return;
    var movieVideo = document.getElementById('hg-video'); if (movieVideo) { if (movieVideo._hgDetachUiHandlers) movieVideo._hgDetachUiHandlers(); movieVideo.pause(); movieVideo.removeAttribute('src'); movieVideo.load(); }
    var showVideo = document.getElementById('hgp-video'); if (showVideo) { if (showVideo._hgDetachUiHandlers) showVideo._hgDetachUiHandlers(); showVideo.pause(); showVideo.removeAttribute('src'); showVideo.load(); }
    if (_videoTrackingInterval) { clearInterval(_videoTrackingInterval); _videoTrackingInterval = null; }
    var content = modal.querySelector('#hg-modal-content');
    if (content && content._keyHandler) { document.removeEventListener('keydown', content._keyHandler); content._keyHandler = null; }

    // Remove focus trap
    removeFocusTrap(modal);

    // Restore aria-hidden states
    modal.setAttribute('aria-hidden', 'true');
    var main = document.getElementById('hg-main');
    if (main) main.setAttribute('aria-hidden', 'false');

    modal.style.display = 'none';
    document.body.style.overflow = '';

    // Restore focus to last focused element
    if (_lastFocusedElement && typeof _lastFocusedElement.focus === 'function') {
      _lastFocusedElement.focus();
    }

    announceToScreenReader('Modal closed.');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SEARCH
  // ═══════════════════════════════════════════════════════════════════════════

  function inferSearchMeta(item) {
    var title = (item && item.title ? item.title : '').toLowerCase();
    var genre = (item && item.genre ? item.genre.split(',')[0].trim() : '');
    if (!genre) {
      if (title.indexOf('comedy') !== -1) genre = 'Comedy';
      else if (title.indexOf('drama') !== -1) genre = 'Drama';
      else if (title.indexOf('action') !== -1 || title.indexOf('thriller') !== -1) genre = 'Action';
      else if (title.indexOf('romance') !== -1 || title.indexOf('love') !== -1) genre = 'Romance';
    }
    var yearMatch = (item && item.year ? String(item.year) : '').match(/\b(19|20)\d{2}\b/) || title.match(/\b(19|20)\d{2}\b/);
    var year = yearMatch ? yearMatch[0] : '';
    var language = '';
    if (title.indexOf('korean') !== -1 || title.indexOf('k-drama') !== -1) language = 'Korean';
    else if (title.indexOf('urdu') !== -1 || title.indexOf('pakistani') !== -1) language = 'Urdu';
    else if (title.indexOf('hindi') !== -1 || title.indexOf('bollywood') !== -1) language = 'Hindi';
    else if (title.indexOf('english') !== -1 || title.indexOf('hollywood') !== -1) language = 'English';
    else if (title.indexOf('dual audio') !== -1) language = 'Dual Audio';
    return { genre: genre || '', year: year || '', language: language || '' };
  }

  function highlightMatches(el, q) {
    if (!el) return;
    var query = String(q || '').trim();
    if (!query) return;
    var text = el.textContent || '';
    if (!text) return;
    var lower = text.toLowerCase();
    var qLower = query.toLowerCase();
    var idx = lower.indexOf(qLower);
    if (idx < 0) return;
    var frag = document.createDocumentFragment();
    var start = 0;
    while (idx >= 0) {
      if (idx > start) frag.appendChild(document.createTextNode(text.slice(start, idx)));
      var mark = document.createElement('mark');
      mark.className = 'hg-search-mark';
      mark.textContent = text.slice(idx, idx + query.length);
      frag.appendChild(mark);
      start = idx + query.length;
      idx = lower.indexOf(qLower, start);
    }
    if (start < text.length) frag.appendChild(document.createTextNode(text.slice(start)));
    el.textContent = '';
    el.appendChild(frag);
  }

  function getFacetOptions(items, key) {
    var set = {};
    items.forEach(function(item) {
      var meta = inferSearchMeta(item);
      if (meta[key]) set[meta[key]] = true;
    });
    return Object.keys(set).sort();
  }

  function applySearchFilters(items) {
    return (items || []).filter(function(item) {
      if (_searchScope === 'movies' && item.type !== 'movie') return false;
      if (_searchScope === 'shows' && item.type !== 'show') return false;
      var meta = inferSearchMeta(item);
      if (_searchFacetState.genre !== 'all' && meta.genre !== _searchFacetState.genre) return false;
      if (_searchFacetState.year !== 'all' && meta.year !== _searchFacetState.year) return false;
      if (_searchFacetState.language !== 'all' && meta.language !== _searchFacetState.language) return false;
      return true;
    });
  }

  function buildFacetSelect(label, key, options, onChange) {
    var wrap = document.createElement('label');
    wrap.className = 'hg-search-facet';
    var span = document.createElement('span');
    span.textContent = label;
    wrap.appendChild(span);
    var sel = document.createElement('select');
    var all = document.createElement('option');
    all.value = 'all';
    all.textContent = 'All';
    sel.appendChild(all);
    options.forEach(function(opt) {
      var o = document.createElement('option');
      o.value = opt;
      o.textContent = opt;
      sel.appendChild(o);
    });
    sel.value = _searchFacetState[key] || 'all';
    sel.addEventListener('change', function() {
      _searchFacetState[key] = sel.value || 'all';
      onChange();
    });
    wrap.appendChild(sel);
    return wrap;
  }

  function updateSearchActiveCard(resultsDiv, index) {
    var cards = resultsDiv.querySelectorAll('.hg-search-grid .hg-card');
    cards.forEach(function(card, i) {
      card.classList.toggle('hg-search-active', i === index);
      if (i === index) card.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  }

  function renderSearchResults(resultsDiv, q, items) {
    resultsDiv.textContent = '';
    _searchRawItems = items || [];
    var topBar = document.createElement('div');
    topBar.className = 'hg-search-topbar';
    var scopeTabs = document.createElement('div');
    scopeTabs.className = 'hg-search-scope-tabs';
    [
      { id: 'all', label: 'All' },
      { id: 'movies', label: 'Movies' },
      { id: 'shows', label: 'TV Shows' }
    ].forEach(function(scope) {
      var btn = document.createElement('button');
      btn.className = 'hg-search-scope-tab' + (_searchScope === scope.id ? ' active' : '');
      btn.textContent = scope.label;
      btn.addEventListener('click', function() {
        _searchScope = scope.id;
        renderSearchResults(resultsDiv, q, _searchRawItems);
      });
      scopeTabs.appendChild(btn);
    });
    topBar.appendChild(scopeTabs);

    var facets = document.createElement('div');
    facets.className = 'hg-search-facets';
    facets.appendChild(buildFacetSelect('Genre', 'genre', getFacetOptions(_searchRawItems, 'genre'), function() {
      renderSearchResults(resultsDiv, q, _searchRawItems);
    }));
    facets.appendChild(buildFacetSelect('Year', 'year', getFacetOptions(_searchRawItems, 'year'), function() {
      renderSearchResults(resultsDiv, q, _searchRawItems);
    }));
    facets.appendChild(buildFacetSelect('Language', 'language', getFacetOptions(_searchRawItems, 'language'), function() {
      renderSearchResults(resultsDiv, q, _searchRawItems);
    }));
    topBar.appendChild(facets);
    resultsDiv.appendChild(topBar);

    var filtered = applySearchFilters(_searchRawItems);
    var count = document.createElement('div');
    count.id = 'hg-search-count';
    count.className = 'hg-search-count';
    count.textContent = filtered.length + ' result' + (filtered.length === 1 ? '' : 's') + ' for "' + q + '"';
    resultsDiv.appendChild(count);

    if (filtered.length === 0) {
      var noR = document.createElement('div');
      noR.className = 'hg-search-empty';
      var fallback = document.createElement('p');
      fallback.textContent = 'No results for "' + q + '".';
      noR.appendChild(fallback);
      var suggestions = document.createElement('div');
      suggestions.className = 'hg-search-zero-suggest';
      ['Try a shorter keyword', 'Try searching in All scope', 'Try another genre or language'].forEach(function(t) {
        var s = document.createElement('span');
        s.textContent = t;
        suggestions.appendChild(s);
      });
      noR.appendChild(suggestions);
      resultsDiv.appendChild(noR);
      _searchItems = [];
      _searchIndex = -1;
      return;
    }

    var grid = document.createElement('div');
    grid.className = 'hg-search-grid';
    filtered.forEach(function(item) {
      grid.appendChild(buildCard(item));
    });
    resultsDiv.appendChild(grid);
    grid.querySelectorAll('.hg-card-title').forEach(function(titleEl) {
      highlightMatches(titleEl, q);
    });
    _searchItems = filtered;
    _searchIndex = -1;
  }

  function handleSearch(q) {
    var resultsDiv = document.getElementById('hg-search-results'); if (!resultsDiv) return;
    var hero = document.getElementById('hg-hero');
    if (q.length < 2) {
      resultsDiv.style.display = 'none'; resultsDiv.textContent = '';
      if (hero) hero.style.display = '';
      _searchItems = [];
      _searchIndex = -1;
      return;
    }
    if (q !== _searchLastQuery) {
      _searchScope = 'all';
      _searchFacetState = { genre: 'all', year: 'all', language: 'all' };
      _searchLastQuery = q;
    }
    if (Utils.searchHistory && Utils.searchHistory.add) Utils.searchHistory.add(q);
    resultsDiv.style.display = '';
    if (hero) hero.style.display = 'none';
    _searchItems = [];
    _searchIndex = -1;
    resultsDiv.textContent = '';
    var skeleton = document.createElement('div'); skeleton.className = 'hg-search-grid';
    for (var i = 0; i < 8; i++) { var sk = document.createElement('div'); sk.className = 'hg-skeleton hg-skeleton-card'; skeleton.appendChild(sk); }
    resultsDiv.appendChild(skeleton);

    // Respect active tab filter
    var activeTab = document.querySelector('.hg-nav-tab.active');
    var activeFilter = activeTab ? (activeTab.dataset.filter || 'home') : 'home';
    var fetchMovies = activeFilter !== 'shows';
    var fetchShows = activeFilter !== 'movies';

    var promises = [];
    if (fetchMovies) promises.push(fetchMoviesPage(1, 'k=' + encodeURIComponent(q)).catch(function() { return []; }));
    if (fetchShows) promises.push(fetchShowsPage(1, 'k=' + encodeURIComponent(q)).catch(function() { return []; }));

    if (promises.length === 0) {
      renderSearchResults(resultsDiv, q, []);
      return;
    }

    var cacheKey = activeFilter + '::' + q.toLowerCase();
    if (_searchCache[cacheKey]) {
      renderSearchResults(resultsDiv, q, _searchCache[cacheKey]);
      return;
    }

    var reqId = ++_searchReqId;
    Promise.all(promises).then(function(results) {
      if (reqId !== _searchReqId) return;
      var allItems = [].concat.apply([], results);
      var seen = {};
      var deduped = allItems.filter(function(item) {
        var key = item.type + ':' + (item.href || item.id || item.title);
        if (seen[key]) return false;
        seen[key] = true;
        return true;
      });
      _searchCache[cacheKey] = deduped;
      renderSearchResults(resultsDiv, q, deduped);
    }).catch(function() {
      if (reqId !== _searchReqId) return;
      renderSearchResults(resultsDiv, q, []);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ═══════════════════════════════════════════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════════════════════════════════════════

  function init() {
    document.body.style.visibility = 'hidden';
    var shell = buildShell();
    document.body.appendChild(shell);
    document.body.style.visibility = 'visible';
    var prefs = (Utils.preferences && Utils.preferences.get) ? Utils.preferences.get() : {};
    if (prefs && prefs.reducedMotion) document.body.classList.add('hg-reduced-motion');
    var savedState = getUiState();

    var content = shell.querySelector('#hg-content');
    renderAccountPanel(shell.querySelector('#hg-account-panel'));
    var initialMovies = parseMoviesFromDoc(document);
    var initialEpisodes = parseShowsFromDoc(document);
    var initialShows = Array.from(mergeEpisodesToShowMap(initialEpisodes).values());

    // Hero
    var heroItems = [].concat(initialMovies, initialShows).filter(function(item) { return item.posterUrl; }).slice(0, 6);
    if (heroItems.length > 0) { _allHeroSlides = heroItems; populateHero(heroItems); }

    // Recently Added row with initial content
    var myListRow = buildCarouselSection({
      id: 'mylist',
      title: 'My List',
      type: 'mixed',
      fetchFn: function() { return Promise.resolve(buildMyListItems()); }
    });
    populateCarousel(myListRow, buildMyListItems());
    content.appendChild(myListRow);
    myListRow._loaded = true;
    renderMyListManager();

    // Recently Added row with initial content
    var initialAll = [].concat(initialMovies, initialShows);
    var recentRow = buildCarouselSection({ id: 'recent', title: 'Recently Added', type: 'mixed' });
    populateCarousel(recentRow, initialAll); content.appendChild(recentRow); recentRow._loaded = true;

    // Lazy-loaded rows
    ROW_DEFS.forEach(function(rowDef) {
      if (rowDef.id === 'recent') return;
      var section = buildCarouselSection(rowDef); content.appendChild(section);
    });

    // IntersectionObserver for lazy loading
    var isSmallScreen = window.innerWidth <= 768;
    var lazyRootMargin = isSmallScreen ? '0px 0px 1500px 0px' : '0px 0px 800px 0px';
    var infiniteRootMargin = isSmallScreen ? '0px 0px 1000px 0px' : '0px 0px 600px 0px';
    var observer = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (entry.isIntersecting && !entry.target._loaded) {
          var section = entry.target; section._loaded = true; observer.unobserve(section);
          var rowDef = section._rowDef;
          if (rowDef && rowDef.fetchFn) {
            rowDef.fetchFn()
              .then(function(items) { populateCarousel(section, items); })
              .catch(function() {
                renderRowState(section, 'Failed to load this row.', function() {
                  renderRowState(section, 'Loading...');
                  rowDef.fetchFn()
                    .then(function(retryItems) { populateCarousel(section, retryItems); })
                    .catch(function() { renderRowState(section, 'Still failed to load.'); });
                });
              });
          }
        }
      });
    }, { root: null, rootMargin: lazyRootMargin, threshold: 0 });
    content.querySelectorAll('.hg-carousel-section').forEach(function(section) { if (!section._loaded) observer.observe(section); });

    // Infinite scroll for "All Movies" and "All TV Shows" sections
    var infiniteSections = content.querySelectorAll('[data-row-id="allmovies"], [data-row-id="allshows"]');
    infiniteSections.forEach(function(section) {
      var sentinel = document.createElement('div');
      sentinel.className = 'hg-infinite-sentinel';
      section.appendChild(sentinel);
      var infiniteObserver = new IntersectionObserver(function(entries) {
        if (entries[0].isIntersecting && !section._allLoaded && section._loaded && !section._loadingMore) {
          appendMoreToSection(section);
        }
      }, { root: null, rootMargin: infiniteRootMargin, threshold: 0 });
      infiniteObserver.observe(sentinel);
    });

    // Hero buttons
    var heroPlay = shell.querySelector('#hg-hero-play');
    var heroInfo = shell.querySelector('#hg-hero-info');
    if (heroPlay) heroPlay.addEventListener('click', function() { if (_heroSlides[_heroIndex]) openModal(_heroSlides[_heroIndex]); });
    if (heroInfo) heroInfo.addEventListener('click', function() { if (_heroSlides[_heroIndex]) openModal(_heroSlides[_heroIndex]); });

    document.addEventListener('keydown', function(e) { if (e.key === 'Escape') closeModal(); });

    var urlParams = new URLSearchParams(window.location.search);
    var urlFilter = urlParams.get('view') || '';
    var urlQuery = urlParams.get('q') || '';

    if (urlQuery || (savedState && savedState.searchQuery)) {
      var search = shell.querySelector('#hg-search');
      var clearBtn = shell.querySelector('#hg-search-clear');
      var queryToUse = urlQuery || savedState.searchQuery;
      if (search) {
        search.value = queryToUse;
        if (clearBtn) clearBtn.style.display = queryToUse ? 'inline-flex' : 'none';
        handleSearch(queryToUse);
      }
    }

    var filterToUse = urlFilter || (savedState && savedState.filter) || '';
    if (filterToUse) {
      var savedTab = shell.querySelector('.hg-nav-tab[data-filter="' + filterToUse + '"]');
      if (savedTab) {
        shell.querySelectorAll('.hg-nav-tab').forEach(function(t) {
          t.classList.remove('active');
          t.setAttribute('aria-selected', 'false');
          t.setAttribute('tabindex', '-1');
        });
        savedTab.classList.add('active');
        savedTab.setAttribute('aria-selected', 'true');
        savedTab.setAttribute('tabindex', '0');
        shell.dataset.filter = filterToUse;
        applyFilter(shell, filterToUse);
      }
    }

    if (savedState && savedState.scrollTop) {
      setTimeout(function() { shell.scrollTop = savedState.scrollTop; }, 50);
    }

    var s = document.createElement('style');
    s.textContent = 'body>*:not(#hg-app){display:none!important}body{background:#000!important;margin:0!important;padding:0!important;overflow:hidden!important}';
    document.head.appendChild(s);
  }

  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', init); } else { init(); }
})();
