// content.js - Refactored for multiple buttons with heavy logging

(function() {
  'use strict';
  console.log('[Downloader V6] Script injected and running.');

  const DOWNLOAD_SVG_ICON = `
    <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="width: 16px; height: 16px;">
      <path d="M8.5 2a.5.5 0 00-1 0v6.793L5.354 6.646a.5.5 0 10-.708.708l3 3a.5.5 0 00.708 0l3-3a.5.5 0 00-.708-.708L8.5 8.793V2z" fill="currentColor"></path>
      <path d="M3.5 12.5a.5.5 0 000 1h9a.5.5 0 000-1h-9z" fill="currentColor"></path>
    </svg>`;

  let globalClientId = null;
  let scanCount = 0;

  // --- Core Functions ---

  /**
   * Caches the client_id for the session.
   * @returns {Promise<string|null>}
   */
  async function getClientId() {
    if (globalClientId) return globalClientId;
    
    console.log('[Downloader] Caching Client ID...');
    const pageHtml = document.documentElement.innerHTML;
    let match = pageHtml.match(/"clientId":"([^"]+)"/);
    if (match?.[1]) {
        globalClientId = match[1];
        console.log('[Downloader] Client ID found in HTML.');
        return globalClientId;
    }

    const scripts = Array.from(document.querySelectorAll('script[src]'));
    for (const script of scripts) {
      try {
        const scriptContent = await fetch(script.src).then(res => res.text());
        match = scriptContent.match(/client_id:"([a-zA-Z0-9_-]+)"/);
        if (match?.[1]) {
          globalClientId = match[1];
          console.log('[Downloader] Client ID found in script:', script.src);
          return globalClientId;
        }
      } catch (e) { /* ignore */ }
    }
    console.error('[Downloader] CRITICAL: Client ID could not be found.');
    return null;
  }

  /**
   * Finds the corresponding track or playlist data object for a given track element.
   * It finds a URL within the element (or uses the page URL) and resolves it via API.
   * @param {HTMLElement} trackContainer - The DOM element for the track or a larger container.
   * @returns {Promise<object|null>}
   */
  async function findTrackInfoForElement(trackContainer) {
    // Универсальный селектор для ссылок на заголовки в разных представлениях
    const link = trackContainer.querySelector('a.soundTitle__title, a.trackItem__trackTitle');
    
    // Если ссылка найдена в элементе, используем ее. Иначе (для главной страницы трека/плейлиста) - URL всей страницы.
    const urlToResolve = link ? link.href : window.location.href;

    console.log(`[Downloader] Resolving URL: ${urlToResolve}`);
    const clientId = await getClientId();
    if (!clientId) {
        console.error('[Downloader] Cannot resolve: Client ID not found.');
        return null;
    }
    
    const resolveUrl = `https://api-v2.soundcloud.com/resolve?url=${encodeURIComponent(urlToResolve)}&client_id=${clientId}`;
    try {
        const response = await fetch(resolveUrl);
        if (!response.ok) throw new Error(`API response status: ${response.status}`);
        
        const data = await response.json();
        // Возвращаем данные, если это трек или плейлист. Фон разберется.
        if (data.kind === 'track' || data.kind === 'playlist') {
            console.log(`[Downloader] Resolved as a ${data.kind}: "${data.title}"`);
            return data;
        }
    } catch (error) {
        console.error('[Downloader] Resolve API failed:', error);
    }

    return null;
  }
  
  /**
   * Handles the download button click.
   * @param {Event} event
   */
  async function handleDownloadClick(event) {
    const button = event.currentTarget;
    event.stopPropagation();
    
    button.disabled = true;
    button.innerHTML = '...';
    
    try {
      const clientId = await getClientId();
      if (!clientId) throw new Error('Client ID not found.');
      
      const trackContainer = button.closest('.sound, .trackItem, .listen__body, .searchList__item, .listenEngagement, .soundBadge');
      if (!trackContainer) throw new Error('Could not find parent track container for the button.');
      
      const trackOrPlaylistInfo = await findTrackInfoForElement(trackContainer);
      if (!trackOrPlaylistInfo) throw new Error('Could not resolve track/playlist info for this element.');
      
      console.log(`[Downloader] Sending download request for "${trackOrPlaylistInfo.title}"`);
      chrome.runtime.sendMessage({
        action: 'fetchDownloadUrl',
        data: { clientId, trackInfo: trackOrPlaylistInfo }
      });
      
      button.innerHTML = '✓';
    } catch (error) {
      console.error('[Downloader] Download click error:', error);
      button.innerHTML = '✗';
    } finally {
      setTimeout(() => {
        button.disabled = false;
        button.innerHTML = DOWNLOAD_SVG_ICON;
      }, 2000);
    }
  }

  // --- UI Injection ---

  /**
   * Creates a new download button, adapting its size to sibling buttons.
   * @param {HTMLElement} actionGroup - The button group where the new button will be injected.
   * @returns {HTMLButtonElement}
   */
  function createDownloadButton(actionGroup) {
    const button = document.createElement('button');
    
    // Determine button size by checking for existing small buttons in the group
    const isSmall = actionGroup.querySelector('.sc-button-small');
    const sizeClass = isSmall ? 'sc-button-small' : 'sc-button-medium';

    button.className = `sc-button-secondary sc-button ${sizeClass} sc-button-icon sc-button-responsive`;
    button.title = 'Скачать трек';
    button.innerHTML = DOWNLOAD_SVG_ICON;
    button.addEventListener('click', handleDownloadClick);
    return button;
  }

  /**
   * Finds all track items on the page and injects a download button if one doesn't exist.
   *
   * This is the core logic that needs to be robust against SoundCloud's layout changes.
   * We will look directly for the button groups, as they are a stable landmark.
   */
  function scanAndInject() {
    scanCount++;
    console.log(`[Downloader] Scan #${scanCount} running...`);

    // Selector for the button group container. We add :not(.download-btn-injected)
    // to avoid processing the same group twice.
    const selector = '.soundActions .sc-button-group:not(.download-btn-injected)';
    const actionGroups = document.querySelectorAll(selector);

    if (actionGroups.length > 0) {
      console.log(`[Downloader] Found ${actionGroups.length} new action group(s).`);
    }

    for (const group of actionGroups) {
      group.classList.add('download-btn-injected');

      const trackContainer = group.closest('.sound, .trackItem, .listen__body, .searchList__item, .soundBadge');
      
      if (trackContainer && trackContainer.querySelector('a.soundTitle__title')) {
        console.log('[Downloader] Found valid track container, injecting button into:', group);
        const button = createDownloadButton(group);
        group.prepend(button);
      } else {
        // This is a special case for the main player on a track page,
        // where the actions are sometimes detached from the main title element.
        if(document.querySelector('.listenEngagement')) {
             console.log('[Downloader] Found main player via .listenEngagement, injecting button.');
             const button = createDownloadButton(group);
             group.prepend(button);
        } else {
            console.warn('[Downloader] Found an action group, but could not determine its track container.', group);
        }
      }
    }
  }

  // --- Initialization ---

  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
  }

  const debouncedScan = debounce(scanAndInject, 500);
  const observer = new MutationObserver(debouncedScan);
  
  getClientId().then(id => {
    if(id) {
        console.log('[Downloader] Client ID cached. Starting observer.');
        observer.observe(document.body, { childList: true, subtree: true });
        scanAndInject(); // Initial scan
    } else {
        console.error('[Downloader] Could not start observer, Client ID not found.');
    }
  });

  console.log('[Downloader] SoundCloud Downloader V6 initialized.');

})(); 