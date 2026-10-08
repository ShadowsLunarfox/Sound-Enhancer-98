import { AudioEngine } from "./audio-engine.js";

const engine = new AudioEngine({
  onEnded: tabId => { chrome.runtime.sendMessage({ target: "background", type: "engine-ended", tabId }).catch(() => {}); }
});
let queue = Promise.resolve();

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.target !== "offscreen" || sender.id !== chrome.runtime.id) return false;
  // Meter queries must not wait behind getUserMedia, which may need permission.
  if (message.type === "meter") {
    respond({ ok: true, data: engine.meter(message.tabId) });
    return false;
  }
  const result = queue.then(async () => {
    switch (message.type) {
      case "start": return engine.start(message);
      case "update": return engine.update(message.tabId, message.settings);
      case "stop": engine.stop(message.tabId); return engine.snapshot();
      case "snapshot": return engine.snapshot();
      default: throw new Error("Unknown audio command.");
    }
  });
  queue = result.catch(() => {});
  result.then(data => respond({ ok: true, data }), error => respond({ ok: false, error: error.message }));
  return true;
});
