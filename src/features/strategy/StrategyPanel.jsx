// src/features/strategy/StrategyPanel.jsx
import React, { useEffect, useMemo, useState, useCallback } from "react";
import { useStrategies } from "../../hooks/useStrategies";
import { useBackendClient } from "../../hooks/useBackend";
import { STRATEGY_EXPR_PRESETS } from "../../constants/expressions";
import { DEFAULT_STRATEGIES } from "../../constants/defaultStrategies";
import { DEFAULT_EXIT } from "../../constants/enums";
import { normalizeIndicatorKeys } from "../../utils/helpers";

import SetupCard from "./components/SetupCard";
import StrategyTabs from "./components/StrategyTabs";
import ExitConfig from "./components/ExitConfig";
import ExpressionEditor from "./components/ExpressionEditor";
import IndicatorsSection from "./components/IndicatorsSection";

import { mapExitToScheme, ensureParamsForExpr, readLS, SNAP_LAST_KEY, SETUP_DEF_KEY, COLSTATS_LAST_KEY, EV_COLSTATS_UPDATE, getBody, pickColStats, mergeColStats } from "./utils/strategyHelpers";

// Legacy expr + indicatör setleri (istersen utils'e taşı)
const LEGACY_LONG_EXPR = `((data['bb_lo'].shift(1) - data['close'].shift(1)) < 0 & (data['RSI_diff'].shift(1) > -13) & ((data['SMA'].shift(1) > data['SMA'].shift(2)) & (data['SMA'] < data['SMA'].shift(1)) & (data['hist'] < 0)))`.replace(/\s+/g, " ").trim();
const LEGACY_SHORT_EXPR = `(((data['NDMA'] > 0.00022) & (data['NDMA'] < 0.0252)) & ((data['EMA'].shift(1) > data['EMA'].shift(2)) & (data['EMA'] < data['EMA'].shift(1)) & (data['hist'] < 0)) & (data['hist'].shift(1) > 0))`.replace(/\s+/g, " ").trim();
const LEGACY_LONG_INDICATORS = { macd_fast_default: 6, macd_slow_default: 18, macd_signal_default: 9, sma_period: 21, bb_period: 20, bb_std: 2, rsi_short: 10, rsi_long: 60 };
const LEGACY_SHORT_INDICATORS = { macd_fast_default: 6, macd_slow_default: 18, macd_signal_default: 9, ema_period: 21, ndma_window: 20 };

