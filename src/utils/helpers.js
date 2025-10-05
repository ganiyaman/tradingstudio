// src/utils/helpers.js

// ---------- core utils ----------
export function uid(len = 12) {
  const abc = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const a = abc.length;
  let out = "";
  const bytes =
    typeof crypto !== "undefined" && crypto.getRandomValues
      ? crypto.getRandomValues(new Uint8Array(len))
      : Array.from({ length: len }, () => Math.floor(Math.random() * 256));
  for (let i = 0; i < len; i++) out += abc[bytes[i] % a];
  return out;
}

export function clone(obj) {
  if (obj == null) return obj;
  if (typeof structuredClone === "function") return structuredClone(obj);
  return JSON.parse(JSON.stringify(obj));
}

export function pctToFrac(x) {
  if (x == null || x === "") return null;
  if (typeof x === "string") {
    const s = x.trim();
    if (s.endsWith("%")) return Number(s.slice(0, -1)) / 100;
    const n = Number(s);
    return Number.isFinite(n) ? n / 100 : null;
  }
  if (typeof x === "number") return x > 1 ? x / 100 : x;
  return null;
}

export function normalizeIndicatorKeys(inds = {}) {
  const out = { ...inds };
  const alias = {
    macd_fast: "macd_fast_default",
    macd_slow: "macd_slow_default",
    macd_signal: "macd_signal_default",
  };
  for (const [oldKey, newKey] of Object.entries(alias)) {
    if (oldKey in out) {
      if (!(newKey in out)) {
        const v = Number(out[oldKey]);
        out[newKey] = Number.isFinite(v) ? v : out[oldKey];
      }
      delete out[oldKey];
    }
  }
  return out;
}

