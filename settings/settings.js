import {
  getApiKey, setApiKey,
  getBlockedDomains, setBlockedDomains,
  getAllowedDomains,
} from '../utils/storage.js';
import { formatTimeRemaining } from '../utils/timer.js';

const $ = (id) => document.getElementById(id);
const apiKeyInput = $('apiKey');
const saveKeyBtn = $('saveKey');
const toggleKeyBtn = $('toggleKey');
const keyStatus = $('keyStatus');
const domainList = $('domainList');
const newDomainInput = $('newDomain');
const addDomainBtn = $('addDomain');
const domainError = $('domainError');
const allowList = $('allowList');

function setStatus(el, text, kind = 'info') {
  el.textContent = text;
  el.className = `status ${kind}`;
  el.hidden = false;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.hidden = true; }, 2500);
}

function normalizeDomain(raw) {
  if (!raw) return '';
  let v = String(raw).toLowerCase().trim();
  v = v.replace(/^https?:\/\//, '').replace(/^www\./, '');
  v = v.split('/')[0].split('?')[0].trim();
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(v)) return '';
  if (v.startsWith('-') || v.endsWith('-')) return '';
  return v;
}

async function init() {
  apiKeyInput.value = await getApiKey();
  await renderDomains();
  await renderAllowed();
}

saveKeyBtn.addEventListener('click', async () => {
  const v = apiKeyInput.value.trim();
  await setApiKey(v);
  setStatus(keyStatus, v ? 'API key saved.' : 'API key cleared.', v ? 'ok' : 'info');
});

toggleKeyBtn.addEventListener('click', () => {
  const showing = apiKeyInput.type === 'text';
  apiKeyInput.type = showing ? 'password' : 'text';
  toggleKeyBtn.textContent = showing ? 'Show' : 'Hide';
});

apiKeyInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') saveKeyBtn.click();
});

addDomainBtn.addEventListener('click', addDomain);
newDomainInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    addDomain();
  }
});
newDomainInput.addEventListener('input', () => {
  domainError.hidden = true;
  newDomainInput.classList.remove('invalid');
});

async function addDomain() {
  const cleaned = normalizeDomain(newDomainInput.value);
  if (!cleaned) {
    domainError.hidden = false;
    newDomainInput.classList.add('invalid');
    return;
  }
  const list = await getBlockedDomains();
  if (list.includes(cleaned)) {
    domainError.textContent = `${cleaned} is already in the list.`;
    domainError.hidden = false;
    newDomainInput.classList.add('invalid');
    return;
  }
  list.push(cleaned);
  await setBlockedDomains(list);
  newDomainInput.value = '';
  domainError.hidden = true;
  await renderDomains();
}

async function renderDomains() {
  const list = await getBlockedDomains();
  domainList.replaceChildren();

  if (list.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No blocked domains yet — add one below.';
    domainList.append(li);
    return;
  }

  for (const domain of list) {
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.className = 'domain-text';
    span.textContent = domain;
    li.append(span);
    domainList.append(li);
  }
}

async function renderAllowed() {
  const allowed = await getAllowedDomains();
  const now = Date.now();
  const entries = Object.entries(allowed)
    .filter(([, ts]) => typeof ts === 'number' && ts > now)
    .sort((a, b) => a[1] - b[1]);

  allowList.replaceChildren();

  if (entries.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No active access right now.';
    allowList.append(li);
    return;
  }

  for (const [domain, expiry] of entries) {
    const li = document.createElement('li');

    const span = document.createElement('span');
    span.className = 'domain-text';
    span.textContent = `${domain}`;

    const remaining = document.createElement('span');
    remaining.className = 'remaining';
    remaining.textContent = `${formatTimeRemaining(expiry - now)} remaining`;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'secondary small';
    btn.textContent = 'Revoke';
    btn.addEventListener('click', async () => {
      const resp = await chrome.runtime.sendMessage({ type: 'REVOKE_ACCESS', domain });
      if (!resp?.ok) console.error('Revoke failed:', resp?.error);
      await renderAllowed();
    });

    li.append(span, remaining, btn);
    allowList.append(li);
  }
}

setInterval(renderAllowed, 1000);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.blockedDomains) renderDomains();
  if (changes.allowedDomains) renderAllowed();
  if (changes.geminiApiKey) {
    apiKeyInput.value = changes.geminiApiKey.newValue ?? '';
  }
});

init();
