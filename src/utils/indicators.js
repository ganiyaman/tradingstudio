// SMA, EMA, RSI, MACD, Bollinger

export function sma(arr, period) {
  const out = Array(arr.length).fill(null);
  let sum = 0, q = [];
  for (let i = 0; i < arr.length; i++) {
    const v = Number(arr[i]);
    if (Number.isFinite(v)) { q.push(v); sum += v; }
    if (q.length > period) sum -= q.shift();
    out[i] = q.length === period ? sum / period : null;
  }
  return out;
}

export function ema(arr, period) {
  const out = Array(arr.length).fill(null);
  const k = 2 / (period + 1);
  let prev = null;
  for (let i = 0; i < arr.length; i++) {
    const v = Number(arr[i]);
    if (!Number.isFinite(v)) { out[i] = null; continue; }
    prev = prev == null ? v : v * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function rsi(closes, period = 14) {
  const out = Array(closes.length).fill(null);
  let avgU = 0, avgD = 0, prev = null;
  for (let i = 0; i < closes.length; i++) {
    const c = Number(closes[i]);
    if (!Number.isFinite(c)) { out[i] = null; continue; }
    if (prev == null) { prev = c; continue; }
    const ch = c - prev;
    const u = Math.max(0, ch);
    const d = Math.max(0, -ch);
    if (i <= period) {
      avgU += u; avgD += d;
      if (i === period) {
        avgU /= period; avgD /= period;
        const rs = avgD === 0 ? 100 : avgU / (avgD || 1e-12);
        out[i] = 100 - 100 / (1 + rs);
      }
    } else {
      avgU = (avgU * (period - 1) + u) / period;
      avgD = (avgD * (period - 1) + d) / period;
      const rs = avgD === 0 ? 100 : avgU / (avgD || 1e-12);
      out[i] = 100 - 100 / (1 + rs);
    }
    prev = c;
  }
  return out;
}

export function macd(closes, fast = 12, slow = 26, signal = 9) {
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);
  const macdLine = closes.map((_, i) =>
    (emaFast[i] != null && emaSlow[i] != null) ? (emaFast[i] - emaSlow[i]) : null
  );
  const signalLine = ema(macdLine.map(v => v ?? 0), signal);
  const hist = macdLine.map((v, i) => (v != null && signalLine[i] != null) ? (v - signalLine[i]) : null);
  return { macdLine, signalLine, hist };
}

export function bollinger(closes, period = 20, stdMult = 2) {
  const ma = sma(closes, period);
  const out = closes.map((_, i) => {
    if (i + 1 < period) return { mid: null, upper: null, lower: null };
    let sum = 0, sum2 = 0;
    for (let k = i - period + 1; k <= i; k++) {
      const v = Number(closes[k]);
      sum += v; sum2 += v * v;
    }
    const mean = sum / period;
    const variance = sum2 / period - mean * mean;
    const stdev = Math.sqrt(Math.max(0, variance));
    return {
      mid: ma[i],
      upper: mean + stdMult * stdev,
      lower: mean - stdMult * stdev,
    };
  });
  return out;
}
