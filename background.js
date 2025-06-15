// background.js

// Слушатель для сообщений от content.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'fetchDownloadUrl') {
    console.log('[BG] Получены данные от content.js:', request.data);
    
    // Запускаем асинхронную операцию
    (async () => {
      try {
        const finalUrl = await getFinalDownloadUrl(request.data.trackInfo, request.data.clientId);
        
        console.log('[BG] Финальный URL получен, начинаю скачивание:', finalUrl);

        // Используем API для скачивания
        chrome.downloads.download({
          url: finalUrl,
          // Очищаем имя файла от недопустимых символов
          filename: `${request.data.trackInfo.title.replace(/[/\\?%*:|"<>]/g, '-')}.mp3`
        });
        
        // Сообщаем content.js об успехе
        chrome.tabs.sendMessage(sender.tab.id, { action: 'downloadStatus', status: 'success' });

      } catch (error) {
        console.error('[BG] Полная ошибка в фоновом скрипте:', error);
        // Сообщаем content.js об ошибке
        chrome.tabs.sendMessage(sender.tab.id, { action: 'downloadStatus', status: 'error', message: error.message });
      }
    })();

    return true; // Держим канал открытым для асинхронных операций
  }
});


async function getFinalDownloadUrl(trackInfo, clientId) {
    let media = trackInfo.media;
    if (!media) {
      console.log(`[BG] Медиа-данные отсутствуют, делаю доп. запрос к tracks API...`);
      const trackApiUrl = `https://api-v2.soundcloud.com/tracks/${trackInfo.id}?client_id=${clientId}`;
      const trackApiResponse = await fetch(trackApiUrl);
      if (!trackApiResponse.ok) throw new Error(`Ошибка Tracks API: ${trackApiResponse.status}`);
      const trackApiData = await trackApiResponse.json();
      media = trackApiData.media;
    }

    if (!media || !media.transcodings) {
      throw new Error('Медиа-данные не содержат информации о транскодингах.');
    }

    const progressiveTranscoding = media.transcodings.find(t => t.format?.protocol === 'progressive');
    if (!progressiveTranscoding?.url) {
      throw new Error('Трек недоступен для скачивания (нет progressive-ссылки).');
    }

    const intermediateUrl = `${progressiveTranscoding.url}?client_id=${clientId}`;
    console.log(`[BG] Запрос по промежуточному URL: ${intermediateUrl}`);
    const response = await fetch(intermediateUrl);
    
    if (!response.ok) {
        throw new Error(`Не удалось получить финальный URL. Статус: ${response.status}`);
    }

    // ИЗМЕНЕНИЕ: Парсим JSON-ответ, чтобы получить финальный URL
    const responseData = await response.json();
    const finalDownloadUrl = responseData.url;

    if (!finalDownloadUrl) {
      throw new Error('Ответ API не содержал финального URL в поле "url".');
    }
    
    console.log(`[BG] Успех! Финальный URL извлечен из JSON: ${finalDownloadUrl}`);
    return finalDownloadUrl;
} 