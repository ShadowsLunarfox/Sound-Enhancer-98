import { DEFAULT_SETTINGS, normalizeSettings } from "./shared.js";

// Standalone UI preview only. The real extension always uses Chrome's APIs.
export function createPreviewApi() {
  const data = {
    activeTabId: 1, remember: true,
    tabs: [
      { id: 1, title: "Late night jazz radio — YouTube", host: "www.youtube.com", audible: true },
      { id: 2, title: "Your favorite playlist — Spotify", host: "open.spotify.com", audible: true },
      { id: 3, title: "A very good movie — Netflix", host: "www.netflix.com", audible: false }
    ],
    sessions: [], profiles: {}
  };
  const copy = () => structuredClone(data);
  return async function request(type, payload = {}) {
    const tab = data.tabs.find(tab => tab.id === payload.tabId);
    switch (type) {
      case "dashboard": return copy();
      case "connect": {
        const settings = normalizeSettings(payload.settings);
        data.sessions = data.sessions.filter(session => session.tabId !== payload.tabId);
        data.sessions.push({ tabId: tab.id, host: tab.host, settings });
        if (data.remember) data.profiles[tab.host] = settings;
        return copy();
      }
      case "update": {
        const settings = normalizeSettings(payload.settings);
        const session = data.sessions.find(session => session.tabId === payload.tabId);
        if (session) session.settings = settings;
        if (data.remember) data.profiles[tab.host] = settings;
        return { settings, connected: Boolean(session) };
      }
      case "disconnect": data.sessions = data.sessions.filter(session => session.tabId !== payload.tabId); return copy();
      case "remember": data.remember = payload.value; if (payload.value && tab) data.profiles[tab.host] = normalizeSettings(payload.settings); return { remember: data.remember };
      case "forget": delete data.profiles[payload.host]; return copy();
      case "focus": data.activeTabId = payload.tabId; return {};
      case "meter": return { peak: 0, reduction: 0 };
      default: return DEFAULT_SETTINGS;
    }
  };
}
