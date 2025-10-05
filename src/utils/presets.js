import { uid, clone, normalizeIndicatorKeys } from "./helpers";

export const PRESET_STRATEGIES = [
  { id: "MACD_SWING",   name: "MACD Swing",   side: "both", indicators: { macd_fast_default: 6, macd_slow_default: 18, macd_signal_default: 9 } },
  { id: "EMA_TREND",    name: "EMA Trend",    side: "long", indicators: { ema_period: 34, rsi_period: 14 } },
  { id: "BOLL_MEANREV", name: "Bollinger MR", side: "both", indicators: { bb_period: 20, bb_std: 2.0, rsi_period: 12 } },
];

export const RANDOM_PARAM_RANGES = {
  macd_fast_default:   { type:"int",   min: 4,  max: 18 },
  macd_slow_default:   { type:"int",   min: 10, max: 50 },
  macd_signal_default: { type:"int",   min: 5,  max: 15 },
  ema_period:          { type:"int",   min: 8,  max: 80 },
  sma_period:          { type:"int",   min: 8,  max: 120 },
  rsi_period:          { type:"int",   min: 6,  max: 30 },
  bb_period:           { type:"int",   min: 10, max: 40 },
  bb_std:              { type:"float", min: 1.2, max: 3.2, decimals: 2 },
  adx_period:          { type:"int",   min: 7,  max: 28 },
  ao_fast:             { type:"int",   min: 3,  max: 10 },
  ao_slow:             { type:"int",   min: 20, max: 42 },
};

export function exportStrategiesToJSON(strategies = []) {
  const slim = (strategies || []).map(s => ({
    id: s.id, name: s.name, side: s.side, indicators: s.indicators || {},
  }));
  return JSON.stringify({ version: 1, strategies: slim }, null, 2);
}

export function importStrategiesFromJSON(jsonText, idMode = "new") {
  const warnings = [];
  let parsed;
  try { parsed = JSON.parse(jsonText); } catch { throw new Error("Invalid JSON"); }
  const raw = parsed?.strategies;
  if (!Array.isArray(raw)) throw new Error("Missing 'strategies' array");

  const out = raw.map((s, idx) => {
    const id = idMode === "keep" && s.id ? String(s.id) : `S_${uid(8)}`;
    const name = s.name ? String(s.name) : `Imported ${idx + 1}`;
    const side = ["long","short","both"].includes(s.side) ? s.side : "long";
    const indicators = normalizeIndicatorKeys(clone(s.indicators || {}));
    return { id, name, side, indicators };
  });

  out.forEach((s, i) => { if (Object.keys(s.indicators).length === 0) warnings.push(`Strategy[${i}] has no indicators`); });
  return { strategies: out, warnings };
}
