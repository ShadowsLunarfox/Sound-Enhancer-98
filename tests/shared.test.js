import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSettings, DEFAULT_SETTINGS, siteFromUrl, gainForSettings } from "../shared.js";

test("untrusted or out-of-range settings cannot exceed the audio limits", () => {
  assert.deepEqual(normalizeSettings({ volume: 99999, bass: -99, treble: 99, balance: Infinity, muted: "true", limiter: "false" }), { volume: 1000, bass: -12, treble: 12, balance: 0, muted: false, limiter: true });
  assert.deepEqual(normalizeSettings({ volume: "1000", bass: NaN }), DEFAULT_SETTINGS);
  assert.equal(normalizeSettings({ volume: -100 }).volume, 0);
});

test("website profiles isolate domains and ports and reject internal pages", () => {
  assert.equal(siteFromUrl("https://WWW.YouTube.com/watch?v=123"), "www.youtube.com");
  assert.equal(siteFromUrl("http://localhost:4173/test"), "localhost:4173");
  for (const url of ["chrome://settings", "file:///private/audio.mp3", "about:blank", "invalid", "javascript:alert(1)"]) assert.equal(siteFromUrl(url), null);
});

test("500 and 1000 percent mean 5x and 10x linear gain, and mute preserves volume", () => {
  assert.equal(gainForSettings({ volume: 500, muted: false }), 5);
  assert.equal(gainForSettings({ volume: 1000, muted: false }), 10);
  assert.equal(gainForSettings({ volume: 1000, muted: true }), 0);
});
