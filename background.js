// background.js

// Слушатель для сообщений от content.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'fetchDownloadUrl') {
    (async () => {
      const { trackInfo, clientId } = request.data;

      try {
        if (trackInfo.kind === 'track') {
          console.log(`[BG] Single track download initiated: "${trackInfo.title}"`);
          await processAndDownloadTrack(trackInfo, clientId);

        } else if (trackInfo.kind === 'playlist') {
          console.log(`[BG] Playlist download initiated: "${trackInfo.title}", ${trackInfo.track_count} tracks.`);
          const playlistFolder = trackInfo.title.replace(/[/\\?%*:|"<>]/g, '-');
          
          for (const trackSummary of trackInfo.tracks) {
            // Check if it's a valid track summary before processing
            if (trackSummary && trackSummary.id) {
               await processAndDownloadTrack(trackSummary, clientId, playlistFolder);
               // Add a small delay to be polite to the API
               await new Promise(resolve => setTimeout(resolve, 300)); 
            } else {
               console.warn('[BG] Skipping invalid item in playlist:', JSON.stringify(trackSummary, null, 2));
            }
          }
          console.log(`[BG] Playlist download finished for "${trackInfo.title}".`);
        }
      } catch (e) {
        console.error('[BG] Top-level error in listener:', e);
      }
    })();
    return true; // Keep channel open for async operations
  }
});

/**
 * Fetches the full track data, gets the final download URL, and initiates the download.
 * @param {object} trackObject - A track object (can be a summary or a full object).
 * @param {string} clientId - The API client_id.
 * @param {string} [subfolder=''] - The optional subfolder for the download.
 */
async function processAndDownloadTrack(trackObject, clientId, subfolder = '') {
  try {
    // Step 1: Always fetch the full track object to ensure we have fresh media data.
    console.log(`[BG] Processing track: "${trackObject.title}" (ID: ${trackObject.id})`);
    const trackApiUrl = `https://api-v2.soundcloud.com/tracks/${trackObject.id}?client_id=${clientId}`;
    const trackApiResponse = await fetch(trackApiUrl);
    if (!trackApiResponse.ok) {
      throw new Error(`Failed to fetch full track object, status: ${trackApiResponse.status}`);
    }
    const fullTrackObject = await trackApiResponse.json();

    // Step 2: Extract the progressive transcoding URL from the full object.
    const progressiveTranscoding = fullTrackObject.media?.transcodings?.find(
      t => t.format?.protocol === 'progressive'
    );
    if (!progressiveTranscoding?.url) {
      throw new Error('Track is not available for download (no progressive stream URL).');
    }

    // Step 3: Fetch the intermediate URL to get the final download URL from the JSON response.
    const intermediateUrl = `${progressiveTranscoding.url}?client_id=${clientId}`;
    const finalUrlResponse = await fetch(intermediateUrl);
    if (!finalUrlResponse.ok) {
      throw new Error(`Failed to fetch intermediate URL, status: ${finalUrlResponse.status}`);
    }
    const finalUrlData = await finalUrlResponse.json();
    const finalDownloadUrl = finalUrlData.url;

    if (!finalDownloadUrl) {
      throw new Error('Final download URL was not found in the API response.');
    }

    // Step 4: Sanitize filename and initiate download.
    const sanitizedTitle = fullTrackObject.title.replace(/[/\\?%*:|"<>]/g, '-');
    const filename = subfolder ? `${subfolder}/${sanitizedTitle}.mp3` : `${sanitizedTitle}.mp3`;
    
    console.log(`[BG] Starting download for "${fullTrackObject.title}" to "${filename}"`);
    chrome.downloads.download({
      url: finalDownloadUrl,
      filename: filename
    });

  } catch (error) {
    console.error(`[BG] Failed to process/download track "${trackObject.title || 'Unknown'}":`, error);
  }
} 