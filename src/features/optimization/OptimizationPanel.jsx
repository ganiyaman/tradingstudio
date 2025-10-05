import React, { useMemo, useState } from "react";
import { useStrategies } from "../../hooks/useStrategies";
import { useBackendClient } from "../../hooks/useBackend";
import { fmt } from "../../utils/format";
import { paretoFrontier } from "../../utils/helpers";

function RangeRow({ k, conf, onChange }) {
    const [min, setMin] = useState(conf?.min ?? 1);
    const [max, setMax] = useState(conf?.max ?? 50);
    const [step, setStep] = useState(conf?.step ?? 1);
    const commit = () => onChange({ min: Number(min), max: Number(max), step: Number(step) });
    return (
        <tr className="border-t border-gray-800">
            <td className="p-2"><code className="text-xs bg-black/30 px-2 py-1 rounded border border-gray-700">{k}</code></td>
            <td className="p-2"><input className="input w-full" type="number" value={min} onChange={e => setMin(e.target.value)} onBlur={commit} /></td>
            <td className="p-2"><input className="input w-full" type="number" value={max} onChange={e => setMax(e.target.value)} onBlur={commit} /></td>
            <td className="p-2"><input className="input w-full" type="number" value={step} onChange={e => setStep(e.target.value)} onBlur={commit} /></td>
        </tr>
    );
}

export default function OptimizationPanel() {
    const { strategies, activeId, patchStrategyDeep } = useStrategies();
    const active = useMemo(() => strategies.find(s => s.id === activeId) || strategies[0], [strategies, activeId]);
    const api = useBackendClient();

    const indicatorKeys = Object.keys(active?.indicators || {});
    const [ranges, setRanges] = useState({});
    const [budget, setBudget] = useState(200);
    const [running, setRunning] = useState(false);
    const [top, setTop] = useState([]);

    const updateRange = (k, conf) => setRanges(r => ({ ...r, [k]: conf }));

    const runOpt = async () => {
        if (!active) return; setRunning(true);
        try {
            const searchSpace = indicatorKeys.reduce((acc, k) => { const def = Number(active.indicators[k] ?? 0) || 1; acc[k] = ranges[k] || { min: Math.max(1, def - 5), max: def + 5, step: 1 }; return acc; }, {});
            const payload = { strategies: [{ id: active.id, side: active.side || "long", indicators: active.indicators || {} }], symbol: "ORDIUSDT", timeframe: "5m", start: "2025-09-01T00:00:00Z", end: "2025-09-05T00:00:00Z", budget, searchSpace };
            const res = await api.post("/optimize", payload);
            setTop((res?.results || []).slice(0, 50));
        } catch (e) { alert(e.message); } finally { setRunning(false); }
    };

    const applyToStrategy = (cand) => patchStrategyDeep(active.id, s => { s.indicators = { ...(s.indicators || {}), ...(cand?.indicators || {}) }; return s; });

    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl border border-gray-700 bg-gray-800/50">
                <div className="flex items-center justify-between mb-3">
                    <div className="font-semibold">Search Space — {active?.name || "-"}</div>
                    <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-300">Budget</span>
                        <input className="input w-24" type="number" value={budget} onChange={e => setBudget(Number(e.target.value) || 0)} />
                        <button className="btn-primary" onClick={runOpt} disabled={running || !active}>{running ? "Optimizing…" : "Run Optimization"}</button>
                    </div>
                </div>
                <div className="overflow-auto">
                    <table className="w-full text-sm">
                        <thead className="text-gray-300"><tr><th className="text-left p-2">Key</th><th className="text-right p-2">Min</th><th className="text-right p-2">Max</th><th className="text-right p-2">Step</th></tr></thead>
                        <tbody className="text-gray-400">
                            {indicatorKeys.map(k => <RangeRow key={k} k={k} conf={ranges[k]} onChange={(conf) => updateRange(k, conf)} />)}
                            {indicatorKeys.length === 0 && <tr><td colSpan={4} className="p-3 text-center text-gray-500">No indicator keys.</td></tr>}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="p-4 rounded-xl border border-gray-700 bg-gray-800/50">
                <div className="font-semibold mb-3">Top Results</div>
                <div className="overflow-auto">
                    <table className="w-full text-sm">
                        <thead className="text-gray-300"><tr>
                            <th className="text-left p-2">#</th>
                            <th className="text-right p-2">Profit%</th>
                            <th className="text-right p-2">Sharpe</th>
                            <th className="text-right p-2">Win%</th>
                            <th className="text-left p-2">Params</th>
                            <th className="text-left p-2">Apply</th>
                        </tr></thead>
                        <tbody className="text-gray-400">
                            {top.map((r, i) => (
                                <tr key={i} className="border-t border-gray-800 align-top">
                                    <td className="p-2">{i + 1}</td>
                                    <td className="p-2 text-right">{fmt(r.profit, 2)}</td>
                                    <td className="p-2 text-right">{fmt(r.sharpe, 2)}</td>
                                    <td className="p-2 text-right">{fmt(r.winRate, 2)}</td>
                                    <td className="p-2"><pre className="bg-black/30 border border-gray-700 rounded p-2 max-h-28 overflow-auto text-xs">{JSON.stringify(r.indicators, null, 2)}</pre></td>
                                    <td className="p-2"><button className="btn-primary" onClick={() => applyToStrategy(r)}>Apply</button></td>
                                </tr>
                            ))}
                            {top.length === 0 && <tr><td colSpan={6} className="p-3 text-center text-gray-500">No results.</td></tr>}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="p-4 rounded-xl border border-gray-700 bg-gray-800/50 lg:col-span-2">
                <div className="font-semibold mb-2">Pareto Frontier — profit ↑, sharpe ↑, maxDD ↓</div>
                <Scatter rows={top} xKey="maxDD" yKey="profit" />
            </div>
        </div>
    );
}

function Scatter({ rows = [], xKey = "maxDD", yKey = "profit", colorPareto = "rgba(16,185,129,0.9)" }) {
    const w = 560, h = 300, p = 36; const xs = rows.map(r => Number(r[xKey])).filter(Number.isFinite); const ys = rows.map(r => Number(r[yKey])).filter(Number.isFinite);
    if (!xs.length || !ys.length) return <div className="text-sm text-gray-500">No data</div>;
    const minX = Math.min(...xs), maxX = Math.max(...xs); const minY = Math.min(...ys), maxY = Math.max(...ys);
    const sx = v => p + ((v - minX) / (maxX - minX || 1)) * (w - 2 * p); const sy = v => h - p - ((v - minY) / (maxY - minY || 1)) * (h - 2 * p);
    const pf = paretoFrontier(rows); const key = (r, i) => (r._id || i) + ":" + JSON.stringify(r.indicators || {}); const S = new Set(pf.map(key));
    return (
        <svg width={w} height={h} className="block">
            <rect width={w} height={h} fill="transparent" />
            <text x={w / 2 - 30} y={h - 6} className="fill-gray-400 text-[10px]">{xKey}</text>
            <text x={6} y={14} className="fill-gray-400 text-[10px]">{yKey}</text>
            {rows.map((r, i) => { const x = Number(r[xKey]), y = Number(r[yKey]); if (!Number.isFinite(x) || !Number.isFinite(y)) return null; const on = S.has(key(r, i)); return <circle key={i} cx={sx(x)} cy={sy(y)} r={on ? 4 : 3} fill={on ? colorPareto : "rgba(148,163,184,0.6)"} />; })}
        </svg>
    );
}