// ---------- CSV ----------
export function exportToCsv(filename, rows, headers) {
  const escape = (s) => {
    if (s == null) return "";
    const n = String(s);
    return /[",\n]/.test(n) ? `"${n.replace(/"/g, '""')}"` : n;
  };
  const cols = headers || Object.keys(rows?.[0] || {});
  const head = cols.map(escape).join(",");
  const body = (rows || [])
    .map((r) => cols.map((c) => escape(r[c])).join(","))
    .join("\n");
  const csv = head + "\n" + body;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".csv") ? filename : filename + ".csv";
  link.click();
  URL.revokeObjectURL(url);
}

// ---------- basic stats / metrics ----------
export function seriesReturns(equity) {
  const out = [];
  for (let i = 1; i < (equity?.length || 0); i++) {
    const a = Number(equity[i - 1]), b = Number(equity[i]);
    if (Number.isFinite(a) && Number.isFinite(b) && a !== 0) out.push(b / a - 1);
  }
  return out;
}

export function std(arr) {
  if (!arr || arr.length === 0) return 0;
  const m = arr.reduce((a, b) => a + b, 0) / arr.length;
  const v = arr.reduce((a, b) => a + (b - m) * (b - m), 0) / arr.length;
  return Math.sqrt(v);
}

export function maxDrawdown(equity) {
  let peak = -Infinity, mdd = 0;
  for (const x of equity || []) {
    const v = Number(x);
    if (!Number.isFinite(v)) continue;
    if (v > peak) peak = v;
    const dd = peak > 0 ? v / peak - 1 : 0;
    if (dd < mdd) mdd = dd;
  }
  return mdd; // negative
}

export function sharpe(returns, rf = 0, periodsPerYear = 252) {
  const ex = returns.map((r) => r - rf / periodsPerYear);
  const s = std(ex);
  const m = ex.reduce((a, b) => a + b, 0) / Math.max(1, ex.length);
  return s === 0 ? 0 : Math.sqrt(periodsPerYear) * (m / s);
}

export function calmar(equity, periodsPerYear = 252) {
  const rets = seriesReturns(equity);
  const annRet = (() => {
    const m = rets.reduce((a, b) => a + b, 0) / Math.max(1, rets.length);
    return m * periodsPerYear;
  })();
  const mdd = Math.abs(maxDrawdown(equity));
  return mdd === 0 ? 0 : annRet / mdd;
}

// ---------- rolling helpers ----------
export function rolling(arr, win, fn) {
  const out = Array(arr.length).fill(null);
  let buf = [];
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    buf.push(v);
    if (buf.length > win) buf.shift();
    if (buf.length === win) out[i] = fn(buf);
  }
  return out;
}

export function rollingSharpeFromEquity(equity, win = 200, periodsPerYear = 252) {
  const rets = seriesReturns(equity || []);
  const r = rolling(rets, win, (chunk) => {
    const s = std(chunk);
    const m = chunk.reduce((a, b) => a + b, 0) / chunk.length;
    return s === 0 ? 0 : Math.sqrt(periodsPerYear) * (m / s);
  });
  return [null, ...r]; // align
}

export function rollingMDDFromEquity(equity, win = 200) {
  return rolling(equity || [], win, (chunk) => Math.abs(maxDrawdown(chunk)) * 100);
}

// ---------- ridge attribution ----------
function invMat(A) {
  const n = A.length;
  const M = A.map((row, i) => [
    ...row,
    ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  ]);
  for (let i = 0; i < n; i++) {
    let piv = i;
    for (let r = i + 1; r < n; r++)
      if (Math.abs(M[r][i]) > Math.abs(M[piv][i])) piv = r;
    if (piv !== i) {
      const tmp = M[i]; M[i] = M[piv]; M[piv] = tmp;
    }
    const x = M[i][i] || 1e-12;
    for (let j = 0; j < 2 * n; j++) M[i][j] /= x;
    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const f = M[r][i];
      for (let j = 0; j < 2 * n; j++) M[r][j] -= f * M[i][j];
    }
  }
  return M.map((row) => row.slice(n));
}

function xtx(X) {
  const p = X[0].length;
  const out = Array.from({ length: p }, () => Array(p).fill(0));
  for (let i = 0; i < X.length; i++) {
    for (let a = 0; a < p; a++) {
      const xa = X[i][a];
      for (let b = 0; b < p; b++) out[a][b] += xa * X[i][b];
    }
  }
  return out;
}

function xty(X, y) {
  const p = X[0].length;
  const out = Array(p).fill(0);
  for (let i = 0; i < X.length; i++) {
    for (let a = 0; a < p; a++) out[a] += X[i][a] * y[i];
  }
  return out;
}

export function ridgeAttribution(samples, scoreKey = "profit", lambda = 1e-3) {
  if (!samples?.length) return [];
  const keySet = new Set();
  samples.forEach((s) =>
    Object.keys(s?.indicators || {}).forEach((k) => keySet.add(k))
  );
  const keys = [...keySet];
  if (keys.length === 0) return [];

  const zscoreVec = (vec) => {
    const xs = vec.map(Number).filter(Number.isFinite);
    const n = xs.length || 1;
    const mean = xs.reduce((a, b) => a + b, 0) / n;
    const stdv =
      Math.sqrt(xs.reduce((a, b) => a + (b - mean) * (b - mean), 0) / n) || 1;
    return { mean, stdv, f: (v) => (Number(v) - mean) / stdv };
  };

  const zs = Object.fromEntries(
    keys.map((k) => [k, zscoreVec(samples.map((s) => s?.indicators?.[k]))])
  );
  const zy = zscoreVec(samples.map((s) => s?.[scoreKey]));
  const X = samples.map((s) => keys.map((k) => zs[k].f(s?.indicators?.[k])));
  const y = samples.map((s) => zy.f(s?.[scoreKey]));

  const XtX = xtx(X);
  for (let i = 0; i < XtX.length; i++) XtX[i][i] += lambda;
  const XtY = xty(X, y);

  const inv = invMat(XtX);
  const beta = inv.map((row) =>
    row.reduce((a, b, idx) => a + b * XtY[idx], 0)
  );
  const absMax = Math.max(...beta.map((b) => Math.abs(b))) || 1;

  return keys
    .map((k, i) => ({ key: k, coef: beta[i], weight: Math.abs(beta[i]) / absMax }))
    .sort((a, b) => b.weight - a.weight);
}

// ---------- pareto & vol targeting ----------
export function paretoFrontier(
  items,
  { maximize = ["profit", "sharpe"], minimize = ["maxDD"] } = {}
) {
  const betterEq =
    (a, b) =>
      maximize.every((k) => Number(a[k]) >= Number(b[k])) &&
      minimize.every((k) => Number(a[k]) <= Number(b[k]));
  const strictlyBetter =
    (a, b) =>
      betterEq(a, b) &&
      (maximize.some((k) => Number(a[k]) > Number(b[k])) ||
        minimize.some((k) => Number(a[k]) < Number(b[k])));

  const pts = [];
  for (const x of items) {
    let dominated = false;
    for (const y of items) {
      if (y !== x && strictlyBetter(y, x)) {
        dominated = true;
        break;
      }
    }
    if (!dominated) pts.push(x);
  }
  return pts;
}

export function volatilityTargetEquity(
  equity,
  targetAnnVol = 0.2,
  lookback = 50,
  periodsPerYear = 252
) {
  if (!equity || equity.length < lookback + 2) return equity || [];
  const rets = [];
  for (let i = 1; i < equity.length; i++) {
    const a = Number(equity[i - 1]),
      b = Number(equity[i]);
    if (Number.isFinite(a) && a !== 0 && Number.isFinite(b)) rets.push(b / a - 1);
    else rets.push(0);
  }
  const rollStd = [];
  let buf = [];
  for (let i = 0; i < rets.length; i++) {
    buf.push(rets[i]);
    if (buf.length > lookback) buf.shift();
    if (buf.length === lookback) {
      const m = buf.reduce((a, c) => a + c, 0) / buf.length;
      const v =
        Math.sqrt(buf.reduce((a, c) => a + (c - m) * (c - m), 0) / buf.length) ||
        0;
      rollStd.push(v * Math.sqrt(periodsPerYear));
    } else rollStd.push(null);
  }
  const scaledRets = rets.map((r, i) => {
    const cur = rollStd[i];
    if (!Number.isFinite(cur) || cur === 0) return 0;
    return r * (targetAnnVol / cur);
  });
  const out = [equity[0]];
  for (let i = 0; i < scaledRets.length; i++) {
    const prev = Number(out[out.length - 1]);
    out.push(Number.isFinite(prev) ? prev * (1 + scaledRets[i]) : null);
  }
  return out;
}

// ---------- BusyBus (global busy indicator) ----------
export const BusyBus = {
  _subs: new Set(),
  _count: 0,
  begin() {
    this._count++;
    this._emit();
  },
  end() {
    this._count = Math.max(0, this._count - 1);
    this._emit();
  },
  set(v) {
    this._count = v ? 1 : 0;
    this._emit();
  },
  subscribe(fn) {
    try {
      fn(this._count > 0);
    } catch {}
    this._subs.add(fn);
    return () => this._subs.delete(fn);
  },
  _emit() {
    const busy = this._count > 0;
    this._subs.forEach((fn) => {
      try {
        fn(busy);
      } catch {}
    });
  },
};
