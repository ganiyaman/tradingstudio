// src/features/strategy/StrategyPanel.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useStrategies } from "../../hooks/useStrategies";
import { useBackendClient } from "../../hooks/useBackend";
import { DEFAULT_IND_CATALOG } from "../../constants/indicatorCatalog";
import { DEFAULT_STRATEGIES } from "../../constants/defaultStrategies";
import { STRATEGY_EXPR_PRESETS } from "../../constants/expressions";
import { EXIT_TYPES, DEFAULT_EXIT } from "../../constants/enums";
import { normalizeIndicatorKeys } from "../../utils/helpers";

/* ---- LocalStorage anahtarları ---- */
const SNAP_LAST_KEY = "SNAPSHOT:last";
const SETUP_DEF_KEY = "SETUP:defaults";

/* ---- Legacy expr ve default indikatör setleri ---- */
const LEGACY_LONG_EXPR = `( (data['bb_lo'].shift(1) - data['close'].shift(1)) < 0
  & (data['RSI_diff'].shift(1) > -13)
  & ((data['SMA'].shift(1) > data['SMA'].shift(2)) & (data['SMA'] < data['SMA'].shift(1)) & (data['hist'] < 0)) )`
    .replace(/\s+/g, " ").trim();

const LEGACY_SHORT_EXPR = `( ((data['NDMA'] > 0.00022) & (data['NDMA'] < 0.0252))
  & ((data['EMA'].shift(1) > data['EMA'].shift(2)) & (data['EMA'] < data['EMA'].shift(1)) & (data['hist'] < 0))
  & (data['hist'].shift(1) > 0) )`
    .replace(/\s+/g, " ").trim();

