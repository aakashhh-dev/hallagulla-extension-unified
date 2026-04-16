// ─── Halla Gulla — Shared Utilities ─────────────────────────────────────────
// Common functions used across all content scripts

(function (global) {
  'use strict';

  const Utils = {
    // ── DOM Utilities ─────────────────────────────────────────────────────────

    esc: function(s) {
      return String(s || '').replace(/\u0026/g, '\u0026amp;').replace(/\u003c/g, '\u0026lt;').replace(/\u003e/g, '\u0026gt;').replace(/"/g, '\u0026quot;');
    },

    createEl: function(tag, attrs, children) {
      const el = document.createElement(tag);
      if (attrs) {
        Object.keys(attrs).forEach(function(k) {
          if (k === 'className') el.className = attrs[k];
          else if (k === 'dataset') Object.assign(el.dataset, attrs[k]);
          else if (k.startsWith('on') && typeof attrs[k] === 'function') {
            el.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
          } else el.setAttribute(k, attrs[k]);
        });
      }
      if (children) {
        children.forEach(function(c) {
          el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
        });
      }
      return el;
    },

    parseHTML: function(html) {
      const tpl = document.createElement('template');
      tpl.innerHTML = html;
      return tpl.content;
    },

    // ── URL Utilities ───────────────────────────────────────────────────────

    makeAbsoluteUrl: function(path) {
      if (!path) return '';
      if (path.startsWith('http')) return path;
      if (path.startsWith('/')) return 'https://hallagulla.club' + path;
      return 'https://hallagulla.club/classic/' + path;
    },

    extractSeasonNum: function(showName) {
      if (!showName) return 0;
      const m = showName.match(/Season\s+(\d+)/i);
      return m ? parseInt(m[1], 10) : 0;
    },

    extractEpisodeNum: function(title) {
      if (!title) return 0;
      const m = title.match(/Episode\s+(\d+)/i);
      return m ? parseInt(m[1], 10) : 0;
    },

    // ── Cache Utilities ─────────────────────────────────────────────────────

    cache: {
      store: new Map(),
      MAX_ENTRIES: 100,
      get: function(key) { return this.store.get(key); },
      set: function(key, value) {
        if (this.store.size >= this.MAX_ENTRIES && !this.store.has(key)) {
          // Evict oldest entry (first key in insertion order)
          var oldest = this.store.keys().next().value;
          this.store.delete(oldest);
        }
        this.store.set(key, value);
      },
      has: function(key) { return this.store.has(key); },
      clear: function() { this.store.clear(); }
    },

    fetchWithCache: function(url, options, useCache) {
      if (useCache && this.cache.has(url)) {
        return Promise.resolve(this.cache.get(url));
      }
      return fetch(url, options || { credentials: 'same-origin' })
        .then(function(res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.text();
        })
        .then(function(text) {
          if (useCache) this.cache.set(url, text);
          return text;
        }.bind(this));
    },

    // ── Time Utilities ────────────────────────────────────────────────────────

    timeAgo: function(date) {
      const d = typeof date === 'string' ? new Date(date) : date;
      const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
      const intervals = { year: 31536000, month: 2592000, week: 604800, day: 86400, hour: 3600, minute: 60 };
      for (const [unit, secondsInUnit] of Object.entries(intervals)) {
        const interval = Math.floor(seconds / secondsInUnit);
        if (interval >= 1) return interval + ' ' + unit + (interval > 1 ? 's' : '') + ' ago';
      }
      return 'Just now';
    },

    formatDuration: function(seconds) {
      if (!seconds || isNaN(seconds)) return '00:00';
      const hrs = Math.floor(seconds / 3600);
      const mins = Math.floor((seconds % 3600) / 60);
      const secs = Math.floor(seconds % 60);
      if (hrs > 0) return hrs + ':' + String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
      return String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
    },

    // ── Throttle/Debounce ──────────────────────────────────────────────────

    throttle: function(fn, limit) {
      let inThrottle;
      return function() {
        const args = arguments;
        const context = this;
        if (!inThrottle) {
          fn.apply(context, args);
          inThrottle = true;
          setTimeout(function() { inThrottle = false; }, limit);
        }
      };
    },

    debounce: function(fn, wait) {
      let timeout;
      return function() {
        const context = this;
        const args = arguments;
        clearTimeout(timeout);
        timeout = setTimeout(function() { fn.apply(context, args); }, wait);
      };
    },

    // ── Watch History ───────────────────────────────────────────────────────

    watchHistory: {
      KEY: 'hg_watch_history',
      MAX_ITEMS: 50,

      get: function() {
        try {
          const data = localStorage.getItem(this.KEY);
          return data ? JSON.parse(data) : [];
        } catch (e) { return []; }
      },

      save: function(item) {
        try {
          let history = this.get();
          history = history.filter(function(h) { return h.href !== item.href; });
          history.unshift(item);
          if (history.length > this.MAX_ITEMS) history = history.slice(0, this.MAX_ITEMS);
          localStorage.setItem(this.KEY, JSON.stringify(history));
        } catch (e) {}
      },

      clear: function() {
        try { localStorage.removeItem(this.KEY); } catch (e) {}
      },

      getContinueWatching: function(showName) {
        const history = this.get();
        return history.filter(function(h) {
          return showName && h.showName && h.showName.includes(showName);
        })[0] || null;
      }
    },

    // ── Video Progress ──────────────────────────────────────────────────────

    videoProgress: {
      KEY: 'hg_video_progress',

      get: function(videoUrl) {
        try {
          const data = localStorage.getItem(this.KEY);
          const progress = data ? JSON.parse(data) : {};
          const val = progress[videoUrl];
          if (!val) return 0;
          // Backwards compat: old entries stored just a number (currentTime)
          if (typeof val === 'number') return { currentTime: val, duration: 0 };
          return val;
        } catch (e) { return 0; }
      },

      save: function(videoUrl, currentTime, duration) {
        try {
          if (!videoUrl || !duration) return;
          if (currentTime < 10 || currentTime > duration - 30) return;
          const data = localStorage.getItem(this.KEY);
          const progress = data ? JSON.parse(data) : {};
          progress[videoUrl] = { currentTime: currentTime, duration: duration };
          localStorage.setItem(this.KEY, JSON.stringify(progress));
        } catch (e) {}
      },

      clear: function(videoUrl) {
        try {
          const data = localStorage.getItem(this.KEY);
          const progress = data ? JSON.parse(data) : {};
          delete progress[videoUrl];
          localStorage.setItem(this.KEY, JSON.stringify(progress));
        } catch (e) {}
      }
    },

    // ── Keyboard Navigation ────────────────────────────────────────────────

    setupKeyboard: function(handlers) {
      document.addEventListener('keydown', function(e) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        const handler = handlers[e.key];
        if (handler) {
          e.preventDefault();
          handler(e);
        }
      });
    },

    // ── Infinite Scroll ─────────────────────────────────────────────────────

    setupInfiniteScroll: function(root, sentinel, callback, options) {
      const opts = Object.assign({
        root: root,
        rootMargin: '0px 0px 800px 0px',
        threshold: 0
      }, options || {});

      const observer = new IntersectionObserver(function(entries) {
        if (entries[0].isIntersecting) callback();
      }, opts);

      observer.observe(sentinel);
      return observer;
    },

    // ── Picture-in-Picture ─────────────────────────────────────────────────

    supportsPIP: function() {
      return document.pictureInPictureEnabled &&
        typeof HTMLVideoElement !== 'undefined' &&
        HTMLVideoElement.prototype.requestPictureInPicture;
    },

    togglePIP: function(video) {
      if (document.pictureInPictureElement) {
        return document.exitPictureInPicture();
      } else if (video && video.requestPictureInPicture) {
        return video.requestPictureInPicture();
      }
      return Promise.reject('PIP not supported');
    }
  };

  global.HGUtils = Utils;

})(window);
