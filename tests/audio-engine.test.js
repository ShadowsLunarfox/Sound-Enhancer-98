import test from "node:test";
import assert from "node:assert/strict";
import { AudioEngine } from "../audio-engine.js";
import { DEFAULT_SETTINGS } from "../shared.js";

function fixture() {
  const tracks = [];
  const param = () => ({ value: 0, setTargetAtTime(value) { this.value = value; } });
  const node = () => ({ connections: [], connect(target) { this.connections.push(target); return target; }, disconnect() { this.connections = []; } });
  const context = {
    currentTime: 0, destination: node(), closed: false, resume: async () => {},
    close: async () => { context.closed = true; },
    createMediaStreamSource: node,
    createBiquadFilter: () => ({ ...node(), gain: param(), frequency: param() }),
    createStereoPanner: () => ({ ...node(), pan: param() }),
    createGain: () => ({ ...node(), gain: param() }),
    createDynamicsCompressor: () => ({ ...node(), threshold: param(), knee: param(), ratio: param(), attack: param(), release: param(), reduction: -3 }),
    createAnalyser: () => ({ ...node(), fftSize: 256, getFloatTimeDomainData: samples => samples.fill(.25) })
  };
  const ended = [];
  const engine = new AudioEngine({ createContext: () => context, getMedia: async () => {
    const track = { stopped: false, stop() { this.stopped = true; }, addEventListener(_, callback) { this.end = callback; } };
    tracks.push(track);
    return { getTracks: () => [track] };
  }, onEnded: id => ended.push(id) });
  return { engine, context, tracks, ended };
}

test("multiple tabs have independent volume, tone, mute, balance and limiter paths", async () => {
  const { engine } = fixture();
  await engine.start({ tabId: 1, host: "one.com", streamId: "one", settings: { ...DEFAULT_SETTINGS, volume: 1000, bass: 7, balance: -50 } });
  await engine.start({ tabId: 2, host: "two.com", streamId: "two", settings: { ...DEFAULT_SETTINGS, volume: 500 } });
  const first = engine.sessions.get(1), second = engine.sessions.get(2);
  assert.equal(first.gain.gain.value, 10);
  assert.equal(second.gain.gain.value, 5);
  assert.equal(first.bass.gain.value, 7);
  assert.equal(first.pan.pan.value, -.5);
  assert.deepEqual(first.gain.connections, [first.limiter]);
  engine.update(1, { ...DEFAULT_SETTINGS, volume: 1000, muted: true, limiter: false });
  assert.equal(first.gain.gain.value, 0);
  assert.equal(second.gain.gain.value, 5);
  assert.deepEqual(first.gain.connections, [first.analyser]);
  assert.deepEqual(first.limiter.connections, []);
  assert.deepEqual(engine.meter(2), { peak: .25, reduction: -3 });
  engine.update(1, { ...DEFAULT_SETTINGS, volume: 1000, muted: false });
  assert.equal(first.gain.gain.value, 10);
});

test("disconnect and ended tracks release only that tab; last tab closes the context", async () => {
  const { engine, context, tracks, ended } = fixture();
  for (const tabId of [1, 2]) await engine.start({ tabId, host: "site.com", streamId: "id", settings: DEFAULT_SETTINGS });
  engine.stop(1);
  assert.equal(tracks[0].stopped, true);
  assert.equal(tracks[1].stopped, false);
  assert.equal(context.closed, false);
  tracks[1].end();
  assert.deepEqual(ended, [2]);
  assert.equal(engine.snapshot().length, 0);
  assert.equal(context.closed, true);
  assert.deepEqual(engine.meter(2), { peak: 0, reduction: 0 });
});

test("capture failure and graph failure release the stream and context", async () => {
  const { engine, context, tracks } = fixture();
  context.createStereoPanner = () => { throw new Error("Graph failed"); };
  await assert.rejects(engine.start({ tabId: 1, settings: DEFAULT_SETTINGS }), /Graph failed/);
  assert.equal(tracks[0].stopped, true);
  assert.equal(context.closed, true);
  assert.equal(engine.snapshot().length, 0);
});