export default function StrategyPanel({ setNotice }) {
    const { strategies, setStrategies, activeId, setActiveId, active, addIndicatorGroup, removeIndicatorGroup, removeIndicatorInstance, setIndicatorValue, groupInstances, setExpr, setExit } = useStrategies();
    const api = useBackendClient();

    // İlk açılışta default stratejiler
    useEffect(() => {
        if (!strategies || strategies.length === 0) {
            setStrategies(DEFAULT_STRATEGIES.map((s) => ({ ...s })));
            setActiveId("S_A");
        }
    }, [strategies, setStrategies, setActiveId]);

    // setup state
    const lastSnap = readLS(SNAP_LAST_KEY);
    const setupDef = readLS(SETUP_DEF_KEY);
    const [q, setQ] = useState(() => setupDef?.q || lastSnap?.q || ({ symbol: "ORDIUSDT", timeframe: "5m", start: "2025-09-01T00:00:00Z", end: "2025-09-05T00:00:00Z" }));
    const [sim, setSim] = useState(() => {
        try {
            const raw = localStorage.getItem("SIM:costs");
            const j = raw ? JSON.parse(raw) : null;
            return { leverage: Number(j?.leverage ?? 2), fee_pct: Number(j?.fee_pct ?? 0.1), slippage_pct: Number(j?.slippage_pct ?? 0.05) };
        } catch { return { leverage: 2, fee_pct: 0.1, slippage_pct: 0.05 }; }
    });
    useEffect(() => { localStorage.setItem("SIM:costs", JSON.stringify(sim)); }, [sim]);

    const [snapBusy, setSnapBusy] = useState(false);
    const [busy, setBusy] = useState(false);

    const patchStrategy = useCallback((id, partial) => { setStrategies(prev => prev.map(s => s.id === id ? { ...s, ...partial } : s)); }, [setStrategies]);
    const toggleEnabled = (id, checked) => { setStrategies(prev => prev.map(s => (s.id === id ? { ...s, enabled: !!checked } : s))); };

    // PRESETS & expr
    const PRESETS = STRATEGY_EXPR_PRESETS?.length ? STRATEGY_EXPR_PRESETS : [{ id: "empty", label: "Empty", code: "" }];
    const [presetId, setPresetId] = useState(PRESETS[0].id);
    const [exprLocal, setExprLocal] = useState(active?.expr || "");
    useEffect(() => setExprLocal(active?.expr || ""), [active?.id]);
    const exit = active?.exit || DEFAULT_EXIT;

    // backtest’ten gelen kolon istatistikleri
    const [colStats, setColStats] = useState({});
    useEffect(() => {
        try {
            // 1) RESULTS:last (varsa)
            const resPack = JSON.parse(localStorage.getItem("RESULTS:last") || "null");
            const st1 = resPack?.data?.col_stats;
            // 2) COLSTATS:last (snapshot sonrası)
            const st2 = JSON.parse(localStorage.getItem(COLSTATS_LAST_KEY) || "null");
            setColStats(st1 || st2 || {});
        } catch { }
    }, []);

    useEffect(() => { const onUpdate = (e) => { const st = e?.detail?.col_stats || {}; setColStats(st); }; 
    window.addEventListener("results:update-map", onUpdate); 
    window.addEventListener(EV_COLSTATS_UPDATE, onUpdate);
    return () => {
        window.removeEventListener("results:update-map", onUpdate);
        window.removeEventListener(EV_COLSTATS_UPDATE, onUpdate);
        };
    }, []);
    // chips tıklaması ExpressionEditor'a forward
    const onPickExprChip = useCallback((fullKey, stat, evt) => {
        const has = (x) => Number.isFinite(x);
        let inner;
        if (evt?.shiftKey && has(stat?.min)) inner = `data['${fullKey}'] > ${Number(stat.min).toFixed(6)}`;
        else if ((evt?.ctrlKey || evt?.metaKey) && has(stat?.max)) inner = `data['${fullKey}'] < ${Number(stat.max).toFixed(6)}`;
        else inner = `data['${fullKey}']`;
        setExprLocal((prev) => { const base = (prev ?? "").trim(); const wrapped = `(${inner})`; return base ? `${base} & ${wrapped}` : wrapped; });
    }, []);
    const onNewStrategy = useCallback(() => {
        const id = "S_" + Math.random().toString(36).slice(2, 10);
        const s = {
            id,
            name: `Strategy ${(strategies?.length || 0) + 1}`,
            side: "long",
            enabled: true,
            indicators: {},
            groups: [],
            expr: "",
            exit: {}
        };
        setStrategies([...(strategies || []), s]);
        setActiveId(id);
    }, [strategies, setStrategies, setActiveId]);

    // Aktif stratejiyi sil
    const onRemoveActive = useCallback(() => {
        if ((strategies?.length || 0) <= 1) return;
        const nextList = strategies.filter(x => x.id !== activeId);
        setStrategies(nextList);
        if (activeId === (active?.id)) {
            const nextId = nextList[0]?.id || null;
            if (nextId) setActiveId(nextId);
        }
    }, [strategies, activeId, active, setStrategies, setActiveId]);


    const runBacktest = async () => {
        if (busy) return;
        const snap = JSON.parse(localStorage.getItem("SNAPSHOT:last") || "null");
        if (!snap?.id) { setNotice?.('No cached data – "Download Snapshot".'); return; }

        const enabled = (strategies || []).filter(s => !!s.enabled);
        if (!enabled.length) { setNotice?.("No enabled strategies to backtest."); return; }

        setBusy(true); setNotice?.("");
        try {
            const feeFrac = Number(sim?.fee_pct);
            const slpFrac = Number(sim?.slippage_pct);

            const byId = {}; const statsById = {}; const signalsById = {}; const dailyById = {}; let finalColStats = {};
            for (const s of enabled) {
                const exprSrc = (s.id === active?.id && exprLocal != null ? exprLocal : s.expr) || "";
                const exprOneLine = String(exprSrc).replace(/\s+/g, " ").trim();
                if (!exprOneLine) throw new Error(`Expression is empty for "${s.name}"`);
                if (s.id === active?.id && exprOneLine !== (active.expr || "")) { setExpr(active.id, exprOneLine); }

                const { uiPatched, indicatorsForCompute, paramsForExpr, addedUi } = ensureParamsForExpr(exprOneLine, s.indicators || {});
                if (addedUi.length) {
                    setStrategies(prev => prev.map(x => (x.id === s.id ? { ...x, indicators: uiPatched } : x)));
                    if (s.id === enabled[0].id) { setNotice?.(`Auto-added params: ${addedUi.join(", ")}`); }
                }
                const indicatorsNormalized = (typeof normalizeIndicatorKeys === "function") ? normalizeIndicatorKeys(indicatorsForCompute) : indicatorsForCompute;
                const scheme = mapExitToScheme(s.exit);

                const payload = {
                    symbol: q.symbol, timeframe: q.timeframe, start: q.start, end: q.end,
                    data_snapshot_id: snap.id, exit_scheme: scheme, expr: exprOneLine,
                    fee_pct: Number.isFinite(feeFrac) ? feeFrac : 0, slippage_pct: Number.isFinite(slpFrac) ? slpFrac : 0,
                    leverage: Number(s.leverage ?? sim?.leverage ?? 1), mode: "event", respect_expr_sign: true,
                    side: (s.side === "short" || s.side === -1) ? -1 : 1,
                    indicators: indicatorsNormalized, params: { ...(s.extraParams || {}), ...(paramsForExpr || {}) },
                };

                const raw = await api.post("/backtest/run_with_exit", payload, { timeout: 10 * 60 * 1000 });
                const res = getBody(raw);
                const { stats = null, signals = [], daily_profits = [] } = res ?? {};
                const rawColStats = pickColStats(res) || {};
                const daily = Array.isArray(res?.daily_profits) ? res.daily_profits : [];

                statsById[s.id] = stats; signalsById[s.id] = signals; dailyById[s.id] = daily;
                byId[s.id] = { id: s.id, name: s.name, side: s.side, exit: s.exit, expr: exprOneLine, stats, signals, daily_profits: daily, col_stats: rawColStats };
                finalColStats = mergeColStats(finalColStats, rawColStats);
            }

            const strategiesMap = strategies.map(s => ({ id: s.id, name: s.name, enabled: !!s.enabled, side: typeof s.side === "string" ? (s.side === "short" ? -1 : 1) : s.side }));
            const pack = { ts: Date.now(), kind: "backtest", payload: { symbol: q.symbol, timeframe: q.timeframe, start: q.start, end: q.end }, data: { signalsById, statsById, dailyById, col_stats: finalColStats }, strategies: strategiesMap };
            localStorage.setItem("RESULTS:last", JSON.stringify(pack));
            window.dispatchEvent(new CustomEvent("results:update-map", { detail: { signalsById, statsById, dailyById, col_stats: finalColStats, strategies: strategiesMap } }));
            window.dispatchEvent(new CustomEvent("tab:results"));

            const totalTrades = Object.values(signalsById).reduce((a, arr) => a + (arr?.length || 0), 0);
            setNotice?.(totalTrades ? `Backtest OK (${totalTrades} trades across ${enabled.length} strategy)` : `Backtest completed. 0 trades across ${enabled.length} strategy.`);
        } catch (e) {
            console.error("❌ Backtest error:", e);
            setNotice?.(`Backtest error: ${e.message || e}`);
        } finally { setBusy(false); }
    };


    return (
        <div className="space-y-6">
            <SetupCard
                q={q} setQ={setQ}
                sim={sim} setSim={setSim}
                api={api} setNotice={setNotice}
                snapBusy={snapBusy} setSnapBusy={setSnapBusy}
                strategies={strategies}               // ← eklendi
            />


            <StrategyTabs strategies={strategies} activeId={activeId} setActiveId={setActiveId} setStrategies={setStrategies} active={active} LEGACY_LONG_EXPR={LEGACY_LONG_EXPR} LEGACY_SHORT_EXPR={LEGACY_SHORT_EXPR} LEGACY_LONG_INDICATORS={LEGACY_LONG_INDICATORS} LEGACY_SHORT_INDICATORS={LEGACY_SHORT_INDICATORS} />

            <ExitConfig
                active={active}
                exit={active?.exit || DEFAULT_EXIT}
                setExit={setExit}
                toggleEnabled={toggleEnabled}
                patchStrategy={patchStrategy}
                onNewStrategy={onNewStrategy}
                onRemoveActive={onRemoveActive}
                canRemove={(strategies?.length || 0) > 1}
            />

            <ExpressionEditor PRESETS={PRESETS} presetId={presetId} setPresetId={setPresetId} exprLocal={exprLocal} setExprLocal={setExprLocal} active={active} setExpr={setExpr} setNotice={setNotice} />

            <IndicatorsSection active={active} addIndicatorGroup={addIndicatorGroup} removeIndicatorGroup={removeIndicatorGroup} groupInstances={groupInstances} removeIndicatorInstance={removeIndicatorInstance} setIndicatorValue={setIndicatorValue} colStats={colStats} onPickExprChip={onPickExprChip} />

            <div>
                <button className="px-4 py-2 rounded bg-emerald-600 disabled:opacity-60" onClick={runBacktest} disabled={!active || busy}>
                    {busy ? "Running…" : "Run Backtest"}
                </button>
            </div>
        </div>
    );
}
