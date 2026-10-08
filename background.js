import { DEFAULT_SETTINGS, normalizeSettings, siteFromUrl } from "./shared.js";

let creating;
let queue = Promise.resolve();

function enqueue(operation) {
  const result = queue.then(operation);
  queue = result.catch(() => {});
  return result;
}

async function hasEngine() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"], documentUrls: [chrome.runtime.getURL("offscreen.html")] });
  return contexts.length > 0;
}

async function ensureEngine() {
  if (await hasEngine()) return;
  if (!creating) {
    creating = chrome.offscreen.createDocument({
      url: "offscreen.html", reasons: ["USER_MEDIA"],
      justification: "Process user-selected tab audio with volume, equalizer, and stereo controls."
    }).finally(() => { creating = null; });
  }
  await creating;
}

async function engine(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({ target: "offscreen", type, ...payload });
  if (!response?.ok) throw new Error(response?.error || "The audio engine did not respond. Please reconnect this tab.");
  return response.data;
}

async function snapshot() {
  return await hasEngine() ? engine("snapshot") : [];
}

async function profiles() {
  const stored = await chrome.storage.local.get(["profiles", "remember"]);
  return { profiles: stored.profiles || {}, remember: stored.remember !== false };
}

async function saveProfile(host, settings) {
  const stored = await profiles();
  if (stored.remember) {
    stored.profiles[host] = normalizeSettings(settings);
    await chrome.storage.local.set({ profiles: stored.profiles });
  }
}

async function updateBadge(tabId, settings) {
  try {
    await chrome.action.setBadgeBackgroundColor({ tabId, color: "#000080" });
    await chrome.action.setBadgeText({ tabId, text: settings ? settings.muted ? "M" : `${settings.volume}%` : "" });
    await chrome.action.setTitle({ tabId, title: settings ? `Sound Enhancer 98 — ${settings.muted ? "Muted" : `${settings.volume}%`}` : "Sound Enhancer 98" });
  } catch { /* A tab can close before its badge updates. */ }
}

async function closeIdleEngine() {
  if (await hasEngine() && (await engine("snapshot")).length === 0) await chrome.offscreen.closeDocument();
}

async function stopTab(tabId) {
  if (await hasEngine()) await engine("stop", { tabId });
  await updateBadge(tabId, null);
  await closeIdleEngine();
}

async function activeSourceTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (siteFromUrl(tab?.url)) return tab;
  // The detached mixer is itself a focused browser window, not an audio source.
  const browserWindow = await chrome.windows.getLastFocused({ windowTypes: ["normal"], populate: true }).catch(() => null);
  return browserWindow?.tabs?.find(item => item.active);
}

async function openMixerWindow(message) {
  const url = new URL(chrome.runtime.getURL("popup.html"));
  url.searchParams.set("window", "1");
  url.searchParams.set("panel", message.panel === "sites" ? "sites" : "mixer");
  if (Number.isInteger(message.tabId)) {
    const tab = await chrome.tabs.get(message.tabId);
    if (siteFromUrl(tab.url)) {
      url.searchParams.set("tabId", String(tab.id));
      url.searchParams.set("settings", JSON.stringify(normalizeSettings(message.settings)));
    }
  }
  const windows = await chrome.windows.getAll({ populate: true, windowTypes: ["popup"] });
  const existing = windows.find(window => window.tabs?.some(tab => tab.url?.startsWith(chrome.runtime.getURL("popup.html") + "?window=1")));
  if (existing) {
    const tab = existing.tabs.find(tab => tab.url?.startsWith(chrome.runtime.getURL("popup.html") + "?window=1"));
    await chrome.tabs.update(tab.id, { url: url.href });
    const updated = await chrome.windows.update(existing.id, { focused: true, ...(existing.state === "minimized" ? { state: "normal" } : {}) });
    return { windowId: updated.id };
  }
  const created = await chrome.windows.create({ url: url.href, type: "popup", width: 456, height: 650, focused: true });
  return { windowId: created.id };
}

async function dashboard() {
  const [tabs, activeTab, stored, sessions] = await Promise.all([
    chrome.tabs.query({}), activeSourceTab(), profiles(), snapshot()
  ]);
  return {
    tabs: tabs.filter(tab => siteFromUrl(tab.url)).map(tab => ({
      id: tab.id, windowId: tab.windowId, title: tab.title || siteFromUrl(tab.url),
      host: siteFromUrl(tab.url), audible: Boolean(tab.audible), nativeMuted: Boolean(tab.mutedInfo?.muted)
    })),
    activeTabId: activeTab?.id, sessions, ...stored
  };
}

async function handle(message) {
  switch (message.type) {
    case "dashboard": return dashboard();
    case "popout": return openMixerWindow(message);
    case "connect": {
      const tab = await chrome.tabs.get(message.tabId);
      const host = siteFromUrl(tab.url);
      if (!host) throw new Error("Open a regular website to connect its audio. Chrome pages cannot be captured.");
      const settings = normalizeSettings(message.settings);
      const existing = (await snapshot()).find(session => session.tabId === tab.id);
      if (existing) {
        await engine("update", { tabId: tab.id, settings });
      } else {
        if (!tab.active) throw new Error("Switch to this tab, then open Sound Enhancer from the toolbar to connect it.");
        await ensureEngine();
        try {
          const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
          await engine("start", { tabId: tab.id, host, streamId, settings });
        } catch (error) {
          await closeIdleEngine();
          throw new Error(`Could not connect audio. Open the extension from this tab's toolbar and try again. ${error.message}`);
        }
      }
      await saveProfile(host, settings);
      await updateBadge(tab.id, settings);
      return dashboard();
    }
    case "update": {
      const tab = await chrome.tabs.get(message.tabId);
      const host = siteFromUrl(tab.url);
      if (!host) throw new Error("This tab is no longer on a supported website.");
      const settings = normalizeSettings(message.settings);
      const session = (await snapshot()).find(item => item.tabId === tab.id);
      if (session) {
        await engine("update", { tabId: tab.id, settings });
        await updateBadge(tab.id, settings);
      }
      await saveProfile(host, settings);
      return { settings, connected: Boolean(session) };
    }
    case "disconnect": await stopTab(message.tabId); return dashboard();
    case "remember": {
      await chrome.storage.local.set({ remember: Boolean(message.value) });
      if (message.value && message.tabId) {
        const tab = await chrome.tabs.get(message.tabId);
        const host = siteFromUrl(tab.url);
        if (host) await saveProfile(host, normalizeSettings(message.settings));
      }
      return { remember: Boolean(message.value) };
    }
    case "forget": {
      const stored = await profiles();
      delete stored.profiles[message.host];
      await chrome.storage.local.set({ profiles: stored.profiles });
      return dashboard();
    }
    case "focus": {
      const tab = await chrome.tabs.update(message.tabId, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
      return {};
    }
    case "engine-ended": {
      await updateBadge(message.tabId, null);
      await closeIdleEngine();
      return {};
    }
    default: throw new Error("Unknown mixer command.");
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target !== "background" || sender.id !== chrome.runtime.id) return false;
  enqueue(() => handle(message)).then(data => sendResponse({ ok: true, data }), error => sendResponse({ ok: false, error: error.message }));
  return true;
});

chrome.tabs.onRemoved.addListener(tabId => { enqueue(() => stopTab(tabId)).catch(console.error); });

chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (!change.url) return;
  enqueue(async () => {
    const session = (await snapshot()).find(item => item.tabId === tabId);
    // A boost from one website must never carry over to another website.
    if (session && siteFromUrl(change.url) !== session.host) await stopTab(tabId);
  }).catch(console.error);
});
