// ─── Halla Gulla — Shared Utilities ─────────────────────────────────────────
// Common functions used across all content scripts

(function (global) {
  'use strict';

  const Utils = {
    Config: global.HGConfig || {},

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

    // ── Storage Bridge (localStorage + chrome.storage.local) ───────────────

    storage: {
      _cache: Object.create(null),
      _hydrated: false,

      _hasChromeStorage: function() {
        return !!(global.chrome && chrome.storage && chrome.storage.local);
      },

      _lsGet: function(key) {
        try { return localStorage.getItem(key); } catch (e) { return null; }
      },

      _lsSet: function(key, val) {
        try { localStorage.setItem(key, val); } catch (e) {}
      },

      _lsRemove: function(key) {
        try { localStorage.removeItem(key); } catch (e) {}
      },

      _chromeGet: function(key, cb) {
        if (!this._hasChromeStorage()) {
          cb({});
          return;
        }
        try {
          chrome.storage.local.get([key], function(data) { cb(data || {}); });
        } catch (e) { cb({}); }
      },

      _chromeSet: function(obj) {
        if (!this._hasChromeStorage()) return;
        try { chrome.storage.local.set(obj); } catch (e) {}
      },

      _chromeRemove: function(key) {
        if (!this._hasChromeStorage()) return;
        try { chrome.storage.local.remove([key]); } catch (e) {}
      },

      init: function() {
        if (this._hydrated) return;
        this._hydrated = true;
        var cfg = (global.HGConfig && global.HGConfig.STORAGE) || {};
        var keys = Object.keys(cfg).map(function(k) { return cfg[k]; });
        if (keys.length === 0) return;
        var self = this;
        keys.forEach(function(key) {
          var raw = self._lsGet(key);
          if (raw !== null) self._cache[key] = raw;
        });
        if (!this._hasChromeStorage()) return;

        this._chromeGet(cfg.STORAGE_MIGRATED || 'hg_storage_migrated_v1', function(meta) {
          var migrated = !!meta[(cfg.STORAGE_MIGRATED || 'hg_storage_migrated_v1')];
          if (!migrated) {
            var payload = {};
            keys.forEach(function(key) {
              var raw = self._lsGet(key);
              if (raw !== null) payload[key] = raw;
            });
            payload[(cfg.STORAGE_MIGRATED || 'hg_storage_migrated_v1')] = '1';
            self._chromeSet(payload);
          } else {
            try {
              chrome.storage.local.get(keys, function(data) {
                Object.keys(data || {}).forEach(function(key) {
                  if (typeof data[key] === 'string') {
                    self._cache[key] = data[key];
                    self._lsSet(key, data[key]);
                  }
                });
              });
            } catch (e) {}
          }
        });
      },

      getJSONSync: function(key, fallback) {
        this.init();
        var raw = this._cache[key];
        if (typeof raw !== 'string') raw = this._lsGet(key);
        if (typeof raw !== 'string') return fallback;
        try { return JSON.parse(raw); } catch (e) { return fallback; }
      },

      setJSONSync: function(key, value) {
        this.init();
        var raw = '';
        try { raw = JSON.stringify(value); } catch (e) { return; }
        this._cache[key] = raw;
        this._lsSet(key, raw);
        var payload = {}; payload[key] = raw;
        this._chromeSet(payload);
      },

      remove: function(key) {
        this.init();
        delete this._cache[key];
        this._lsRemove(key);
        this._chromeRemove(key);
      }
    },

    // ── Selector Adapter ────────────────────────────────────────────────────

    selectors: {
      map: {
        THUMBNAIL: ['.thumb', '.col-item'],
        TITLE: ['h6', '.v-title'],
        VIDEO_SOURCE: ['#video-player source', 'video source', '#video-player video source'],
        VIDEO_ELEMENT: ['#video-player', 'video'],
        DOWNLOAD_LINK: ['#setCounter[href]', 'a[href*="cdnnow.co"]'],
        SEASON_SELECT: ['#seasons_list'],
        INFO_META: ['.infohd', '.v-category2'],
        CATEGORY: ['.v-category a'],
        RATING: ['.div-rate', '.rating-num']
      },

      list: function(key) {
        var cfgSelectors = (global.HGConfig && global.HGConfig.SELECTORS) || {};
        var direct = cfgSelectors[key];
        if (direct) return [direct].concat(this.map[key] || []);
        return this.map[key] || [];
      },

      query: function(root, key) {
        var selectors = this.list(key);
        for (var i = 0; i < selectors.length; i++) {
          var node = root.querySelector(selectors[i]);
          if (node) return node;
        }
        return null;
      },

      queryAll: function(root, key) {
        var selectors = this.list(key);
        for (var i = 0; i < selectors.length; i++) {
          var nodes = root.querySelectorAll(selectors[i]);
          if (nodes && nodes.length > 0) return nodes;
        }
        return [];
      }
    },

    // ── Feature Flags ────────────────────────────────────────────────────────

    featureFlags: {
      KEY: ((global.HGConfig && global.HGConfig.STORAGE && global.HGConfig.STORAGE.FEATURE_FLAGS) || 'hg_feature_flags'),

      getAll: function() {
        var stored = Utils.storage.getJSONSync(this.KEY, null);
        if (stored && typeof stored === 'object') return stored;
        return {};
      },

      isEnabled: function(name) {
        var stored = this.getAll();
        if (Object.prototype.hasOwnProperty.call(stored, name)) return stored[name] === true;
        var defaults = (global.HGConfig && global.HGConfig.FEATURES) || {};
        return defaults[name] === true;
      },

      set: function(name, value) {
        var flags = this.getAll();
        flags[name] = !!value;
        Utils.storage.setJSONSync(this.KEY, flags);
      }
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
      KEY: ((global.HGConfig && global.HGConfig.STORAGE && global.HGConfig.STORAGE.WATCH_HISTORY) || 'hg_watch_history'),
      MAX_ITEMS: 50,

      get: function() {
        return Utils.storage.getJSONSync(this.KEY, []);
      },

      save: function(item) {
        try {
          let history = this.get();
          history = history.filter(function(h) { return h.href !== item.href; });
          history.unshift(item);
          if (history.length > this.MAX_ITEMS) history = history.slice(0, this.MAX_ITEMS);
          Utils.storage.setJSONSync(this.KEY, history);
        } catch (e) {}
      },

      clear: function() {
        Utils.storage.remove(this.KEY);
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
      KEY: ((global.HGConfig && global.HGConfig.STORAGE && global.HGConfig.STORAGE.VIDEO_PROGRESS) || 'hg_video_progress'),

      get: function(videoUrl) {
        try {
          const progress = Utils.storage.getJSONSync(this.KEY, {});
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
          const progress = Utils.storage.getJSONSync(this.KEY, {});
          progress[videoUrl] = { currentTime: currentTime, duration: duration };
          Utils.storage.setJSONSync(this.KEY, progress);
        } catch (e) {}
      },

      clear: function(videoUrl) {
        try {
          const progress = Utils.storage.getJSONSync(this.KEY, {});
          delete progress[videoUrl];
          Utils.storage.setJSONSync(this.KEY, progress);
        } catch (e) {}
      }
    },

    // ── My List ────────────────────────────────────────────────────────────

    myLists: {
      KEY: ((global.HGConfig && global.HGConfig.STORAGE && global.HGConfig.STORAGE.MY_LISTS) || 'hg_my_lists'),
      LEGACY_KEY: ((global.HGConfig && global.HGConfig.STORAGE && global.HGConfig.STORAGE.MY_LIST) || 'hg_my_list'),
      MAX_ITEMS: 300,
      DEFAULT_LIST_ID: 'default',

      _itemKey: function(item) {
        if (!item) return '';
        return (item.type || 'mixed') + ':' + (item.href || item.id || item.title || '');
      },

      _safeItem: function(item, key) {
        return {
          type: item.type || 'movie',
          id: item.id || key,
          title: item.title || 'Untitled',
          posterUrl: item.posterUrl || '',
          href: item.href || '',
          rating: item.rating || '',
          views: item.views || '',
          addedDate: item.addedDate || '',
          showName: item.showName || '',
          seasons: Array.isArray(item.seasons) ? item.seasons : [],
          totalEpisodes: item.totalEpisodes || 0,
          quality: item.quality || '',
          length: item.length || '',
          genre: item.genre || ''
        };
      },

      _defaultState: function() {
        return {
          activeListId: this.DEFAULT_LIST_ID,
          lists: [
            { id: this.DEFAULT_LIST_ID, name: 'My List', items: [] }
          ]
        };
      },

      _read: function() {
        var state = Utils.storage.getJSONSync(this.KEY, null);
        if (!state || !Array.isArray(state.lists)) state = this._defaultState();
        if (!state.activeListId) state.activeListId = this.DEFAULT_LIST_ID;
        if (state.lists.length === 0) state.lists.push({ id: this.DEFAULT_LIST_ID, name: 'My List', items: [] });
        return state;
      },

      _write: function(state) {
        Utils.storage.setJSONSync(this.KEY, state);
      },

      _migrateLegacy: function() {
        var state = this._read();
        if (state._legacyMigrated) return;
        var legacy = Utils.storage.getJSONSync(this.LEGACY_KEY, null);
        if (Array.isArray(legacy) && legacy.length > 0) {
          var base = state.lists.find(function(l) { return l.id === 'default'; });
          if (!base) {
            base = { id: 'default', name: 'My List', items: [] };
            state.lists.unshift(base);
          }
          base.items = legacy;
        }
        state._legacyMigrated = true;
        this._write(state);
      },

      getLists: function() {
        this._migrateLegacy();
        return this._read().lists.map(function(l) { return { id: l.id, name: l.name, count: (l.items || []).length }; });
      },

      getActiveListId: function() {
        this._migrateLegacy();
        return this._read().activeListId || this.DEFAULT_LIST_ID;
      },

      setActiveListId: function(id) {
        this._migrateLegacy();
        var state = this._read();
        if (!state.lists.some(function(l) { return l.id === id; })) return false;
        state.activeListId = id;
        this._write(state);
        return true;
      },

      getActiveItems: function() {
        this._migrateLegacy();
        var state = this._read();
        var list = state.lists.find(function(l) { return l.id === state.activeListId; }) || state.lists[0];
        return (list.items || []).map(function(x) { return x.item; });
      },

      hasInActive: function(item) {
        var key = this._itemKey(item);
        if (!key) return false;
        this._migrateLegacy();
        var state = this._read();
        var list = state.lists.find(function(l) { return l.id === state.activeListId; }) || state.lists[0];
        return (list.items || []).some(function(x) { return x.key === key; });
      },

      toggleInActive: function(item) {
        var key = this._itemKey(item);
        if (!key) return false;
        this._migrateLegacy();
        var state = this._read();
        var list = state.lists.find(function(l) { return l.id === state.activeListId; }) || state.lists[0];
        list.items = Array.isArray(list.items) ? list.items : [];
        var idx = list.items.findIndex(function(x) { return x.key === key; });
        if (idx >= 0) {
          list.items.splice(idx, 1);
          this._write(state);
          return false;
        }
        list.items.unshift({ key: key, item: this._safeItem(item, key), savedAt: Date.now() });
        if (list.items.length > this.MAX_ITEMS) list.items = list.items.slice(0, this.MAX_ITEMS);
        this._write(state);
        return true;
      },

      createList: function(name) {
        var n = String(name || '').trim();
        if (!n) return null;
        this._migrateLegacy();
        var state = this._read();
        var id = 'list_' + Date.now();
        state.lists.push({ id: id, name: n.slice(0, 40), items: [] });
        state.activeListId = id;
        this._write(state);
        return id;
      },

      removeFromActiveByKeys: function(keys) {
        var removeMap = {};
        (keys || []).forEach(function(k) { removeMap[k] = true; });
        this._migrateLegacy();
        var state = this._read();
        var list = state.lists.find(function(l) { return l.id === state.activeListId; }) || state.lists[0];
        list.items = (list.items || []).filter(function(x) { return !removeMap[x.key]; });
        this._write(state);
      },

      moveInActiveByKey: function(key, direction) {
        this._migrateLegacy();
        var state = this._read();
        var list = state.lists.find(function(l) { return l.id === state.activeListId; }) || state.lists[0];
        var items = list.items || [];
        var idx = items.findIndex(function(x) { return x.key === key; });
        if (idx < 0) return false;
        var nextIdx = idx + (direction < 0 ? -1 : 1);
        if (nextIdx < 0 || nextIdx >= items.length) return false;
        var temp = items[idx];
        items[idx] = items[nextIdx];
        items[nextIdx] = temp;
        this._write(state);
        return true;
      }
    },

    myList: {
      _itemKey: function(item) {
        return Utils.myLists._itemKey(item);
      },
      has: function(item) {
        return Utils.myLists.hasInActive(item);
      },
      get: function() {
        return Utils.myLists.getActiveItems();
      },
      toggle: function(item) {
        return Utils.myLists.toggleInActive(item);
      }
    },

    // ── Search History ──────────────────────────────────────────────────────

    searchHistory: {
      KEY: ((global.HGConfig && global.HGConfig.STORAGE && global.HGConfig.STORAGE.SEARCH_HISTORY) || 'hg_search_history'),
      MAX_ITEMS: 15,

      get: function() {
        return Utils.storage.getJSONSync(this.KEY, []);
      },

      add: function(query) {
        var q = String(query || '').trim();
        if (!q) return;
        var list = this.get().filter(function(x) { return String(x || '').toLowerCase() !== q.toLowerCase(); });
        list.unshift(q);
        if (list.length > this.MAX_ITEMS) list = list.slice(0, this.MAX_ITEMS);
        Utils.storage.setJSONSync(this.KEY, list);
      },

      clear: function() {
        Utils.storage.remove(this.KEY);
      }
    },

    // ── Preferences ─────────────────────────────────────────────────────────

    preferences: {
      KEY: ((global.HGConfig && global.HGConfig.STORAGE && global.HGConfig.STORAGE.PREFERENCES) || 'hg_preferences'),
      defaults: {
        autoplayNext: true,
        speed: 1,
        subtitles: 'off',
        quality: 'auto'
      },
      get: function() {
        var prefs = Utils.storage.getJSONSync(this.KEY, null);
        return Object.assign({}, this.defaults, prefs || {});
      },
      set: function(next) {
        var prefs = this.get();
        var merged = Object.assign({}, prefs, next || {});
        Utils.storage.setJSONSync(this.KEY, merged);
        return merged;
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

  Utils.storage.init();
  global.HGUtils = Utils;

})(window);
