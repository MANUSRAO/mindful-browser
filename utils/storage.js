export const StorageKeys = Object.freeze({
  API_KEY: 'geminiApiKey',
  BLOCKED_DOMAINS: 'blockedDomains',
  ALLOWED_DOMAINS: 'allowedDomains',
});

export const DEFAULT_BLOCKED_DOMAINS = Object.freeze([
  'facebook.com',
  'instagram.com',
  'twitter.com',
  'x.com',
  'youtube.com',
  'reddit.com',
  'tiktok.com',
]);

async function getOne(key, fallback) {
  const result = await chrome.storage.local.get(key);
  return result[key] ?? fallback;
}

export async function getApiKey() {
  return (await getOne(StorageKeys.API_KEY, '')).trim();
}

export async function setApiKey(key) {
  await chrome.storage.local.set({ [StorageKeys.API_KEY]: (key ?? '').trim() });
}

export async function getBlockedDomains() {
  return await getOne(StorageKeys.BLOCKED_DOMAINS, [...DEFAULT_BLOCKED_DOMAINS]);
}

export async function setBlockedDomains(domains) {
  const cleaned = [...new Set(domains.map(d => d.toLowerCase().trim()).filter(Boolean))];
  await chrome.storage.local.set({ [StorageKeys.BLOCKED_DOMAINS]: cleaned });
}

export async function getAllowedDomains() {
  return await getOne(StorageKeys.ALLOWED_DOMAINS, {});
}

export async function setAllowedDomains(allowed) {
  await chrome.storage.local.set({ [StorageKeys.ALLOWED_DOMAINS]: allowed });
}

export async function grantAccess(domain, durationMs) {
  const allowed = await getAllowedDomains();
  allowed[domain] = Date.now() + durationMs;
  await setAllowedDomains(allowed);
}

export async function revokeAccess(domain) {
  const allowed = await getAllowedDomains();
  if (domain in allowed) {
    delete allowed[domain];
    await setAllowedDomains(allowed);
  }
}

export async function pruneExpiredAccess() {
  const allowed = await getAllowedDomains();
  const now = Date.now();
  let changed = false;
  for (const [domain, expiry] of Object.entries(allowed)) {
    if (typeof expiry !== 'number' || expiry <= now) {
      delete allowed[domain];
      changed = true;
    }
  }
  if (changed) await setAllowedDomains(allowed);
  return allowed;
}
