import { DEFAULT_SETTINGS, PRESETS, normalizeSettings, siteLabel } from "./shared.js";

const $ = id => document.getElementById(id);
const isExtension = Boolean(globalThis.chrome?.runtime?.id);
const request = isExtension ? async (type, payload = {}) => {
  const response = await chrome.runtime.sendMessage({ target: type === "meter" ? "offscreen" : "background", type, ...payload });
  if (!response?.ok) throw new Error(response?.error || "Could not reach the mixer. Reopen the extension to try again.");
  return response.data;
} : (await import("./preview-api.js")).createPreviewApi();

let data = { tabs: [], sessions: [], profiles: {}, remember: true };
let selectedId;
let settings = { ...DEFAULT_SETTINGS };
let busy = false;
let pendingUpdate = Promise.resolve();
let updateTimer;
let meterPending = false;
const draftSettings = new Map();
const segments = Array.from({ length: 18 }, () => {
  const segment = document.createElement("span");
  segment.className = "meter-segment";
  $("meter").append(segment);
  return segment;
});

const currentTab = () => data.tabs.find(tab => tab.id === selectedId);
const currentSession = () => data.sessions.find(session => session.tabId === selectedId);
const signed = value => `${value > 0 ? "+" : ""}${value} dB`;

function status(text, error = false) {
  $("status").textContent = text;
  $("status").title = text;
  if (error) { $("hint").textContent = text; $("hint").title = text; $("hint").classList.add("error"); }
}

function renderSettings() {
  for (const key of ["volume", "bass", "treble", "balance"]) $(key).value = settings[key];
  $("volume-number").value = settings.volume;
  $("volume-readout").value = settings.volume;
  $("boost-tag").textContent = settings.muted ? "MUTED" : `${(settings.volume / 100).toFixed(1)}×`;
  $("bass-value").value = signed(settings.bass);
  $("treble-value").value = signed(settings.treble);
  $("balance-value").value = settings.balance === 0 ? "Center" : `${Math.abs(settings.balance)}% ${settings.balance < 0 ? "L" : "R"}`;
  $("limiter").checked = settings.limiter;
  $("remember").checked = data.remember;
  $("mute").setAttribute("aria-pressed", String(settings.muted));
  $("mute").querySelector("span").textContent = settings.muted ? "Unmute" : "Mute";
  document.querySelectorAll("[data-volume]").forEach(button => button.classList.toggle("selected", Number(button.dataset.volume) === settings.volume));
  $("preset").value = Object.entries(PRESETS).find(([, preset]) => ["volume", "bass", "treble", "balance"].every(key => preset[key] === settings[key]))?.[0] || "custom";
  const boosted = settings.volume > 300;
  $("boost-note").classList.toggle("warning", boosted);
  $("boost-note").lastElementChild.textContent = boosted ? `${settings.volume / 100}× gain can distort loud audio. ${settings.limiter ? "Limiter is on." : "Limiter is off."}` : "Boost works best on quiet audio. Start at 100%.";
}

function renderConnection() {
  const tab = currentTab();
  const connected = Boolean(currentSession());
  const other = selectedId !== data.activeTabId;
  $("connection-light").classList.toggle("connected", connected);
  $("connection-light").title = connected ? "Audio connected" : "Disconnected";
  $("meter-state").textContent = connected ? "LIVE" : "OFFLINE";
  $("meter-state").classList.toggle("live", connected);
  $("site-icon").textContent = tab ? siteLabel(tab.host).charAt(0).toUpperCase() : "?";
  $("connect").textContent = busy ? "Please wait…" : connected ? "Disconnect this tab" : other && tab ? "Open tab to connect" : "Connect this tab";
  $("connect").disabled = busy || !tab;
  $("tab-select").disabled = busy || data.tabs.length === 0;
  for (const id of ["volume", "volume-number", "bass", "treble", "balance", "preset", "mute", "reset", "reset-menu", "limiter"]) $(id).disabled = busy || !tab;
  document.querySelectorAll("[data-volume]").forEach(button => { button.disabled = busy || !tab; });
  $("hint").classList.remove("error");
  $("hint").title = "";
  $("hint").textContent = !tab ? "Open a website that plays audio, then click this extension in the toolbar." : tab.nativeMuted ? "This tab is muted in Chrome. Unmute the browser tab to hear its audio." : connected ? "Audio stays connected when you close this window." : other ? "Switch to this tab, then open the extension from its toolbar to connect." : "Connect a tab to start. Your other tabs keep their own volume.";
  $("engine-status").textContent = `${data.sessions.length} ${data.sessions.length === 1 ? "tab" : "tabs"} connected`;
  if (!connected) setMeter(0);
}

