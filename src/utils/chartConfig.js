export const SERIES_COLORS = [
  "#60a5fa", "#34d399", "#f59e0b", "#f97316", "#a78bfa", "#ef4444", "#10b981"
];

export function pickColor(i) {
  return SERIES_COLORS[i % SERIES_COLORS.length];
}
