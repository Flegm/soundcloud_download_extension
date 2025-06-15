// content.js

const BUTTON_ID = 'sc-downloader-btn';
const DOWNLOAD_SVG_ICON = `
  <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="width: 16px; height: 16px;">
    <path d="M8.5 2a.5.5 0 00-1 0v6.793L5.354 6.646a.5.5 0 10-.708.708l3 3a.5.5 0 00.708 0l3-3a.5.5 0 00-.708-.708L8.5 8.793V2z" fill="currentColor"></path>
    <path d="M3.5 12.5a.5.5 0 000 1h9a.5.5 0 000-1h-9z" fill="currentColor"></path>
  </svg>
`;

// --- Основная логика ---

/**
 * Главная функция, которая ищет место для кнопки и вставляет её.
 */
function injectButton() {
  // Ищем контейнер с кнопками действий
  const actionsContainer = document.querySelector('.soundActions .sc-button-group');
  if (!actionsContainer) {
    // Если контейнера нет, ничего не делаем
    return;
  }
  
  // Проверяем, не была ли кнопка уже добавлена
  if (document.getElementById(BUTTON_ID)) {
    return;
  }
  
  console.log('[Downloader] Контейнер для кнопки найден. Создаю кнопку...');
  
  const downloadButton = document.createElement('button');
  downloadButton.id = BUTTON_ID;
  // Используем те же классы, что и у соседних кнопок для совпадения стиля
  downloadButton.className = 'sc-button-download sc-button sc-button-medium sc-button-icon sc-button-responsive';
  downloadButton.title = 'Скачать трек';
  downloadButton.innerHTML = DOWNLOAD_SVG_ICON;

  // Добавляем обработчик клика
  downloadButton.addEventListener('click', handleDownloadClick);
  
  // Вставляем нашу кнопку в начало группы кнопок
  actionsContainer.prepend(downloadButton);
}

/**
 * Обработчик клика по кнопке "Скачать".
 */
async function handleDownloadClick(event) {
  const button = event.currentTarget;
  // Предотвращаем клик по другим элементам
  event.stopPropagation();
  
  // Показываем, что процесс пошел
  button.disabled = true;
  button.textContent = '...';
  
  try {
    console.log('[Downloader] Кнопка нажата. Начинаю сбор информации...');
    
    const clientId = await findClientId();
    if (!clientId) throw new Error('Не удалось найти client_id');
    
    const trackInfo = await findTrackData(clientId);
    if (!trackInfo) throw new Error('Не удалось найти информацию о треке');
    
    console.log(`[Downloader] Информация собрана, отправляю в background.js...`);
    
    // Отправляем данные в background script для обработки
    chrome.runtime.sendMessage({
      action: 'fetchDownloadUrl',
      data: { clientId, trackInfo }
    });
  } catch (error) {
    console.error('[Downloader] Ошибка:', error);
    button.textContent = 'Ошибка!';
    // Возвращаем иконку через пару секунд
    setTimeout(() => {
      button.innerHTML = DOWNLOAD_SVG_ICON;
      button.disabled = false;
    }, 2000);
  }
}

// Слушаем ответ от background.js о статусе скачивания
chrome.runtime.onMessage.addListener((request) => {
  if (request.action === 'downloadStatus') {
    const button = document.getElementById(BUTTON_ID);
    if (!button) return;

    if (request.status === 'success') {
      button.textContent = '✓'; // Успех
    } else {
      console.error('[Downloader] Ошибка от background:', request.message);
      button.textContent = '✗'; // Ошибка
    }
    
    // Возвращаем исходное состояние кнопки через 2 секунды
    setTimeout(() => {
      button.innerHTML = DOWNLOAD_SVG_ICON;
      button.disabled = false;
    }, 2000);
  }
});


// --- Функции для поиска данных ---

async function findTrackData(clientId) {
  if (window.__sc_hydration) {
    for (const item of window.__sc_hydration) {
      if (item.hydratable === 'sound' && item.data?.id) {
        console.log('[Downloader] Данные о треке найдены в hydration-объекте.');
        return item.data;
      }
    }
  }
  
  console.warn('[Downloader] Не удалось найти данные в hydration. Использую fallback-метод (resolve).');
  const resolveUrl = `https://api-v2.soundcloud.com/resolve?url=${window.location.href}&client_id=${clientId}`;
  const response = await fetch(resolveUrl);
  if (!response.ok) return null;
  const data = await response.json();
  return data.kind === 'track' ? data : null;
}

async function findClientId() {
    const pageHtml = document.documentElement.innerHTML;
    let match = pageHtml.match(/"clientId":"([^"]+)"/);
    if (match?.[1]) return match[1];

    const scripts = Array.from(document.querySelectorAll('script[src]'));
    for (const script of scripts) {
        try {
            const scriptContent = await fetch(script.src).then(res => res.text());
            match = scriptContent.match(/client_id:"([a-zA-Z0-9_-]+)"/);
            if (match?.[1]) return match[1];
        } catch (e) { /* ignore */ }
    }
    return null;
}

// --- Наблюдатель за изменениями на странице ---

// Создаем наблюдателя, который будет запускать injectButton при изменениях в DOM
const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    // Проверяем, не была ли добавлена или удалена нода, которая может содержать наши кнопки
    if (mutation.addedNodes.length || mutation.removedNodes.length) {
      // Можно добавить более тонкую проверку, но для простоты просто вызываем функцию
      injectButton();
      break; // Выходим после первого же обнаружения, чтобы не вызывать функцию много раз
    }
  }
});

// Начинаем наблюдение за всем документом
observer.observe(document.body, {
  childList: true,
  subtree: true
});

// Вызываем функцию в первый раз на случай, если страница уже загрузилась
injectButton(); 