function renderSites() {
  const entries = Object.entries(data.profiles).sort(([a], [b]) => a.localeCompare(b));
  $("site-count").textContent = entries.length;
  $("site-list").replaceChildren();
  if (!entries.length) {
    const empty = document.createElement("p");
    empty.className = "empty-sites";
    empty.textContent = "No saved websites yet. Adjust a website's mixer with “Remember settings” turned on to add it here.";
    $("site-list").append(empty);
  }
  for (const [host, values] of entries) {
    const profile = normalizeSettings(values);
    const row = document.createElement("div");
    row.className = "saved-site";
    const icon = document.createElement("div"); icon.className = "site-icon"; icon.textContent = siteLabel(host).charAt(0).toUpperCase(); icon.setAttribute("aria-hidden", "true");
    const details = document.createElement("div"); details.className = "saved-details";
    const name = document.createElement("strong"); name.textContent = siteLabel(host);
    const tone = document.createElement("small"); tone.textContent = `Bass ${signed(profile.bass)} · Treble ${signed(profile.treble)}`;
    details.append(name, tone);
    const volume = document.createElement("span"); volume.className = "saved-volume"; volume.textContent = profile.muted ? "MUTE" : `${profile.volume}%`;
    const forget = document.createElement("button"); forget.className = "forget-button"; forget.textContent = "Forget"; forget.setAttribute("aria-label", `Forget settings for ${siteLabel(host)}`);
    forget.addEventListener("click", async () => {
      forget.disabled = true;
      try {
        await flushUpdates();
        data = await request("forget", { host });
        renderSites();
        status(`Forgot ${siteLabel(host)}`);
      } catch (error) { status(error.message, true); forget.disabled = false; }
    });
    row.append(icon, details, volume, forget);
    $("site-list").append(row);
  }
}

function selectTab(tabId) {
  selectedId = tabId;
  settings = normalizeSettings(draftSettings.get(tabId) || currentSession()?.settings || data.profiles[currentTab()?.host] || DEFAULT_SETTINGS);
  $("tab-select").value = String(tabId);
  renderSettings(); renderConnection();
}

function renderDashboard() {
  $("tab-select").replaceChildren();
  const tabs = [...data.tabs].sort((a, b) => Number(b.id === data.activeTabId) - Number(a.id === data.activeTabId) || Number(b.audible) - Number(a.audible));
  for (const tab of tabs) {
    const option = document.createElement("option");
    option.value = tab.id;
    option.textContent = `${data.sessions.some(session => session.tabId === tab.id) ? "● " : ""}${siteLabel(tab.host)} — ${tab.title}`;
    $("tab-select").append(option);
  }
  if (!tabs.length) {
    const option = document.createElement("option"); option.textContent = "No supported websites open"; $("tab-select").append(option);
  }
  $("tab-count").textContent = `(${tabs.length} ${tabs.length === 1 ? "tab" : "tabs"})`;
  if (!tabs.some(tab => tab.id === selectedId)) selectedId = tabs.find(tab => tab.id === data.activeTabId)?.id ?? tabs[0]?.id;
  selectTab(selectedId);
  renderSites();
}

function queueUpdate() {
  clearTimeout(updateTimer);
  if (!currentTab()) return;
  const tabId = selectedId;
  const host = currentTab().host;
  const values = { ...settings };
  draftSettings.set(tabId, values);
  const operation = () => {
    pendingUpdate = pendingUpdate.then(async () => {
      const result = await request("update", { tabId, settings: values });
      const session = data.sessions.find(session => session.tabId === tabId);
      if (session) session.settings = result.settings;
      if (data.remember) data.profiles[host] = values;
      renderSites();
      status(!isExtension ? "Preview mode · simulated controls" : result.connected ? "Audio settings applied" : data.remember ? "Saved · connect tab to hear changes" : "Connect tab to hear changes");
    }).catch(error => status(error.message, true));
  };
  // Retain the captured tab/settings so a source switch cannot redirect a change.
  updateTimer = setTimeout(() => { updateTimer = undefined; operation(); }, 90);
  queueUpdate.pending = operation;
}

async function flushUpdates() {
  if (updateTimer !== undefined) {
    clearTimeout(updateTimer); updateTimer = undefined;
    queueUpdate.pending?.();
  }
  await pendingUpdate;
}

function changeSettings(patch) {
  settings = normalizeSettings({ ...settings, ...patch });
  renderSettings();
  queueUpdate();
}

function switchPanel(panel) {
  const mixer = panel === "mixer";
  $("mixer-panel").hidden = !mixer; $("sites-panel").hidden = mixer;
  $("mixer-tab").setAttribute("aria-selected", String(mixer)); $("sites-tab").setAttribute("aria-selected", String(!mixer));
  $("mixer-tab").tabIndex = mixer ? 0 : -1; $("sites-tab").tabIndex = mixer ? -1 : 0;
}

