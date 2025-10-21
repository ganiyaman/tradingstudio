// src/features/optimization/OptimizationPanel.jsx
import React, { useEffect, useState, useRef } from "react";
import { useBackendClient } from "@/hooks/useBackend";
import { useStrategies } from "@/hooks/useStrategies";

/* ------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------ */
// Kaç bar/satır olduğunu farklı kaynaklardan kestir
function inferRowsCount({ pack, results, colStats }) {
  // 1) Setup/Snapshot metadata (varsa)
  if (pack?.rows) return Number(pack.rows);
  if (pack?.meta?.rows) return Number(pack.meta.rows);

  // 2) Results:last (localStorage)
  try {
    const resPack = JSON.parse(localStorage.getItem("RESULTS:last") || "null");
    const d = resPack?.data || {};
    if (Number.isFinite(d.rows)) return Number(d.rows);
    if (Array.isArray(d.index)) return d.index.length;
    if (Array.isArray(d.ts)) return d.ts.length; // bazen zaman dizisi tutulur
    if (Number.isFinite(d.df_len)) return Number(d.df_len);
  } catch { }

  // 3) COLSTATS:last (localStorage) — herhangi bir kolonun count/n/len alanı
  try {
    const cs = colStats || JSON.parse(localStorage.getItem("COLSTATS:last") || "null");
    if (cs && typeof cs === "object") {
      const any = Object.values(cs)[0];
      const n = any?.count ?? any?.n ?? any?.len;
      if (Number.isFinite(n)) return Number(n);
    }
  } catch { }

  return null; // bulunamadı
}




// number input’larda undefined/NaN → '' verelim (controlled)

const numInputValue = (v) => (v === null || v === undefined ? "" : v);




const safeNum = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const fmt = (n, d = 2) => {
  const x = Number(n);
  return Number.isFinite(x) ? x.toFixed(d) : "-";
};
const normalizeIndicatorKeys = (obj) => obj || {};
// helpers (dosyanın üstüne koy)
// (1) Yardımcılar (dosyanın üst kısmına bir kez ekle)
const expandSpec = (spec) => {
  if (!spec) return [];
  if (Array.isArray(spec)) return spec.slice();
  if (Array.isArray(spec.values)) return spec.values.slice();
  const { min, max, step } = spec || {};
  if ([min, max, step].every(v => Number.isFinite(Number(v)))) {
    const out = [];
    for (let x = Number(min); x <= Number(max) + 1e-12; x += Number(step)) out.push(Number(x));
    return out;
  }
  return [];
};
const cartesian = (lists) => lists.reduce((a, b) => {
  const out = [];
  for (const x of a) for (const y of b) out.push({ ...x, ...y });
  return out;
}, [{}]);
const buildGridFromParamSpace = (paramSpace = {}) => {
  const keys = Object.keys(paramSpace);
  if (!keys.length) return [];
  const lists = keys.map(k => expandSpec(paramSpace[k]).map(v => ({ [k]: v })));
  return cartesian(lists);
};
// --- helpers: aggregate WFO by params ---
const mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const sum = (a) => a.length ? a.reduce((x, y) => x + y, 0) : 0;
const keyOfParams = (p) => JSON.stringify(p || {});

function aggregateFoldStats(folds) {
  const profits = folds.map(f => Number(f?.test_stats?.profit ?? 0));
  const wins = folds.map(f => Number(f?.test_stats?.winRate ?? 0));
  const trades = folds.map(f => Number(f?.test_stats?.trades ?? 0));
  return {
    profit: mean(profits),
    winRate: mean(wins),
    trades: sum(trades),
  };
}

