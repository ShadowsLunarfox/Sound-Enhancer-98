import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { startPreviewServer } from "./preview-server.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const artifactDir = new URL("../artifacts/", import.meta.url);
const profileDir = new URL(`../artifacts/chrome-${Date.now()}/`, import.meta.url);
await mkdir(artifactDir, { recursive: true });
await mkdir(profileDir, { recursive: true });
const server = await startPreviewServer(0);
const base = `http://127.0.0.1:${server.address().port}`;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

class CDP {
  constructor(url) {
    this.socket = new WebSocket(url); this.serial = 0; this.pending = new Map();
    this.ready = new Promise((resolve, reject) => { this.socket.onopen = resolve; this.socket.onerror = reject; });
    this.socket.onmessage = event => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const pending = this.pending.get(message.id); if (!pending) return;
      this.pending.delete(message.id); clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error.message)); else pending.resolve(message.result);
    };
  }
  async call(method, params = {}) {
    await this.ready;
    return new Promise((resolve, reject) => {
      const id = ++this.serial;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, 15000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }
  close() { this.socket.close(); }
}

const browser = spawn(process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", [
  "--headless=new", "--no-first-run", "--no-default-browser-check", "--noerrdialogs",
  "--remote-debugging-port=0", `--user-data-dir=${fileURLToPath(profileDir)}`,
  "--enable-unsafe-extension-debugging", "--autoplay-policy=no-user-gesture-required", "about:blank"
], { windowsHide: true, stdio: "ignore" });
let browserError;
browser.on("error", error => { browserError = error; });
let rootCdp, page;
try {
  let debugPort;
  for (let i = 0; i < 100; i++) {
    if (browserError) throw browserError;
    try { debugPort = (await readFile(new URL("DevToolsActivePort", profileDir), "utf8")).split("\n")[0]; break; } catch { await delay(100); }
  }
  if (!debugPort) throw new Error("Chrome did not start its isolated debugging profile.");
  const debugBase = `http://127.0.0.1:${debugPort}`;
  const version = await (await fetch(`${debugBase}/json/version`)).json();
  rootCdp = new CDP(version.webSocketDebuggerUrl);
  const { targetId } = await rootCdp.call("Target.createTarget", { url: `${base}/popup.html` });
  const targets = await (await fetch(`${debugBase}/json/list`)).json();
  page = new CDP(targets.find(target => target.id === targetId).webSocketDebuggerUrl);
  await page.call("Page.enable");
  await page.call("Emulation.setDeviceMetricsOverride", { width: 440, height: 592, deviceScaleFactor: 2, mobile: false });
  for (let i = 0; i < 50; i++) {
    if (await page.evaluate("document.querySelector('#status')?.textContent.includes('Preview')")) break;
    await delay(100);
  }
  const initial = await page.evaluate(`({ title: document.title, sourceCount: document.querySelector('#tab-select').options.length, width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight, footerTop: document.querySelector('footer').getBoundingClientRect().top, hintBottom: document.querySelector('#hint').getBoundingClientRect().bottom })`);
  assert.equal(initial.sourceCount, 3);
  assert.equal(initial.width, 440);
  assert.ok(initial.height <= 592, `Popup overflows: ${JSON.stringify(initial)}`);
  assert.ok(initial.hintBottom <= initial.footerTop, `Content overlaps footer: ${JSON.stringify(initial)}`);
  console.log("PASS popup fits Chrome's popup bounds", initial);
  const click = selector => page.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  await click('[data-volume="1000"]'); await delay(180);
  assert.equal(await page.evaluate("document.querySelector('#volume-readout').value"), "1000");
  await click("#connect"); await delay(250);
  assert.equal(await page.evaluate("document.querySelector('#connect').textContent"), "Disconnect this tab");
  await click("#mute"); await delay(180);
  assert.equal(await page.evaluate("document.querySelector('#mute').getAttribute('aria-pressed')"), "true");
  await click("#mute");
  await page.evaluate("document.querySelector('#bass').value = 8; document.querySelector('#bass').dispatchEvent(new Event('input', { bubbles: true }))");
  await delay(180);
  const screenshot = await page.call("Page.captureScreenshot", { format: "png" });
  await writeFile(new URL("mixer-preview.png", artifactDir), Buffer.from(screenshot.data, "base64"));
  await click("#sites-tab");
  assert.equal(await page.evaluate("document.querySelectorAll('.saved-site').length"), 1);
  const sitesScreenshot = await page.call("Page.captureScreenshot", { format: "png" });
  await writeFile(new URL("websites-preview.png", artifactDir), Buffer.from(sitesScreenshot.data, "base64"));
  await click(".forget-button"); await delay(200);
  assert.equal(await page.evaluate("document.querySelectorAll('.saved-site').length"), 0);
  await click("#back-mixer"); await click("#reset"); await delay(180);
  assert.equal(await page.evaluate("document.querySelector('#volume-readout').value"), "100");
  await click("#help-title");
  assert.equal(await page.evaluate("document.querySelector('#help-dialog').open"), true);
  await click("#help-ok");
  await click("#connect"); await delay(200);
  assert.equal(await page.evaluate("document.querySelector('#engine-status').textContent"), "0 tabs connected");
  console.log("PASS preview controls: 1000%, connect, mute, bass, profiles, forget, reset, help, disconnect");

  const audio = await page.evaluate(`(async () => {
    const { AudioEngine } = await import('./audio-engine.js');
    const { DEFAULT_SETTINGS } = await import('./shared.js');
    const input = new AudioContext();
    await input.resume();
    const oscillator = input.createOscillator();
    oscillator.frequency.value = 440;
    const lowGain = input.createGain(); lowGain.gain.value = 0.01;
    const destination = input.createMediaStreamDestination();
    oscillator.connect(lowGain).connect(destination); oscillator.start();
    const engine = new AudioEngine({ getMedia: async () => destination.stream });
    await engine.start({ tabId: 1, host: 'test.local', streamId: 'synthetic', settings: { ...DEFAULT_SETTINGS, volume: 1000, limiter: false } });
    await new Promise(resolve => setTimeout(resolve, 600));
    const peak = engine.meter(1).peak;
    const contextState = { input: input.state, output: engine.context.state, inputTime: input.currentTime, outputTime: engine.context.currentTime, track: destination.stream.getAudioTracks()[0].readyState };
    engine.update(1, { ...DEFAULT_SETTINGS, volume: 1000, muted: true });
    await new Promise(resolve => setTimeout(resolve, 250));
    const mutedPeak = engine.meter(1).peak;
    engine.stop(1); oscillator.stop(); await input.close();
    return { peak, mutedPeak, remaining: engine.snapshot().length, contextState };
  })()`);
  assert.ok(audio.peak > .085 && audio.peak < .115, `Expected 10x gain, got ${JSON.stringify(audio)}`);
  assert.ok(audio.mutedPeak < .001);
  assert.equal(audio.remaining, 0);
  console.log("PASS real Web Audio processing with 10x gain, mute, and cleanup", audio);

  const extension = await rootCdp.call("Extensions.loadUnpacked", { path: root });
  assert.ok(extension.id);
  console.log(`PASS unpacked Manifest V3 extension loads: ${extension.id}`);
  await page.call("Page.navigate", { url: `chrome-extension://${extension.id}/popup.html` });
  await delay(500);
  const extensionState = await page.evaluate(`({ status: document.querySelector('#status').textContent, runtimeId: chrome.runtime.id, hint: document.querySelector('#hint').textContent })`);
  assert.equal(extensionState.runtimeId, extension.id);
  assert.equal(extensionState.status, "Ready");
  console.log("PASS production popup and service worker messaging", extensionState);

  const fixtureTarget = await rootCdp.call("Target.createTarget", { url: `${base}/tests/audio-fixture.html` });
  await delay(600);
  // CDP's extension action invokes the same permission grant as the toolbar icon.
  const tabTargets = await rootCdp.call("Target.getTargets", { filter: [{ type: "tab", exclude: false }] });
  const fixtureTabTarget = tabTargets.targetInfos.find(target => target.url.includes("/tests/audio-fixture.html"));
  assert.ok(fixtureTabTarget, JSON.stringify(tabTargets));
  await rootCdp.call("Extensions.triggerAction", { id: extension.id, targetId: fixtureTabTarget.targetId });
  await delay(300);
  const tabId = await page.evaluate(`(async () => (await chrome.tabs.query({})).find(tab => tab.url?.includes('/tests/audio-fixture.html')).id)()`);
  const production = async (type, payload = {}) => page.evaluate(`chrome.runtime.sendMessage(${JSON.stringify({ target: "background", type, ...payload })})`);
  const connected = await production("connect", { tabId, settings: { volume: 500, bass: 4, treble: 0, balance: 0, muted: false, limiter: false } });
  assert.equal(connected.ok, true, JSON.stringify(connected));
  assert.equal(connected.data.sessions.length, 1);
  assert.equal(connected.data.sessions[0].settings.volume, 500);
  await delay(650);
  const output = await page.evaluate(`chrome.runtime.sendMessage({ target: 'offscreen', type: 'meter', tabId: ${tabId} })`);
  assert.equal(output.ok, true, JSON.stringify(output));
  assert.ok(output.data.peak > 0.02, `Captured audio did not reach output: ${JSON.stringify(output)}`);
  const offscreenContexts = await page.evaluate("chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })");
  assert.equal(offscreenContexts.length, 1);
  console.log("PASS actual toolbar authorization, tab capture, offscreen processing, and 500% boost", output.data);

  // Closing the actual toolbar popup must not interrupt the offscreen stream.
  const popupTargets = await (await fetch(`${debugBase}/json/list`)).json();
  for (const target of popupTargets.filter(target => target.type === "page" && target.url === `chrome-extension://${extension.id}/popup.html` && target.id !== targetId)) {
    await rootCdp.call("Target.closeTarget", { targetId: target.id });
  }
  assert.equal((await production("dashboard")).data.sessions.length, 1);

  const secondBase = base.replace("127.0.0.1", "localhost");
  await rootCdp.call("Target.createTarget", { url: `${secondBase}/tests/audio-fixture.html` });
  await delay(550);
  const secondTargets = await rootCdp.call("Target.getTargets", { filter: [{ type: "tab", exclude: false }] });
  const secondTabTarget = secondTargets.targetInfos.find(target => target.url === `${secondBase}/tests/audio-fixture.html`);
  assert.ok(secondTabTarget);
  await rootCdp.call("Extensions.triggerAction", { id: extension.id, targetId: secondTabTarget.targetId });
  const secondId = await page.evaluate(`(async () => (await chrome.tabs.query({})).find(tab => tab.url === ${JSON.stringify(`${secondBase}/tests/audio-fixture.html`)}).id)()`);
  const secondConnection = await production("connect", { tabId: secondId, settings: { volume: 1000, bass: 0, treble: 0, balance: 0, muted: false, limiter: false } });
  assert.equal(secondConnection.ok, true, JSON.stringify(secondConnection));
  assert.equal(secondConnection.data.sessions.length, 2);
  await delay(650);
  const secondOutput = await page.evaluate(`chrome.runtime.sendMessage({ target: 'offscreen', type: 'meter', tabId: ${secondId} })`);
  assert.ok(secondOutput.data.peak > .085 && secondOutput.data.peak < .115, JSON.stringify(secondOutput));
  const firstStill = await page.evaluate(`chrome.runtime.sendMessage({ target: 'offscreen', type: 'meter', tabId: ${tabId} })`);
  assert.ok(firstStill.data.peak > .035 && firstStill.data.peak < .075, JSON.stringify(firstStill));
  console.log("PASS two websites captured independently at 500% and 1000%; playback survives popup close");

  // Cross-site navigation releases just that site's stream and leaves the other.
  await page.evaluate(`chrome.tabs.update(${secondId}, { url: ${JSON.stringify(`${base}/tests/audio-fixture.html?changed-site`)} })`);
  await delay(500);
  const afterNavigation = await production("dashboard");
  assert.equal(afterNavigation.data.sessions.length, 1);
  assert.equal(afterNavigation.data.sessions[0].tabId, tabId);
  assert.equal(Object.keys(afterNavigation.data.profiles).length, 2);
  console.log("PASS cross-website navigation disconnects only the changed tab");

  const muted = await production("update", { tabId, settings: { volume: 1000, bass: 0, treble: 0, balance: 0, muted: true, limiter: true } });
  assert.equal(muted.ok, true, JSON.stringify(muted));
  await delay(250);
  const mutedOutput = await page.evaluate(`chrome.runtime.sendMessage({ target: 'offscreen', type: 'meter', tabId: ${tabId} })`);
  assert.ok(mutedOutput.data.peak < 0.001);
  const disconnected = await production("disconnect", { tabId });
  assert.equal(disconnected.ok, true, JSON.stringify(disconnected));
  assert.equal(disconnected.data.sessions.length, 0);
  assert.equal((await page.evaluate("chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })")).length, 0);
  assert.equal(Object.values(disconnected.data.profiles).find(profile => profile.muted).volume, 1000);
  console.log("PASS production mute, remembered profile, disconnect, and offscreen cleanup");

  await writeFile(new URL("verification.json", artifactDir), JSON.stringify({ initial, audio, extensionId: extension.id, extensionState, capturedOutput: output.data, checkedAt: new Date().toISOString() }, null, 2));
} finally {
  page?.close();
  if (rootCdp) { await rootCdp.call("Browser.close").catch(() => {}); rootCdp.close(); }
  else browser.kill();
  await new Promise(resolve => server.close(resolve));
  // Delete only the unique test profile we created under this workspace.
  const ownedProfile = resolve(fileURLToPath(profileDir));
  const artifactRoot = resolve(fileURLToPath(artifactDir));
  assert.ok(ownedProfile.startsWith(artifactRoot + sep));
  await rm(ownedProfile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(error => console.warn(`Could not clean up test profile: ${error.message}`));
}