for (const id of ["volume", "bass", "treble", "balance"]) {
  $(id).addEventListener("input", event => changeSettings({ [id]: Number(event.target.value) }));
  $(id).addEventListener("change", () => { flushUpdates(); });
}
$("volume-number").addEventListener("change", event => changeSettings({ volume: event.target.value === "" ? settings.volume : Number(event.target.value) }));
$("volume-number").addEventListener("keydown", event => { if (event.key === "Enter") event.target.blur(); });
document.querySelectorAll("[data-volume]").forEach(button => button.addEventListener("click", () => changeSettings({ volume: Number(button.dataset.volume) })));
$("limiter").addEventListener("change", event => changeSettings({ limiter: event.target.checked }));
$("mute").addEventListener("click", () => changeSettings({ muted: !settings.muted }));
$("preset").addEventListener("change", event => { const preset = PRESETS[event.target.value]; if (preset) changeSettings({ ...preset, muted: false }); });
for (const id of ["reset", "reset-menu"]) $(id).addEventListener("click", () => changeSettings(DEFAULT_SETTINGS));
$("tab-select").addEventListener("change", async event => { const tabId = Number(event.target.value); await flushUpdates(); selectTab(tabId); });
$("remember").addEventListener("change", async event => {
  const value = event.target.checked;
  try { await flushUpdates(); await request("remember", { value, tabId: selectedId, settings }); data.remember = value; if (value && currentTab()) data.profiles[currentTab().host] = { ...settings }; renderSettings(); renderSites(); status(value ? "Website settings will be remembered" : "Automatic saving is off"); }
  catch (error) { renderSettings(); status(error.message, true); }
});

$("connect").addEventListener("click", async () => {
  busy = true; renderConnection();
  try {
    await flushUpdates();
    if (!currentSession() && selectedId !== data.activeTabId) {
      await request("focus", { tabId: selectedId });
      if (isExtension) { window.close(); return; }
      data.activeTabId = selectedId; status("Preview · tab selected");
    } else {
      const connected = Boolean(currentSession());
      data = await request(connected ? "disconnect" : "connect", { tabId: selectedId, settings });
      renderDashboard();
      status(!isExtension ? "Preview mode · audio is simulated" : connected ? "Disconnected · original audio restored" : "Connected · audio engine running");
    }
  } catch (error) { status(error.message, true); }
  finally { busy = false; const errorText = $("hint").classList.contains("error") ? $("hint").textContent : null; renderConnection(); if (errorText) status(errorText, true); }
});

$("mixer-tab").addEventListener("click", () => switchPanel("mixer"));
$("sites-tab").addEventListener("click", () => switchPanel("sites"));
$("back-mixer").addEventListener("click", () => { switchPanel("mixer"); $("mixer-tab").focus(); });
document.querySelector(".tabs").addEventListener("keydown", event => {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const mixer = event.key === "Home" || event.key !== "End" && $("mixer-tab").getAttribute("aria-selected") !== "true";
  switchPanel(mixer ? "mixer" : "sites"); $(mixer ? "mixer-tab" : "sites-tab").focus();
});
for (const id of ["help-title", "help-menu"]) $(id).addEventListener("click", () => $("help-dialog").showModal());
for (const id of ["close-help", "help-ok"]) $(id).addEventListener("click", () => $("help-dialog").close());
$("close").addEventListener("click", async () => { await flushUpdates(); window.close(); });

function setMeter(peak) {
  // Show a logarithmic -48 dB to 0 dB scale, not fabricated activity.
  const level = peak > 0 ? Math.min(1, Math.max(0, (20 * Math.log10(peak) + 48) / 48)) : 0;
  segments.forEach((segment, i) => segment.classList.toggle("lit", i < Math.round(level * segments.length)));
  $("meter").setAttribute("aria-valuenow", String(Math.round(level * 100)));
}

setInterval(async () => {
  if (!currentSession() || meterPending || document.hidden) return;
  meterPending = true;
  try { const reading = await request("meter", { tabId: selectedId }); setMeter(reading.peak); $("meter-state").textContent = settings.muted ? "MUTED" : reading.reduction < -1 ? "LIMITING" : "LIVE"; }
  catch { setMeter(0); }
  finally { meterPending = false; }
}, 100);

// Reconcile closed tabs, navigation, and externally-ended capture while open.
if (isExtension) setInterval(async () => {
  if (busy || updateTimer !== undefined || document.hidden) return;
  try {
    await pendingUpdate;
    const fresh = await request("dashboard");
    const signature = state => JSON.stringify([state.tabs, state.sessions.map(session => session.tabId)]);
    if (signature(fresh) !== signature(data)) { data = fresh; renderDashboard(); }
  } catch { /* Explicit user actions surface errors; transient polling is quiet. */ }
}, 1800);

try {
  data = await request("dashboard");
  renderDashboard();
  status(isExtension ? currentSession() ? "Connected · audio engine running" : "Ready" : "Preview mode · simulated controls");
} catch (error) { renderConnection(); status(error.message, true); }
