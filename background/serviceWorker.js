import {
  getBlockedDomains,
  getAllowedDomains,
  grantAccess,
  revokeAccess,
  pruneExpiredAccess,
  StorageKeys,
} from "../utils/storage.js";
import {
  ACCESS_DURATION_MS,
  alarmNameForDomain,
  domainFromAlarmName,
} from "../utils/timer.js";

const RULE_ID_OFFSET = 1000;
const CONTENT_SCRIPT_ID = "mindful-enforcer";

function ruleIdFor(index) {
  return RULE_ID_OFFSET + index;
}

function buildBlockRule(domain, id) {
  const blockUrl = chrome.runtime.getURL("block/block.html");
  return {
    id,
    priority: 1,
    action: {
      type: "redirect",
      redirect: { url: `${blockUrl}?domain=${encodeURIComponent(domain)}` },
    },
    condition: {
      urlFilter: `||${domain}^`,
      resourceTypes: ["main_frame"],
    },
  };
}

let _syncChain = Promise.resolve();
function serialize(fn) {
  const next = _syncChain.then(fn, fn);
  _syncChain = next.catch(() => {});
  return next;
}

async function _syncDnrRulesImpl() {
  const [blocked, allowed] = await Promise.all([
    getBlockedDomains(),
    pruneExpiredAccess(),
  ]);

  const desiredRules = [];
  blocked.forEach((domain, idx) => {
    const expiry = allowed[domain];
    if (typeof expiry === "number" && expiry > Date.now()) return;
    desiredRules.push(buildBlockRule(domain, ruleIdFor(idx)));
  });

  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = [
    ...new Set([
      ...existing.map((r) => r.id),
      ...desiredRules.map((r) => r.id),
    ]),
  ];

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds,
    addRules: desiredRules,
  });
}

function syncDnrRules() {
  return serialize(_syncDnrRulesImpl);
}

async function syncContentScripts() {
  const blocked = await getBlockedDomains();
  const matches = blocked.flatMap((d) => [`*://${d}/*`, `*://*.${d}/*`]);

  try {
    const registered = await chrome.scripting.getRegisteredContentScripts({
      ids: [CONTENT_SCRIPT_ID],
    });
    if (registered.length > 0) {
      await chrome.scripting.unregisterContentScripts({
        ids: [CONTENT_SCRIPT_ID],
      });
    }
  } catch {}

  if (matches.length === 0) return;

  await chrome.scripting.registerContentScripts([
    {
      id: CONTENT_SCRIPT_ID,
      js: ["content/contentScript.js"],
      matches,
      runAt: "document_start",
      persistAcrossSessions: true,
      allFrames: false,
    },
  ]);
}

async function evictTabsForDomain(domain) {
  const blockUrl = `${chrome.runtime.getURL("block/block.html")}?domain=${encodeURIComponent(domain)}`;
  try {
    const tabs = await chrome.tabs.query({});
    const targets = tabs.filter((t) => {
      if (t.id == null || !t.url) return false;
      let host;
      try {
        host = new URL(t.url).hostname.replace(/^www\./, "");
      } catch {
        return false;
      }
      return host === domain || host.endsWith("." + domain);
    });
    console.log(`[mindful] evicting ${targets.length} tab(s) from ${domain}`);
    await Promise.all(
      targets.map((t) =>
        chrome.tabs.update(t.id, { url: blockUrl }).catch((err) => {
          console.warn(`[mindful] tab ${t.id} update failed:`, err);
        }),
      ),
    );
  } catch (err) {
    console.warn("[mindful] evictTabsForDomain failed:", err);
  }
}

async function syncAlarms() {
  const allowed = await pruneExpiredAccess();
  const existing = await chrome.alarms.getAll();
  const existingNames = new Set(existing.map((a) => a.name));

  for (const [domain, expiry] of Object.entries(allowed)) {
    const name = alarmNameForDomain(domain);
    if (!existingNames.has(name)) {
      await chrome.alarms.create(name, { when: expiry });
    }
  }
  for (const alarm of existing) {
    const dom = domainFromAlarmName(alarm.name);
    if (dom && !(dom in allowed)) {
      await chrome.alarms.clear(alarm.name);
    }
  }
}

async function syncAll() {
  await Promise.all([syncDnrRules(), syncContentScripts(), syncAlarms()]);
}

chrome.runtime.onInstalled.addListener(syncAll);
chrome.runtime.onStartup.addListener(syncAll);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (StorageKeys.BLOCKED_DOMAINS in changes) {
    syncAll().catch((err) => console.error("[mindful] sync failed", err));
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  console.log("[mindful] alarm fired:", alarm.name);
  const domain = domainFromAlarmName(alarm.name);
  if (!domain) return;
  try {
    await revokeAccess(domain);
    await syncDnrRules();
    await evictTabsForDomain(domain);
  } catch (err) {
    console.error("[mindful] alarm handler failed:", err);
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      switch (msg?.type) {
        case "GRANT_ACCESS": {
          if (!msg.domain) throw new Error("Missing domain");
          const expiresAt = Date.now() + ACCESS_DURATION_MS;
          await grantAccess(msg.domain, ACCESS_DURATION_MS);
          await chrome.alarms.create(alarmNameForDomain(msg.domain), {
            when: expiresAt,
          });
          await syncDnrRules();
          console.log(
            `[mindful] granted ${msg.domain} until ${new Date(expiresAt).toISOString()}`,
          );
          sendResponse({ ok: true, expiresAt });
          return;
        }
        case "REVOKE_ACCESS": {
          if (!msg.domain) throw new Error("Missing domain");
          await chrome.alarms.clear(alarmNameForDomain(msg.domain));
          await revokeAccess(msg.domain);
          await syncDnrRules();
          await evictTabsForDomain(msg.domain);
          sendResponse({ ok: true });
          return;
        }
        case "RESYNC": {
          await syncAll();
          sendResponse({ ok: true });
          return;
        }
        default:
          sendResponse({
            ok: false,
            error: `Unknown message type: ${msg?.type}`,
          });
      }
    } catch (err) {
      sendResponse({ ok: false, error: err?.message ?? String(err) });
    }
  })();
  return true;
});