/** En iyi N parametre agregasyon satırı üretir (AGG) */
function buildWFOAggRows(folds, topN = 5) {
  const valid = (folds || []).filter(f => !f?.skipped && f?.test_stats);
  const bucket = new Map();
  for (const f of valid) {
    const p = f?.params ?? f?.theta_star ?? f?.best_params ?? {};
    const k = keyOfParams(p);
    if (!bucket.has(k)) bucket.set(k, { params: p, folds: [], objs: [] });
    const b = bucket.get(k);
    b.folds.push(f);
    b.objs.push(Number(f?.test_obj ?? 0));
  }
  const ranked = [...bucket.values()]
    .map(b => {
      const agg = aggregateFoldStats(b.folds);
      const score = mean(b.objs);             // fold test_obj ortalaması
      return { params: b.params, score, ...agg };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);

  return ranked.map(r => ({
    _agg: true,
    params: r.params,
    profit: r.profit,
    winRate: r.winRate,
    trades: r.trades,
  }));
}



// Backend optimize: Dict[str, Dict] expects. Wrap raw array as {values:[...]}
const isParamSpec = (v) =>
  !!v && (Array.isArray(v) || typeof v === "object" && ("values" in v || "min" in v || "max" in v || "step" in v));

// ---- WFO aggregate helpers ----
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
// --- helpers for WFO "Top 10" ---
const stableKey = (obj) => {
  // order-independent stringify
  const sortObj = (o) => {
    if (Array.isArray(o)) return o.map(sortObj);
    if (o && typeof o === "object") {
      return Object.keys(o).sort().reduce((acc, k) => { acc[k] = sortObj(o[k]); return acc; }, {});
    }
    return o;
  };
  return JSON.stringify(sortObj(obj || {}));
};
// Yüzde gösterimi tutarlı olsun: 0–1 arası oranları %'ye çevir
const pct = (x) => {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  // profit bazen -1..1 oran gelebiliyor → %'ye çevir
  return Math.abs(n) <= 2 ? n * 100 : n;
};
const pct01 = (x) => {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  // winRate 0..1 ise yüzdeye çevir, aksi halde olduğu gibi
  return (n >= 0 && n <= 1) ? (n * 100) : n;
};

// yardimci: sayisal stringleri sayıya çevir, objeyi kanonikleştir
const canonicalizeParams = (obj = {}) => {
  const out = {};
  Object.entries(obj).forEach(([k, v]) => {
    const n = Number(v);
    out[k] = Number.isFinite(n) ? n : v;
  });
  return out;
};

// dedup & sort helper
const dedupAndSortTop = (rows = [], objective = "profit") => {
  const pickScore = (r) => {
    // objective’ine göre skor; basitçe profit’i kullanıyoruz
    const s = Number(r?.profit ?? r?.stats?.profit ?? 0);
    return Number.isFinite(s) ? s : -1e18;
  };
  const bucket = new Map();
  for (const r of rows) {
    const p =
      (r.params && Object.keys(r.params).length ? r.params :
        (r.best_params && Object.keys(r.best_params).length ? r.best_params :
          (r.indicators && Object.keys(r.indicators).length ? r.indicators : {})));
    const key = stableKey(canonicalizeParams(p));
    const cur = bucket.get(key);
    if (!cur || pickScore(r) > pickScore(cur)) {
      // en iyi skorlu versiyonu tut
      bucket.set(key, { ...r, params: canonicalizeParams(p) });
    }
  }
  // skorla sırala (desc)
  return [...bucket.values()].sort((a, b) => pickScore(b) - pickScore(a));
};

// Fold'lardaki theta_star parametrelerini birleştir:
// - sayısal: median
// - sayısal olmayan: moda (en sık görülen)
function aggregateThetaParams(thetas) {
  const keys = new Set();
  (thetas || []).forEach(p => Object.keys(p || {}).forEach(k => keys.add(k)));
  const out = {};
  for (const k of keys) {
    const vals = (thetas || [])
        .map(p => (p || {})[k])
        .filter(v => v !== undefined && v !== null);
    const nums = vals.filter(isNum);
    if (nums.length >= Math.ceil(vals.length * 0.5)) {
      // çoğunluk sayısal → median
      const s = nums.slice().sort((a, b) => a - b);
      const mid = Math.floor(s.length / 2);
      out[k] = s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
    } else {
      // string/enum → moda
      const freq = new Map();
      vals.forEach(v => freq.set(v, (freq.get(v) || 0) + 1));
      let bestV = undefined, bestC = -1;
      freq.forEach((c, v) => { if (c > bestC) { bestC = c; bestV = v; } });
      out[k] = bestV;
    }
  }
  return out;
}
// ---- helpers ----
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const roundInt = (x) => Math.max(1, Math.round(x));

/**
 * Verilen N (toplam bar), r_train/r_test (toplam=1 olacak), k_steps → train/test/segment/step
 */
function solveFromK({ N, r_train, r_test, k_steps }) {
  const rt = clamp01(r_train ?? 0.8);
  const rv = clamp01(r_test ?? 0.2);
  // normalize (güvence)
  const s = Math.max(rt + rv, 1e-9);
  const rtr = rt / s, rts = rv / s;

  const k = Math.max(1, Math.floor(k_steps || 1));
  const den = rtr + k * rts;
  let test = N * rts / Math.max(den, 1e-9);
  test = roundInt(test);
  let train = Math.max(1, N - k * test); // k*test + train = N garantisi
  const segment_len = train + test;
  const step_len = test;

  return { train, test, segment_len, step_len, k_steps: k };
}

/**
 * Verilen N, segment_len/step_len → k_steps ve train/test
 */
function solveFromLengths({ N, segment_len, step_len }) {
  let test = roundInt(step_len || 1);
  let train = roundInt((segment_len || 2) - test);
  if (train < 1) { train = 1; test = Math.max(1, (segment_len || 2) - 1); }

  // k ~= (N - train) / test
  let k = Math.round((N - train) / Math.max(1, test));
  if (!Number.isFinite(k) || k < 1) k = 1;

  return { train, test, segment_len: train + test, step_len: test, k_steps: k };
}

function buildWFOSummaryRow(folds) {
  const valid = (folds || []).filter(f => !f.skipped && f?.test_stats);
  if (!valid.length) return null;

  const pickTheta = (f) => (f?.params) ?? (f?.theta_star) ?? (f?.best_params) ?? {};

  const profitArr = valid.map(f => Number(f?.test_stats?.profit ?? 0));
  const winArr = valid.map(f => Number(f?.test_stats?.winRate ?? 0));
  const tradesArr = valid.map(f => Number(f?.test_stats?.trades ?? 0));
  const objArr = valid.map(f => Number(f?.test_obj ?? 0));

  const mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
  const median = (a) => {
    if (!a.length) return 0;
    const s = a.slice().sort((x, y) => x - y);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };

  const paramsAgg = aggregateThetaParams(valid.map(f => pickTheta(f)));

  return {
    _agg: true,
    label: "Aggregated OOS (across folds)",
    params: paramsAgg,
    profit: mean(profitArr),
    trades: tradesArr.reduce((x, y) => x + y, 0),
    winRate: mean(winArr),
    stats: {
      profit_mean: mean(profitArr),
      profit_median: median(profitArr),
      winRate_mean: mean(winArr),
      trades_sum: tradesArr.reduce((x, y) => x + y, 0),
      objective_median: median(objArr),
      folds: valid.length,
    },
  };
}

function splitOptimize(strat) {
  const raw = strat?.optimize || {};
  // Extract only param space (min/max/step|values) from optimize
  const paramSpace = {};
  for (const [k, v] of Object.entries(raw)) {
    // 'params' key is reserved/mixed-use — skip completely
    if (k === "params") continue;
    if (!isParamSpec(v)) continue;
    // Raw array → wrap as {values:[...]}
    if (Array.isArray(v)) { paramSpace[k] = { values: v }; continue; }
    // Already {values:[...]} normalize
    if (Array.isArray(v?.values)) { paramSpace[k] = { values: v.values }; continue; }
    // Range dict (min/max/step)
    paramSpace[k] = v;
  }

  // method — strategy > optimize.method > "random"
  const method = (strat?.method || raw?.method || "random").toLowerCase();

  // method_params — collect from both strategy.methodParams and legacy names in optimize
  const mp = { ...(strat?.methodParams || {}) };

  // Map legacy field names to method_params
  if (raw?.maxIters != null && mp.max_iterations == null) mp.max_iterations = Number(raw.maxIters);
  if (raw?.samples != null && mp.samples == null) mp.samples = Number(raw.samples);
  if (raw?.nCalls != null && mp.n_calls == null) mp.n_calls = Number(raw.nCalls);
  if (raw?.nInitialPoints != null && mp.n_initial_points == null) mp.n_initial_points = Number(raw.nInitialPoints);
  if (raw?.populationSize != null && mp.population_size == null) mp.population_size = Number(raw.populationSize);
  if (raw?.mutationProbability != null && mp.mutation_probability == null) mp.mutation_probability = Number(raw.mutationProbability);
  if (raw?.nTrials != null && mp.n_trials == null) mp.n_trials = Number(raw.nTrials);
  if (raw?.nStartupTrials != null && mp.n_startup_trials == null) mp.n_startup_trials = Number(raw.nStartupTrials);
  if (raw?.maxiter != null && mp.maxiter == null) mp.maxiter = Number(raw.maxiter);
  if (raw?.initial_temp != null && mp.initial_temp == null) mp.initial_temp = Number(raw.initial_temp);

  // Some projects store extra settings in optimize.params as a dict
  if (raw?.params && typeof raw.params === "object" && !Array.isArray(raw.params)) Object.assign(mp, raw.params);

  return { method, method_params: Object.keys(mp).length ? mp : null, paramSpace };
}

// Exit scheme builder (compatible with Strategy fields, flexible)
const buildExitScheme = (s) => {
  const num = (v, d = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
  };
  if (!s || typeof s !== "object") return null;

  // 0) Some projects use 'exitType' + 'exitParams'
  if (s.exitType) {
    const t = String(s.exitType).toLowerCase();
    const p = s.exitParams || {};
    if (t === "fixed_pct" || t === "fixed") {
      const tpPct = num(p.tp ?? p.tp_pct ?? s?.exitConfig?.tpPct, 1);
      const slPct = num(p.sl ?? p.sl_pct ?? s?.exitConfig?.slPct, 2);
      return { type: "fixed", tp_pct: tpPct / 100, sl_pct: slPct / 100 };
    }
    if (t === "atr") {
      return {
        type: "atr",
        atr_n: num(p.atr_n ?? s?.atrN, 14),
        k_sl: num(p.k_sl ?? s?.kSL, 1.5),
        m_tp: num(p.m_tp ?? s?.mTP, 2),
      };
    }
    if (t === "chandelier") {
      return { type: "chandelier", n: num(p.n ?? s?.chN, 22), factor: num(p.factor ?? s?.chK, 3) };
    }
    if (t === "bollinger") {
      return {
        type: "bollinger",
        ma: String(p?.ma ?? s?.bbMa ?? "SMA"),
        n: num(p?.n ?? s?.bbN, 20),
        std: num(p?.std ?? s?.bbStd, 2),
        side: String(p?.side ?? s?.bbSide ?? "upper"),
      };
    }
    if (t === "trailing_pct") {
      return { type: "trailing_pct", trail_pct: num(p.trail_pct ?? s?.trailPct, 0.01) };
    }
  }

  // 1) Modern: if s.exit exists, normalize it first
  if (s?.exit && typeof s.exit === "object") {
    const e = { ...s.exit };
    const t = String(e.type || "").toLowerCase();

    if (t === "fixed_pct") {
      const tpPct = num(e.tp ?? e.tp_pct, 1);
      const slPct = num(e.sl ?? e.sl_pct, 2);
      return {
        type: "fixed",
        tp_pct: tpPct / 100,
        sl_pct: slPct / 100,
        compareVariants: !!e.compareVariants,
        overrideGlobal: !!e.overrideGlobal,
      };
    }

    if (t === "fixed") {
      let tp = e.tp_pct ?? e.tp;
      let sl = e.sl_pct ?? e.sl;
      tp = tp != null ? num(tp, 0) : null;
      sl = sl != null ? num(sl, 0) : null;
      if (tp != null && tp > 1) tp = tp / 100;
      if (sl != null && sl > 1) sl = sl / 100;
      return {
        type: "fixed",
        tp_pct: tp ?? 0,
        sl_pct: sl ?? 0,
        compareVariants: !!e.compareVariants,
        overrideGlobal: !!e.overrideGlobal,
      };
    }

    if (t === "trailing_pct") {
      let trail = e.trail_pct ?? e.trail;
      let act = e.activation_pct ?? e.activation;
      trail = trail != null ? num(trail, 0.01) : 0.01;
      act = act != null ? num(act, NaN) : null;
      if (trail > 1) trail = trail / 100;
      if (typeof act === "number" && Number.isFinite(act) && act > 1) act = act / 100;
      return {
        type: "trailing_pct",
        trail_pct: trail,
        activation_pct: Number.isFinite(act) ? act : null,
        compareVariants: !!e.compareVariants,
        overrideGlobal: !!e.overrideGlobal,
      };
    }

    if (t === "atr") {
      return {
        type: "atr",
        atr_n: num(e.atr_n ?? e.atr_period, 14),
        k_sl: num(e.k_sl ?? e.atr_mult, 1.5),
        m_tp: num(e.m_tp ?? e.tp_mult, 2),
        source: e.source || "close",
        compareVariants: !!e.compareVariants,
        overrideGlobal: !!e.overrideGlobal,
      };
    }

    if (t === "boll" || t === "bollinger") {
      const clamp = (v, lo = -Infinity, hi = Infinity) => Math.min(Math.max(v, lo), hi);
      const maRaw = String(e?.ma ?? e?.bb_ma ?? "SMA").toUpperCase();
      const allowedMA = new Set(["SMA", "EMA", "WMA", "SMMA"]);
      const ma = allowedMA.has(maRaw) ? maRaw : "SMA";
      const n = clamp(num(e?.n ?? e?.bb_n ?? e?.bb_period, 20), 1);
      const std = clamp(num(e?.std ?? e?.bb_std ?? e?.bb_mult, 2), 0.1);
      const sideRaw = String(e?.side ?? e?.bb_side ?? "upper").toLowerCase();
      const side = sideRaw === "lower" ? "lower" : "upper";
      return { type: "bollinger", ma, n, std, side, compareVariants: !!e?.compareVariants, overrideGlobal: !!e?.overrideGlobal };
    }

    if (t === "chandelier" || t === "ch") {
      return { type: "chandelier", n: num(e.n ?? e.ch_period, 22), factor: num(e.factor ?? e.ch_mult, 3), source: e.source || "high_low_close", compareVariants: !!e.compareVariants, overrideGlobal: !!e.overrideGlobal };
    }

    // unknown but object — pass through
    return e;
  }

  // 2) Legacy: if tp/sl (%) fields exist, convert to fixed
  if (s.tp != null || s.sl != null) {
    let tp = num(s.tp, 0);
    let sl = num(s.sl, 0);
    if (tp > 1) tp = tp / 100;
    if (sl > 1) sl = sl / 100;
    return { type: "fixed", tp_pct: tp, sl_pct: sl };
  }

  // 3) Older: stopType + various fields
  if (s.stopType) {
    const t = String(s.stopType).toLowerCase();
    if (t === "atr")
      return { type: "atr", atr_n: num(s.atrN, 14), k_sl: num(s.kSL, 1.5), m_tp: num(s.mTP, 2) };
    if (t === "chandelier")
      return { type: "chandelier", n: num(s.chN, 22), factor: num(s.chK, 3) };
    if (t === "bollinger") {
      return { type: "bollinger", ma: String(s?.bbMa ?? "SMA"), n: num(s?.bbN, 20), std: num(s?.bbStd, 2), side: String(s?.bbSide ?? "upper") };
    }
    if (t === "trailing_pct") return { type: "trailing_pct", trail_pct: num(s.trailPct, 0.01) };
    if (t === "fixed" || t === "fixed_pct") {
      const tpPct = num(s.exitConfig?.tpPct, 1);
      const slPct = num(s.exitConfig?.slPct, 2);
      return { type: "fixed", tp_pct: tpPct / 100, sl_pct: slPct / 100 };
    }
  }

  // None match: let backend use global/default
  return null;
};

// Normalize top array (resilient to different backend field names)
const normalizeTopRows = (rawTop) => {
  const arr = Array.isArray(rawTop) ? rawTop : [];
  return arr.map((r) => {
    const profitRaw = Number.isFinite(Number(r?.profit)) ? Number(r.profit) : Number(r?.stats?.profit ?? 0);
    const winRaw = Number.isFinite(Number(r?.winRate)) ? Number(r.winRate) : Number(r?.stats?.winRate ?? 0);

    const profit = pct(profitRaw);
    const trades = Number.isFinite(Number(r?.trades)) ? Number(r.trades) : Number(r?.stats?.trades ?? 0);
    const winRate = pct01(winRaw);

    // WFO fold'larında paramlar theta_star altında geliyor
    const params =
      (r.params && typeof r.params === "object") ? r.params :
        (r.theta_star && typeof r.theta_star === "object") ? r.theta_star :
          (r.best_params && typeof r.best_params === "object") ? r.best_params :
            (r.indicators && typeof r.indicators === "object") ? r.indicators :
              {};

    return { ...r, profit, trades, winRate, params };
  });
};

// Flexible reader to match keys with SetupCard
function readSetupFromStorage() {
  const setupKeys = ["SETUP:def", "SETUP:defaults", "SETUP", "setup", "SETUP_STATE"];
  let setup = null;
  for (const k of setupKeys) {
    try {
      const v = localStorage.getItem(k);
      if (v) {
        setup = JSON.parse(v);
        if (setup && (setup.q || setup.sim)) break;
      }
    } catch { }
  }
  const snapKeys = ["SNAP:last", "SNAPSHOT:last", "DATA:SNAPSHOT:last", "snapshot:last"];
  let snapshotId = "";
  for (const k of snapKeys) {
    try {
      const v = localStorage.getItem(k);
      if (!v) continue;
      const j = JSON.parse(v);
      if (j?.id) { snapshotId = j.id; break; }
      if (typeof j === "string") { snapshotId = j; break; }
    } catch { }
  }

  const q = setup?.q || {};
  const sim = setup?.sim || {};
  return { q, sim, snapshotId };
}

/* ============================================================
 * Component
 * ============================================================ */
export default function OptimizationPanel() {
  const api = useBackendClient();
  const { strategies, patchStrategy, patchStrategyDeep } = useStrategies();

  // UI States
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");
  const [progress, setProgress] = useState(0);

  // Results state
  const [optTopById, setOptTopById] = useState({}); // { [sid]: rows[] }
  const [bestById, setBestById] = useState({}); // { [sid]: best+stats }
  const [activeTopResId, setActiveTopResId] = useState(null);
  useEffect(() => {
    try {
      const top = JSON.parse(localStorage.getItem("OPT:topById") || "null");
      if (top && typeof top === "object") setOptTopById(top);
    } catch { }
    try {
      const best = JSON.parse(localStorage.getItem("OPT:bestById") || "null");
      if (best && typeof best === "object") setBestById(best);
    } catch { }
    try {
      const aid = localStorage.getItem("OPT:activeTopResId");
      if (aid) setActiveTopResId(aid);
    } catch { }
  }, []);
  useEffect(() => {
    try { localStorage.setItem("OPT:topById", JSON.stringify(optTopById)); } catch { }
  }, [optTopById]);

  useEffect(() => {
    try { localStorage.setItem("OPT:bestById", JSON.stringify(bestById)); } catch { }
  }, [bestById]);

  useEffect(() => {
    if (!activeTopResId) return;
    try { localStorage.setItem("OPT:activeTopResId", String(activeTopResId)); } catch { }
  }, [activeTopResId]);

  // Tab for search-space UI (indicator defaults) per strategy
  const [optTabId, setOptTabId] = useState(() => strategies?.[0]?.id ?? null);

  useEffect(() => {
    if (!optTabId && strategies?.[0]?.id) setOptTabId(strategies[0].id);
    if (!activeTopResId && strategies?.[0]?.id) setActiveTopResId(strategies[0].id);
  }, [strategies]); // eslint-disable-line react-hooks/exhaustive-deps

  // --------------------------
  // NEW: Run Mode & WFO/CV/MC UI state
  // --------------------------
  // =========================
  // Run Mode & WFO/CV/MC Config (SAFE ORDER)
  // =========================

  // 1) Çalışma modu (WFO vs Legacy)
  const [mode, setMode] = useState(() => localStorage.getItem("OPT:mode") || "wfo");
  useEffect(() => { try { localStorage.setItem("OPT:mode", mode); } catch { } }, [mode]);

  // 2) Varsayılanlar
  const WFO_DEFAULTS = {
    // WFO outer + uzunluklar
    r_train: 0.8,
    r_test: 0.2,
    segment_len: 1000,   // snapshot gelince otomatik güncellenecek
    step_len: 200,
    k_steps: 1,
    anchored: false,
    pd_enable: false,
    pd_metric: "profit",     // "profit" | "winrate" | "pf" | "sharpe"
    pd_window: 1,            // kaç fold/pencere
    pd_threshold_pct: 10,    // % düşüş eşiği (örn 10 => %10)
    pd_compare_to: "train",  // "train" | "prev_fold"
    pd_min_trades: 0,

    // Inner CV
    cv_r_train: 0.8,
    cv_r_test: 0.2,
    cv_use_same_ratio: true,
    k_folds: 1,
    embargo_bars: 0,
    cv_max_folds: 1,
    score_fn: "median_minus_lambda_sigma",
    score_lambda: 0.5,
    

    // Monte Carlo
    mc_runs: 0,                 // 0 = kapalı
    mc_start_shift_ratio: 0,    // 0..1 (step_len * ratio → bars)
    mc_start_shift_bars: 0,     // türetilmiş alan
    mc_test_len_pct: 0,         // test uzunluğu ±%
    mc_fee_bps: 0,              // ücret jitter (bps)
    mc_slip_bps: 0,             // slippage jitter (bps)
    mc_param_pct: 0,            // param jitter oranı (0.05 => ±%5)

    // Outer objective filtre
    objective: "profit",
    min_trades: 0,
  };

  // 3) Config state (localStorage ile birleşik)
  const [wfoCfg, setWfoCfg] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("OPT:WFOCFG") || "null");
      return saved ? { ...WFO_DEFAULTS, ...saved } : WFO_DEFAULTS;
    } catch {
      return WFO_DEFAULTS;
    }
  });
  useEffect(() => {
    if (!wfoCfg.cv_use_same_ratio) return;
    const rtr = Number(wfoCfg.r_train);
    const rte = Number(wfoCfg.r_test);
    if (
      wfoCfg.cv_r_train !== rtr ||
      wfoCfg.cv_r_test !== rte
    ) {
      setCfg({ cv_r_train: rtr, cv_r_test: rte });
    }
  }, [wfoCfg.cv_use_same_ratio, wfoCfg.r_train, wfoCfg.r_test]);


  // Tek yerden patch
  const setCfg = (patch) => setWfoCfg(prev => ({ ...prev, ...patch }));

  // Persist et
  useEffect(() => {
    try { localStorage.setItem("OPT:WFOCFG", JSON.stringify(wfoCfg)); } catch { }
  }, [wfoCfg]);

  // (Opsiyonel) Eski anahtar varsa bir kez içeri al
  useEffect(() => {
    try {
      const legacy = JSON.parse(localStorage.getItem("WFO:cfg") || "null");
      if (legacy && typeof legacy === "object") {
        setWfoCfg(prev => ({ ...WFO_DEFAULTS, ...prev, ...legacy }));
      }
    } catch { }
    // sadece ilk mount'ta dene
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 4) Snapshot satır sayısı takibi
  const [rowsCount, setRowsCount] = useState(null);

  // a) İlk açılışta APP:setup veya SNAPSHOT:last'tan yükle
  useEffect(() => {
    try {
      // Öncelik: SNAPSHOT:last
      const snap = JSON.parse(localStorage.getItem("SNAPSHOT:last") || "null");
      let r = Number(snap?.rows);
      if (!Number.isFinite(r) || r <= 0) {
        // APP:setup yedeği
        const setup = JSON.parse(localStorage.getItem("APP:setup") || "null");
        r = Number(setup?.snapshot?.rows || setup?.snapshot?.rowCount || setup?.q?.rows || 0);
      }
      if (Number.isFinite(r) && r > 0) setRowsCount(r);
    } catch { }
  }, []);

  // b) Yeni snapshot alındığında canlı güncelle
  useEffect(() => {
    const onSnap = (e) => {
      const r = Number(e?.detail?.rows);
      if (Number.isFinite(r) && r > 0) setRowsCount(r);
    };
    window.addEventListener("snapshot:update", onSnap);
    return () => window.removeEventListener("snapshot:update", onSnap);
  }, []);

  // Fallback: rowsCount yoksa 6000 kullan
  const N = Number(rowsCount) || 6000;

  // 5) Hesap yardımcıları
  const clamp01 = (x) => Math.max(0, Math.min(1, Number(x) || 0));
  function solveFromK({ N, r_train, r_test, k_steps }) {
    const rTr = clamp01(r_train) || 0.8;
    const rTe = clamp01(r_test) || 0.2;
    const k = Math.max(1, Number(k_steps) || 1);

    const denom = rTr + k * rTe;
    if (denom <= 0) {
      // emniyet: sabit bir şey dön
      const seg = Math.max(1, Math.round(N * 0.8));
      const step = Math.max(1, Math.round(N * 0.2));
      return { segment_len: seg, step_len: step, train_len: seg - step, test_len: step };
    }
    const segment_len = Math.max(1, Math.round(N / denom));
    const test_len = Math.max(1, Math.round(segment_len * rTe));
    const step_len = test_len; // rolling WFO'da doğal adım test kadar
    const train_len = Math.max(1, segment_len - test_len);
    return { segment_len, step_len, train_len, test_len };
  }

  function solveFromLengths({ N, segment_len, step_len, r_train, r_test }) {
    const seg = Math.max(1, Number(segment_len) || 1);
    const step = Math.max(1, Number(step_len) || 1);
    const rTr = clamp01(r_train) || 0.8;
    const rTe = clamp01(r_test) || 0.2;
    // seg ≈ N / (rTr + k*rTe)  ⇒ k ≈ (N/seg - rTr)/rTe
    const approxK = rTe > 0 ? (N / seg - rTr) / rTe : 1;
    const k_steps = Math.max(1, Math.round(approxK));
    // train/test yeniden hesapla (görsel tutarlılık)
    const { segment_len: seg2, step_len: step2 } = solveFromK({ N, r_train: rTr, r_test: rTe, k_steps });
    return { k_steps, segment_len: seg2, step_len: step2 };
  }

  // 6) Otomatik senkronizasyon akışı
  const lastEdited = useRef(null);

  /**
   * Not:
   * - Eğer UI tarafında oran inputlarını değiştirirken `lastEdited.current="ratio"`,
   *   k_steps’i değiştirirken `lastEdited.current="k"`,
   *   segment/step’i değiştirirken `lastEdited.current="lens"`
   *   olarak set edersen (onChange içinde), bu efektler kullanıcı niyetini korur.
   */

  // (A) N / oranlar / k_steps değişince → segment/step hesapla
  useEffect(() => {
    if (lastEdited.current === "lens") return; // kullanıcı uzunluk girdi; k'dan hesaplayacağız
    const { segment_len, step_len } = solveFromK({
      N,
      r_train: wfoCfg.r_train,
      r_test: wfoCfg.r_test,
      k_steps: wfoCfg.k_steps,
    });
    setWfoCfg(p => ({ ...p, segment_len, step_len }));
    // kullanıcı niyeti değil, sistem güncellemesi
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [N, wfoCfg.r_train, wfoCfg.r_test, wfoCfg.k_steps]);

  // (B) segment/step kullanıcıdan gelirse → k_steps türet
  useEffect(() => {
    if (lastEdited.current !== "lens") return;
    const { k_steps, segment_len, step_len } = solveFromLengths({
      N,
      segment_len: wfoCfg.segment_len,
      step_len: wfoCfg.step_len,
      r_train: wfoCfg.r_train,
      r_test: wfoCfg.r_test,
    });
    lastEdited.current = null;
    setWfoCfg(p => ({ ...p, k_steps, segment_len, step_len }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wfoCfg.segment_len, wfoCfg.step_len, N]);

  // (C) mc_start_shift_ratio → mc_start_shift_bars (step_len’e bağlı)
  useEffect(() => {
    const step = Number(wfoCfg.step_len || 0);
    const r = clamp01(wfoCfg.mc_start_shift_ratio || 0);
    if (!Number.isFinite(step) || step <= 0) return;
    const bars = Math.max(0, Math.round(step * r));
    if (wfoCfg.mc_start_shift_bars !== bars || r !== (wfoCfg.mc_start_shift_ratio || 0)) {
      setCfg({ mc_start_shift_ratio: r, mc_start_shift_bars: bars });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wfoCfg.step_len, wfoCfg.mc_start_shift_ratio]);

  // 7) (İsteğe bağlı) UI helper: oran/uzunluk inputları için niyet işaretleyicileri
  const markEdited = {
    ratio: () => { lastEdited.current = "ratio"; },
    k: () => { lastEdited.current = "k"; },
    lens: () => { lastEdited.current = "lens"; },
  };

  // 8) Dışarıya gerekenleri export et (bileşen içi kullanım)
  // ------------------------------------------------------------
  // APPLY: write chosen params from a Top row into strategy indicators
  // ------------------------------------------------------------
  const applyParamsFromRow = (row, sid) => {
    const params =
      (row?.params && Object.keys(row.params).length && row.params) ||
      (row?.theta_star && Object.keys(row.theta_star).length && row.theta_star) ||
      (row?.best_params && Object.keys(row.best_params).length && row.best_params) ||
      {};

    patchStrategyDeep(sid, (ss) => {
      ss.indicators = { ...(ss.indicators || {}) };
      for (const [k, v] of Object.entries(params)) {
        if (v != null && !Number.isNaN(Number(v))) ss.indicators[k] = Number(v);
      }
      return ss;
    });
  };


  // ------------------------------------------------------------
  // START OPTIMIZATION (reads Setup from localStorage)
  // ------------------------------------------------------------
  const startOptimization = async () => {
    const { q, sim, snapshotId } = readSetupFromStorage();
    if (!snapshotId) {
      setErr('Optimization requires downloaded data. Setup → "Download Snapshot"');
      return;
    }
    if (!q?.symbol || !q?.timeframe || !q?.start || !q?.end) {
      setErr("Setup params missing (symbol/timeframe/start/end). Please fill settings from Setup tab.");
      return;
    }

    setBusy(true);
    setErr("");
    setNotice("");
    setProgress(0);
    setOptTopById({});
    setBestById({});

    try {
      const enabled = strategies.filter((s) => s.enabled);
      if (!enabled.length) throw new Error("No enabled strategy to optimize.");

      const outBest = {};
      const outTop = {};
      const commonSnap = { data_snapshot_id: snapshotId };

      const total = enabled.length;
      let idx = 0;

      for (const s of enabled) {
        // Exit/Sim/Fees
        const lev = safeNum(s.leverage ?? sim?.leverage ?? 1, 1);
        const exit_scheme = buildExitScheme(s);
        const isFixed = exit_scheme?.type === "fixed";
        const tp = isFixed ? safeNum(exit_scheme?.tp_pct ?? 0, 0) : 0;
        const sl = isFixed ? safeNum(exit_scheme?.sl_pct ?? 0, 0) : 0;
        const fee_pct = safeNum(sim?.fee_pct ?? sim?.feePct ?? 0, 0);
        const slippage_pct = safeNum(sim?.slippage_pct ?? sim?.slippagePct ?? 0, 0);

        // splitOptimize çıktısını güvenli al
        const { method, method_params, paramSpace, baseParams } = splitOptimize(s) || {};

        // paramSpace sağlamlaştır
        const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
        const space = isPlainObject(paramSpace) ? paramSpace : {};

        // Optimize tikli paramlardan grid üret
        const MAX_GRID = 2000;

        // Param uzayından grid üret
        let grid = buildGridFromParamSpace(paramSpace);

        // Çok büyükse, yöntem uzayı üzerinden örnekleme yapalım
        let methodParamsFinal = { ...(method_params || {}) };
        if (grid.length > MAX_GRID) {
          methodParamsFinal.space = paramSpace; // random/optuna/genetic bunu kullansın
          grid = [];                             // grid → boş (uzaydan sampler)
        }

        // Sonrasında optimize bloğunu oluştururken şunu kullan:
        // const optimizeBlock = { params: space };
        // if (method) optimizeBlock.method = String(method);
        // if (isPlainObject(mparams) && Object.keys(mparams).length) optimizeBlock.method_params = mparams;
        // Eğer grid'i backend'e göndereceksen: optimizeBlock.grid = grid; (küçükse)


        // Ortak alanlar
        const base = {
          symbol: q.symbol,
          timeframe: q.timeframe,
          start: q.start,
          end: q.end,
          side: safeNum(s.side ?? 1, 1),
          tp,
          sl,
          leverage: lev,
          fee_pct,
          slippage_pct,
          expr: String(s.expr ?? ""),
          params: { ...(s.extraParams || {}) },
          indicators: normalizeIndicatorKeys(s.indicators || {}),
          exit_scheme,
          ...commonSnap,
        };

        let j;

        if (mode === "wfo") {
          // ----- WFO Request -----
          // (2) splitOptimize'tan gelenler:
          // const { method, method_params, paramSpace, baseParams } = splitOptimize(s);

          const MAX_GRID = 2000;

          // Param uzayından grid üret
          let grid = buildGridFromParamSpace(paramSpace);

          // Çok büyükse, yöntem uzayı üzerinden örnekleme yapalım
          let methodParamsFinal = { ...(method_params || {}) };
          if (grid.length > MAX_GRID) {
            methodParamsFinal.space = paramSpace; // random/optuna/genetic bunu kullansın
            grid = [];                             // grid → boş (uzaydan sampler)
          }

          // Temel payload (in-sample’daki hesap motoru ile aynı)
          const wfoPayload = {
            ...base,

            // Outer ratios/lengths
            r_train: Number(wfoCfg.r_train),
            r_test: Number(wfoCfg.r_test),
            segment_len: Number(wfoCfg.segment_len),
            step_len: Number(wfoCfg.step_len),
            anchored: !!wfoCfg.anchored,

            // Outer objective
            objective: String(wfoCfg.objective || "profit"),

            // Inner CV
            k_folds: Number(wfoCfg.k_folds),
            embargo_bars: Number(wfoCfg.embargo_bars),
            cv_use_same_ratio: !!wfoCfg.cv_use_same_ratio,
            cv_r_train: Number(wfoCfg.cv_r_train),
            cv_r_test: Number(wfoCfg.cv_r_test),
            cv_max_folds: Number(wfoCfg.cv_max_folds || 0) || null,
            score_fn: String(wfoCfg.score_fn || "median_minus_lambda_sigma"),
            score_lambda: Number(wfoCfg.score_lambda || 0.5),

            // Performance Downdrop (Outer)
            perf_downdrop: wfoCfg.pd_enable ? {
              metric: String(wfoCfg.pd_metric || "profit"),
              window: Number(wfoCfg.pd_window || 1),
              threshold_pct: Number(wfoCfg.pd_threshold_pct || 0),
              compare_to: String(wfoCfg.pd_compare_to || "train"),
              min_trades: Number(wfoCfg.pd_min_trades || 0),
            } : null,

            // Monte Carlo
            mc_runs: Number(wfoCfg.mc_runs || 0),
            mc_config: {
              jitter: {
                start_shift_bars: Number(wfoCfg.mc_start_shift_bars || 0),
                test_len_pct: Number(wfoCfg.mc_test_len_pct || 0),
                fee_bps: Number(wfoCfg.mc_fee_bps || 0),
                slip_bps: Number(wfoCfg.mc_slip_bps || 0),
                param_pct: Number(wfoCfg.mc_param_pct || 0),
              },
              // MC tarafında da aynı downdrop kuralını uygulamak istersen:
              perf_downdrop: wfoCfg.pd_enable ? {
                metric: String(wfoCfg.pd_metric || "profit"),
                window: Number(wfoCfg.pd_window || 1),
                threshold_pct: Number(wfoCfg.pd_threshold_pct || 0),
                compare_to: String(wfoCfg.pd_compare_to || "train"),
                min_trades: Number(wfoCfg.pd_min_trades || 0),
              } : null,
            },

            seed: Number.isFinite(wfoCfg.seed) ? Number(wfoCfg.seed) : 42,

            // Search method
            method,
            method_params,
            grid,
          };



          j = await api.post("/optimize/wfo", wfoPayload);

          const folds = Array.isArray(j?.folds) ? j.folds : [];

          // ➊ Fold'lardan param gruplarını oluştur ve en iyi 5’i al
          const aggRows = buildWFOAggRows(folds, 5); // her satırda params/profit/winRate/trades var

          // ➋ Fold paramlarını skora göre sırala (zaten sende var)
          const bucket = new Map();
          for (const f of folds) {
            if (!f || f.skipped) continue;
            const theta = f.params || f.theta_star || {};
            const key = stableKey(theta);
            if (!key || key === "{}") continue;
            const rec = bucket.get(key) || { theta, objs: [] };
            rec.objs.push(Number(f?.test_obj ?? 0));
            bucket.set(key, rec);
          }
          const ranked = [...bucket.values()]
            .map(r => ({ theta: r.theta, score: r.objs.length ? r.objs.reduce((a, b) => a + b, 0) / r.objs.length : -1e18 }))
            .sort((a, b) => b.score - a.score)
            .slice(0, 10);

          // ➌ Top adayları full dönemde backtest et
          
          const rows = [];
          for (const cand of ranked) {
            const mergedIndicators = normalizeIndicatorKeys({ ...(s.indicators || {}), ...(cand.theta || {}) });
            const backPayload = {
              symbol: q.symbol, timeframe: q.timeframe, start: q.start, end: q.end,
              side: safeNum(s.side ?? 1, 1),
              tp, sl, leverage: lev, fee_pct, slippage_pct,
              expr: String(s.expr ?? ""), params: { ...(s.extraParams || {}) },
              indicators: mergedIndicators, exit_scheme, ...commonSnap,
            };
            const bj = await api.post("/backtest/run_with_exit", backPayload);
            const stats = bj?.stats || {};
            rows.push({
              params: { ...(cand.theta || {}) },
              profit: pct(stats?.profit ?? 0),
              trades: Number(stats?.trades ?? 0),
              winRate: pct01(stats?.winRate ?? 0),
              stats: { ...stats, profit: pct(stats?.profit ?? 0), winRate: pct01(stats?.winRate ?? 0) },
            });
          }

          // ➍ Tabloda önce AGG top-5, sonra full-range backtest sonuçları gelsin
          outTop[s.id] = [...aggRows, ...rows];


          // ➎ “Best” alanı: Top-1'in full backtest’i
          if (rows[0]) {
            outBest[s.id] = {
              indicators: normalizeIndicatorKeys({ ...(s.indicators || {}), ...(rows[0].params || {}) }),
              stats: rows[0].stats,
              best_params: rows[0].params,
              summary: j?.summary || {},
            };
          }

        } else {
          // ----- Legacy In-Sample Request (eski akış) -----
          const payload = {
            ...base,
            method,
            limits: {},
            method_params,
            optimize: paramSpace,
          };

          try {
            j = await api.post("/optimize/core", payload);
          } catch (e) {
            console.error("OPTIMIZE error ->", e?.message || e);
            throw e;
          }

          // Best indicators/params merge
          const bestIndRaw = j?.best?.indicators || j?.best?.params || j?.best?.best_params || {};
          const mergedIndicators = normalizeIndicatorKeys({ ...(s.indicators || {}), ...(bestIndRaw || {}) });
          

          // Re-check with backtest
          const backPayload = {
            ...base,
            indicators: mergedIndicators,
          };
          const bj = await api.post("/backtest/run_with_exit", backPayload);
          if (!bj || typeof bj !== "object") throw new Error("Backtest recheck failed");

          outBest[s.id] = { ...(j.best || {}), indicators: mergedIndicators, stats: bj.stats };

          // Normalize top/result list
          const rawTop = j?.top || j?.results || j?.top_results || [];
          const topRows = normalizeTopRows(rawTop);
          outTop[s.id] = dedupAndSortTop(topRows, wfoCfg.objective || "profit");
        }

        if (!activeTopResId && (outTop[s.id]?.length)) setActiveTopResId(s.id);

        idx += 1;
        setProgress(Math.round((idx / total) * 100));
      }

      setBestById(outBest);
      setOptTopById(outTop);
      setNotice(mode === "wfo" ? "WFO Optimization completed ✓" : "In-Sample Optimization completed ✓");
    } catch (e) {
      if (e?.name !== "AbortError") setErr(String(e?.message || e));
    } finally {
      setBusy(false);
      setTimeout(() => setProgress(0), 800);
    }
  };

  const abortRun = () => {
    try { api.abort(); } catch { }
    setBusy(false);
    setNotice("Aborted");
  };

  /* =============================================================
   * UI - Helper function to extract params from row
   * ============================================================= */
  const extractParamsFromRow = (r, strat) => {
    // 1) Stratejide optimize alanı varsa: o anahtarları dene
    if (r?._agg && r?.params && typeof r.params === "object") {
      return { ...r.params };
        }
    const hasOpt = strat?.optimize && Object.keys(strat.optimize).length > 0;
    if (hasOpt) {
      const keys = Object.keys(strat.optimize).filter(k => k !== "params");
      const out = {};
      keys.forEach(k => {
        if (r?.params && r.params[k] != null) out[k] = r.params[k];
        else if (r?.theta_star && r.theta_star[k] != null) out[k] = r.theta_star[k];
      });
      if (Object.keys(out).length) return out;
    }

    // 2) WFO satırları: öncelik r.params
    if (r?.params && typeof r.params === "object" && Object.keys(r.params).length) {
      return { ...r.params };
    }
    if (r?.theta_star && typeof r.theta_star === "object" && Object.keys(r.theta_star).length) {
      return { ...r.theta_star };
        }

    // 3) Flat fallback: satırın içinden “istatistik” olmayan anahtarları çek
    const STAT_KEYS = new Set([
      "profit", "profit_mean", "profit_median",
      "winRate", "winRate_mean",
      "trades", "trades_sum",
      "stats", "test_stats", "train_stats",
      "train", "test", "fold", "label", "_agg",
      "train_obj", "test_obj"
    ]);
    const out = {};
    Object.entries(r || {}).forEach(([k, v]) => {
      if (STAT_KEYS.has(k)) return;
      if (k === "params") return;
      // yalın tipleri veya sayı/string olanları al
      if (["number", "string", "boolean"].includes(typeof v)) out[k] = v;
    });
    return out;
  };


  /* =============================================================
   * UI
   * ============================================================= */
  return (
    <div className="space-y-6">
      

      {/* Optimization Settings (per strategy) — method/param UI only */}
      <div className="p-4 rounded-xl bg-gray-800/60 border border-gray-700/50">
        <h3 className="text-sm font-semibold mb-3">Optimization Settings (per strategy)</h3>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {strategies.map((s) => (
            <div key={s.id} className="p-3 rounded-lg bg-gray-900/40 border border-gray-700/40">
              <div className="text-xs text-gray-400">{s.name || s.id}</div>

              <div className="grid grid-cols-1 gap-3 mt-2">
                {/* Method Selection */}
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Method</label>
                  <select
                    className="w-full px-3 py-2 rounded bg-gray-900/60 border border-gray-700"
                    value={s.method || "random"}
                    onChange={(e) => patchStrategy(s.id, { method: e.target.value })}
                  >
                    <option value="random">Random Search</option>
                    <option value="grid">Grid Search</option>
                    <option value="bayesian">Bayesian Optimization</option>
                    <option value="genetic">Genetic Algorithm</option>
                    <option value="tpe">TPE (Optuna)</option>
                    <option value="cmaes">CMA-ES (Optuna)</option>
                    <option value="annealing">Simulated Annealing</option>
                  </select>
                </div>

                {/* Dynamic params by method */}
                <div className="space-y-2">
                  {s.method === "random" && (
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Samples</label>
                      <input
                        type="number"
                        className="w-full px-3 py-2 rounded bg-gray-900/60 border border-gray-700"
                        value={s.methodParams?.samples ?? 1000}
                        onChange={(e) =>
                          patchStrategy(s.id, {
                            methodParams: { ...(s.methodParams || {}), samples: Number(e.target.value) },
                          })
                        }
                      />
                    </div>
                  )}

                  {s.method === "grid" && (
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Max Iterations</label>
                      <input
                        type="number"
                        className="w-full px-3 py-2 rounded bg-gray-900/60 border border-gray-700"
                        value={s.methodParams?.max_iterations ?? s.maxIter ?? 200}
                        onChange={(e) =>
                          patchStrategy(s.id, {
                            methodParams: { ...(s.methodParams || {}), max_iterations: Number(e.target.value) },
                          })
                        }
                      />
                    </div>
                  )}

                  {s.method === "bayesian" && (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">N Calls</label>
                        <input
                          type="number"
                          className="w-full px-2 py-1 rounded bg-gray-900/60 border border-gray-700 text-xs"
                          value={s.methodParams?.n_calls ?? 150}
                          onChange={(e) =>
                            patchStrategy(s.id, {
                              methodParams: { ...(s.methodParams || {}), n_calls: Number(e.target.value) },
                            })
                          }
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">Initial Points</label>
                        <input
                          type="number"
                          className="w-full px-2 py-1 rounded bg-gray-900/60 border border-gray-700 text-xs"
                          value={s.methodParams?.n_initial_points ?? 10}
                          onChange={(e) =>
                            patchStrategy(s.id, {
                              methodParams: { ...(s.methodParams || {}), n_initial_points: Number(e.target.value) },
                            })
                          }
                        />
                      </div>
                    </div>
                  )}

                  {s.method === "genetic" && (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">Max Iterations</label>
                        <input
                          type="number"
                          className="w-full px-2 py-1 rounded bg-gray-900/60 border border-gray-700 text-xs"
                          value={s.methodParams?.max_num_iteration ?? 100}
                          onChange={(e) =>
                            patchStrategy(s.id, {
                              methodParams: { ...(s.methodParams || {}), max_num_iteration: Number(e.target.value) },
                            })
                          }
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">Population</label>
                        <input
                          type="number"
                          className="w-full px-2 py-1 rounded bg-gray-900/60 border border-gray-700 text-xs"
                          value={s.methodParams?.population_size ?? 20}
                          onChange={(e) =>
                            patchStrategy(s.id, {
                              methodParams: { ...(s.methodParams || {}), population_size: Number(e.target.value) },
                            })
                          }
                        />
                      </div>
                      <div className="col-span-2">
                        <label className="block text-xs text-gray-400 mb-1">Mutation Probability</label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          max="1"
                          className="w-full px-2 py-1 rounded bg-gray-900/60 border border-gray-700 text-xs"
                          value={s.methodParams?.mutation_probability ?? 0.1}
                          onChange={(e) =>
                            patchStrategy(s.id, {
                              methodParams: { ...(s.methodParams || {}), mutation_probability: Number(e.target.value) },
                            })
                          }
                        />
                      </div>
                    </div>
                  )}

                  {s.method === "tpe" && (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">N Trials</label>
                        <input
                          type="number"
                          className="w-full px-2 py-1 rounded bg-gray-900/60 border border-gray-700 text-xs"
                          value={s.methodParams?.n_trials ?? 200}
                          onChange={(e) =>
                            patchStrategy(s.id, {
                              methodParams: { ...(s.methodParams || {}), n_trials: Number(e.target.value) },
                            })
                          }
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">Startup Trials</label>
                        <input
                          type="number"
                          className="w-full px-2 py-1 rounded bg-gray-900/60 border border-gray-700 text-xs"
                          value={s.methodParams?.n_startup_trials ?? 10}
                          onChange={(e) =>
                            patchStrategy(s.id, {
                              methodParams: { ...(s.methodParams || {}), n_startup_trials: Number(e.target.value) },
                            })
                          }
                        />
                      </div>
                    </div>
                  )}

                  {s.method === "cmaes" && (
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">N Trials</label>
                      <input
                        type="number"
                        className="w-full px-3 py-2 rounded bg-gray-900/60 border border-gray-700"
                        value={s.methodParams?.n_trials ?? 200}
                        onChange={(e) =>
                          patchStrategy(s.id, {
                            methodParams: { ...(s.methodParams || {}), n_trials: Number(e.target.value) },
                          })
                        }
                      />
                    </div>
                  )}

                  {s.method === "annealing" && (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">Max Iter</label>
                        <input
                          type="number"
                          className="w-full px-2 py-1 rounded bg-gray-900/60 border border-gray-700 text-xs"
                          value={s.methodParams?.maxiter ?? 1000}
                          onChange={(e) =>
                            patchStrategy(s.id, {
                              methodParams: { ...(s.methodParams || {}), maxiter: Number(e.target.value) },
                            })
                          }
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">Initial Temp</label>
                        <input
                          type="number"
                          className="w-full px-2 py-1 rounded bg-gray-900/60 border border-gray-700 text-xs"
                          value={s.methodParams?.initial_temp ?? 5230}
                          onChange={(e) =>
                            patchStrategy(s.id, {
                              methodParams: { ...(s.methodParams || {}), initial_temp: Number(e.target.value) },
                            })
                          }
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      {/* Run Mode + WFO/CV/MC Settings */}
      <div className="p-4 rounded-xl bg-gray-800/60 border border-gray-700/50">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">Run Mode &nbsp;•&nbsp; WFO / CV / MC Settings</h3>
          <div className="flex items-center gap-3">
            <label className="text-xs text-gray-300 flex items-center gap-2">
              <input
                type="radio"
                name="mode"
                checked={mode === "wfo"}
                onChange={() => setMode("wfo")}
              />
              Walk-Forward (WFO)
            </label>
            <label className="text-xs text-gray-300 flex items-center gap-2">
              <input
                type="radio"
                name="mode"
                checked={mode === "insample"}
                onChange={() => setMode("insample")}
              />
              Legacy In-Sample
            </label>
          </div>
        </div>

        {/* WFO/CV/MC Controls */}
        {mode === "wfo" && (() => {
          // ON/OFF durumları
          const cvEnabled = Number(wfoCfg?.k_folds || 1) > 1;
          const mcEnabled = Number(wfoCfg?.mc_runs || 0) > 0;

          const onToggleCV = (checked) => {
            setCfg({ k_folds: checked ? Math.max(2, Number(wfoCfg?.k_folds || 0) || 5) : 1 });
          };
          const onToggleMC = (checked) => {
            setCfg({ mc_runs: checked ? Math.max(10, Number(wfoCfg?.mc_runs || 0) || 100) : 0 });
          };

          // CV ratio’ları (Use same as WFO açıkken senkron)
          const clamp01 = (x) => Math.max(0, Math.min(1, Number(x)));
          const onCvTrain = (val) => {
            if (!cvEnabled || wfoCfg.cv_use_same_ratio) return;
            const t = clamp01(val);
            setCfg({ cv_r_train: t, cv_r_test: Number((1 - t).toFixed(4)) });
          };
          const onCvTest = (val) => {
            if (!cvEnabled || wfoCfg.cv_use_same_ratio) return;
            const t = clamp01(val);
            setCfg({ cv_r_test: t, cv_r_train: Number((1 - t).toFixed(4)) });
          };

          return (
            <div className="grid lg:grid-cols-3 md:grid-cols-2 grid-cols-1 gap-4">
              {/* WFO */}
              <div className="p-3 rounded-lg bg-gray-900/40 border border-gray-700/40">
                <div className="text-xs text-gray-400 mb-2 font-semibold">WFO (Outer)</div>

                {/* Objective (Outer) */}
                <div className="mb-3">
                  <label className="block text-xs text-gray-400 mb-1">Objective (Outer)</label>
                  <select
                    value={wfoCfg.objective ?? "profit"}
                    onChange={(e) => setCfg({ objective: e.target.value })}
                    className="w-full px-2 py-1 rounded bg-gray-900/60 border border-gray-700 text-xs"
                  >
                    <option value="profit">Profit (maximize)</option>
                    <option value="sharpe">Sharpe (maximize)</option>
                    <option value="winrate">Win Rate (maximize)</option>
                    <option value="pf">Profit Factor (maximize)</option>
                    <option value="drawdown">Max Drawdown (minimize)</option>
                    <option value="J">J-score (trades × avgProfit × winRate)</option>
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {/* Train Ratio */}
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Train Ratio</label>
                    <input
                      type="number" min="0" max="1" step="0.01"
                      value={Number.isFinite(wfoCfg.r_train) ? wfoCfg.r_train : 0.8}
                      onChange={(e) => {
                        let v = parseFloat(e.target.value);
                        if (!Number.isFinite(v)) v = 0.8;
                        v = Math.min(1, Math.max(0, v));
                        setCfg({ r_train: v, r_test: Number((1 - v).toFixed(4)) });
                      }}
                      className="w-full px-2 py-1 rounded bg-gray-900/60 border border-gray-700 text-xs"
                    />
                  </div>

                  {/* Test Ratio */}
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Test Ratio</label>
                    <input
                      type="number" min="0" max="1" step="0.01"
                      value={Number.isFinite(wfoCfg.r_test) ? wfoCfg.r_test : 0.2}
                      onChange={(e) => {
                        let v = parseFloat(e.target.value);
                        if (!Number.isFinite(v)) v = 0.2;
                        v = Math.min(1, Math.max(0, v));
                        setCfg({ r_test: v, r_train: Number((1 - v).toFixed(4)) });
                      }}
                      className="w-full px-2 py-1 rounded bg-gray-900/60 border border-gray-700 text-xs"
                    />
                  </div>

                  {/* Segment Len */}
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Segment Len</label>
                    <input
                      type="number" min="1" step="1"
                      value={Number.isFinite(wfoCfg.segment_len) ? wfoCfg.segment_len : 1000}
                      onChange={(e) => {
                        let v = parseInt(e.target.value, 10);
                        if (!Number.isFinite(v) || v < 1) v = 1000;
                        setCfg({ segment_len: v });
                      }}
                      className="w-full px-2 py-1 rounded bg-gray-900/60 border border-gray-700 text-xs"
                    />
                  </div>

                  {/* Step Len */}
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Step Len</label>
                    <input
                      type="number" min="1" step="1"
                      value={Number.isFinite(wfoCfg.step_len)
                        ? wfoCfg.step_len
                        : Math.max(1, Math.round((wfoCfg.segment_len || 1000) * (wfoCfg.r_test || 0.2)))}
                      onChange={(e) => {
                        let v = parseInt(e.target.value, 10);
                        if (!Number.isFinite(v) || v < 1) {
                          v = Math.max(1, Math.round((wfoCfg.segment_len || 1000) * (wfoCfg.r_test || 0.2)));
                        }
                        setCfg({ step_len: v });
                      }}
                      className="w-full px-2 py-1 rounded bg-gray-900/60 border border-gray-700 text-xs"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-gray-400 mb-1">K Steps</label>
                  <input
                    type="number" min="1" step="1"
                    value={Number.isFinite(wfoCfg.k_steps) ? wfoCfg.k_steps : 1}
                    onChange={(e) => {
                      let v = parseInt(e.target.value, 10);
                      if (!Number.isFinite(v) || v < 1) v = 1;
                      setCfg({ k_steps: v });
                    }}
                    className="w-full px-2 py-1 rounded bg-gray-900/60 border border-gray-700 text-xs"
                  />
                </div>

                <label className="flex items-center gap-2 mt-2 text-xs text-gray-300">
                  <input
                    type="checkbox"
                    checked={!!wfoCfg.anchored}
                    onChange={(e) => setCfg({ anchored: e.target.checked })}
                  />
                  Anchored (train grows)
                </label>

                <p className="mt-2 text-[11px] text-gray-400">
                  Not: Train/Test oranları otomatik dengelenir (toplam = 1).
                </p>
              </div>

              {/* CV */}
              <div className="p-3 rounded-lg bg-gray-900/40 border border-gray-700/40">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs text-gray-400 font-semibold">Inner CV</div>
                  {/* ON/OFF */}
                  <label className="text-xs text-gray-300 flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={cvEnabled}
                      onChange={(e) => onToggleCV(e.target.checked)}
                    />
                    {cvEnabled ? "On" : "Off"}
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">CV Train Ratio</label>
                    <input
                      type="number" min="0" max="1" step="0.01"
                      value={numInputValue(wfoCfg.cv_r_train)}
                      onChange={(e) => {
                        if (wfoCfg.cv_use_same_ratio) return;
                        let v = parseFloat(e.target.value);
                        if (!Number.isFinite(v)) v = 0.8;
                        v = Math.min(1, Math.max(0, v));
                        setCfg({ cv_r_train: v, cv_r_test: Number((1 - v).toFixed(4)) });
                      }}
                      className="w-full px-2 py-1 rounded bg-gray-900/60 border border-gray-700 text-xs"
                      disabled={!cvEnabled || wfoCfg.cv_use_same_ratio}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">CV Test Ratio</label>
                    <input
                      type="number" min="0" max="1" step="0.01"
                      value={numInputValue(wfoCfg.cv_r_test)}
                      onChange={(e) => {
                        if (wfoCfg.cv_use_same_ratio) return;
                        let v = parseFloat(e.target.value);
                        if (!Number.isFinite(v)) v = 0.2;
                        v = Math.min(1, Math.max(0, v));
                        setCfg({ cv_r_test: v, cv_r_train: Number((1 - v).toFixed(4)) });
                      }}
                      className="w-full px-2 py-1 rounded bg-gray-900/60 border border-gray-700 text-xs"
                      disabled={!cvEnabled || wfoCfg.cv_use_same_ratio}
                    />
                  </div>

                <div className={`grid grid-cols-2 gap-2 ${cvEnabled ? "" : "opacity-50 pointer-events-none"}`}>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">K Folds</label>
                    <input
                      type="number" min="1"
                      value={numInputValue(wfoCfg.k_folds)}
                      onChange={(e) => setCfg({ k_folds: Number(e.target.value) })}
                      className="w-full px-2 py-1 rounded bg-gray-900/60 border border-gray-700 text-xs"
                      disabled={!cvEnabled}
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Embargo Bars</label>
                    <input
                      type="number" min="0"
                      value={numInputValue(wfoCfg.embargo_bars)}
                      onChange={(e) => setCfg({ embargo_bars: Number(e.target.value) })}
                      className="w-full px-2 py-1 rounded bg-gray-900/60 border border-gray-700 text-xs"
                      disabled={!cvEnabled}
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Max CV Folds</label>
                    <input
                      type="number" min="1"
                      value={numInputValue(wfoCfg.cv_max_folds)}
                      onChange={(e) => setCfg({ cv_max_folds: Number(e.target.value) })}
                      className="w-full px-2 py-1 rounded bg-gray-900/60 border border-gray-700 text-xs"
                      disabled={!cvEnabled}
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Score λ</label>
                    <input
                      type="number" step="0.05"
                      value={numInputValue(wfoCfg.score_lambda)}
                      onChange={(e) => setCfg({ score_lambda: Number(e.target.value) })}
                      className="w-full px-2 py-1 rounded bg-gray-900/60 border border-gray-700 text-xs"
                      disabled={!cvEnabled}
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Score Fn</label>
                  <select
                    value={wfoCfg.score_fn || "median_minus_lambda_sigma"}
                    onChange={(e) => setCfg({ score_fn: e.target.value })}
                    className="w-full px-2 py-1 rounded bg-gray-900/60 border border-gray-700 text-xs"
                  >
                    <option value="median_minus_lambda_sigma">median − λ·σ</option>
                    <option value="median">median</option>
                    <option value="mean">mean</option>
                    <option value="iqm">IQM (trimmed mean)</option>
                  </select>
                </div>

                {/* CV Train/Test ratios + "Use same as WFO" */}
                <div className={`mt-3 ${cvEnabled ? "" : "opacity-50 pointer-events-none"}`}>
                  <label className="flex items-center gap-2 text-xs text-gray-300 mb-2">
                    <input
                      type="checkbox"
                      checked={!!wfoCfg.cv_use_same_ratio}
                      onChange={(e) => {
                        const ch = e.target.checked;
                        // eşitlenirken WFO oranlarını CV’ye bas
                        const rtr = Number.isFinite(wfoCfg.r_train) ? wfoCfg.r_train : 0.8;
                        const rte = Number.isFinite(wfoCfg.r_test) ? wfoCfg.r_test : 0.2;
                        setCfg({
                          cv_use_same_ratio: ch,
                          ...(ch ? { cv_r_train: rtr, cv_r_test: rte } : {}),
                        });
                      }}
                      disabled={!cvEnabled}
                    />
                    Use same train/test ratio as WFO
                  </label>

                  
                  </div>
                </div>
              </div>

              {/* Monte Carlo */}
              <div className="p-3 rounded-lg bg-gray-900/40 border border-gray-700/40">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs text-gray-400 font-semibold">Monte Carlo</div>
                  {/* ON/OFF */}
                  <label className="text-xs text-gray-300 flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={mcEnabled}
                      onChange={(e) => onToggleMC(e.target.checked)}
                    />
                    {mcEnabled ? "On" : "Off"}
                  </label>
                </div>

                <div className={`grid grid-cols-2 gap-2 ${mcEnabled ? "" : "opacity-50 pointer-events-none"}`}>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">MC Runs</label>
                    <input
                      type="number"
                      value={numInputValue(wfoCfg.mc_runs)}
                      onChange={(e) => setCfg({ mc_runs: Number(e.target.value) })}
                      className="w-full px-2 py-1 rounded bg-gray-900/60 border border-gray-700 text-xs"
                      disabled={!mcEnabled}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Start Shift (±bars)</label>
                    <input
                      type="number"
                      value={numInputValue(wfoCfg.mc_start_shift_bars)}
                      onChange={(e) => setCfg({ mc_start_shift_bars: Number(e.target.value) })}
                      className="w-full px-2 py-1 rounded bg-gray-900/60 border border-gray-700 text-xs"
                      disabled={!mcEnabled}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Test Len Jitter (±%)</label>
                    <input
                      type="number" step="0.01"
                      value={numInputValue(wfoCfg.mc_test_len_pct)}
                      onChange={(e) => setCfg({ mc_test_len_pct: Number(e.target.value) })}
                      className="w-full px-2 py-1 rounded bg-gray-900/60 border border-gray-700 text-xs"
                      disabled={!mcEnabled}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Fee Jitter (±bps)</label>
                    <input
                      type="number"
                      value={numInputValue(wfoCfg.mc_fee_bps)}
                      onChange={(e) => setCfg({ mc_fee_bps: Number(e.target.value) })}
                      className="w-full px-2 py-1 rounded bg-gray-900/60 border border-gray-700 text-xs"
                      disabled={!mcEnabled}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Slip Jitter (±bps)</label>
                    <input
                      type="number"
                      value={numInputValue(wfoCfg.mc_slip_bps)}
                      onChange={(e) => setCfg({ mc_slip_bps: Number(e.target.value) })}
                      className="w-full px-2 py-1 rounded bg-gray-900/60 border border-gray-700 text-xs"
                      disabled={!mcEnabled}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Param Perturb (±%)</label>
                    <input
                      type="number" step="0.01"
                      value={numInputValue(wfoCfg.mc_param_pct)}
                      onChange={(e) => setCfg({ mc_param_pct: Number(e.target.value) })}
                      className="w-full px-2 py-1 rounded bg-gray-900/60 border border-gray-700 text-xs"
                      disabled={!mcEnabled}
                    />
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
      </div>
      {/* Indicator Defaults / Search Space - Strategy tabs */}
      <div className="p-4 rounded-xl bg-gray-800/60 border border-gray-700/50">
        <h3 className="text-base font-semibold mb-3">
          Indicator Defaults / Search Space &nbsp;•&nbsp; Custom Params
        </h3>

        {/* Strategy Tabs */}
        <div className="mb-4 border-b border-gray-700">
          <div className="flex flex-wrap gap-2">
            {strategies.map((s) => (
              <button
                key={s.id}
                onClick={() => setOptTabId(s.id)}
                className={`px-3 py-1.5 rounded-t-lg text-sm border-b-2 transition-colors ${optTabId === s.id
                  ? "border-cyan-400 text-cyan-300 bg-slate-900/60"
                  : "border-transparent text-gray-400 hover:text-gray-200 hover:bg-slate-900/40"
                  }`}
              >
                {s.name || s.id}
              </button>
            ))}
          </div>
        </div>

        {/* Active Strategy Content */}
        {(() => {
          const as = strategies.find((s) => s.id === optTabId) || strategies[0];
          if (!as) return null;

          return (
            <div className="space-y-6">
              {/* Example MACD parameters */}
              <div>
                <h4 className="text-sm font-medium mb-3 text-gray-300">MACD Parameters</h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {[
                    ["macd_fast_default", 6, { min: 6, max: 20, step: 2 }, "MACD Fast"],
                    ["macd_slow_default", 18, { min: 18, max: 40, step: 2 }, "MACD Slow"],
                    ["macd_signal_default", 9, { min: 5, max: 15, step: 1 }, "MACD Signal"],
                  ].map(([key, def, defOpt, label]) => (
                    <div key={key} className="p-3 rounded-lg bg-gray-900/40 border border-gray-700/40">
                      <label className="block text-xs text-gray-400 mb-2 font-medium">{label}</label>
                      <input
                        type="number"
                        className="w-full px-3 py-2 rounded bg-gray-900/60 border border-gray-700"
                        value={as?.indicators?.[key] ?? def}
                        onChange={(e) =>
                          patchStrategyDeep(as.id, (ss) => {
                            ss.indicators = { ...(ss.indicators || {}), [key]: Number(e.target.value) };
                            return ss;
                          })
                        }
                      />
                      <label className="flex items-center gap-2 text-xs mt-2">
                        <input
                          type="checkbox"
                          checked={!!as?.optimize?.[key]}
                          onChange={(e) =>
                            patchStrategyDeep(as.id, (ss) => {
                              const on = e.target.checked;
                              ss.optimize = { ...(ss.optimize || {}) };
                              if (on) ss.optimize[key] = ss.optimize[key] || { ...defOpt };
                              else delete ss.optimize[key];
                              return ss;
                            })
                          }
                        />
                        <span className="text-gray-300">Optimize</span>
                      </label>

                      {as?.optimize?.[key] && (
                        <div className="grid grid-cols-3 gap-2 mt-2">
                          {["min", "max", "step"].map((k) => (
                            <input
                              key={k}
                              type="number"
                              className="px-2 py-1 rounded bg-gray-900/60 border border-gray-700 text-xs"
                              placeholder={k}
                              value={as.optimize?.[key]?.[k] ?? ""}
                              onChange={(e) =>
                                patchStrategyDeep(as.id, (ss) => {
                                  ss.optimize = { ...(ss.optimize || {}) };
                                  ss.optimize[key] = { ...(ss.optimize[key] || {}) };
                                  ss.optimize[key][k] = Number(e.target.value);
                                  return ss;
                                })
                              }
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Custom Parameters */}
              <div className="p-4 rounded-lg bg-gray-900/40 border border-gray-700/40">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="text-sm font-medium text-gray-300">Custom Parameters</h4>
                  <button
                    onClick={() =>
                      patchStrategyDeep(as.id, (ss) => {
                        ss.indicators = { ...(ss.indicators || {}) };
                        let idx = 1, key = `rsi_smooth_${idx}`;
                        while (ss.indicators[key] !== undefined) { idx += 1; key = `rsi_smooth_${idx}`; }
                        ss.indicators[key] = 14;
                        return ss;
                      })
                    }
                    className="text-xs px-3 py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 text-white transition-colors"
                  >
                    + Add Parameter
                  </button>
                </div>

                <div className="space-y-3">
                  {Object.entries(as?.indicators || {})
                    .filter(([k]) => !/^macd_/i.test(k))
                    .map(([key, val]) => (
                      <div key={key} className="p-3 rounded bg-gray-800/60 border border-gray-700/50">
                        <div className="grid grid-cols-12 gap-3 items-start">
                          <div className="col-span-4">
                            <label className="block text-xs text-gray-400 mb-1">Parameter Name</label>
                            <input
                              className="w-full px-2 py-1 rounded bg-gray-900/60 border border-gray-700 text-xs"
                              value={key}
                              onChange={(e) =>
                                patchStrategyDeep(as.id, (ss) => {
                                  const v = ss.indicators?.[key];
                                  const filtered = { ...(ss.indicators || {}) };
                                  delete filtered[key];
                                  const newKey = e.target.value || key;
                                  filtered[newKey] = v;
                                  ss.indicators = filtered;
                                  if (ss.optimize?.[key]) {
                                    const o = ss.optimize[key];
                                    delete ss.optimize[key];
                                    ss.optimize[newKey] = o;
                                  }
                                  return ss;
                                })
                              }
                            />
                          </div>

                          <div className="col-span-2">
                            <label className="block text-xs text-gray-400 mb-1">Value</label>
                            <input
                              type="number"
                              className="w-full px-2 py-1 rounded bg-gray-900/60 border border-gray-700 text-xs"
                              value={val}
                              onChange={(e) =>
                                patchStrategyDeep(as.id, (ss) => {
                                  ss.indicators = { ...(ss.indicators || {}), [key]: Number(e.target.value) };
                                  return ss;
                                })
                              }
                            />
                          </div>

                          <div className="col-span-2">
                            <label className="flex items-center gap-1 text-xs mt-5">
                              <input
                                type="checkbox"
                                checked={!!as?.optimize?.[key]}
                                onChange={(e) =>
                                  patchStrategyDeep(as.id, (ss) => {
                                    const on = e.target.checked;
                                    ss.optimize = { ...(ss.optimize || {}) };
                                    if (on)
                                      ss.optimize[key] =
                                        ss.optimize[key] || {
                                          min: Number(val) || 2,
                                          max: (Number(val) || 14) * 3,
                                          step: 1,
                                        };
                                    else delete ss.optimize[key];
                                    return ss;
                                  })
                                }
                              />
                              <span className="text-gray-300">Optimize</span>
                            </label>
                          </div>

                          {as?.optimize?.[key] && (
                            <div className="col-span-3">
                              <label className="block text-xs text-gray-400 mb-1">Min / Max / Step</label>
                              <div className="grid grid-cols-3 gap-1">
                                {["min", "max", "step"].map((k) => (
                                  <input
                                    key={k}
                                    type="number"
                                    className="px-2 py-1 rounded bg-gray-900/60 border border-gray-700 text-xs"
                                    placeholder={k}
                                    value={as.optimize?.[key]?.[k] ?? ""}
                                    onChange={(e) =>
                                      patchStrategyDeep(as.id, (ss) => {
                                        ss.optimize = { ...(ss.optimize || {}) };
                                        ss.optimize[key] = { ...(ss.optimize[key] || {}) };
                                        ss.optimize[key][k] = Number(e.target.value);
                                        return ss;
                                      })
                                    }
                                  />
                                ))}
                              </div>
                            </div>
                          )}

                          <div className="col-span-1 flex justify-end mt-5">
                            <button
                              onClick={() =>
                                patchStrategyDeep(as.id, (ss) => {
                                  const filtered = { ...(ss.indicators || {}) };
                                  delete filtered[key];
                                  ss.indicators = filtered;
                                  if (ss.optimize?.[key]) delete ss.optimize[key];
                                  return ss;
                                })
                              }
                              className="text-xs px-2 py-1 rounded bg-red-600 hover:bg-red-500 text-white"
                            >
                              ×
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          );
        })()}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={startOptimization}
          disabled={busy}
          className={"px-4 py-2 rounded bg-purple-600 hover:bg-purple-500 text-white " + (busy ? "opacity-70" : "")}
          title="Start Optimization (SetupCard settings used)"
        >
          {busy ? "Running…" : (mode === "wfo" ? "Start WFO Optimization" : "Start In-Sample Optimization")}
        </button>

        {busy && (
          <button onClick={abortRun} className="px-4 py-2 rounded bg-rose-600 hover:bg-rose-500 text-white">
            Abort
          </button>
        )}

        {progress > 0 && (
          <div className="flex items-center gap-2 text-xs text-gray-300">
            <div className="w-40 h-2 bg-gray-700/60 rounded">
              <div className="h-2 bg-green-500 rounded" style={{ width: `${progress}%` }} />
            </div>
            <span>{progress}%</span>
          </div>
        )}
      </div>

      {/* Top Results */}
      <div className="p-4 rounded-xl bg-gray-800/60 border border-gray-700/50">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">Top Results</h3>
          {activeTopResId && (
            <span className="text-xs text-gray-400">
              {strategies.find((s) => s.id === activeTopResId)?.name || activeTopResId}
            </span>
          )}
        </div>

        {/* Tabs */}
        <div className="flex flex-wrap gap-2 mb-3">
          {Object.keys(optTopById || {}).map((sid) => {
            const label = strategies.find((s) => s.id === sid)?.name || sid;
            const active = sid === activeTopResId;
            return (
              <button
                key={sid}
                onClick={() => setActiveTopResId(sid)}
                className={
                  "px-3 py-1.5 rounded border text-xs " +
                  (active
                    ? "bg-blue-600 border-blue-500 text-white"
                    : "bg-gray-900/50 border-gray-700 text-gray-300 hover:bg-gray-800")
                }
                title={label}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* Active Table */}
        {activeTopResId ? (
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="text-gray-400">
                <tr className="text-left">
                  <th className="py-2 pr-4">Params</th>
                  <th className="py-2 pr-4">Profit%</th>
                  <th className="py-2 pr-4">Trades</th>
                  <th className="py-2 pr-4">Win%</th>
                  <th className="px-2 py-1 text-right">Apply</th>
                </tr>
              </thead>
              <tbody>
                {(optTopById[activeTopResId] || [])
                  .filter((r) => {
                    const trades = r.trades ?? r.stats?.trades ?? 0;
                    const profit = r.profit ?? r.stats?.profit ?? 0;
                    return trades > 0 || Math.abs(profit) > 1e-9;
                  })
                  .map((r, i) => {
                    const strat = strategies.find((s) => s.id === activeTopResId);
                    const out = extractParamsFromRow(r, strat);
                    const isAgg = !!r._agg;
                    const keys = Object.keys(out || {});
                    
                    const profit = r.profit ?? r.stats?.profit ?? 0;
                    const trades = r.trades ?? r.stats?.trades ?? "-";
                    const winRate = r.winRate ?? r.stats?.winRate ?? 0;

                    return (
                      <tr key={i} className="border-t border-gray-800">
                        <td className="py-2 pr-4 whitespace-pre">
                          <div className="flex items-center gap-2">
                            {isAgg && <span className="px-2 py-0.5 rounded bg-amber-600/30 text-amber-200 text-[11px]">AGG</span>}
                            <code className="text-xs">
                              {keys.length === 0 ? "-" : keys.map(k => `${k}:${out[k]}`).join(", ")}
                            </code>
                          </div>
                        </td>
                        <td className="py-2 pr-4">{fmt(profit, 2)}%</td>
                        <td className="py-2 pr-4">{trades}</td>
                        <td className="py-2 pr-4">{fmt(winRate, 2)}%</td>
                        <td className="px-2 py-1 text-right">
                          <button
                            className="px-2 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-xs"
                            onClick={() => applyParamsFromRow(r, activeTopResId)}
                            title="Set these parameters as Indicator Defaults & Search Space"
                          >
                            Apply
                          </button>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
            {(!optTopById[activeTopResId] || !(optTopById[activeTopResId].length > 0)) && (
              <div className="text-xs text-gray-400 pt-2">Results empty. Try a wider date range or adjust WFO/CV/MC settings.</div>
            )}
          </div>
        ) : (
          <div className="text-xs text-gray-400">No results yet.</div>
        )}
      </div>

      {(err || notice) && (
        <div className="text-xs">
          {err && <div className="text-red-400">{err}</div>}
          {notice && <div className="text-green-400">{notice}</div>}
        </div>
      )}
    </div>
  );
}
