import React, { useMemo, useState } from "react";
import { pickColor } from "../utils/chartConfig";


function SimpleLine({ data = [], height = 240, color }) {
  const padding = 24;
  const w = Math.max(360, (typeof window !== "undefined" ? Math.min(1100, window.innerWidth - 96) : 720));
  const h = height;
  const vals = data.filter(Number.isFinite);
  if (!vals.length) return <div className="text-sm text-gray-500">No data</div>;
  const min = Math.min(...vals), max = Math.max(...vals);
  const sx = (i) => padding + (i / Math.max(1, data.length - 1)) * (w - 2 * padding);
  const sy = (v) => h - padding - ((v - min) / (max - min || 1)) * (h - 2 * padding);
  const d = data
    .map((v, i) => (Number.isFinite(Number(v)) ? `${i ? "L" : "M"}${sx(i)},${sy(Number(v))}` : null))
    .filter(Boolean)
    .join(" ");
  return (
    <svg width={w} height={h} className="block">
      <rect width={w} height={h} fill="transparent" />
      <path d={d} fill="none" stroke={color || "currentColor"} strokeWidth="2" />
    </svg>
  );
}

function SimpleMultiLine({ seriesMap = {}, height = 240 }) {
  const padding = 24;
  const w = Math.max(360, (typeof window !== "undefined" ? Math.min(1100, window.innerWidth - 96) : 720));
  const h = height;
  const names = Object.keys(seriesMap);
  if (names.length === 0) return <div className="text-sm text-gray-500">No data</div>;
  const longest = Math.max(...names.map((n) => seriesMap[n]?.length || 0));
  const allY = names.flatMap((n) => (seriesMap[n] || []).map(Number).filter(Number.isFinite));
  if (allY.length === 0) return <div className="text-sm text-gray-500">No data</div>;
  const min = Math.min(...allY), max = Math.max(...allY);
  const sx = (i) => padding + (i / Math.max(1, longest - 1)) * (w - 2 * padding);
  const sy = (v) => h - padding - ((v - min) / (max - min || 1)) * (h - 2 * padding);
  const paths = names.map((name, idx) => {
    const arr = seriesMap[name] || [];
    const d = arr
      .map((v, i) => (Number.isFinite(Number(v)) ? `${i ? "L" : "M"}${sx(i)},${sy(Number(v))}` : null))
      .filter(Boolean)
      .join(" ");
    return { name, color: pickColor(idx), d };
  });
  return (
    <>
      <svg width={w} height={h} className="block">
        <rect width={w} height={h} fill="transparent" />
        {paths.map((p) => (
          <path key={p.name} d={p.d} fill="none" stroke={p.color} strokeWidth="2" />
        ))}
      </svg>
      <div className="flex flex-wrap gap-2 mt-1">
        {paths.map((p) => (
          <span key={p.name} className="inline-flex items-center gap-2 text-xs text-gray-300">
            <span className="inline-block w-3 h-3 rounded" style={{ background: p.color }} />
            {p.name}
          </span>
        ))}
      </div>
    </>
  );
}

export function useChartData() {
  const [equity, setEquity] = useState([]);
  const [seriesMap, setSeriesMap] = useState({});

  const ChartView = useMemo(
    () => ({
      Component: function Chart({ data }) {
        if (Array.isArray(data)) return <SimpleLine data={data} />;
        if (data && typeof data === "object") return <SimpleMultiLine seriesMap={data} />;
        return <div className="text-sm text-gray-500">No data</div>;
      },
      setEquity: setEquity,
      setSeriesMap: setSeriesMap,
    }),
    []
  );

  return { equity, setEquity, chartSeries: equity, seriesMap, setSeriesMap, ChartView };
}
