// content.js

(function() {
  'use strict';

  // --- Configuration ---
  const ACTION_SELECTORS = [
    '.soundActions .sc-button-group',
    '.soundActions__small .sc-button-group',
    '.soundList__item .sound__actions .sc-button-group',
    '.playableTile__actions .playableTile__actionWrapper'
  ];
  const DOWNLOAD_BUTTON_CLASS = 'sc-button-download';
  const DOWNLOAD_BUTTON_PLAYLIST_CLASS = 'sc-button-download-playlist';
  const SVG_ICON_DOWNLOAD = `<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M4.8 8.24l3.2 3.2 3.2-3.2-1.06-1.06-1.39 1.39V2H7.25v6.57l-1.39-1.39-1.06 1.06zM2 14h12v-2H2v2z" fill="currentColor"/></svg>`;

  let clientIdPromise = null;

  // --- Core Functions ---

  function getClientId() {
    if (clientIdPromise) return clientIdPromise;

    clientIdPromise = new Promise(async (resolve, reject) => {
      for (let i = 0; i < 15; i++) { // Retry for ~7.5 seconds
        const appScripts = Array.from(document.querySelectorAll('script[src]'))
                                .filter(s => s.src && s.src.includes('sndcdn.com/assets/'));

        for (const script of appScripts) {
          try {
            const text = await fetch(script.src).then(res => res.text());
            const match = text.match(/client_id\s*:\s*"([a-zA-Z0-9_]+)"/);
            if (match && match[1]) {
              console.log('[SC DL] client_id found:', match[1]);
              return resolve(match[1]);
            }
          } catch (error) {
            console.warn(`[SC DL] Failed to fetch/parse script ${script.src}, trying others...`);
          }
        }
        await new Promise(p => setTimeout(p, 500));
      }
      reject('Client ID not found after multiple retries.');
    });
    return clientIdPromise;
  }

  async function fetchTrackInfo(trackUrl) {
    try {
      const clientId = await getClientId();
      const resolveUrl = `https://api-v2.soundcloud.com/resolve?url=${encodeURIComponent(trackUrl)}&client_id=${clientId}`;
      const response = await fetch(resolveUrl);
      if (!response.ok) throw new Error(`API resolve failed: ${response.status}`);
      return await response.json();
    } catch (error) {
      console.error('[SC DL] fetchTrackInfo failed:', error);
      throw error;
    }
  }

  function createDownloadButton(isPlaylistButton) {
    const btn = document.createElement('button');
    const btnClass = isPlaylistButton ? DOWNLOAD_BUTTON_PLAYLIST_CLASS : DOWNLOAD_BUTTON_CLASS;
    btn.className = `sc-button sc-button-small sc-button-responsive ${btnClass}`;
    btn.title = isPlaylistButton ? 'Download Playlist' : 'Download';
    btn.innerHTML = SVG_ICON_DOWNLOAD;
    return btn;
  }

  async function handleSystemPlaylist(target) {
    console.log('[SC DL] System playlist download initiated.');
    target.disabled = true;

    try {
        const path = window.location.pathname;
        const clientId = await getClientId();
        let hydrationData;

        // Find and parse hydration data from page scripts
        const scripts = Array.from(document.querySelectorAll('script'));
        for (const script of scripts) {
            if (script.textContent.includes('window.__sc_hydration')) {
                const text = script.textContent;
                const match = text.match(/window\.__sc_hydration\s*=\s*(\[.+\]);/);
                if (match && match[1]) {
                    try {
                        hydrationData = JSON.parse(match[1]);
                        break; // Found it, no need to check other scripts
                    } catch (e) {
                        console.warn('[SC DL] Failed to parse hydration data, continuing...', e);
                    }
                }
            }
        }

        if (!hydrationData) {
            throw new Error('Could not find or parse page hydration data.');
        }

        let tracks = [];
        let playlistTitle = document.querySelector('.systemPlaylistDetails__title')?.textContent.trim() || 'SoundCloud Mix';
        let playlistUser = { username: 'System' }; // Default user

        console.log('[SC DL] DEBUG: Available hydration keys:', hydrationData.map(item => item.hydratable));
        
        // Strategy 1: Look for tracks directly in any hydration object
        const playlistHydrationObject = hydrationData.find(item =>
            item.data && Array.isArray(item.data.tracks) && item.data.tracks.length > 0
        );

        if (playlistHydrationObject) {
            console.log(`[SC DL] Found tracks in hydration object: '${playlistHydrationObject.hydratable}'`);
            tracks = playlistHydrationObject.data.tracks;
            // Use a more specific title if available from the hydration object
            playlistTitle = playlistHydrationObject.data.title || playlistHydrationObject.data.set_title || playlistTitle;
            // Try to get the real user/creator of the playlist/station
            if (playlistHydrationObject.data.user && playlistHydrationObject.data.user.username) {
                console.log(`[SC DL] Found playlist user: ${playlistHydrationObject.data.user.username}`);
                playlistUser = playlistHydrationObject.data.user;
            }
        }

        // Strategy 2: If no tracks found, try API for Likes/History pages
        if (tracks.length === 0 && (path.includes('/you/likes') || path.includes('/you/history'))) {
            console.log('[SC DL] No tracks in hydration, trying API for Likes/History.');
            let userId = null;
            const userObject = hydrationData.find(item => item.hydratable === 'user' || item.hydratable === 'me');
            if (userObject && userObject.data && userObject.data.id) {
                userId = userObject.data.id;
            }

            if (!userId) throw new Error('Could not find User ID for Likes/History page.');
            console.log(`[SC DL] Found User ID from page data: ${userId}`);

            let apiUrl = '';
            if (path.includes('/you/likes')) {
                apiUrl = `https://api-v2.soundcloud.com/users/${userId}/likes?limit=400&client_id=${clientId}`;
            } else if (path.includes('/you/history')) {
                apiUrl = `https://api-v2.soundcloud.com/users/${userId}/history/tracks?limit=400&client_id=${clientId}`;
            }

            if (apiUrl) {
                const response = await fetch(apiUrl);
                if (!response.ok) throw new Error(`API request failed for ${path}: ${response.status}`);
                const data = await response.json();
                const apiTracks = data.collection.map(item => (item.track || item)).filter(Boolean);
                if (apiTracks.length > 0) {
                    tracks = apiTracks;
                }
            }
        }

        if (!tracks || tracks.length === 0) {
            console.error('[SC DL] Final track search failed. For debugging, here is the full hydration data:', hydrationData);
            throw new Error('Could not find any tracks for this system playlist.');
        }

        const playlistObject = {
            kind: 'playlist',
            title: playlistTitle,
            tracks: tracks,
            track_count: tracks.length,
            user: playlistUser
        };

        chrome.runtime.sendMessage({
            action: 'fetchDownloadUrl',
            data: { trackInfo: playlistObject, clientId }
        });

    } catch (error) {
        console.error(`[SC DL] System playlist download failed: ${error.message}`);
    } finally {
        setTimeout(() => { target.disabled = false; }, 1000);
    }
  }

  async function handleTrackClick(event) {
    const target = event.target.closest(`.${DOWNLOAD_BUTTON_CLASS}, .${DOWNLOAD_BUTTON_PLAYLIST_CLASS}`);
    if (!target) return;
    
    // --- Divert to special handler for system playlists ---
    if (target.closest('.systemPlaylistDetails__controls')) {
        handleSystemPlaylist(target);
        return;
    }

    event.preventDefault();
    event.stopPropagation();

    const isPlaylist = target.classList.contains(DOWNLOAD_BUTTON_PLAYLIST_CLASS);
    const trackUrl = isPlaylist ? window.location.href : target.dataset.trackUrl;

    if (!trackUrl) {
      console.error('[SC DL] No track URL found for this button.');
      return;
    }

    console.log(`[SC DL] Click detected. Type: ${isPlaylist ? 'Playlist' : 'Single'}. URL: ${trackUrl}`);
    target.disabled = true;

    try {
      const [trackInfo, clientId] = await Promise.all([fetchTrackInfo(trackUrl), getClientId()]);
      
      chrome.runtime.sendMessage({
        action: 'fetchDownloadUrl',
        data: { trackInfo, clientId }
      });
    } catch (error) {
      console.error(`[SC DL] Download failed: ${error.message}`);
    } finally {
      target.disabled = false;
    }
  }

  function addButtons(node) {
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    // --- Handle Individual Track Buttons ---
    ACTION_SELECTORS.forEach(selector => {
        const groups = [];
        // Check if the node itself is a target
        try {
            if (node.matches(selector)) groups.push(node);
        } catch(e) { /* ignore invalid selectors for nodes that aren't elements */ }
        // Check for targets inside the node
        groups.push(...node.querySelectorAll(selector));

        groups.forEach(group => {
            if (group.querySelector(`.${DOWNLOAD_BUTTON_CLASS}`)) return;

            let trackUrl;
            const mainTrackContainer = group.closest('.listenEngagement__actions');
            const tileContainer = group.closest('.playableTile');
            const soundContainer = group.closest('.sound, .soundList__item, .soundBadge, .trackItem');

            if (mainTrackContainer) {
                trackUrl = window.location.href;
            } else if (tileContainer) {
                const linkEl = tileContainer.querySelector('a.playableTile__artworkLink');
                if (linkEl?.href) trackUrl = new URL(linkEl.href, window.location.origin).href;
            } else if (soundContainer) {
                const linkEl = soundContainer.querySelector('a.soundTitle__title, a.trackItem__trackTitle');
                if (linkEl?.href) trackUrl = new URL(linkEl.href, window.location.origin).href;
            }
            
            if (!trackUrl) return;

            const btn = createDownloadButton(false);
            btn.dataset.trackUrl = trackUrl;

            // --- Style Matching ---
            const existingButton = group.querySelector('.sc-button:not(.sc-button-download)');
            if (existingButton) {
                const classesToCopy = ['sc-button-secondary', 'sc-button-icon', 'playableTile__actionButton'];
                classesToCopy.forEach(cls => {
                    if (existingButton.classList.contains(cls)) btn.classList.add(cls);
                });
                const sizeClass = Array.from(existingButton.classList).find(c => c.match(/sc-button-(small|medium|large)/));
                if (sizeClass) btn.classList.replace('sc-button-small', sizeClass);
            }
            
            group.appendChild(btn);
        });
    });

    // --- Handle Main Playlist Button ---
    const mainHeaderSelector = '.sound__header .soundActions .sc-button-group';
    const mainActionGroups = node.querySelectorAll(mainHeaderSelector);
    mainActionGroups.forEach(group => {
        if (group.querySelector(`.${DOWNLOAD_BUTTON_PLAYLIST_CLASS}`)) return;
        if (document.querySelector('.sound.playlist, .sound.album')) {
            const btn = createDownloadButton(true);
            if (!btn.classList.contains('sc-button-secondary')) {
                btn.classList.add('sc-button-secondary');
            }
            group.appendChild(btn);
        }
    });

    // --- Handle System Playlist Buttons (e.g., on 'Likes' page) ---
    const systemPlaylistControls = node.querySelectorAll('.systemPlaylistDetails__controls');
    systemPlaylistControls.forEach(controls => {
      if (controls.querySelector(`.${DOWNLOAD_BUTTON_PLAYLIST_CLASS}`)) return;

      const btn = createDownloadButton(true); // true for playlist
      btn.dataset.trackUrl = window.location.href; // Assign page URL for download

      // Match style of other buttons
      const existingButton = controls.querySelector('.sc-button');
      if (existingButton) {
        btn.classList.add('sc-button-secondary');
        const sizeClass = Array.from(existingButton.classList).find(c => c.match(/sc-button-(small|medium|large)/));
        if (sizeClass) {
          btn.classList.replace('sc-button-small', sizeClass);
        }
      }
      
      // Add text label, as these buttons are not icon-only
      const label = document.createElement('span');
      label.className = 'sc-button-label';
      label.textContent = 'Download';
      btn.appendChild(label);

      // Wrap button in its own div to match structure
      const buttonWrapper = document.createElement('div');
      buttonWrapper.className = 'systemPlaylistDetails__button';
      buttonWrapper.appendChild(btn);

      // Add to the beginning of the controls
      controls.prepend(buttonWrapper);
    });
  }

  // --- Observer & Initialization ---
  function startObserver() {
    const observer = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          addButtons(node);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    addButtons(document.body); // Initial run on the whole body
  }

  document.addEventListener('click', handleTrackClick, true);
  getClientId(); // Start fetching client_id as soon as possible
  startObserver();

})(); 