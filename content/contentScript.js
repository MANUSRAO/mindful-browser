(() => {
  const host = location.hostname.replace(/^www\./, '');

  async function tick() {
    const { blockedDomains = [], allowedDomains = {} } =
      await chrome.storage.local.get(['blockedDomains', 'allowedDomains']);

    const matched = blockedDomains.find(
      d => host === d || host.endsWith('.' + d)
    );
    if (!matched) return null;

    const expiry = allowedDomains[matched];
    if (typeof expiry !== 'number' || expiry <= Date.now()) {
      location.reload();
      return null;
    }
    return expiry;
  }

  let scheduled = null;

  async function schedule() {
    if (scheduled !== null) {
      clearTimeout(scheduled);
      scheduled = null;
    }
    const expiry = await tick();
    if (!expiry) return;
    const ms = Math.max(500, expiry - Date.now() + 250);
    scheduled = setTimeout(schedule, ms);
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.allowedDomains || changes.blockedDomains)) {
      schedule();
    }
  });

  schedule();
})();
