import { getApiKey, getAllowedDomains } from '../utils/storage.js';
import { formatTimeRemaining } from '../utils/timer.js';

const apiState = document.getElementById('apiState');
const activeList = document.getElementById('active');
const settingsBtn = document.getElementById('settings');

settingsBtn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

async function refresh() {
  const apiKey = await getApiKey();
  apiState.innerHTML = apiKey
    ? '<p class="ok">✓ Gemini API key configured</p>'
    : '<p class="warn">⚠ No Gemini API key — open settings</p>';

  const allowed = await getAllowedDomains();
  const now = Date.now();
  const active = Object.entries(allowed)
    .filter(([, ts]) => typeof ts === 'number' && ts > now)
    .sort((a, b) => a[1] - b[1]);

  activeList.replaceChildren();
  if (active.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No active access';
    activeList.append(li);
  } else {
    for (const [domain, expiry] of active) {
      const li = document.createElement('li');
      const dom = document.createElement('span');
      dom.className = 'domain';
      dom.textContent = domain;
      const tm = document.createElement('span');
      tm.className = 'time';
      tm.textContent = formatTimeRemaining(expiry - now);
      li.append(dom, tm);
      activeList.append(li);
    }
  }
}

setInterval(refresh, 1000);
refresh();
