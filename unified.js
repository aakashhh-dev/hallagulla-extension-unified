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
  function extractVideoUrl(doc) {
    var srcEl = doc.querySelector('#video-player source, video source, #video-player video source');
    var url = srcEl ? (srcEl.getAttribute('src') || '') : '';
    if (!url) { var ve = doc.querySelector('#video-player, video'); if (ve) url = ve.getAttribute('src') || ''; }
    if (!url) { var pe = doc.querySelector('#video-player'); if (pe) { var ds = pe.getAttribute('data-setup') || ''; if (ds) { try { var s = JSON.parse(ds); if (s.sources && s.sources[0] && s.sources[0].src) url = s.sources[0].src; } catch (e) {} } } }
    if (!url) { var dlEl = doc.querySelector('#setCounter[href], a[href*="cdnnow.co"]'); if (dlEl) url = dlEl.getAttribute('href') || ''; }
    return url;
  }

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

  function parseMoviesFromDoc(doc) {
    var items = [];
    doc.querySelectorAll('.thumb').forEach(function(thumb) {
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
    doc.querySelectorAll('.thumb').forEach(function(thumb) {
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
        r.videoUrl = extractVideoUrl(doc);
        doc.querySelectorAll('table tr').forEach(function(row) {
          var cells = row.querySelectorAll('td'); if (cells.length < 3) return;
          var label = cells[0].textContent.trim().toLowerCase(); var value = cells[2].textContent.trim(); var inner = cells[2].innerHTML;
          if (label === 'description') r.description = value; if (label === 'genre') r.genre = inner;
          if (label === 'length') r.length = value; if (label === 'country') r.country = value;
          if (label === 'language') r.language = value; if (label === 'actors') r.actors = inner;
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
        doc.querySelectorAll('.thumb, .col-item').forEach(function(item) {
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

  // Infinite-scroll: append next page to "All Movies" / "All TV Shows"
  function appendMoreToSection(section) {
    if (section._loadingMore) return;
    var rowDef = section._rowDef;
    if (!rowDef) return;
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
        var endMsg = document.createElement('div'); endMsg.className = 'hg-section-end'; endMsg.textContent = 'You\'ve seen it all';
        section._carousel.appendChild(endMsg);
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
    { id: 'continue',  title: 'Continue Watching',  type: 'mixed', fetchFn: null },
    { id: 'trending',  title: 'Trending Now',        type: 'mixed', fetchFn: function() { return fetchMoviesPage(1, 'Sortby=MostView'); } },
    { id: 'recent',    title: 'Recently Added',       type: 'mixed', fetchFn: function() { return fetchMoviesPage(1, 'Sortby=Recent'); } },
    { id: 'newshows',  title: 'New Shows',             type: 'show',  fetchFn: function() { return fetchShowsPage(1, 'Sortby=Recent'); } },
    { id: 'bollywood',  title: 'Bollywood',            type: 'movie', fetchFn: function() { return fetchMoviesPage(1, 'cat=3'); } },
    { id: 'hollywood',  title: 'Hollywood',            type: 'movie', fetchFn: function() { return fetchMoviesPage(1, 'cat=4'); } },
    { id: 'webseries', title: 'Web Series',            type: 'show',  fetchFn: function() { return fetchShowsPage(1, 'cat=3'); } },
    { id: 'dualaudio', title: 'Dual Audio',             type: 'movie', fetchFn: function() { return fetchMoviesPage(1, 'cat=26'); } },
    { id: 'action',    title: 'Action & Thriller',     type: 'movie', fetchFn: function() { return fetchMoviesPage(1, 'genre=Action'); } },
    { id: 'comedy',    title: 'Comedy',                type: 'movie', fetchFn: function() { return fetchMoviesPage(1, 'genre=Comedy'); } },
    { id: 'drama',     title: 'Drama',                 type: 'movie', fetchFn: function() { return fetchMoviesPage(1, 'genre=Drama'); } },
    { id: 'kids',      title: 'Kids',                  type: 'movie', fetchFn: function() { return fetchMoviesPage(1, 'cat=25'); } },
    { id: 'korean',    title: 'Korean Shows',           type: 'show',  fetchFn: function() { return fetchShowsPage(1, 'cat=17'); } },
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
    var card = document.createElement('div');
    card.className = 'hg-card';
    card.dataset.type = item.type;
    card.dataset.id = item.id;

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
    typeBadge.className = 'hg-card-type-badge' + (item.type === 'movie' ? ' hg-card-type-movie' : '');
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

    // NEW badge
    if (item.addedDate) {
      try {
        var daysAgo = (Date.now() - new Date(item.addedDate).getTime()) / (1000 * 60 * 60 * 24);
        if (daysAgo < 7 && daysAgo >= 0) {
          var newBadge = document.createElement('div'); newBadge.className = 'hg-card-new-badge'; newBadge.textContent = 'NEW';
          posterDiv.appendChild(newBadge);
        }
      } catch (e) {}
    }

    // Hover overlay
    var overlay = document.createElement('div'); overlay.className = 'hg-card-overlay';
    var playBtn = document.createElement('button'); playBtn.className = 'hg-card-play-btn'; playBtn.textContent = '\u25B6';
    overlay.appendChild(playBtn); posterDiv.appendChild(overlay);
    card.appendChild(posterDiv);

    // Card info — always visible below poster (Netflix style)
    var info = document.createElement('div'); info.className = 'hg-card-info';
    var titleDiv = document.createElement('div'); titleDiv.className = 'hg-card-title'; titleDiv.textContent = item.title;
    info.appendChild(titleDiv);
    var metaDiv = document.createElement('div'); metaDiv.className = 'hg-card-meta';
    if (item.type === 'show' && item.totalEpisodes) {
      var epSpan = document.createElement('span'); epSpan.textContent = item.totalEpisodes + ' ep'; metaDiv.appendChild(epSpan);
    }
    if (item.rating) { var ratSpan = document.createElement('span'); ratSpan.textContent = '\u2605 ' + item.rating; metaDiv.appendChild(ratSpan); }
    if (item.views) { var viewSpan = document.createElement('span'); viewSpan.textContent = formatNumber(parseInt(item.views, 10)) + ' views'; metaDiv.appendChild(viewSpan); }
    info.appendChild(metaDiv); card.appendChild(info);
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

  function populateCarousel(section, items) {
    var carousel = section._carousel; carousel.textContent = '';
    items.forEach(function(item, i) {
      var card = buildCard(item); card.style.animationDelay = (i % 12 * 40) + 'ms'; carousel.appendChild(card);
    });
    // Queue poster backfill for shows without thumbnails
    queuePosterBackfill(items);
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
    wrap.addEventListener('scroll', function() {
      var header = wrap.querySelector('#hg-header');
      if (header) header.classList.toggle('hg-scrolled', wrap.scrollTop > 40);
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
    ['Home', 'Movies', 'TV Shows'].forEach(function(label, i) {
      var btn = document.createElement('button');
      btn.className = 'hg-nav-tab' + (i === 0 ? ' active' : '');
      btn.dataset.filter = ['home', 'movies', 'shows'][i];
      btn.textContent = label;
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', i === 0 ? 'true' : 'false');
      btn.setAttribute('aria-controls', 'hg-content');
      btn.id = 'hg-tab-' + ['home', 'movies', 'shows'][i];
      nav.appendChild(btn);
    });
    header.appendChild(nav);

    var searchWrap = document.createElement('div'); searchWrap.id = 'hg-search-wrap';
    var searchInput = document.createElement('input');
    searchInput.id = 'hg-search';
    searchInput.type = 'text';
    searchInput.placeholder = 'Search movies & shows...';
    searchInput.autocomplete = 'off';
    searchInput.setAttribute('aria-label', 'Search movies and shows');
    searchWrap.appendChild(searchInput); header.appendChild(searchWrap);
    wrap.appendChild(header);

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
    var heroButtons = document.createElement('div'); heroButtons.className = 'hg-hero-buttons';
    var heroPlayBtn = document.createElement('button'); heroPlayBtn.className = 'hg-hero-btn hg-hero-btn-primary'; heroPlayBtn.id = 'hg-hero-play'; heroPlayBtn.textContent = '\u25B6 Play';
    heroPlayBtn.setAttribute('aria-label', 'Play featured content');
    heroButtons.appendChild(heroPlayBtn);
    var heroInfoBtn = document.createElement('button'); heroInfoBtn.className = 'hg-hero-btn hg-hero-btn-secondary'; heroInfoBtn.id = 'hg-hero-info'; heroInfoBtn.textContent = 'More Info';
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
    content.appendChild(searchResults);
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
        nav.querySelectorAll('.hg-nav-tab').forEach(function(t) { t.classList.remove('active'); });
        this.classList.add('active');
        var filter = this.dataset.filter;
        wrap.dataset.filter = filter;
        applyFilter(wrap, filter);
      });
    });

    backdrop.addEventListener('click', closeModal);
    closeBtn.addEventListener('click', closeModal);

    var searchTimer;
    searchInput.addEventListener('input', function() {
      clearTimeout(searchTimer); var q = searchInput.value.trim();
      searchTimer = setTimeout(function() { handleSearch(q); }, 600);
    });

    prevBtn.addEventListener('click', function() { heroSlide(-1); });
    nextBtn.addEventListener('click', function() { heroSlide(1); });

    return wrap;
  }

  function applyFilter(wrap, filter) {
    var hero = wrap.querySelector('#hg-hero');
    var sections = wrap.querySelectorAll('.hg-carousel-section');
    // Reset all sections and cards visible
    sections.forEach(function(s) { s.classList.remove('hg-section-hidden'); });
    wrap.querySelectorAll('.hg-card').forEach(function(c) { c.style.display = ''; });

    if (filter === 'movies') {
      // Hide show-only rows entirely
      sections.forEach(function(s) {
        if (s.dataset.type === 'show') s.classList.add('hg-section-hidden');
      });
      // Within mixed rows, hide show cards
      wrap.querySelectorAll('.hg-carousel-section:not(.hg-section-hidden) .hg-card[data-type="show"]').forEach(function(c) { c.style.display = 'none'; });
    } else if (filter === 'shows') {
      // Hide movie-only rows entirely
      sections.forEach(function(s) {
        if (s.dataset.type === 'movie') s.classList.add('hg-section-hidden');
      });
      // Within mixed rows, hide movie cards
      wrap.querySelectorAll('.hg-carousel-section:not(.hg-section-hidden) .hg-card[data-type="movie"]').forEach(function(c) { c.style.display = 'none'; });
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
      if (item.posterUrl) slide.style.backgroundImage = 'url(' + item.posterUrl + ')';
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
    content.classList.add('transitioning');
    setTimeout(function() {
      var catEl = content.querySelector('.hg-hero-category');
      var titleEl = content.querySelector('.hg-hero-title');
      var descEl = content.querySelector('.hg-hero-desc');
      if (catEl) catEl.textContent = item.type === 'show' ? 'TV SHOW' : 'MOVIE';
      if (titleEl) titleEl.textContent = item.title;
      if (descEl) descEl.textContent = item.type === 'show' ? (item.totalEpisodes ? item.totalEpisodes + ' episodes available' : 'Watch all seasons') : (item.quality || 'Stream now');
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
  // MOVIE MODAL
  // ═══════════════════════════════════════════════════════════════════════════

  var _modalFetchId = 0;

  function buildMovieModal(item) {
    var content = document.getElementById('hg-modal-content'); content.textContent = '';
    var layout = document.createElement('div'); layout.id = 'hg-modal-layout-movie';

    var videoWrap = document.createElement('div'); videoWrap.id = 'hg-modal-video-wrap';
    var video = document.createElement('video'); video.id = 'hg-video'; video.controls = true; video.autoplay = true; video.playsInline = true;
    videoWrap.appendChild(video);
    var overlay = document.createElement('div'); overlay.id = 'hg-modal-poster-overlay';
    if (item.posterUrl) overlay.style.backgroundImage = 'url(' + item.posterUrl + ')';
    overlay.style.display = 'flex'; videoWrap.appendChild(overlay);
    layout.appendChild(videoWrap);

    var meta = document.createElement('div'); meta.id = 'hg-modal-meta';
    var left = document.createElement('div'); left.id = 'hg-modal-left';
    var titleEl = document.createElement('h2'); titleEl.id = 'hg-modal-title'; titleEl.textContent = item.title; left.appendChild(titleEl);
    var badgesEl = document.createElement('div'); badgesEl.id = 'hg-modal-badges'; left.appendChild(badgesEl);
    var descEl = document.createElement('p'); descEl.id = 'hg-modal-desc'; descEl.textContent = 'Loading...'; left.appendChild(descEl);
    var detailsEl = document.createElement('div'); detailsEl.id = 'hg-modal-details'; left.appendChild(detailsEl);
    meta.appendChild(left);

    var right = document.createElement('div'); right.id = 'hg-modal-right';
    var castLabel = document.createElement('div'); castLabel.id = 'hg-modal-cast-label'; castLabel.textContent = 'Cast'; right.appendChild(castLabel);
    var castEl = document.createElement('div'); castEl.id = 'hg-modal-cast'; right.appendChild(castEl);
    meta.appendChild(right); layout.appendChild(meta); content.appendChild(layout);

    var myFetchId = ++_modalFetchId;
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
        // Parse genre links safely
        var genreContainer = document.createElement('div');
        genreContainer.innerHTML = detail.genre;
        var genreLinks = genreContainer.querySelectorAll('a');
        if (genreLinks.length > 0) {
          var genreParts = [];
          genreLinks.forEach(function(a) { genreParts.push(esc(a.textContent.trim())); });
          var genreText = document.createTextNode(genreParts.join(', '));
          genreRow.appendChild(genreText);
        } else {
          var genreText2 = document.createTextNode(esc(genreContainer.textContent.trim()));
          genreRow.appendChild(genreText2);
        }
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
        var actorsContainer = document.createElement('div');
        actorsContainer.innerHTML = detail.actors;
        var names = Array.from(actorsContainer.querySelectorAll('a')).map(function(a) { return a.textContent.trim(); }).filter(Boolean);
        castEl.textContent = '';
        names.forEach(function(n) {
          castEl.appendChild(createSafeSpan(n, 'hg-actor'));
        });
      }

      if (detail.videoUrl) {
        video.src = detail.videoUrl; video.poster = item.posterUrl; overlay.style.display = 'none'; video.play().catch(function() {});
      } else {
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
      }
    }).catch(function(err) { console.error('HG: movie detail failed', err); descEl.textContent = 'Failed to load movie details.'; });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SHOW MODAL
  // ═══════════════════════════════════════════════════════════════════════════

  var _seasonRequestId = 0; var _episodeLoadId = 0; var _videoTrackingInterval = null;

  function buildShowModal(item) {
    var content = document.getElementById('hg-modal-content'); content.textContent = '';
    var seasonTabsDiv = document.createElement('div'); seasonTabsDiv.id = 'hgp-season-tabs';
    if (item.seasons && item.seasons.length > 0) {
      item.seasons.sort(function(a, b) { return (a.num || 999) - (b.num || 999); }).forEach(function(s, i) {
        var tab = document.createElement('button'); tab.className = 'hgp-season-tab' + (i === 0 ? ' active' : '');
        tab.dataset.season = s.name; tab.textContent = s.num ? 'S' + s.num : 'S1'; seasonTabsDiv.appendChild(tab);
      });
    }

    var layout = document.createElement('div'); layout.id = 'hgp-layout';
    var mainCol = document.createElement('div'); mainCol.id = 'hgp-main';
    var videoWrap = document.createElement('div'); videoWrap.id = 'hgp-video-wrap';
    var video = document.createElement('video'); video.id = 'hgp-video'; video.controls = true; video.playsInline = true; video.preload = 'auto';
    video.addEventListener('contextmenu', function(e) { e.preventDefault(); });
    videoWrap.appendChild(video);

    if (Utils.supportsPIP && Utils.supportsPIP()) {
      var pipBtn = document.createElement('button'); pipBtn.id = 'hgp-pip-btn'; pipBtn.title = 'Picture-in-Picture (P)';
      var pipSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      pipSvg.setAttribute('viewBox', '0 0 24 20'); pipSvg.setAttribute('width', '20'); pipSvg.setAttribute('height', '20');
      pipSvg.setAttribute('aria-hidden', 'true');
      var r1 = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      r1.setAttribute('x', '2'); r1.setAttribute('y', '2'); r1.setAttribute('width', '20'); r1.setAttribute('height', '16');
      r1.setAttribute('rx', '2'); r1.setAttribute('fill', 'none'); r1.setAttribute('stroke', 'currentColor'); r1.setAttribute('stroke-width', '2');
      var r2 = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      r2.setAttribute('x', '8'); r2.setAttribute('y', '12'); r2.setAttribute('width', '10'); r2.setAttribute('height', '8'); r2.setAttribute('fill', 'currentColor');
      pipSvg.appendChild(r1); pipSvg.appendChild(r2); pipBtn.appendChild(pipSvg);
      pipBtn.addEventListener('click', function() { if (Utils.togglePIP) Utils.togglePIP(video).catch(function() {}); });
      videoWrap.appendChild(pipBtn);
    }

    var loadingOverlay = document.createElement('div'); loadingOverlay.id = 'hgp-loading-overlay';
    var spinner = document.createElement('div'); spinner.className = 'hg-spinner'; loadingOverlay.appendChild(spinner);
    var loadingText = document.createElement('span'); loadingText.textContent = 'Loading video...'; loadingOverlay.appendChild(loadingText);
    videoWrap.appendChild(loadingOverlay); mainCol.appendChild(videoWrap);

    var infoBar = document.createElement('div'); infoBar.id = 'hgp-info';
    var infoLeft = document.createElement('div'); infoLeft.id = 'hgp-info-left';
    var titleEl = document.createElement('h1'); titleEl.id = 'hgp-title'; titleEl.textContent = 'Loading...'; infoLeft.appendChild(titleEl);
    var showNameEl = document.createElement('div'); showNameEl.id = 'hgp-show-name'; showNameEl.textContent = item.showName || item.title; infoLeft.appendChild(showNameEl);
    var statsEl = document.createElement('div'); statsEl.id = 'hgp-stats'; infoLeft.appendChild(statsEl);
    infoBar.appendChild(infoLeft);
    var dlBtn = document.createElement('a'); dlBtn.id = 'hgp-dl-btn'; dlBtn.target = '_blank'; dlBtn.style.display = 'none'; dlBtn.textContent = '\u2B07 Download';
    infoBar.appendChild(dlBtn); mainCol.appendChild(infoBar); layout.appendChild(mainCol);

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

    seasonTabsDiv.querySelectorAll('.hgp-season-tab').forEach(function(tab) {
      tab.addEventListener('click', function() {
        seasonTabsDiv.querySelectorAll('.hgp-season-tab').forEach(function(t) { t.classList.remove('active'); });
        this.classList.add('active'); loadSeason(this.dataset.season, content, null);
      });
    });

    if (item.seasons && item.seasons.length > 0) loadSeason(item.seasons[0].name, content, item.href);

    if (Utils.watchHistory) {
      Utils.watchHistory.save({ href: item.href.startsWith('http') ? item.href : 'https://hallagulla.club/classic/' + item.href,
        title: item.title, showName: item.showName || item.title, posterUrl: item.posterUrl, timestamp: Date.now() });
    }
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
    if (overlay) { overlay.textContent = ''; var sp = document.createElement('div'); sp.className = 'hg-spinner'; overlay.appendChild(sp); var txt = document.createElement('span'); txt.textContent = 'Loading video...'; overlay.appendChild(txt); overlay.style.display = 'flex'; }

    Utils.fetchWithCache(url, { credentials: 'same-origin' }, true).then(function(html) {
      if (myLoadId !== _episodeLoadId) return;
      var doc = new DOMParser().parseFromString(html, 'text/html');
      var videoUrl = extractVideoUrl(doc);
      var og = doc.querySelector('meta[property="og:image"]'); var poster = og ? og.getAttribute('content') : '';
      var titleEl = doc.querySelector('.v-title'); var newTitle = titleEl ? titleEl.textContent.trim() : ep.title;
      var showEl = doc.querySelector('.v-category a'); var showName = showEl ? showEl.textContent.trim() : '';
      var vcats = doc.querySelectorAll('.v-category2'); var views = '', downloads = '';
      vcats.forEach(function(el) { var t = el.textContent.trim(); if (t.toLowerCase().indexOf('view') === 0) views = t.replace(/View\s*:\s*/i, '').trim(); if (t.toLowerCase().indexOf('download') === 0) downloads = t.replace(/Download\s*:\s*/i, '').trim(); });
      var dlEl = doc.querySelector('#setCounter[href], a[href*="cdnnow.co"]'); var dlUrl = dlEl ? (dlEl.getAttribute('href') || videoUrl) : videoUrl;
      if (overlay) overlay.style.display = 'none';

      var video = content.querySelector('#hgp-video');
      if (video && videoUrl) {
        video.pause(); video.removeAttribute('src'); video.load();
        if (_videoTrackingInterval) { clearInterval(_videoTrackingInterval); _videoTrackingInterval = null; }
        video.src = videoUrl; if (poster) video.poster = poster; video.load(); video.play().catch(function() {});
        setupVideoTracking(video, videoUrl);
      } else if (overlay) { overlay.textContent = 'Video not available for streaming'; overlay.style.display = 'flex'; }

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
      if (overlay) { overlay.textContent = 'Failed to load video'; overlay.style.display = 'flex'; }
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
    var movieVideo = document.getElementById('hg-video'); if (movieVideo) { movieVideo.pause(); movieVideo.removeAttribute('src'); movieVideo.load(); }
    var showVideo = document.getElementById('hgp-video'); if (showVideo) { showVideo.pause(); showVideo.removeAttribute('src'); showVideo.load(); }
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

  function handleSearch(q) {
    var resultsDiv = document.getElementById('hg-search-results'); if (!resultsDiv) return;
    var hero = document.getElementById('hg-hero');
    if (q.length < 2) {
      resultsDiv.style.display = 'none'; resultsDiv.textContent = '';
      if (hero) hero.style.display = '';
      return;
    }
    resultsDiv.style.display = '';
    if (hero) hero.style.display = 'none';
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

    if (promises.length === 0) { resultsDiv.textContent = ''; var noR = document.createElement('div'); noR.className = 'hg-search-empty'; noR.textContent = 'No results for "' + q + '"'; resultsDiv.appendChild(noR); return; }

    Promise.all(promises).then(function(results) {
      var allItems = [].concat.apply([], results);
      resultsDiv.textContent = '';
      if (allItems.length === 0) { var noR2 = document.createElement('div'); noR2.className = 'hg-search-empty'; noR2.textContent = 'No results for "' + q + '"'; resultsDiv.appendChild(noR2); return; }
      var grid = document.createElement('div'); grid.className = 'hg-search-grid';
      allItems.forEach(function(item) { grid.appendChild(buildCard(item)); });
      resultsDiv.appendChild(grid);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CONTINUE WATCHING
  // ═══════════════════════════════════════════════════════════════════════════

  function buildContinueWatching() {
    if (!Utils.watchHistory) return [];
    var history = Utils.watchHistory.get();
    return history.slice(0, 10).map(function(h) {
      var progress = 0;
      if (h.href && Utils.videoProgress) {
        var pd = Utils.videoProgress.get(h.href);
        if (typeof pd === 'object' && pd !== null) { progress = pd.currentTime && pd.duration ? pd.currentTime / pd.duration : 0; }
        else if (typeof pd === 'number' && pd > 0) { progress = 0.05; }
      }
      return { type: h.showName ? 'show' : 'movie', id: 'cw-' + (h.showName || h.title), title: h.title || h.showName || 'Unknown', posterUrl: h.posterUrl || '', href: h.href || '', rating: '', views: '', addedDate: '', showName: h.showName || '', seasons: [], totalEpisodes: 0, _progress: progress, _history: h };
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════════════════════════════════════════

  function init() {
    document.body.style.visibility = 'hidden';
    var shell = buildShell();
    document.body.appendChild(shell);
    document.body.style.visibility = 'visible';

    var content = shell.querySelector('#hg-content');
    var initialMovies = parseMoviesFromDoc(document);
    var initialEpisodes = parseShowsFromDoc(document);
    var initialShows = Array.from(mergeEpisodesToShowMap(initialEpisodes).values());

    // Continue Watching
    var continueItems = buildContinueWatching();
    if (continueItems.length > 0) {
      var continueRow = buildCarouselSection({ id: 'continue', title: 'Continue Watching', type: 'mixed' });
      populateCarousel(continueRow, continueItems); content.appendChild(continueRow); continueRow._loaded = true;
    }

    // Hero
    var heroItems = [].concat(initialMovies, initialShows).filter(function(item) { return item.posterUrl; }).slice(0, 6);
    if (heroItems.length > 0) { _allHeroSlides = heroItems; populateHero(heroItems); }

    // Recently Added row with initial content
    var initialAll = [].concat(initialMovies, initialShows);
    var recentRow = buildCarouselSection({ id: 'recent', title: 'Recently Added', type: 'mixed' });
    populateCarousel(recentRow, initialAll); content.appendChild(recentRow); recentRow._loaded = true;

    // Lazy-loaded rows
    ROW_DEFS.forEach(function(rowDef) {
      if (rowDef.id === 'continue' || rowDef.id === 'recent') return;
      var section = buildCarouselSection(rowDef); content.appendChild(section);
    });

    // IntersectionObserver for lazy loading
    var observer = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (entry.isIntersecting && !entry.target._loaded) {
          var section = entry.target; section._loaded = true; observer.unobserve(section);
          var rowDef = section._rowDef;
          if (rowDef && rowDef.fetchFn) {
            rowDef.fetchFn().then(function(items) { populateCarousel(section, items); }).catch(function() { section._carousel.textContent = ''; var err = document.createElement('div'); err.style.cssText = 'color:#888;padding:20px;'; err.textContent = 'Failed to load.'; section._carousel.appendChild(err); });
          }
        }
      });
    }, { root: null, rootMargin: '0px 0px 800px 0px', threshold: 0 });
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
      }, { root: null, rootMargin: '0px 0px 600px 0px', threshold: 0 });
      infiniteObserver.observe(sentinel);
    });

    // Background fetch: pre-populate shows row on movies page
    var isMoviesPage = window.location.pathname.indexOf('/movies') !== -1;
    if (isMoviesPage) {
      fetchShowsPage(1, '').then(function(shows) { if (shows.length > 0) { var s = content.querySelector('[data-row-id="newshows"]'); if (s && !s._loaded) { populateCarousel(s, shows); s._loaded = true; } } }).catch(function() {});
    }

    // Hero buttons
    var heroPlay = shell.querySelector('#hg-hero-play');
    var heroInfo = shell.querySelector('#hg-hero-info');
    if (heroPlay) heroPlay.addEventListener('click', function() { if (_heroSlides[_heroIndex]) openModal(_heroSlides[_heroIndex]); });
    if (heroInfo) heroInfo.addEventListener('click', function() { if (_heroSlides[_heroIndex]) openModal(_heroSlides[_heroIndex]); });

    document.addEventListener('keydown', function(e) { if (e.key === 'Escape') closeModal(); });

    var s = document.createElement('style');
    s.textContent = 'body>*:not(#hg-app){display:none!important}body{background:#000!important;margin:0!important;padding:0!important;overflow:hidden!important}';
    document.head.appendChild(s);
  }

  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', init); } else { init(); }
})();
