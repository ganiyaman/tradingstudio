
// src/features/strategy/utils/strategyHelpers.js

// Tek noktadan paylaşılan yardımcılar
export const SNAP_LAST_KEY = "SNAPSHOT:last";
export const SETUP_DEF_KEY = "SETUP:defaults";
export const COLSTATS_LAST_KEY = "COLSTATS:last";
export const EV_COLSTATS_UPDATE = "colstats:update";

export function readLS(k) {
  try { const s = localStorage.getItem(k); return s ? JSON.parse(s) : null; } catch { return null; }
}
export function makeId() { return "S_" + Math.random().toString(36).slice(2, 10); }

export function normalizeBollExit(exit = {}) {
  return {
    type: 'bollinger',
    bbMa: exit.bbMa ?? exit.ma ?? 'SMA',
    bbN: exit.bbN ?? exit.n ?? 22,
    bbStd: exit.bbStd ?? exit.std ?? 2,
    bbSide: exit.bbSide ?? exit.side ?? 'upper',
  };
}

export function mapExitToScheme(exitObj = {}) {
  const pct = (x) => {
    const n = Number(String(x ?? 0).replace(",", "."));
    return Number.isFinite(n) ? n / 100 : 0;
  };
  const t = exitObj.type || "fixed";

  if (t === "fixed" || t === "fixed_pct") {
    return { type: "fixed", tp_pct: pct(exitObj.tp ?? exitObj.tpPct ?? 1), sl_pct: pct(exitObj.sl ?? exitObj.slPct ?? 2) };
  }
  if (t === "atr") {
    return {
      type: "atr",
      atr_n: Number(exitObj.atr_n ?? exitObj.atrN ?? 14),
      k_sl: Number(exitObj.k_sl ?? exitObj.kSL ?? 2.0),
      m_tp: Number(exitObj.m_tp ?? exitObj.mTP ?? 2.0),
    };
  }
  if (t === "chandelier") {
    return { type: "chandelier", n: Number(exitObj.n ?? exitObj.chN ?? 22), factor: Number(exitObj.factor ?? exitObj.chK ?? 3.0) };
  }
  if (t === "boll" || t === "bollinger") {
    return {
      type: "bollinger",
      ma: (exitObj.ma ?? exitObj.bbMa ?? "SMA"),
      n: Number(exitObj.n ?? exitObj.bbN ?? 20),
      std: Number(exitObj.std ?? exitObj.bbStd ?? 2.0),
      side: exitObj.side ?? exitObj.bbSide ?? "upper",
    };
  }
  if (t === "trailing_pct") {
    return { type: "trailing_pct", trail_pct: pct(exitObj.trail_pct ?? exitObj.trailPct ?? 1) };
  }
  return { type: "fixed", tp_pct: 0.01, sl_pct: 0.02 };
}

