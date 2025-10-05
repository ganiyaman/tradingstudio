// number, price, bytes, percentage

export function fmt(x, d = 2) {
  if (x == null || x === "") return "-";
  const n = Number(x);
  if (!Number.isFinite(n)) return "-";
  return n.toFixed(d);
}

export function fmtPx(x, d = 4) {
  if (x == null || x === "") return "-";
  const n = Number(x);
  if (!Number.isFinite(n)) return "-";
  return n.toFixed(d);
}

export function fmtBytes(bytes, decimals = 1) {
  const b = Number(bytes);
  if (!Number.isFinite(b)) return "-";
  if (b === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.floor(Math.log(Math.abs(b)) / Math.log(1024));
  const v = b / Math.pow(1024, i);
  return `${v.toFixed(decimals)} ${units[i] ?? "B"}`;
}

export function fmtPct(x, decimals = 2) {
  if (x == null || x === "") return "-";
  const n = Number(x);
  if (!Number.isFinite(n)) return "-";
  const val = Math.abs(n) <= 1 ? n * 100 : n;
  return `${val.toFixed(decimals)}%`;
}
