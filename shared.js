// ─── Halla Gulla — Shared Components ────────────────────────────────────────
// Common components and functions shared between unified.js and player.js
// This eliminates code duplication and provides a single source of truth

(function (global) {
  'use strict';

  var Utils = window.HGUtils || {};
  var esc = Utils.esc || function(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };

  // ─── Video URL Extraction ───────────────────────────────────────────────────
  // Robust extraction of video URL from various Video.js embed patterns

  function extractVideoUrl(doc) {
    // 1. Check for <source> tags inside video elements
    var srcEl = doc.querySelector('#video-player source, video source, #video-player video source');
    if (srcEl) {
      var src = srcEl.getAttribute('src') || '';
      if (src) return src;
    }

    // 2. Check for src attribute directly on <video> element
    var videoEl = doc.querySelector('#video-player, video');
    if (videoEl) {
      var vSrc = videoEl.getAttribute('src') || '';
      if (vSrc) return vSrc;
    }

    // 3. Check data-setup attribute (Video.js JSON config)
    var playerEl = doc.querySelector('#video-player');
    if (playerEl) {
      var dataSetup = playerEl.getAttribute('data-setup') || '';
      if (dataSetup) {
        try {
          var setup = JSON.parse(dataSetup);
          if (setup && setup.sources && setup.sources.length > 0 && setup.sources[0].src) {
            return setup.sources[0].src;
          }
        } catch (e) {
          // data-setup not valid JSON, ignore
        }
      }
    }

    // 4. Fallback: download link always has the direct MP4 URL
    var dlLink = doc.querySelector('#setCounter[href], a[href*="cdnnow.co"]');
    if (dlLink) {
      var dlHref = dlLink.getAttribute('href') || '';
      if (dlHref) return dlHref;
    }

    return '';
  }

  // ─── Episode Rendering ──────────────────────────────────────────────────────
  // Renders a list of episodes with consistent styling and behavior

  function renderEpisodes(episodes, list, container, currentHref, onEpisodeClick) {
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

      // Episode number
      var numDiv = document.createElement('div');
      numDiv.className = 'hgp-ep-num';
      numDiv.textContent = ep.epNum || '?';
      row.appendChild(numDiv);

      // Thumbnail
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

      // Thumbnail image or blank
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

      // Episode info
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

      // Click/keyboard handlers
      var handleClick = function() {
        if (onEpisodeClick) onEpisodeClick(ep, row, container);
      };
      row.addEventListener('click', handleClick);
      row.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick();
        }
      });

      list.appendChild(row);
    });

    // Update episode count
    var epCountEl = container ? container.querySelector('#hgp-ep-count') : null;
    if (epCountEl) {
      epCountEl.textContent = episodes.length + ' episode' + (episodes.length !== 1 ? 's' : '');
    }

    // Show/hide "Next Episode" button
    if (container) {
      var nextBtn = container.querySelector('#hgp-next-ep-btn');
      if (nextBtn) {
        var hasCurrent = currentIdx >= 0;
        var hasNext = currentIdx < episodes.length - 1;
        nextBtn.style.display = (hasCurrent && hasNext) ? '' : 'none';
      }
    }

    // Scroll current episode into view
    var currentRow = list.querySelector('.hgp-ep-current');
    if (currentRow) {
      setTimeout(function() {
        currentRow.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }, 200);
    }
  }

  // ─── Video Tracking ─────────────────────────────────────────────────────────
  // Sets up video progress tracking with resume notification

  var _videoTrackingInterval = null;
  var _activeVideoUrl = '';

  function setupVideoTracking(video, videoUrl, shell, callbacks) {
    if (!Utils.videoProgress) return;

    _activeVideoUrl = videoUrl;

    // Clear any existing tracking
    if (_videoTrackingInterval) {
      clearInterval(_videoTrackingInterval);
      _videoTrackingInterval = null;
    }

    // Check for saved progress
    var savedData = Utils.videoProgress.get(videoUrl);
    var savedTime = 0;
    if (typeof savedData === 'object' && savedData !== null) {
      savedTime = savedData.currentTime || 0;
    } else {
      savedTime = typeof savedData === 'number' ? savedData : 0;
    }

    // Resume from saved position
    if (savedTime > 0) {
      video.addEventListener('loadedmetadata', function() {
        if (savedTime < video.duration - 30) {
          video.currentTime = savedTime;
          if (callbacks && callbacks.onResume) {
            callbacks.onResume(savedTime);
          }
        }
      }, { once: true });
    }

    // Save progress every 10 seconds
    _videoTrackingInterval = setInterval(function() {
      if (video.paused || video.ended) return;
      Utils.videoProgress.save(videoUrl, video.currentTime, video.duration);
    }, 10000);

    // Clear progress on video end
    video.addEventListener('ended', function() {
      if (_videoTrackingInterval) {
        clearInterval(_videoTrackingInterval);
        _videoTrackingInterval = null;
      }
      Utils.videoProgress.clear(videoUrl);
      if (callbacks && callbacks.onEnded) {
        callbacks.onEnded();
      }
    }, { once: true });

    // Save on page unload
    window.addEventListener('beforeunload', function() {
      if (_videoTrackingInterval && video.currentTime > 0 && video.duration) {
        clearInterval(_videoTrackingInterval);
        Utils.videoProgress.save(_activeVideoUrl, video.currentTime, video.duration);
      }
    });
  }

  function getVideoTrackingInterval() {
    return _videoTrackingInterval;
  }

  function clearVideoTrackingInterval() {
    if (_videoTrackingInterval) {
      clearInterval(_videoTrackingInterval);
      _videoTrackingInterval = null;
    }
  }

  function getActiveVideoUrl() {
    return _activeVideoUrl;
  }

  // ─── Resume Notification ────────────────────────────────────────────────────
  // Shows a notification when resuming video from a saved position

  function showResumeNotification(container, time) {
    var wrap = container.querySelector('#hgp-video-wrap') || container.querySelector('#hg-modal-video-wrap');
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
      var video = container.querySelector('#hgp-video') || container.querySelector('#hg-video');
      if (video) video.currentTime = 0;
      notification.remove();
    });
    notification.appendChild(btn);

    wrap.appendChild(notification);
    setTimeout(function() { notification.remove(); }, 5000);
  }

  // ─── Episode Data Extraction ────────────────────────────────────────────────
  // Extracts episode metadata from a fetched episode page

  function extractEpisodeMetadata(doc) {
    var data = {
      videoUrl: '',
      poster: '',
      title: '',
      showName: '',
      views: '',
      downloads: '',
      downloadUrl: ''
    };

    data.videoUrl = extractVideoUrl(doc);

    var og = doc.querySelector('meta[property="og:image"]');
    data.poster = og ? og.getAttribute('content') : '';

    var titleEl = doc.querySelector('.v-title');
    data.title = titleEl ? titleEl.textContent.trim() : '';

    var showEl = doc.querySelector('.v-category a');
    data.showName = showEl ? showEl.textContent.trim() : '';

    doc.querySelectorAll('.v-category2').forEach(function(el) {
      var t = el.textContent.trim();
      if (t.toLowerCase().indexOf('view') === 0) {
        data.views = t.replace(/View\s*:\s*/i, '').trim();
      }
      if (t.toLowerCase().indexOf('download') === 0) {
        data.downloads = t.replace(/Download\s*:\s*/i, '').trim();
      }
    });

    var dlEl = doc.querySelector('#setCounter[href], a[href*="cdnnow.co"]');
    data.downloadUrl = dlEl ? (dlEl.getAttribute('href') || data.videoUrl) : data.videoUrl;

    return data;
  }

  // ─── Season Loading ─────────────────────────────────────────────────────────
  // Loads episodes for a season with race condition prevention

  var _seasonLoadId = 0;

  function loadSeason(seasonName, container, listSelector, currentHref, renderCallback) {
    var myLoadId = ++_seasonLoadId;

    var list = container.querySelector(listSelector);
    list.textContent = '';
    var loading = document.createElement('div');
    loading.id = 'hgp-eps-loading';
    var sp = document.createElement('div');
    sp.className = 'hg-spinner';
    loading.appendChild(sp);
    list.appendChild(loading);

    var url = 'https://hallagulla.club/classic/includes/ajax.php?albumName=' +
      encodeURIComponent(seasonName) + '&req=videos';

    return (Utils.fetchWithRetry || fetch)(url, {
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'XMLHttpRequest' }
    })
      .then(function(res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.text();
      })
      .then(function(html) {
        // Race condition check
        if (myLoadId !== _seasonLoadId) return null;

        var tempDoc = new DOMParser().parseFromString('<div>' + html + '</div>', 'text/html');
        var items = tempDoc.querySelectorAll('.thumb, .col-item');

        if (items.length === 0) {
          list.textContent = '';
          var noEps = document.createElement('div');
          noEps.className = 'hgp-no-eps';
          noEps.textContent = 'No episodes found.';
          list.appendChild(noEps);
          return null;
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

          var epNum = Utils.extractEpisodeNum ? Utils.extractEpisodeNum(title) :
            (title.match(/Episode\s+(\d+)/i) ? parseInt(title.match(/Episode\s+(\d+)/i)[1], 10) : 0);
          var epLabel = epNum ? 'E' + String(epNum).padStart(2, '0') : '';
          var isCurrent = href === currentHref ||
            (currentHref && currentHref.indexOf(href.replace('.html', '')) !== -1);

          episodes.push({
            href: href,
            title: title,
            posterUrl: posterUrl,
            views: views,
            date: date,
            epNum: epNum,
            epLabel: epLabel,
            isCurrent: isCurrent
          });
        });

        episodes.sort(function(a, b) { return a.epNum - b.epNum; });
        return episodes;
      })
      .catch(function(err) {
        if (myLoadId !== _seasonLoadId) return null;
        console.error('HG: failed to load season', seasonName, err);
        list.textContent = '';
        var noEps = document.createElement('div');
        noEps.className = 'hgp-no-eps';
        noEps.textContent = 'Failed to load episodes. Please try again.';
        var retryBtn = document.createElement('button');
        retryBtn.textContent = 'Retry';
        retryBtn.style.cssText = 'margin-left:8px;color:#00FFD1;cursor:pointer;';
        retryBtn.addEventListener('click', function() {
          loadSeason(seasonName, container, listSelector, currentHref, renderCallback);
        });
        noEps.appendChild(retryBtn);
        list.appendChild(noEps);
        return null;
      });
  }

  function getSeasonLoadId() {
    return _seasonLoadId;
  }

  // Export shared components
  global.HGShared = {
    extractVideoUrl: extractVideoUrl,
    renderEpisodes: renderEpisodes,
    setupVideoTracking: setupVideoTracking,
    getVideoTrackingInterval: getVideoTrackingInterval,
    clearVideoTrackingInterval: clearVideoTrackingInterval,
    getActiveVideoUrl: getActiveVideoUrl,
    showResumeNotification: showResumeNotification,
    extractEpisodeMetadata: extractEpisodeMetadata,
    loadSeason: loadSeason,
    getSeasonLoadId: getSeasonLoadId
  };

})(window);
