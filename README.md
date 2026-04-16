# Halla Gulla — Cyber Bazaar

A Chrome extension that replaces Halla Gulla pages with a neon cyberpunk streaming interface.

## What it does

- **Movies page** (`/classic/movies`) — Dark poster grid with infinite scroll, modal with autoplay video, cast, description, and download links
- **TV Shows page** (`/classic/videos`) — Show cards grouped by series, Netflix-style modal with season tabs, episode sidebar, and video player. AJAX-based filtering and search, continue watching row
- **Player page** (`/classic/videopreview-*`) — Full player layout with video, episode list, season navigation, next-episode toast, PiP support, and keyboard shortcuts

## Features

- Infinite scroll — no more clicking page 2, 3, 4...
- Continue watching row (persists across sessions via localStorage)
- Video progress tracking — resume from where you left off
- Keyboard shortcuts: Space (play/pause), arrows (seek/volume), F (fullscreen), P (PiP)
- Search with live filtering (TV shows) or redirect (movies)
- Filter by sort, category, genre, quality, year

## How to install

1. Open Chrome and go to `chrome://extensions`
2. Turn on **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `hallagulla-extension-unified` folder
5. Done — go to `https://hallagulla.club/classic/movies`

## Notes

- Video autoplay may be blocked by your browser on first load — click the play button if so
- Some movies link to torrents rather than direct MP4 — those will show download buttons instead of the player
- If you see "Failed to load" in the modal, the site may be blocking cross-origin fetches for that particular movie page — direct download links will still work

## Troubleshooting

**The page looks the same as before:**
Make sure the extension is enabled in `chrome://extensions` and that the URL matches `hallagulla.club/classic/movies` (or `/videos`, or a `/videopreview-*` page)

**Video doesn't play:**
Try clicking the video directly. Some movies use torrent links only — in that case download buttons appear.

**Extension not loading fonts:**
The Google Fonts import requires internet access. If you're offline, it falls back to system sans-serif.