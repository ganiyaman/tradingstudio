import React, { useEffect, useMemo, useState } from "react";
import { useStrategies } from "../../hooks/useStrategies";
import { useBackendClient } from "../../hooks/useBackend";
import { useChartData } from "../../hooks/useChartData";
import { fmt } from "../../utils/format";
import { seriesReturns, std, maxDrawdown, sharpe, calmar, rollingSharpeFromEquity, rollingMDDFromEquity, volatilityTargetEquity } from "../../utils/helpers";

function WeightRow({ s, w, onChange }) {
    return (
        <div className="flex items-center gap-2">
            <div className="w-48 truncate">{s.name}</div>
            <input className="input w-28" type="number" value={w} onChange={e => onChange(Number(e.target.value) || 0)} />
        </div>
    );
}
const normalizeWeights = (ws) => { const sum = Object.values(ws).reduce((a, b) => a + Math.max(b, 0), 0); if (sum <= 0) return ws; return Object.fromEntries(Object.entries(ws).map(([k, v]) => [k, Math.max(v, 0) / sum])); };

export default function PortfolioPanel() {
    const { strategies } = useStrategies();
    const api = useBackendClient();
    const [period, setPeriod] = useState({ symbol: "ORDIUSDT", timeframe: "5m", start: "2025-09-01T00:00:00Z", end: "2025-09-05T00:00:00Z" });
    const [weights, setWeights] = useState(() => Object.fromEntries(strategies.map(s => [s.id, 1])));
    const [loading, setLoading] = useState(false);
    const [perf, setPerf] = useState(null);
    const { seriesMap, ChartView } = useChartData();
    const normalized = useMemo(() => normalizeWeights(weights), [weights]);
    const [lastEquities, setLastEquities] = useState({});
    const [rollWin, setRollWin] = useState(200);
    const [rollSeries, setRollSeries] = useState({});
    const [vtOn, setVtOn] = useState(false); const [vtTarget, setVtTarget] = useState(0.20); const [vtLB, setVtLB] = useState(50);

    const computeRiskParityWeights = (eqMap) => {
        const ids = Object.keys(eqMap || {}); if (!ids.length) return {};
        const invVol = {}; ids.forEach(id => { const rets = seriesReturns(eqMap[id]?.filter(Number.isFinite)); const s = std(rets); invVol[id] = s > 0 ? 1 / s : 0; });
        let sum = Object.values(invVol).reduce((a, b) => a + b, 0); if (sum <= 0) return {}; return Object.fromEntries(ids.map(id => [id, invVol[id] / sum]));
    };

    const run = async () => {
        if (!strategies.length) return; setLoading(true);
        try {
            const runs = strategies.map(s => ({ id: s.id, symbol: period.symbol, timeframe: period.timeframe, start: period.start, end: period.end, side: s.side || "long", indicators: s.indicators || {} }));
            const [resRuns, bench] = await Promise.all([
                api.post("/backtest/many", { runs }),
                api.post("/benchmark", period).catch(() => ({}))
            ]);
            const equities = Object.fromEntries((resRuns?.results || []).map(r => [r.id, r.equity || []]));
            setLastEquities(equities);
            const len = Math.max(...Object.values(equities).map(e => e?.length || 0)); const names = Object.keys(equities);
            const w = normalized;
            const port = [...Array(len)].map((_, i) => { let sum = 0, ws = 0; names.forEach(n => { const wi = w[n] ?? 0; const eq = equities[n]?.[i]; if (Number.isFinite(eq)) { sum += wi * eq; ws += wi; } }); return ws > 0 ? sum : null; });
            const map = Object.fromEntries(names.map(n => [`${n}`, equities[n]]));
            map["Portfolio"] = port; if (Array.isArray(bench?.equity)) map["Benchmark"] = bench.equity;
            if (vtOn) { const vt = volatilityTargetEquity(port, Number(vtTarget), Number(vtLB), 252); map["Portfolio (VT)"] = vt; }
            ChartView.setSeriesMap(map);

            const portClean = port.filter(Number.isFinite);
            let metrics = null; if (portClean.length > 2) { const rets = seriesReturns(portClean); metrics = { retPct: ((portClean.at(-1) / portClean[0]) - 1) * 100, volPct: std(rets) * Math.sqrt(252) * 100, mddPct: Math.abs(maxDrawdown(portClean)) * 100, sharpe: sharpe(rets, 0, 252), calmar: calmar(portClean, 252) }; }
            const rSharpe = rollingSharpeFromEquity(port, rollWin, 252); const rMDD = rollingMDDFromEquity(port, rollWin); setRollSeries({ "Rolling Sharpe": rSharpe, "Rolling MDD %": rMDD });
            setPerf({ portfolio: metrics?.retPct ?? null, nStrategies: strategies.length, weights: w, metrics });
        } catch (e) { alert(e.message); } finally { setLoading(false); }
    };

    useEffect(() => { run(); /* eslint-disable-next-line */ }, []);

    return (
        <div className="space-y-4">
            <div className="p-4 rounded-xl border border-gray-700 bg-gray-800/50">
                <div className="font-semibold mb-3">Portfolio Settings</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <input className="input" value={period.symbol} onChange={e => setPeriod(p => ({ ...p, symbol: e.target.value }))} />
                    <select className="input" value={period.timeframe} onChange={e => setPeriod(p => ({ ...p, timeframe: e.target.value }))}>
                        {["1m", "3m", "5m", "15m", "30m", "1h", "4h", "1d"].map(tf => <option key={tf}>{tf}</option>)}
                    </select>
                    <input className="input" value={period.start} onChange={e => setPeriod(p => ({ ...p, start: e.target.value }))} />
                    <input className="input" value={period.end} onChange={e => setPeriod(p => ({ ...p, end: e.target.value }))} />
                </div>

                <div className="p-3 rounded-lg border border-gray-700 bg-gray-900/40 mb-3 mt-3">
                    <div className="font-semibold mb-2">Volatility Targeting</div>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-2 items-center">
                        <label className="flex items-center gap-2 text-sm text-gray-300"><input type="checkbox" checked={vtOn} onChange={e => setVtOn(e.target.checked)} /> Enable</label>
                        <label className="flex items-center gap-2"><span className="text-sm text-gray-300">Target σ (ann)</span><input className="input" type="number" step="0.01" value={vtTarget} onChange={e => setVtTarget(Number(e.target.value) || 0.2)} /></label>
                        <label className="flex items-center gap-2"><span className="text-sm text-gray-300">Lookback</span><input className="input" type="number" value={vtLB} onChange={e => setVtLB(Number(e.target.value) || 50)} /></label>
                        <button className="btn-primary" onClick={run} disabled={loading}>{loading ? "Running…" : "Recompute"}</button>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="p-3 rounded-lg border border-gray-700 bg-gray-900/40">
                        <div className="font-semibold mb-2">Weights</div>
                        <div className="flex items-center gap-2 mb-2">
                            <button className="px-3 py-2 rounded-lg border border-gray-600 text-gray-200 hover:bg-gray-700/40" onClick={() => setWeights(Object.fromEntries(strategies.map(s => [s.id, 1])))}>Equal-Weight</button>
                            <button className="px-3 py-2 rounded-lg border border-gray-600 text-gray-200 hover:bg-gray-700/40" onClick={() => { const rp = computeRiskParityWeights(lastEquities); if (!Object.keys(rp).length) return alert("Run once to compute RP."); const eps = 1e-6; setWeights(Object.fromEntries(Object.keys(rp).map(k => [k, rp[k] + eps]))); }}>Risk-Parity</button>
                        </div>
                        <div className="space-y-2">
                            {strategies.map(s => <WeightRow key={s.id} s={s} w={weights[s.id] ?? 0} onChange={(v) => setWeights(ws => ({ ...ws, [s.id]: v }))} />)}
                        </div>
                        <button className="btn-primary mt-3" onClick={run} disabled={loading}>{loading ? "Running…" : "Recompute"}</button>
                    </div>

                    <div className="p-3 rounded-lg border border-gray-700 bg-gray-900/40">
                        <div className="font-semibold mb-2">Performance</div>
                        <div className="text-sm text-gray-300">Strategies: {perf?.nStrategies ?? "-"}</div>
                        <div className="text-sm text-gray-300">Portfolio Return: {fmt(perf?.portfolio, 2)}%</div>
                        {perf?.metrics && (
                            <div className="grid grid-cols-2 gap-2 mt-2 text-sm">
                                <div className="text-gray-300">Volatility (ann): {fmt(perf.metrics.volPct, 2)}%</div>
                                <div className="text-gray-300">Max Drawdown: {fmt(perf.metrics.mddPct, 2)}%</div>
                                <div className="text-gray-300">Sharpe: {fmt(perf.metrics.sharpe, 2)}</div>
                                <div className="text-gray-300">Calmar: {fmt(perf.metrics.calmar, 2)}</div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <div className="p-4 rounded-xl border border-gray-700 bg-gray-800/50">
                <div className="font-semibold mb-2">Portfolio vs Benchmark</div>
                <ChartView.Component data={seriesMap} />
            </div>

            <div className="p-4 rounded-xl border border-gray-700 bg-gray-800/50">
                <div className="flex items-center justify-between mb-2">
                    <div className="font-semibold">Rolling Metrics</div>
                    <div className="flex items-center gap-2"><span className="text-sm text-gray-300">Window</span><input className="input w-24" type="number" value={rollWin} onChange={e => setRollWin(Math.max(10, Number(e.target.value) || 200))} />
                        <button className="btn-primary" onClick={() => { const cur = seriesMap?.["Portfolio"] || []; const a = rollingSharpeFromEquity(cur, rollWin, 252); const b = rollingMDDFromEquity(cur, rollWin); setRollSeries({ "Rolling Sharpe": a, "Rolling MDD %": b }); }}>Recompute</button>
                    </div>
                </div>
                <ChartView.Component data={rollSeries} />
            </div>
        </div>
    );
}
