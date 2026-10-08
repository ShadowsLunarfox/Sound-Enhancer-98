export const DEFAULT_SETTINGS = Object.freeze({ volume: 100, bass: 0, treble: 0, balance: 0, muted: false, limiter: true });

export const PRESETS = Object.freeze({
  flat: { label: "Default", volume: 100, bass: 0, treble: 0, balance: 0 },
  bass: { label: "Bass boost", volume: 150, bass: 8, treble: 0, balance: 0 },
  voice: { label: "Clear voice", volume: 200, bass: -4, treble: 5, balance: 0 },
  movie: { label: "Movie night", volume: 200, bass: 5, treble: 3, balance: 0 }
});

const bounded = (value, fallback, min, max) => {
  const number = typeof value === "number" ? value : NaN;
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};

export function normalizeSettings(input = {}) {
  return {
    volume: Math.round(bounded(input.volume, 100, 0, 1000)),
    bass: bounded(input.bass, 0, -12, 12),
    treble: bounded(input.treble, 0, -12, 12),
    balance: bounded(input.balance, 0, -100, 100),
    muted: typeof input.muted === "boolean" ? input.muted : false,
    limiter: typeof input.limiter === "boolean" ? input.limiter : true
  };
}

export function siteFromUrl(url) {
  try {
    const parsed = new URL(url);
    return ["https:", "http:"].includes(parsed.protocol) ? parsed.host.toLowerCase() : null;
  } catch { return null; }
}

export const siteLabel = (host) => host?.replace(/^www\./, "") || "No website selected";

export function gainForSettings(settings) {
  return settings.muted ? 0 : settings.volume / 100;
}
