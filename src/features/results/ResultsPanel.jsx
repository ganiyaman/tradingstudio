// src/features/results/ResultsPanel.jsx
import React, { useEffect, useMemo, useState } from "react";

/* ---------------- helpers ---------------- */
const LS_RESULTS = "RESULTS:last";
const LS_STRATS = "TRADER:strategies:v1";

// Tek bir sinyal objesindeki olası alanları normalize et
function normalizeSignal(raw, defaultSide = 1) {
    const ts =
        raw.ts ?? raw.time ?? raw.t ?? raw.t_in ?? raw.timestamp ?? null;

    const sideRaw = raw.side ?? defaultSide;
    const side =
        typeof sideRaw === "string"
            ? sideRaw.toUpperCase()
            : sideRaw > 0
                ? "LONG"
                : "SHORT";

    const price =
        raw.price ?? raw.p ?? raw.p_in ?? raw.entry_price ?? raw.open ?? null;
    const tp =
        raw.tp ?? raw.tp_price ?? raw.take_profit ?? raw.tp_px ?? null;
    const sl =
        raw.sl ?? raw.sl_price ?? raw.stop_loss ?? raw.sl_px ?? null;

    const pnl = raw.pnl ?? raw.p_l ?? raw.profit ?? raw.ret ?? null;

    return { ts, side, price, tp, sl, pnl, __raw: raw };
}

const getTs = (s) =>
    s?.ts ?? s?.time ?? s?.t ?? s?.t_in ?? s?.timestamp ?? null;

const byTimeAsc = (a, b) => (getTs(a) ?? 0) - (getTs(b) ?? 0);

function readEnabledIdsFromLocal() {
    try {
        const raw = localStorage.getItem(LS_STRATS);
        const arr = raw ? JSON.parse(raw) : [];
        return arr.filter(s => !!s?.enabled).map(s => s.id);
    } catch { return []; }
}

function readNameMapFromLocal() {
    try {
        const raw = localStorage.getItem(LS_STRATS);
        const arr = raw ? JSON.parse(raw) : [];
        const map = {};
        for (const s of arr) map[s.id] = s.name || s.id;
        return map;
    } catch { return {}; }
}

// “All (enabled)” için: aynı timestamp’te yalnızca bir sinyal kalsın
function mergeSignals(enabledIds, signalsById) {
    const chosen = new Set();
    const out = [];

    for (const id of enabledIds) {
        const arr = Array.isArray(signalsById?.[id]) ? signalsById[id] : [];
        for (const s of arr) {
            const ts = getTs(s);
            if (ts == null) continue;
            const key = String(ts);
            if (chosen.has(key)) continue;
            chosen.add(key);
            out.push(s);
        }
    }
    return out.sort(byTimeAsc);
}

/* ---------------- küçük UI parçaları ---------------- */
function StatBadge({ label, value }) {
    return (
        <div className="px-3 py-2 rounded bg-slate-700/60 text-slate-100 text-sm">
            <div className="text-xs opacity-70">{label}</div>
            <div className="font-semibold">{value}</div>
        </div>
    );
}

