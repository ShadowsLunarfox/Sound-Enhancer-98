import { gainForSettings, normalizeSettings } from "./shared.js";

export class AudioEngine {
  constructor({ createContext = () => new AudioContext({ latencyHint: "interactive" }), getMedia = constraints => navigator.mediaDevices.getUserMedia(constraints), onEnded = () => {} } = {}) {
    this.createContext = createContext;
    this.getMedia = getMedia;
    this.onEnded = onEnded;
    this.sessions = new Map();
    this.context = null;
  }

  async start({ tabId, host, streamId, settings }) {
    if (this.sessions.has(tabId)) return this.update(tabId, settings);
    let stream;
    const nodes = [];
    try {
      stream = await this.getMedia({ audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId } }, video: false });
      this.context ||= this.createContext();
      const context = this.context;
      await context.resume();
      const source = context.createMediaStreamSource(stream);
      const bass = context.createBiquadFilter();
      bass.type = "lowshelf";
      bass.frequency.value = 200;
      const treble = context.createBiquadFilter();
      treble.type = "highshelf";
      treble.frequency.value = 3000;
      const pan = context.createStereoPanner();
      const gain = context.createGain();
      gain.gain.value = 0;
      const limiter = context.createDynamicsCompressor();
      limiter.threshold.value = -1;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.15;
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      nodes.push(source, bass, treble, pan, gain, limiter, analyser);
      source.connect(bass).connect(treble).connect(pan).connect(gain);
      analyser.connect(context.destination);
      const session = { tabId, host, stream, source, bass, treble, pan, gain, limiter, analyser, nodes, samples: new Float32Array(analyser.fftSize), settings: normalizeSettings(settings) };
      this.sessions.set(tabId, session);
      this.route(session);
      this.update(tabId, settings);
      for (const track of stream.getTracks()) track.addEventListener("ended", () => {
        if (this.sessions.get(tabId) === session) {
          this.stop(tabId);
          this.onEnded(tabId);
        }
      });
      return this.snapshot();
    } catch (error) {
      this.sessions.delete(tabId);
      for (const node of nodes) node.disconnect();
      for (const track of stream?.getTracks() || []) track.stop();
      if (this.context && this.sessions.size === 0) {
        await this.context.close().catch(() => {});
        this.context = null;
      }
      throw error;
    }
  }

  route(session) {
    session.gain.disconnect();
    session.limiter.disconnect();
    if (session.settings.limiter) session.gain.connect(session.limiter).connect(session.analyser);
    else session.gain.connect(session.analyser);
  }

  update(tabId, values) {
    const session = this.sessions.get(tabId);
    if (!session) throw new Error("This tab is disconnected. Connect it again to adjust its audio.");
    const settings = normalizeSettings(values);
    const reroute = session.settings.limiter !== settings.limiter;
    session.settings = settings;
    if (reroute) this.route(session);
    const ramp = (parameter, value) => parameter.setTargetAtTime(value, this.context.currentTime, 0.015);
    ramp(session.gain.gain, gainForSettings(settings));
    ramp(session.bass.gain, settings.bass);
    ramp(session.treble.gain, settings.treble);
    ramp(session.pan.pan, settings.balance / 100);
    return settings;
  }

  stop(tabId) {
    const session = this.sessions.get(tabId);
    if (!session) return;
    this.sessions.delete(tabId);
    for (const node of session.nodes) node.disconnect();
    for (const track of session.stream.getTracks()) track.stop();
    if (this.sessions.size === 0 && this.context) {
      const context = this.context;
      this.context = null;
      context.close().catch(() => {});
    }
  }

  meter(tabId) {
    const session = this.sessions.get(tabId);
    if (!session) return { peak: 0, reduction: 0 };
    session.analyser.getFloatTimeDomainData(session.samples);
    let peak = 0;
    for (const value of session.samples) peak = Math.max(peak, Math.abs(value));
    return { peak, reduction: session.settings.limiter ? session.limiter.reduction : 0 };
  }

  snapshot() {
    return [...this.sessions.values()].map(({ tabId, host, settings }) => ({ tabId, host, settings }));
  }
}
