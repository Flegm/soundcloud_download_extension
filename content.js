// content.js

const DOWNLOAD_SVG_ICON = `
  <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="width: 16px; height: 16px;">
    <path d="M8.5 2a.5.5 0 00-1 0v6.793L5.354 6.646a.5.5 0 10-.708.708l3 3a.5.5 0 00.708 0l3-3a.5.5 0 00-.708-.708L8.5 8.793V2z" fill="currentColor"></path>
    <path d="M3.5 12.5a.5.5 0 000 1h9a.5.5 0 000-1h-9z" fill="currentColor"></path>
  </svg>
`;

/**
 * Инициализирует вставку кнопок на страницу.
 */
function init() {
  // Ищем все группы кнопок на странице, которые еще не обработаны
  const actionGroups = document.querySelectorAll('.soundActions .sc-button-group:not([data-downloader-processed])');
  
  actionGroups.forEach(group => {
    // Помечаем группу как обработанную, чтобы не добавлять кнопку дважды
    group.setAttribute('data-downloader-processed', 'true');
    
    // Определяем размер кнопки по наличию родительского элемента .sound.hero
    const isMainTrackPage = group.closest('.sound.hero');
    const buttonSize = isMainTrackPage ? 'medium' : 'small';
    
    // Создаем и вставляем кнопку
    createAndInjectButton(group, buttonSize);
  });
}

/**
 * Создает и вставляет кнопку скачивания в указанный контейнер.
 * @param {HTMLElement} container - Элемент .sc-button-group, куда будет добавлена кнопка.
 * @param {'small'|'medium'} size - Размер кнопки.
 */
function createAndInjectButton(container, size) {
  const button = document.createElement('button');
  button.className = `sc-button-download sc-button-secondary sc-button sc-button-${size} sc-button-icon sc-button-responsive`;
  button.title = 'Скачать трек';
  button.innerHTML = DOWNLOAD_SVG_ICON;

  button.addEventListener('click', handleDownloadClick);
  
  container.prepend(button);
}

/**
 * Обработчик клика по любой кнопке "Скачать".
 */
async function handleDownloadClick(event) {
  event.stopPropagation();
  const button = event.currentTarget;

  button.disabled = true;
  button.textContent = '...';
  
  try {
    const trackContainer = button.closest('.sound, .soundList__item');
    if (!trackContainer) throw new Error('Не удалось найти контейнер трека');

    const titleLink = trackContainer.querySelector('a.soundTitle__title');
    if (!titleLink?.href) throw new Error('Не удалось найти ссылку на трек');

    const trackUrl = titleLink.href;
    console.log(`[Downloader] Начинаю обработку URL: ${trackUrl}`);

    const clientId = await findClientId();
    if (!clientId) throw new Error('Не удалось найти client_id');

    const trackInfo = await findTrackDataByUrl(trackUrl, clientId);
    if (!trackInfo) throw new Error('Не удалось получить информацию о треке по URL');

    chrome.runtime.sendMessage({
      action: 'fetchDownloadUrl',
      data: { clientId, trackInfo }
    });

  } catch (error) {
    console.error('[Downloader] Ошибка при обработке клика:', error);
    button.textContent = '✗';
    setTimeout(() => {
      button.innerHTML = DOWNLOAD_SVG_ICON;
      button.disabled = false;
    }, 2000);
  }
}

// --- Функции-помощники ---

async function findTrackDataByUrl(url, clientId) {
  const resolveUrl = `https://api-v2.soundcloud.com/resolve?url=${encodeURIComponent(url)}&client_id=${clientId}`;
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
      } catch (e) { /* Игнорируем ошибки от заблокированных скриптов */ }
  }
  return null;
}

// --- Обработка ответов от background.js и наблюдение за DOM ---

chrome.runtime.onMessage.addListener((request) => {
  if (request.action === 'downloadStatus') {
    // Эта логика может быть улучшена, если знать, какая именно кнопка была нажата.
    // Но для простоты пока обновляем все кнопки.
    const buttons = document.querySelectorAll('.sc-button-download');
    buttons.forEach(button => {
        if (button.disabled) { // Обновляем только ту, что была нажата
            button.textContent = request.status === 'success' ? '✓' : '✗';
            setTimeout(() => {
                button.innerHTML = DOWNLOAD_SVG_ICON;
                button.disabled = false;
            }, 2000);
        }
    });
  }
});

const observer = new MutationObserver(() => init());
observer.observe(document.body, { childList: true, subtree: true });

// Первый запуск
init();