function TradesTable({ rows }) {
    if (!rows?.length) {
        return <div className="text-sm text-slate-400">No trades.</div>;
    }
    return (
        <div className="overflow-auto border border-slate-700/60 rounded">
            <table className="min-w-[720px] w-full text-sm">
                <thead className="bg-slate-800 text-slate-300">
                    <tr>
                        <th className="text-left  px-3 py-2">Time</th>
                        <th className="text-left  px-3 py-2">Side</th>
                        <th className="text-right px-3 py-2">Price</th>
                        <th className="text-right px-3 py-2">TP</th>
                        <th className="text-right px-3 py-2">SL</th>
                        <th className="text-right px-3 py-2">PnL</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/50">
                    {rows.map((r, i) => {
                        const n = normalizeSignal(r);
                        return (
                            <tr key={i} className="hover:bg-slate-800/50">
                                <td className="px-3 py-2 whitespace-nowrap">
                                    {n.ts ? new Date(n.ts).toISOString() : "-"}
                                </td>
                                <td className="px-3 py-2">{n.side}</td>
                                <td className="px-3 py-2 text-right">{n.price ?? "-"}</td>
                                <td className="px-3 py-2 text-right">{n.tp ?? "-"}</td>
                                <td className="px-3 py-2 text-right">{n.sl ?? "-"}</td>
                                <td className="px-3 py-2 text-right">{n.pnl ?? "-"}</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

/* ---------------- ResultsPanel ---------------- */
export default function ResultsPanel() {
    // Çoklu sonuç saklama: { signalsById, statsById, dailyById, nameMap }
    const [resultsMap, setResultsMap] = useState({
        signalsById: {},
        statsById: {},
        dailyById: {},
        nameMap: readNameMapFromLocal(),
    });

    // “all” veya belirli strateji id
    const [activeKey, setActiveKey] = useState("all");

    // İlk açılışta eski tek-sonuç desteği
    useEffect(() => {
        try {
            const raw = localStorage.getItem(LS_RESULTS);
            if (!raw) return;
            const j = JSON.parse(raw);
            const id = j?.payload?.strategy_id || "active";
            const name = j?.payload?.name || "Strategy";
            const sigs = j?.data?.signals || [];
            const st = j?.data?.stats || null;

            setResultsMap(prev => ({
                ...prev,
                signalsById: { ...prev.signalsById, [id]: sigs },
                statsById: { ...prev.statsById, [id]: st },
                nameMap: { ...prev.nameMap, [id]: name },
            }));
            if (activeKey === "all") setActiveKey(id);
        } catch { }
    }, []); // once

    // StrategyPanel’den gelen event’leri dinle
    useEffect(() => {
        const onMap = (e) => {
            const d = e?.detail || {};
            const nameMap = {};
            (d.strategies || []).forEach(s => { nameMap[s.id] = s.name || s.id; });

            setResultsMap({
                signalsById: d.signalsById || {},
                statsById: d.statsById || {},
                dailyById: d.dailyById || {},
                nameMap: Object.keys(nameMap).length ? nameMap : readNameMapFromLocal(),
            });

            // seçili id yoksa all'a dön
            if (activeKey !== "all" && !(d.signalsById || {})[activeKey]) {
                setActiveKey("all");
            }
        };

        const onSingle = (e) => {
            const p = e?.detail?.payload || {};
            const id = p.strategy_id || "active";
            const nm = p.name || "Strategy";
            const dat = e?.detail?.data || {};

            setResultsMap(prev => ({
                ...prev,
                signalsById: { ...prev.signalsById, [id]: dat.signals || [] },
                statsById: { ...prev.statsById, [id]: dat.stats || null },
                nameMap: { ...prev.nameMap, [id]: nm },
            }));
            if (activeKey === "all") setActiveKey(id);
        };

        const goTab = () => setActiveKey(k => k); // sadece panelde kalmayı sağlar

        window.addEventListener("results:update-map", onMap);
        window.addEventListener("results:update", onSingle);
        window.addEventListener("tab:results", goTab);
        return () => {
            window.removeEventListener("results:update-map", onMap);
            window.removeEventListener("results:update", onSingle);
            window.removeEventListener("tab:results", goTab);
        };
    }, [activeKey]);

    // Sekme butonları (sadece gelen sonuçlar)
    const strategyOptions = useMemo(() => {
        const ids = Object.keys(resultsMap.signalsById || {});
        return ids.map(id => ({ id, name: resultsMap.nameMap?.[id] || id }));
    }, [resultsMap]);

    // “All (enabled)” için etkin strateji id’leri
    const enabledIds = useMemo(() => readEnabledIdsFromLocal(), [resultsMap]);

    // Gösterilecek satırlar & hızlı istatistik
    const { rows, stats } = useMemo(() => {
        if (activeKey === "all") {
            const merged = mergeSignals(enabledIds, resultsMap.signalsById);
            return { rows: merged, stats: { trades: merged.length } };
        }
        const sigs = resultsMap.signalsById?.[activeKey] || [];
        const st = resultsMap.statsById?.[activeKey] || null;
        return { rows: sigs, stats: st };
    }, [activeKey, resultsMap, enabledIds]);

    return (
        <div className="p-4 space-y-4">
            {/* Sekmeler */}
            <div className="flex items-center gap-2 flex-wrap">
                <button
                    className={`px-3 py-1.5 rounded ${activeKey === "all"
                            ? "bg-sky-600 text-white"
                            : "bg-slate-700/70 text-slate-200 hover:bg-slate-600"
                        }`}
                    onClick={() => setActiveKey("all")}
                >
                    All (enabled)
                </button>

                {strategyOptions.map(opt => (
                    <button
                        key={opt.id}
                        className={`px-3 py-1.5 rounded ${activeKey === opt.id
                                ? "bg-sky-600 text-white"
                                : "bg-slate-700/70 text-slate-200 hover:bg-slate-600"
                            }`}
                        onClick={() => setActiveKey(opt.id)}
                        title={opt.id}
                    >
                        {opt.name}
                    </button>
                ))}
            </div>

            {/* Hızlı istatistikler */}
            <div className="flex items-center gap-3">
                <StatBadge label="Trades" value={stats?.trades ?? rows.length} />
                {typeof stats?.winrate !== "undefined" && (
                    <StatBadge label="Win rate" value={`${Number(stats.winrate).toFixed(2)}%`} />
                )}
                {typeof stats?.sharpe !== "undefined" && (
                    <StatBadge label="Sharpe" value={Number(stats.sharpe).toFixed(2)} />
                )}
            </div>

            {/* Tablo */}
            <TradesTable rows={rows} />
        </div>
    );
}