const LEGACY_LONG_INDICATORS = {
    macd_fast_default: 6,
    macd_slow_default: 18,
    macd_signal_default: 9,
    sma_period: 21,
    bb_period: 20,
    bb_std: 2,
    rsi_short: 10,
    rsi_long: 60,
};
const LEGACY_SHORT_INDICATORS = {
    macd_fast_default: 6,
    macd_slow_default: 18,
    macd_signal_default: 9,
    ema_period: 21,
    ndma_window: 20,
};
// StrategyPanel.jsx – helper
const normalizeBollExit = (exit = {}) => ({
    type: 'bollinger',
    bbMa: exit.bbMa ?? exit.ma ?? 'SMA',
    bbN: exit.bbN ?? exit.n ?? 22,
    bbStd: exit.bbStd ?? exit.std ?? 2,
    bbSide: exit.bbSide ?? exit.side ?? 'upper',
});
export default function StrategyPanel({ setNotice }) {
    const {
        strategies, setStrategies, activeId, setActiveId, active,
        addIndicatorGroup, removeIndicatorGroup, setIndicatorValue,
        setExpr, setExit,
    } = useStrategies();
    const api = useBackendClient();

    /* ---------- İlk açılışta default stratejiler ---------- */
    useEffect(() => {
        if (!strategies || strategies.length === 0) {
            setStrategies(DEFAULT_STRATEGIES.map((s) => ({ ...s })));
            setActiveId("S_A");
        }
    }, [strategies, setStrategies, setActiveId]);

    /* ---------- SETUP ---------- */
    const lastSnap = readLS(SNAP_LAST_KEY);
    const setupDef = readLS(SETUP_DEF_KEY);

    const [q, setQ] = useState(
        () =>
            setupDef?.q || lastSnap?.q || {
                symbol: "ORDIUSDT",
                timeframe: "5m",
                start: "2025-09-01T00:00:00Z",
                end: "202-09-05T00:00:00Z",
            }
    );
    const [sim, setSim] = useState(
        () =>
            setupDef?.sim || lastSnap?.sim || {
                leverage: 1,
                fee_pct: 0,
                slippage_pct: 0,
            }
    );
    const [snapBusy, setSnapBusy] = useState(false);
    const [busy, setBusy] = useState(false);

    const downloadSnapshot = async () => {
        setSnapBusy(true);
        try {
            // Sunucunuzdaki endpoint adını gerekirse değiştirin
            const res = await api.post(
                "/data/snapshot",
                { symbol: q.symbol, timeframe: q.timeframe, start: q.start, end: q.end },
                { timeout: 10 * 60 * 1000 }
            );
            const pack = { id: res?.snapshot_id, rows: res?.rows ?? 0, q, sim };
            localStorage.setItem(SNAP_LAST_KEY, JSON.stringify(pack));
            localStorage.setItem(SETUP_DEF_KEY, JSON.stringify({ q, sim }));
            setNotice?.(`Snapshot OK — id: ${pack.id}, rows: ${pack.rows}`);
        } catch (e) {
            setNotice?.(`Snapshot error: ${e.message || e}`);
        } finally {
            setSnapBusy(false);
        }
    };

    /* ---------- PRESETS / EXPR ---------- */
    const PRESETS =
        STRATEGY_EXPR_PRESETS?.length
            ? STRATEGY_EXPR_PRESETS
            : [{ id: "empty", label: "Empty", code: "" }];

    const [presetId, setPresetId] = useState(PRESETS[0].id);
    const [exprLocal, setExprLocal] = useState(active?.expr || "");
    useEffect(() => setExprLocal(active?.expr || ""), [active?.id]);
    const exit = active?.exit || DEFAULT_EXIT;

    const onApplyExpr = () => {
        if (!active) return;
        setExpr(active.id, exprLocal);
        setNotice?.("Strategy expression updated.");
    };

    const applyPreset = () => {
        if (!active) return;
        const p = PRESETS.find((x) => x.id === presetId);
        if (!p) return setNotice?.("Preset not found.");
        setExprLocal(p.code);
        setExpr(active.id, p.code);
        setNotice?.(`Applied preset: ${p.label}`);
    };
    

    /* ---------- BACKTEST ---------- */
    // StrategyPanel.jsx — REPLACE runBacktest
    // === REPLACE ENTIRE FUNCTION ===
    const runBacktest = async () => {
        if (busy) return;

        // 0) Snapshot kontrolü (app2.js uyumlu)
        const snap = JSON.parse(localStorage.getItem("SNAPSHOT:last") || "null");
        if (!snap?.id) {
            setNotice?.('No cached data – "Download Snapshot".');
            return;
        }

        // 1) Koşulacak stratejileri seç
        const enabled = (strategies || []).filter(s => !!s.enabled);
        if (!enabled.length) {
            setNotice?.("No enabled strategies to backtest.");
            return;
        }

        setBusy(true);
        setNotice?.("");

        try {
            // Ücret & slip (kesir)
            const feeFrac = Number(sim?.fee_pct) / 100;
            const slpFrac = Number(sim?.slippage_pct) / 100;

            // Sonuç havuzları
            const byId = {};          // { [strategyId]: { stats, signals, daily_profits } }
            const statsById = {};
            const signalsById = {};
            const dailyById = {};

            for (const s of enabled) {
                // 2) Expr hazırlığı (aktif için exprLocal'ı kaydet)
                const exprSrc = (s.id === active?.id && exprLocal != null ? exprLocal : s.expr) || "";
                const exprOneLine = String(exprSrc).replace(/\s+/g, " ").trim();
                if (!exprOneLine) throw new Error(`Expression is empty for "${s.name}"`);

                if (s.id === active?.id && exprOneLine !== (active.expr || "")) {
                    setExpr(active.id, exprOneLine);
                }

                // 3) Expr -> param gereksinimleri + indikatör normalizasyonu
                const { uiPatched, indicatorsForCompute, paramsForExpr, addedUi } =
                    ensureParamsForExpr(exprOneLine, s.indicators || {});
                if (addedUi.length) {
                    setStrategies(prev =>
                        prev.map(x => (x.id === s.id ? { ...x, indicators: uiPatched } : x))
                    );
                    // Not: tek stratejide bir kere gösterelim, spam olmasın
                    if (s.id === enabled[0].id) {
                        setNotice?.(`Auto-added params: ${addedUi.join(", ")}`);
                    }
                }
                const indicatorsNormalized = (typeof normalizeIndicatorKeys === "function")
                    ? normalizeIndicatorKeys(indicatorsForCompute)
                    : indicatorsForCompute;

                // 4) Exit şeması (tamamen stratejiye özel)
                const scheme = mapExitToScheme(s.exit);

                // 5) Payload (event-driven, run_with_exit)
                const payload = {
                    symbol: q.symbol,
                    timeframe: q.timeframe,
                    start: q.start,
                    end: q.end,

                    data_snapshot_id: snap.id,
                    exit_scheme: scheme,
                    expr: exprOneLine,

                    fee_pct: Number.isFinite(feeFrac) ? feeFrac : 0,
                    slippage_pct: Number.isFinite(slpFrac) ? slpFrac : 0,
                    leverage: Number(s.leverage ?? sim?.leverage ?? 1),
                    mode: "event",
                    respect_expr_sign: true,
                    side: (s.side === "short" || s.side === -1) ? -1 : 1,

                    indicators: indicatorsNormalized,
                    params: paramsForExpr || {},
                };

                // Debug: TP/SL önizleme
                const toPct = x => (x == null ? null : `${(x * 100).toFixed(2)}%`);
                console.log(
                    `PAYLOAD ${s.name} (${payload.side > 0 ? "Long" : "Short"}) ${scheme?.type || "fixed"}`,
                    payload,
                    { exit_preview: { tp: toPct(scheme?.tp_pct), sl: toPct(scheme?.sl_pct), trail: toPct(scheme?.trail_pct) } }
                );

                // 6) Çağrı
                // StrategyPanel.jsx içindeki runBacktest'in içinde, yanıt alındıktan hemen sonra:
                const raw = await api.post("/backtest/run_with_exit", payload, { timeout: 10 * 60 * 1000 });

                // Her iki olası şekli de destekle: {data:{…}} veya doğrudan {…}
                const res = raw?.data ?? raw;

                // backtest tamamlandıktan sonra:
                const pack = {
                    ts: Date.now(),
                    kind: "backtest",
                    payload: { symbol: q.symbol, timeframe: q.timeframe, start: q.start, end: q.end },
                    data: { signalsById, statsById, dailyById }
                };

                // Eski davranış için son sonucu sakla (opsiyonel)
                localStorage.setItem("RESULTS:last", JSON.stringify(pack));

                // Yeni çoklu- strateji güncellemesi
                window.dispatchEvent(new CustomEvent("results:update-map", {
                    detail: {
                        signalsById,     // { [id]: Signal[] }
                        statsById,       // { [id]: Stats }
                        dailyById,       // { [id]: Daily[] } (opsiyonel)
                        strategies       // [{ id, name, enabled, ... }]
                    }
                }));

                // İsteğe bağlı: sonuç sekmesine geç
                window.dispatchEvent(new CustomEvent("tab:results"));


                const { stats = null, signals = [], daily_profits = [] } = raw?.data ?? raw ?? {};

                
                const daily = Array.isArray(res?.daily_profits) ? res.daily_profits : [];

                statsById[s.id] = stats;
                signalsById[s.id] = signals;
                dailyById[s.id] = daily;

                byId[s.id] = {
                    id: s.id,
                    name: s.name,
                    side: s.side,
                    exit: s.exit,
                    expr: exprOneLine,
                    stats, signals, daily_profits: daily
                };
            }
            const strategiesMap = strategies.map(st => ({
                id: st.id,
                name: st.name,
                enabled: !!st.enabled,
                side: (st.side === "short" || st.side === -1) ? -1 : 1,
            }));

            const pack = {
                ts: Date.now(),
                kind: "backtest",
                payload: { symbol: q.symbol, timeframe: q.timeframe, start: q.start, end: q.end },
                data: { signalsById, statsById, dailyById }
            };
            localStorage.setItem("RESULTS:last", JSON.stringify(pack));

            window.dispatchEvent(new CustomEvent("results:update-map", {
                detail: { signalsById, statsById, dailyById, strategies: strategiesMap }
            }));

            window.dispatchEvent(new CustomEvent("tab:results"));
            // 7) Results payload’ı (tek event ile tümünü ResultsPanel’e gönder)

            const totalTrades = Object.values(signalsById).reduce((a, arr) => a + (arr?.length || 0), 0);
            setNotice?.(totalTrades ? `Backtest OK (${totalTrades} trades across ${enabled.length} strategy)` :
                `Backtest completed. 0 trades across ${enabled.length} strategy.`);
        } catch (e) {
            console.error("❌ Backtest error:", e);
            setNotice?.(`Backtest error: ${e.message || e}`);
        } finally {
            setBusy(false);
        }
    };



    /* ----------------------------- RENDER ----------------------------- */
    return (
        <div className="space-y-6">
            {/* Setup */}
            <div className="card">
                <div className="flex items-center justify-between mb-3">
                    <div className="font-semibold">Setup</div>
                    <div className="text-xs text-gray-400">
                        snapshot: {lastSnap?.id || "-"}{" "}
                        {lastSnap?.rows ? `· bars:${lastSnap.rows}` : ""}
                    </div>
                </div>

                <div className="grid md:grid-cols-4 gap-3">
                    <Labeled label="Symbol">
                        <input
                            className="input mt-1"
                            value={q.symbol}
                            onChange={(e) => setQ({ ...q, symbol: e.target.value })}
                        />
                    </Labeled>
                    <Labeled label="Timeframe">
                        <select
                            className="input mt-1"
                            value={q.timeframe}
                            onChange={(e) => setQ({ ...q, timeframe: e.target.value })}
                        >
                            {["1m", "3m", "5m", "15m", "30m", "1h", "4h", "1d"].map((tf) => (
                                <option key={tf} value={tf}>
                                    {tf}
                                </option>
                            ))}
                        </select>
                    </Labeled>
                    <Labeled label="Start (ISO)">
                        <input
                            className="input mt-1"
                            value={q.start}
                            onChange={(e) => setQ({ ...q, start: e.target.value })}
                        />
                    </Labeled>
                    <Labeled label="End (ISO)">
                        <input
                            className="input mt-1"
                            value={q.end}
                            onChange={(e) => setQ({ ...q, end: e.target.value })}
                        />
                    </Labeled>
                </div>

                <div className="grid md:grid-cols-3 gap-3 mt-3">
                    <Labeled label="Leverage">
                        <input
                            className="input mt-1"
                            type="number"
                            value={sim.leverage}
                            onChange={(e) =>
                                setSim({ ...sim, leverage: Number(e.target.value) })
                            }
                        />
                    </Labeled>
                    <Labeled label="Fee %">
                        <input
                            className="input mt-1"
                            type="number"
                            value={sim.fee_pct}
                            onChange={(e) =>
                                setSim({ ...sim, fee_pct: Number(e.target.value) })
                            }
                        />
                    </Labeled>
                    <Labeled label="Slippage %">
                        <input
                            className="input mt-1"
                            type="number"
                            value={sim.slippage_pct}
                            onChange={(e) =>
                                setSim({ ...sim, slippage_pct: Number(e.target.value) })
                            }
                        />
                    </Labeled>
                </div>

                <div className="flex items-center gap-2 mt-4">
                    <button
                        className="btn-primary"
                        onClick={downloadSnapshot}
                        disabled={snapBusy}
                    >
                        {snapBusy ? "Downloading…" : "Download Snapshot"}
                    </button>
                    <button
                        className="px-3 py-2 rounded border border-gray-700"
                        onClick={() => {
                            localStorage.setItem(SETUP_DEF_KEY, JSON.stringify({ q, sim }));
                            setNotice?.("Setup saved.");
                        }}
                    >
                        Save Setup
                    </button>
                </div>
            </div>

            {/* Strategy Tabs */}
            <div className="flex flex-wrap gap-2">
                {(strategies || []).map((s) => (
                    <button
                        key={s.id}
                        className={`px-3 py-1 rounded ${s.id === activeId ? "bg-blue-600" : "bg-gray-700"
                            }`}
                        onClick={() => setActiveId(s.id)}
                    >
                        {s.name} ({s.side === "short" ? "Short" : "Long"})
                    </button>
                ))}
                {/* quick legacy buttons */}
                <button
                    className="px-2 py-1 rounded border border-gray-700 text-xs"
                    onClick={() =>
                        active &&
                        setStrategies((prev) =>
                            prev.map((s) =>
                                s.id === active.id
                                    ? {
                                        ...s,
                                        side: "long",
                                        expr: LEGACY_LONG_EXPR,
                                        indicators: { ...LEGACY_LONG_INDICATORS },
                                        enabled: s.enabled ?? true,
                                    }
                                    : s
                            )
                        )
                    }
                >
                    Use Legacy A (Long)
                </button>
                <button
                    className="px-2 py-1 rounded border border-gray-700 text-xs"
                    onClick={() =>
                        active &&
                        setStrategies((prev) =>
                            prev.map((s) =>
                                s.id === active.id
                                    ? {
                                        ...s,
                                        side: "short",
                                        expr: LEGACY_SHORT_EXPR,
                                        indicators: { ...LEGACY_SHORT_INDICATORS },
                                        enabled: s.enabled ?? true,
                                    }
                                    : s
                            )
                        )
                    }
                >
                    Use Legacy B (Short)
                </button>
            </div>

            {/* Exit Config */}
            <div className="card">
                <div className="font-semibold mb-3">
                    Stop / Exit Configuration — {active?.name || "-"}
                </div>

                <div className="flex items-center gap-4 mb-3">
                    <label className="inline-flex items-center gap-2 text-sm">
                        <input
                            type="checkbox"
                            checked={!!active?.enabled}
                            onChange={(e) =>
                                active && patchStrategyLocal(active.id, { enabled: e.target.checked }, setStrategies)
                            }
                        />

                        Enabled
                    </label>

                    <div className="flex items-center gap-2 text-sm">
                        <span>Side</span>
                        <select
                            className="input"
                            value={active?.side || "long"}
                            onChange={(e) =>
                                active &&
                                patchStrategy(
                                    active.id,
                                    { side: e.target.value },
                                    { setStrategies }
                                )
                            }
                        >
                            <option value="long">Long</option>
                            <option value="short">Short</option>
                        </select>
                    </div>

                    <button
                        className="px-3 py-1 rounded border border-gray-700"
                        onClick={() => {
                            const id = makeId();
                            const s = {
                                id,
                                name: `Strategy ${strategies.length + 1}`,
                                side: "long",
                                enabled: true,
                                indicators: {},
                                groups: [],
                                expr: "",
                                exit: { ...DEFAULT_EXIT },
                            };
                            setStrategies([...(strategies || []), s]);
                            setActiveId(id);
                        }}
                    >
                        + New
                    </button>

                    {strategies.length > 1 && (
                        <button
                            className="px-3 py-1 rounded bg-red-600"
                            onClick={() =>
                                setStrategies(strategies.filter((x) => x.id !== activeId))
                            }
                        >
                            Remove
                        </button>
                    )}
                </div>

                <div className="grid md:grid-cols-4 gap-3">
                    <Labeled label="Exit Type">
                        <select
                            className="input mt-1"
                            value={exit.type}
                            onChange={(e) => active && setExit(active.id, { type: e.target.value })}
                        >
                            {EXIT_TYPES.map((o) => (
                                <option key={o.id} value={o.id}>
                                    {o.label}
                                </option>
                            ))}
                        </select>
                    </Labeled>

                    <ExitFields exit={exit} onChange={(patch) => active && setExit(active.id, patch)} />

                    <div className="flex items-center gap-4 pt-6">
                        <label className="inline-flex items-center gap-2 text-sm">
                            <input
                                type="checkbox"
                                checked={!!exit.compareVariants}
                                onChange={(e) => active && setExit(active.id, { compareVariants: e.target.checked })}
                            />
                            Compare exit strategies
                        </label>
                        <label className="inline-flex items-center gap-2 text-sm">
                            <input
                                type="checkbox"
                                checked={!!exit.overrideGlobal}
                                onChange={(e) => active && setExit(active.id, { overrideGlobal: e.target.checked })}
                            />
                            Override global TP/SL
                        </label>
                    </div>
                </div>
            </div>

            {/* Expression + Presets */}
            <div className="card">
                <div className="flex items-center justify-between mb-2">
                    <div className="font-semibold">Custom Strategy Expression</div>
                    <div className="flex gap-2">
                        <select
                            className="input"
                            value={presetId}
                            onChange={(e) => setPresetId(e.target.value)}
                        >
                            {PRESETS.map((p) => (
                                <option key={p.id} value={p.id}>
                                    {p.label}
                                </option>
                            ))}
                        </select>
                        <button className="px-3 py-2 rounded border border-gray-700" onClick={applyPreset} disabled={!active}>
                            Use Preset
                        </button>
                        <button className="btn-primary" onClick={onApplyExpr} disabled={!active}>
                            Apply
                        </button>
                    </div>
                </div>

                <textarea
                    className="input w-full min-h-[160px]"
                    value={exprLocal}
                    onChange={(e) => setExprLocal(e.target.value)}
                    disabled={!active}
                />
                <p className="text-xs text-gray-400 mt-2">
                    Tek satır boolean ifade: <code>data['SMA'] &gt; data['EMA']</code> gibi.
                    <code> &amp;</code> ve <code> |</code> kullanın, <code>shift()</code> serbest.
                </p>
            </div>

            {/* Indicators */}
            <div className="card">
                <div className="flex items-center justify-between mb-3">
                    <div className="font-semibold">Indicator Defaults</div>
                    <div className="flex items-center gap-2">
                        <button
                            className="px-2 py-1 rounded border border-gray-700 text-xs"
                            onClick={() => {
                                if (!active) return;
                                const nextGroups = syncGroupsFromIndicators(active.indicators || {});
                                setStrategies((prev) =>
                                    prev.map((s) =>
                                        s.id === active.id ? { ...s, groups: nextGroups } : s
                                    )
                                );
                                setNotice?.("Indicator groups synced from current params.");
                            }}
                            disabled={!active}
                        >
                            Sync Groups
                        </button>
                        <AddIndicator onAdd={(g) => active && addIndicatorGroup(g, active.id)} disabled={!active} />
                    </div>
                </div>

                {active?.groups?.length ? (
                    <div className="space-y-4">
                        {active.groups.map((g) => (
                            <div
                                key={g.id}
                                className="p-3 rounded border border-gray-700 bg-gray-800/40"
                            >
                                <div className="flex items-center justify-between mb-2">
                                    <div className="font-medium">{g.name}</div>
                                    <button
                                        className="px-2 py-1 rounded bg-red-600 text-sm"
                                        onClick={() => removeIndicatorGroup(g.id, active.id)}
                                    >
                                        Remove
                                    </button>
                                </div>
                                <div className="grid md:grid-cols-3 gap-3">
                                    {g.params.map((k) => (
                                        <Labeled key={k} label={k}>
                                            <input
                                                className="input mt-1"
                                                type="number"
                                                value={active?.indicators?.[k] ?? ""}
                                                onChange={(e) =>
                                                    setIndicatorValue(active.id, k, Number(e.target.value))
                                                }
                                            />
                                        </Labeled>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                ) : Object.keys(active?.indicators || {}).length ? (
                    <div className="grid md:grid-cols-3 gap-3">
                        {Object.entries(active.indicators).map(([k, v]) => (
                            <Labeled key={k} label={k}>
                                <input
                                    className="input mt-1"
                                    type="number"
                                    value={v ?? ""}
                                    onChange={(e) =>
                                        setIndicatorValue(active.id, k, Number(e.target.value))
                                    }
                                />
                            </Labeled>
                        ))}
                    </div>
                ) : (
                    <div className="text-xs text-gray-400">
                        No indicators yet. Add from the catalog or press “Sync Groups”.
                    </div>
                )}
            </div>

            {/* Run */}
            <div>
                <button
                    className="px-4 py-2 rounded bg-emerald-600 disabled:opacity-60"
                    onClick={runBacktest}
                    disabled={!active || busy}
                >
                    {busy ? "Running…" : "Run Backtest"}
                </button>
            </div>
        </div>
    );
}

/* =================== Alt bileşenler / yardımcılar =================== */

function ExitFields({ exit, onChange }) {
    const type = exit?.type || "fixed_pct";
    if (type === "fixed_pct") {
        return (
            <>
                <Labeled label="Take Profit (%)">
                    <input
                        className="input mt-1"
                        type="number"
                        value={exit.tp ?? 1}
                        onChange={(e) => onChange({ tp: Number(e.target.value) })}
                    />
                </Labeled>
                <Labeled label="Stop Loss (%)">
                    <input
                        className="input mt-1"
                        type="number"
                        value={exit.sl ?? 2}
                        onChange={(e) => onChange({ sl: Number(e.target.value) })}
                    />
                </Labeled>
            </>
        );
    }
    if (type === "atr") {
        return (
            <>
                <Labeled label="ATR n">
                    <input
                        className="input mt-1"
                        type="number"
                        value={exit.atr_n ?? 14}
                        onChange={(e) => onChange({ atr_n: Number(e.target.value) })}
                    />
                </Labeled>
                <Labeled label="k (SL)">
                    <input
                        className="input mt-1"
                        type="number"
                        value={exit.k_sl ?? 1.5}
                        onChange={(e) => onChange({ k_sl: Number(e.target.value) })}
                    />
                </Labeled>
                <Labeled label="m (TP)">
                    <input
                        className="input mt-1"
                        type="number"
                        value={exit.m_tp ?? 2.0}
                        onChange={(e) => onChange({ m_tp: Number(e.target.value) })}
                    />
                </Labeled>
            </>
        );
    }
    if (type === "chandelier") {
        return (
            <>
                <Labeled label="n">
                    <input
                        className="input mt-1"
                        type="number"
                        value={exit.n ?? 22}
                        onChange={(e) => onChange({ n: Number(e.target.value) })}
                    />
                </Labeled>
                <Labeled label="factor">
                    <input
                        className="input mt-1"
                        type="number"
                        value={exit.factor ?? 3}
                        onChange={(e) => onChange({ factor: Number(e.target.value) })}
                    />
                </Labeled>
            </>
        );
    }
    const isBoll = type === 'boll' || type === 'bollinger';
    const boll = isBoll ? normalizeBollExit(exit) : null;

    if (isBoll) {
        return (
            <>
                <Labeled label="MA Type">
                    <select
                        className="input mt-1"
                        value={boll.bbMa}
                        onChange={(e) => onChange({ type: 'bollinger', bbMa: e.target.value })}
                    >
                        <option value="SMA">SMA</option>
                        <option value="EMA">EMA</option>
                    </select>
                </Labeled>

                <Labeled label="Period (n)">
                    <input
                        className="input mt-1"
                        type="number"
                        min={1}
                        value={boll.bbN}
                        onChange={(e) => onChange({ type: 'bollinger', bbN: Number(e.target.value) })}
                    />
                </Labeled>

                <Labeled label="Std Dev">
                    <input
                        className="input mt-1"
                        type="number"
                        step="0.1"
                        min="0"
                        value={boll.bbStd}
                        onChange={(e) => onChange({ type: 'bollinger', bbStd: Number(e.target.value) })}
                    />
                </Labeled>

                <Labeled label="Band Side">
                    <select
                        className="input mt-1"
                        value={boll.bbSide}
                        onChange={(e) => onChange({ type: 'bollinger', bbSide: e.target.value })}
                    >
                        <option value="upper">Upper</option>
                        <option value="lower">Lower</option>
                        <option value="mid">Mid</option>
                    </select>
                </Labeled>
            </>
        );
    }
    if (type === "trailing_pct") {
        return (
            <Labeled label="Trail (%)">
                <input
                    className="input mt-1"
                    type="number"
                    value={exit.trail_pct ?? 1}
                    onChange={(e) => onChange({ trail_pct: Number(e.target.value) })}
                />
            </Labeled>
        );
    }
    return null;
}

function AddIndicator({ onAdd, disabled }) {
    const [sel, setSel] = useState(DEFAULT_IND_CATALOG[0]?.id || "");
    const group = useMemo(
        () => DEFAULT_IND_CATALOG.find((x) => x.id === sel),
        [sel]
    );
    return (
        <div className="flex items-center gap-2">
            <select
                className="input"
                value={sel}
                onChange={(e) => setSel(e.target.value)}
                disabled={disabled}
            >
                {DEFAULT_IND_CATALOG.map((g) => (
                    <option key={g.id} value={g.id}>
                        {g.name}
                    </option>
                ))}
            </select>
            <button
                className="btn-primary"
                onClick={() => group && onAdd?.(group)}
                disabled={disabled}
            >
                + Add Indicator
            </button>
        </div>
    );
}

/* ---- Helpers ---- */
function Labeled({ label, children }) {
    return (
        <label className="text-sm block">
            <div className="text-gray-300">{label}</div>
            {children}
        </label>
    );
}
/* ================= Helpers (single source of truth) ================ */
function readLS(k) {
    try { const s = localStorage.getItem(k); return s ? JSON.parse(s) : null; } catch { return null; }
}
function makeId() {
    return "S_" + Math.random().toString(36).slice(2, 10);
}
function patchStrategyLocal(id, partial, setStrategies) {
    setStrategies(prev => prev.map(s => (s.id === id ? { ...s, ...partial } : s)));
}
/* Exit şemasını BE formatına çevir — tek TANIM bırak! */
function mapExitToScheme(exitObj = {}) {
    const pct = (x) => {
        const n = Number(String(x ?? 0).replace(",", "."));
        return Number.isFinite(n) ? n / 100 : 0;
    };
    const t = exitObj.type || "fixed";

    if (t === "fixed" || t === "fixed_pct") {
        return { type: "fixed", tp_pct: pct(exitObj.tp ?? exitObj.tpPct ?? 1), sl_pct: pct(exitObj.sl ?? exitObj.slPct ?? 2) };
    }
    if (t === "atr") {
        return {
            type: "atr",
            atr_n: Number(exitObj.atr_n ?? exitObj.atrN ?? 14),
            k_sl: Number(exitObj.k_sl ?? exitObj.kSL ?? 2.0),
            m_tp: Number(exitObj.m_tp ?? exitObj.mTP ?? 2.0),
        };
    }
    if (t === "chandelier") {
        return { type: "chandelier", n: Number(exitObj.n ?? exitObj.chN ?? 22), factor: Number(exitObj.factor ?? exitObj.chK ?? 3.0) };
    }
    if (t === "boll" || t === "bollinger") {
        return {
            type: "bollinger",
            ma: (exitObj.ma ?? exitObj.bbMa ?? "SMA"),
            n: Number(exitObj.n ?? exitObj.bbN ?? 20),
            std: Number(exitObj.std ?? exitObj.bbStd ?? 2.0),
            side: exitObj.side ?? exitObj.bbSide ?? "upper",
        };
    }
    if (t === "trailing_pct") {
        return { type: "trailing_pct", trail_pct: pct(exitObj.trail_pct ?? exitObj.trailPct ?? 1) };
    }
    // default → fixed %1/%2
    return { type: "fixed", tp_pct: 0.01, sl_pct: 0.02 };
}

/* Expr -> gerekli paramlar (UI ve BE isimleri) — tek TANIM bırak! */
function ensureParamsForExpr(expr = "", indicators = {}) {
    const raw = (expr || "").replace(/\s+/g, " ");
    const ex = raw.toLowerCase();
    const has = (name) => new RegExp(`\\bdata\\[[\\"\\']${name}[\\"\\']\\]`).test(ex);

    const ui = { ...(indicators || {}) };
    const addedUi = [];
    const addUI = (k, v) => { if (ui[k] == null) { ui[k] = v; addedUi.push(k); } };

    if (has("hist")) { addUI("macd_fast_default", 12); addUI("macd_slow_default", 26); addUI("macd_signal_default", 9); }
    if (has("bb_lo") || has("bb_up")) { addUI("bb_period", 20); addUI("bb_std", 2); }
    if (has("sma")) addUI("sma_period", 21);
    if (has("ema")) addUI("ema_period", 21);
    if (has("rsi_diff")) { addUI("rsi_short", 10); addUI("rsi_long", 60); }
    if (has("ndma")) addUI("ndma_window", 20);

    const indicatorsForCompute = {};
    for (const k of [
        "bb_period", "bb_std",
        "macd_fast_default", "macd_slow_default", "macd_signal_default",
        "sma_period", "ema_period", "rsi_short", "rsi_long", "ndma_window",
    ]) {
        if (ui[k] != null) indicatorsForCompute[k] = ui[k];
    }
    const paramsForExpr = { ...ui };

    return { uiPatched: ui, indicatorsForCompute, paramsForExpr, addedUi };
}

/* Catalog’a göre mevcut indicatorlardan grup çıkarımı — tek TANIM bırak! */
function syncGroupsFromIndicators(indicators = {}) {
    const have = new Set(Object.keys(indicators || {}));
    const groups = [];
    (window.DEFAULT_IND_CATALOG || []).forEach(cat => {
        const keys = (cat.params || []).map(p => (typeof p === "string" ? p : p.key));
        if (keys.some(k => have.has(k))) groups.push({ id: cat.id, name: cat.name, params: keys });
    });
    return groups;
}