// Expr -> gerekli paramlar (UI ve BE isimleri)
export function ensureParamsForExpr(expr = "", indicators = {}) {
  const uiPatched = { ...(indicators || {}) };
  const addedUi = [];
  const paramsForExpr = {};
  const indicatorsForCompute = { ...uiPatched };

  const colRe = /data\[['"]([A-Za-z_]+)(\d*)['"]\]/g;
  const wanted = new Set();
  let m;
  while ((m = colRe.exec(expr)) !== null) {
    const base = m[1];
    const suf = m[2] || "";
    wanted.add(`${base}${suf}`);
  }
  const withSuf = (keyBase, suf) => (suf ? `${keyBase}${suf}` : keyBase);

  for (const name of wanted) {
    const sma = name.match(/^SMA(\d*)$/i);
    if (sma) {
      const suf = sma[1] || "";
      const key = withSuf("sma_period", suf);
      if (indicatorsForCompute[key] == null) { indicatorsForCompute[key] = 21; uiPatched[key] = 21; addedUi.push(key); }
      continue;
    }
    const ema = name.match(/^EMA(\d*)$/i);
    if (ema) {
      const suf = ema[1] || "";
      const key = withSuf("ema_period", suf);
      if (indicatorsForCompute[key] == null) { indicatorsForCompute[key] = 21; uiPatched[key] = 21; addedUi.push(key); }
      continue;
    }
    const bb = name.match(/^BB(\d*)_(hi|lo|mid)$/i);
    if (bb) {
      const suf = bb[1] || "";
      const pKey = withSuf("bb_period", suf);
      const kKey = withSuf("bb_std", suf);
      if (indicatorsForCompute[pKey] == null) { indicatorsForCompute[pKey] = 20; uiPatched[pKey] = 20; addedUi.push(pKey); }
      if (indicatorsForCompute[kKey] == null) { indicatorsForCompute[kKey] = 2.0; uiPatched[kKey] = 2.0; addedUi.push(kKey); }
      continue;
    }
    const bbAny = name.match(/^BB(\d*)$/i);
    if (bbAny) {
      const suf = bbAny[1] || "";
      const pKey = withSuf("bb_period", suf);
      const kKey = withSuf("bb_std", suf);
      if (indicatorsForCompute[pKey] == null) { indicatorsForCompute[pKey] = 20; uiPatched[pKey] = 20; addedUi.push(pKey); }
      if (indicatorsForCompute[kKey] == null) { indicatorsForCompute[kKey] = 2.0; uiPatched[kKey] = 2.0; addedUi.push(kKey); }
      continue;
    }
    if (/^RSI(\d*)$/i.test(name) || /^RSI_diff(\d*)$/i.test(name)) {
      const suf = (name.match(/\d+$/)?.[0]) || "";
      const key = withSuf("rsi_period", suf);
      if (indicatorsForCompute[key] == null) { indicatorsForCompute[key] = 14; uiPatched[key] = 14; addedUi.push(key); }
      continue;
    }
    if (/^hist(\d*)$/i.test(name) || /^MACD_hist(\d*)$/i.test(name) || /^signal(\d*)$/i.test(name)) {
      const suf = (name.match(/\d+$/)?.[0]) || "";
      const fKey = withSuf("macd_fast_default", suf);
      const sKey = withSuf("macd_slow_default", suf);
      const sgKey = withSuf("macd_signal_default", suf);
      if (indicatorsForCompute[fKey] == null) { indicatorsForCompute[fKey] = 6; uiPatched[fKey] = 6; addedUi.push(fKey); }
      if (indicatorsForCompute[sKey] == null) { indicatorsForCompute[sKey] = 18; uiPatched[sKey] = 18; addedUi.push(sKey); }
      if (indicatorsForCompute[sgKey] == null) { indicatorsForCompute[sgKey] = 9; uiPatched[sgKey] = 9; addedUi.push(sgKey); }
      continue;
    }
  }
  return { uiPatched, indicatorsForCompute, paramsForExpr, addedUi };
}

export function collectSuffixesForGroup(group, indicators) {
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const bases = (group?.params || []);
  if (!bases.length) return [];
  const sufSet = new Set();

  for (const base of bases) {
    const bareKey = String(base);
    if (Object.prototype.hasOwnProperty.call(indicators, bareKey)) {
      sufSet.add("");
    }
    const re = new RegExp("^" + escRe(bareKey) + "(\\\\d+)$");
    for (const k of Object.keys(indicators)) {
      const m = k.match(re);
      if (m) sufSet.add(m[1]);
    }
  }
  return Array.from(sufSet).sort((a, b) => (a === "" ? -1 : +a) - (b === "" ? -1 : +b));
}

// API yanıtını normalize et (axios/fetch farkı)
export function getBody(res) {
  return (res && res.data) ? res.data : res;
}
export function pickColStats(res) {
  const body = getBody(res);
  return body?.col_stats || null;
}
export function mergeColStats(target = {}, src = {}) {
  const out = { ...(target || {}) };
  if (src && typeof src === "object") {
    for (const [k, v] of Object.entries(src)) out[k] = v;
  }
  return out;
}
