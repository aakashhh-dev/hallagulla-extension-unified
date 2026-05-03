// ─── Halla Gulla — Configuration ────────────────────────────────────────────
// Centralized configuration for URLs, timing, and feature flags

(function (global) {
  'use strict';

  var Config = {
    // ─── Base URLs ────────────────────────────────────────────────────────────
    BASE_URL: 'https://hallagulla.club',
    CLASSIC_PATH: '/classic',
    AJAX_ENDPOINT: '/classic/includes/ajax.php',

    // ─── URL Patterns ─────────────────────────────────────────────────────────
    URLS: {
      HOME: '/classic/home',
      MOVIES: '/classic/movies',
      VIDEOS: '/classic/videos',
      MUSIC: '/classic/music',
      VIDEO_PREVIEW: '/classic/videopreview-',
      AJAX: '/classic/includes/ajax.php'
    },

    // ─── CDN Domains (for manifest.json host_permissions) ─────────────────────
    CDN_DOMAINS: [
      'https://videos1.cdnnow.co/*',
      'https://videos2.cdnnow.co/*',
      'https://videos3.cdnnow.co/*',
      'https://videos4.cdnnow.co/*',
      'https://videos5.cdnnow.co/*',
      'https://download.cdnnow.co/*'
    ],

    // ─── Timing Configuration ─────────────────────────────────────────────────
    TIMING: {
      HERO_AUTOPLAY_INTERVAL: 8000,      // Hero slide autoplay (ms)
      HERO_TRANSITION_DURATION: 300,      // Hero content transition (ms)
      TOAST_COUNTDOWN_SECONDS: 5,         // Next episode countdown (seconds)
      VIDEO_SAVE_INTERVAL: 10000,         // Video progress save interval (ms)
      POSTER_BACKFILL_DELAY: 500,         // Delay between poster backfill requests (ms)
      SEARCH_DEBOUNCE: 600,               // Search input debounce (ms)
      SCROLL_SMMOOTH_DURATION: 200,       // Scroll animation duration (ms)
      CARD_ANIMATION_DELAY: 40,           // Stagger delay for card animations (ms)
      RESUME_NOTIFICATION_DURATION: 5000, // How long resume notification shows (ms)
      INFINITE_SCROLL_MARGIN: 600,        // Pixels before end to trigger load more
      LAZY_LOAD_MARGIN: 800               // Pixels before section to trigger load
    },

    // ─── Pagination & Limits ──────────────────────────────────────────────────
    LIMITS: {
      HISTORY_MAX_ITEMS: 50,              // Max watch history entries
      CACHE_MAX_ENTRIES: 100,             // Max cache entries
      HERO_MAX_SLIDES: 6,                 // Max hero slides
      CONTINUE_WATCHING_MAX: 10,          // Max continue watching items
      POSTER_BACKFILL_QUEUE_LIMIT: 100,   // Max posters to backfill per session
      SEARCH_MIN_QUERY_LENGTH: 2          // Minimum characters for search
    },

    // ─── Grid Layout ──────────────────────────────────────────────────────────
    GRID: {
      SCROLL_AMOUNT: 600,                 // Horizontal scroll amount (px)
      CARD_ASPECT_RATIO: 2/3,             // Poster aspect ratio
      CARD_MIN_WIDTH: 160,                // Minimum card width (px)
      CARD_MAX_WIDTH: 240,                // Maximum card width (px)
      GAP_SMALL: 12,                      // Gap for mobile (px)
      GAP_MEDIUM: 16,                     // Gap for tablet (px)
      GAP_LARGE: 20                       // Gap for desktop (px)
    },

    // ─── Breakpoints ──────────────────────────────────────────────────────────
    BREAKPOINTS: {
      MOBILE: 480,
      TABLET: 768,
      DESKTOP: 992,
      WIDE: 1200
    },

    // ─── Feature Flags ────────────────────────────────────────────────────────
    FEATURES: {
      ENABLE_PIP: true,                   // Picture-in-Picture support
      ENABLE_AUTO_ADVANCE: true,          // Auto-play next episode
      ENABLE_PROGRESS_TRACKING: true,     // Watch progress tracking
      ENABLE_POSTER_BACKFILL: true,       // Backfill missing posters
      ENABLE_INFINITE_SCROLL: true,       // Infinite scroll for All Movies/Shows
      ENABLE_SEARCH: true,                // Search functionality
      ENABLE_CONTINUE_WATCHING: true,     // Continue watching row
      ENABLE_RETRY_LOGIC: true,           // Retry failed requests
      ENABLE_CACHE: true,                 // Response caching
      navV2: true,                        // Navigation + state persistence
      searchV2: true,                     // Search improvements
      listsV2: true,                      // My List / collections improvements
      playerV2: true,                     // Advanced player interactions
      accountHub: true                    // Account/settings hub (no billing mutation)
    },

    // ─── Retry Configuration ──────────────────────────────────────────────────
    RETRY: {
      MAX_RETRIES: 3,                     // Max retry attempts
      INITIAL_DELAY: 1000,                // Initial retry delay (ms)
      BACKOFF_MULTIPLIER: 2,              // Exponential backoff multiplier
      MAX_DELAY: 8000                     // Maximum retry delay (ms)
    },

    // ─── Selectors ────────────────────────────────────────────────────────────
    SELECTORS: {
      VIDEO_PLAYER: '#video-player',
      VIDEO_ELEMENT: 'video',
      DOWNLOAD_LINK: '#setCounter[href], a[href*="cdnnow.co"]',
      SEASON_SELECT: '#seasons_list',
      THUMBNAIL: '.thumb',
      TITLE: '.v-title',
      CATEGORY: '.v-category a',
      INFOHD: '.infohd',
      RATING: '.div-rate',
      EPISODE_LIST: '#hgp-episodes-list',
      VIDEO_WRAP: '#hgp-video-wrap'
    },

    // ─── Storage Keys ─────────────────────────────────────────────────────────
    STORAGE: {
      WATCH_HISTORY: 'hg_watch_history',
      VIDEO_PROGRESS: 'hg_video_progress',
      SETTINGS: 'hg_settings',
      MY_LIST: 'hg_my_list',
      MY_LISTS: 'hg_my_lists',
      SEARCH_HISTORY: 'hg_search_history',
      PREFERENCES: 'hg_preferences',
      FEATURE_FLAGS: 'hg_feature_flags',
      LAST_UI_STATE: 'hg_last_ui_state',
      STORAGE_MIGRATED: 'hg_storage_migrated_v1'
    },

    // ─── CSS Classes ──────────────────────────────────────────────────────────
    CLASSES: {
      CARD: 'hg-card',
      CARD_POSTER: 'hg-card-poster',
      CARD_TYPE_BADGE: 'hg-card-type-badge',
      CARD_QUALITY: 'hg-card-quality',
      CARD_PROGRESS: 'hg-card-progress',
      CARD_NEW_BADGE: 'hg-card-new-badge',
      CARD_OVERLAY: 'hg-card-overlay',
      CARD_PLAY_BTN: 'hg-card-play-btn',
      CARD_TITLE: 'hg-card-title',
      CARD_META: 'hg-card-meta',
      EPISODE_ITEM: 'hgp-ep-item',
      EPISODE_CURRENT: 'hgp-ep-current',
      EPISODE_UPNEXT: 'hgp-ep-upnext',
      EPISODE_UPNEXT_BADGE: 'hgp-ep-upnext-badge',
      EPISODE_PROGRESS: 'hgp-ep-progress',
      EPISODE_PROGRESS_BAR: 'hgp-ep-progress-bar',
      SEASON_TAB: 'hgp-season-tab',
      LOADING_SPINNER: 'hg-spinner',
      NO_EPISODES: 'hgp-no-eps',
      HERO_SLIDE: 'hg-hero-slide',
      HERO_DOT: 'hg-hero-dot',
      HERO_ACTIVE: 'active'
    },

    // ─── ARIA Labels ──────────────────────────────────────────────────────────
    ARIA: {
      MAIN: 'Video Player',
      EPISODE_LIST: 'Episodes list',
      EPISODE_NAVIGATION: 'Episode navigation',
      VIDEO_PLAYER: 'Episode video player'
    },

    // ─── Keyboard Shortcuts ───────────────────────────────────────────────────
    KEYS: {
      PLAY_PAUSE: ' ',
      SEEK_FORWARD: 'ArrowRight',
      SEEK_BACKWARD: 'ArrowLeft',
      VOLUME_UP: 'ArrowUp',
      VOLUME_DOWN: 'ArrowDown',
      FULLSCREEN: 'f',
      PIP: 'p',
      CLOSE: 'Escape',
      CONFIRM: ['Enter', ' ']
    },

    // ─── Error Messages ───────────────────────────────────────────────────────
    ERRORS: {
      NETWORK: 'Network error. Please check your connection.',
      VIDEO_NOT_AVAILABLE: 'Video not available for streaming',
      FAILED_TO_LOAD: 'Failed to load. Please try again.',
      NO_EPISODES: 'No episodes found.',
      SEARCH_NO_RESULTS: 'No results for "{query}"'
    },

    // ─── Helper Methods ───────────────────────────────────────────────────────

    // Get absolute URL for a path
    makeAbsoluteUrl: function(path) {
      if (!path) return '';
      if (path.startsWith('http')) return path;
      if (path.startsWith('/')) return this.BASE_URL + path;
      return this.BASE_URL + this.CLASSIC_PATH + '/' + path;
    },

    // Get retry delay for a given attempt number
    getRetryDelay: function(attempt) {
      var delay = this.RETRY.INITIAL_DELAY * Math.pow(this.RETRY.BACKOFF_MULTIPLIER, attempt - 1);
      return Math.min(delay, this.RETRY.MAX_DELAY);
    },

    // Check if a feature is enabled
    isEnabled: function(feature) {
      return this.FEATURES[feature] === true;
    },

    // Get breakpoint name for a width
    getBreakpointName: function(width) {
      if (width < this.BREAKPOINTS.MOBILE) return 'mobile';
      if (width < this.BREAKPOINTS.TABLET) return 'mobile';
      if (width < this.BREAKPOINTS.DESKTOP) return 'tablet';
      if (width < this.BREAKPOINTS.WIDE) return 'desktop';
      return 'wide';
    }
  };

  // Make config globally available
  global.HGConfig = Config;

  // Also attach to HGUtils for backward compatibility
  if (global.HGUtils) {
    global.HGUtils.Config = Config;
  }

})(window);
