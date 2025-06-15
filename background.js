// background.js

// Слушатель для сообщений от content.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'fetchDownloadUrl') {
    (async () => {
      const { trackInfo, clientId } = request.data;

      try {
        if (trackInfo.kind === 'track') {
          console.log(`[BG] Single track download: "${trackInfo.title}"`);
          await downloadTrack(trackInfo, clientId);

        } else if (trackInfo.kind === 'playlist') {
          console.log(`[BG] Playlist download: "${trackInfo.title}", ${trackInfo.track_count} tracks.`);
          // Sanitize playlist title for folder name
          const playlistFolder = trackInfo.title.replace(/[/\\?%*:|"<>]/g, '-');
          
          for (const track of trackInfo.tracks) {
            await downloadTrack(track, clientId, playlistFolder);
            // Optional: add a small delay to avoid overwhelming the download manager or getting rate-limited.
            await new Promise(resolve => setTimeout(resolve, 200)); 
          }
        }
      } catch (e) {
        console.error('[BG] Top-level download error:', e);
      }
    })();
    return true;
  }
});

/**
 * Downloads a single track, optionally into a subfolder.
 * @param {object} track - The track object from SoundCloud API.
 * @param {string} clientId - The API client_id.
 * @param {string} [subfolder=''] - The subfolder to save the track in.
 */
async function downloadTrack(track, clientId, subfolder = '') {
  try {
    const finalUrl = await getFinalDownloadUrl(track, clientId);
    const sanitizedTitle = track.title.replace(/[/\\?%*:|"<>]/g, '-');
    const filename = subfolder ? `${subfolder}/${sanitizedTitle}.mp3` : `${sanitizedTitle}.mp3`;
    
    console.log(`[BG] Downloading to: ${filename}`);
    chrome.downloads.download({
      url: finalUrl,
      filename: filename
    });
  } catch (error) {
    console.error(`[BG] Failed to download track "${track.title}":`, error);
  }
}

async function getFinalDownloadUrl(trackInfo, clientId) {
    // This function might need to fetch the full track object if `media` is missing
    let media = trackInfo.media;
    if (!media) {
      console.log(`[BG] Media data missing for "${trackInfo.title}", fetching full track object...`);
      const trackApiUrl = `https://api-v2.soundcloud.com/tracks/${trackInfo.id}?client_id=${clientId}`;
      const trackApiResponse = await fetch(trackApiUrl);
      if (!trackApiResponse.ok) throw new Error(`Tracks API error: ${trackApiResponse.status}`);
      const fullTrackData = await trackApiResponse.json();
      media = fullTrackData.media;
    }

    if (!media || !media.transcodings) {
      throw new Error('Медиа-данные не содержат информации о транскодингах.');
    }

    const progressiveTranscoding = media.transcodings.find(t => t.format?.protocol === 'progressive');
    if (!progressiveTranscoding?.url) {
      throw new Error('Трек недоступен для скачивания (нет progressive-ссылки).');
    }

    const intermediateUrl = `${progressiveTranscoding.url}?client_id=${clientId}`;
    const response = await fetch(intermediateUrl);
    
    if (!response.ok) {
        throw new Error(`Не удалось получить финальный URL. Статус: ${response.status}`);
    }

    const responseData = await response.json();
    const finalDownloadUrl = responseData.url;

    if (!finalDownloadUrl) {
      throw new Error('Ответ API не содержал финального URL в поле "url".');
    }
    
    return finalDownloadUrl;
} 