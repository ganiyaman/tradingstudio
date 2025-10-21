/* eslint-disable */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useStrategies } from "../../hooks/useStrategies";

/* =========================================================
   Helpers
   ========================================================= */
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const deepClone = (x) => JSON.parse(JSON.stringify(x));
const asNum = (v) => (v === "" || v == null ? undefined : Number(v));
const asPctNumber = (v) => (v == null || v === "" ? 0 : Number(v));

// API base: env → window → fallback (mutlak, /api öneki yok)
const RAW_BASE =
    (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_API_BASE) ||
    (typeof window !== "undefined" && window.__API_BASE__) ||
    "http://127.0.0.1:8000";
const API_BASE = String(RAW_BASE).replace(/\/$/, "");
const api = (path) => `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;

// Exit scheme (StrategyPanel ile aynı mantık)
const buildExitSchemeFromStrategy = (s) => {
    const ec = s?.exit || s?.exitConfig || {};
    const t = ec.type || "fixed_pct";
    if (t === "fixed" || t === "fixed_pct") {
        return {
            type: "fixed",
            tp_pct: Number(ec.tp ?? ec.tpPct ?? 1) / 100,
            sl_pct: Number(ec.sl ?? ec.slPct ?? 2) / 100,
        };
    }
    if (t === "atr")
        return {
            type: "atr",
            atr_n: Number(ec.atr_n ?? 14),
            k_sl: Number(ec.k_sl ?? 1.5),
            m_tp: Number(ec.m_tp ?? 2.0),
        };
    if (t === "chandelier")
        return { type: "chandelier", n: Number(ec.n ?? 22), factor: Number(ec.factor ?? 3) };
    if (t === "trailing_pct")
        return { type: "trailing_pct", trail_pct: Number(ec.trail_pct ?? 1) / 100 };
    if (t === "boll" || t === "bollinger")
        return {
            type: "bollinger",
            ma: ec.bbMa || ec.ma || "SMA",
            n: Number(ec.bbN ?? ec.n ?? 20),
            std: Number(ec.bbStd ?? ec.std ?? 2),
            side: ec.bbSide || ec.side || "upper",
        };
    return { type: "fixed", tp_pct: 0.01, sl_pct: 0.02 };
};

// Strategy üstünde doğrudan exprOutputs varsa kullan
const exprOutputKeysFromStrategy = (s) => {
    if (!s) return [];
    if (Array.isArray(s.exprOutputs)) return [...s.exprOutputs];
    if (s.exprOutputs && typeof s.exprOutputs === "object") return Object.keys(s.exprOutputs);
    const alt = s.expr_output_keys || s.expr_outputs || s.exproutputs || s.outputs;
    if (Array.isArray(alt)) return [...alt];
    if (alt && typeof alt === "object") return Object.keys(alt);
    return [];
};

// Gruplardan çıkan suffix’leri stratejinin indicator key’lerine göre bul
function suffixesForGroup(group, indicators) {
    const params = Array.isArray(group?.params)
        ? group.params.map((p) => (typeof p === "string" ? p : p?.key)).filter(Boolean)
        : [];
    const have = Object.keys(indicators || {});
    const sufs = new Set();
    for (const base of params) {
        const re = new RegExp(`^${base}(\\d*)$`);
        for (const k of have) {
            const m = re.exec(k);
            if (m) sufs.add(m[1] || "");
        }
    }
    return Array.from(sufs).sort((a, b) => (a === "" ? -1 : b === "" ? 1 : Number(a) - Number(b)));
}
// -- Setup & Results'tan q (symbol/timeframe/start/end) okuma yardımcıları --
function readJSON(key, def = null) {
    try { return JSON.parse(localStorage.getItem(key) || "null") ?? def; } catch { return def; }
}

// Öncelik: RESULTS:last.payload → SNAPSHOT:last.q → SETUP:def.q
function readQFromStorage() {
    const resPack = readJSON("RESULTS:last");
    const snapPack = readJSON("SNAPSHOT:last");   // SetupCard ve StrategyPanel kaydediyor
    const setupDef = readJSON("SETUP:def");       // SetupCard “Save Setup” ile kaydediyor

    const fromResults = resPack?.payload && resPack.payload.symbol && resPack.payload.timeframe
        ? resPack.payload
        : null;
    const fromSnap = snapPack?.q && snapPack.q.symbol && snapPack.q.timeframe
        ? snapPack.q
        : null;
    const fromSetup = setupDef?.q && setupDef.q.symbol && setupDef.q.timeframe
        ? setupDef.q
        : null;

    return fromResults || fromSnap || fromSetup || null;
}

// Maliyetleri de aynı şekilde oku (StrategyPanel ve SetupCard ile tutarlı)
function readSimFromStorage() {
    return readJSON("SIM:costs") || { leverage: 1, fee_pct: 0, slippage_pct: 0 };
}

// Aktif strateji + (varsa) colStats ile outcome listesi
function outputsFromActiveStrategy(active, colStats) {
    if (!active) return [];
    const outs = new Set();
    const groups = Array.isArray(active.groups) ? active.groups : [];
    const indicators = active.indicators || {};
    const hasColStats =
        colStats && typeof colStats === "object" && Object.keys(colStats).length > 0;

    for (const g of groups) {
        const exprOuts = Array.isArray(g?.exprOutputs) ? g.exprOutputs : [];
        if (!exprOuts.length) continue;
        const sufs = suffixesForGroup(g, indicators); // "", "1", "2"...
        for (const suf of sufs) {
            for (const base of exprOuts) {
                const key = suf ? `${base}${suf}` : base;
                if (!hasColStats || (hasColStats && Object.prototype.hasOwnProperty.call(colStats, key)))
                    outs.add(key);
            }
        }
    }
    return Array.from(outs);
}
// --- API hata metni normalizer ---
function msgFromDetail(detail) {
    if (detail == null) return "";
    if (typeof detail === "string") return detail;

    // Pydantic / FastAPI 422 formatı: [{loc, msg, type}, ...]
    if (Array.isArray(detail)) {
        const parts = detail.map(d => {
            if (typeof d === "string") return d;
            if (!d || typeof d !== "object") return String(d);
            // en okunaklısı:
            if (d.msg && d.loc) return `${d.msg} @ ${Array.isArray(d.loc) ? d.loc.join(".") : d.loc}`;
            if (d.msg) return String(d.msg);
            return JSON.stringify(d);
        });
        return parts.join(" | ");
    }

    // {detail: "..."} gibi nested objeler
    if (typeof detail === "object") {
        if (detail.message) return String(detail.message);
        if (detail.msg) return String(detail.msg);
        if (detail.detail) return msgFromDetail(detail.detail);
        try {
            return JSON.stringify(detail);
        } catch {
            return String(detail);
        }
    }
    return String(detail);
}

function normalizeApiErrorBody(body, status) {
    const detail = body?.detail ?? body;
    const msg = msgFromDetail(detail);
    return msg || `Request failed (${status})`;
}

// intervals -> tek satırlık rule expr + $param'lar
function buildRulesAndParams(intervals = {}, enabledKeys = new Set()) {
    const parts = [];
    const params = {};
    for (const [k, iv] of Object.entries(intervals)) {
        if (!enabledKeys.has(k)) continue;
        const pmin = `flt_${k}_min`;
        const pmax = `flt_${k}_max`;
        const hasMin = iv?.min !== undefined && iv?.min !== null;
        const hasMax = iv?.max !== undefined && iv?.max !== null;

        if (hasMin && hasMax) {
            parts.push(`(data['${k}'] >= $${pmin}) & (data['${k}'] <= $${pmax})`);
            params[pmin] = Number(iv.min);
            params[pmax] = Number(iv.max);
        } else if (hasMin) {
            parts.push(`(data['${k}'] >= $${pmin})`);
            params[pmin] = Number(iv.min);
        } else if (hasMax) {
            parts.push(`(data['${k}'] <= $${pmax})`);
            params[pmax] = Number(iv.max);
        }
    }
    return { ruleExpr: parts.join(" & "), params };
}
// Finite olmayan sayıları ve undefined'ları temizle
function isFiniteNumber(x) { return typeof x === "number" && Number.isFinite(x); }
function sanitizePlain(obj) {
    const out = {};
    for (const [k, v] of Object.entries(obj || {})) {
        if (v === undefined) continue;                   // undefined -> at
        if (typeof v === "number" && !Number.isFinite(v)) continue; // NaN/Inf -> at
        out[k] = v;
    }
    return out;
}
function sanitizeParams(params) {
    const out = {};
    for (const [k, v] of Object.entries(params || {})) {
        const num = typeof v === "string" ? Number(v) : v;
        if (isFiniteNumber(num)) out[k] = num;
        // string ama sayı değilse, Pydantic 422 verir; o yüzden atıyoruz.
    }
    return out;
}

// StrategyPanel ile aynı motoru kullanarak hızlı doğrulama backtest'i
async function runQuickBacktest(activeStrat, combinedExpr, extraParams) {
    const snap = JSON.parse(localStorage.getItem("SNAPSHOT:last") || "null");
    const costs = (() => { try { return JSON.parse(localStorage.getItem("SIM:costs") || "null") || {}; } catch { return {}; } })();

    const side = (activeStrat?.side === "short" || activeStrat?.side === -1) ? -1 : 1;
    const exitScheme = buildExitSchemeFromStrategy(activeStrat);

    // params: sadece finite sayılar
    const paramsClean = sanitizeParams({ ...(activeStrat?.extraParams || {}), ...(extraParams || {}) });

    const rawPayload = {
        symbol: activeStrat?.symbol,
        timeframe: activeStrat?.timeframe,
        start: activeStrat?.start,
        end: activeStrat?.end,
        data_snapshot_id: snap?.id || activeStrat?.dataSnapshotId || activeStrat?.snapshotId || null,
        exit_scheme: exitScheme,
        expr: String(combinedExpr || activeStrat?.expr || "").replace(/\s+/g, " ").trim(),
        fee_pct: Number.isFinite(costs?.fee_pct) ? costs.fee_pct : Number(activeStrat?.feePct ?? 0),
        slippage_pct: Number.isFinite(costs?.slippage_pct) ? costs.slippage_pct : Number(activeStrat?.slipPct ?? 0),
        leverage: Number(activeStrat?.leverage ?? 1) || 1,
        mode: "event",
        respect_expr_sign: true,
        side,
        indicators: { ...(activeStrat?.indicators || {}) },
        params: paramsClean,
    };

    // NaN/Inf/undefined temizliği:
    const payload = {
        ...sanitizePlain(rawPayload),
        indicators: sanitizePlain(rawPayload.indicators),
        params: paramsClean, // zaten sanitize edildi
    };

    // Eğer zorunlu alanlardan biri boşsa anlamlı hata verelim
    const reqKeys = ["symbol", "timeframe", "start", "end", "expr", "exit_scheme", "side", "leverage", "fee_pct", "slippage_pct"];
    for (const k of reqKeys) {
        if (payload[k] === undefined || payload[k] === null || payload[k] === "") {
            throw new Error(`Eksik alan: ${k}. Setup/Strategy seçimlerini kontrol edin.`);
        }
    }

    const res = await fetch(api("/backtest/run_with_exit"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
        // 422 sebebini net göster
        const msg = (j && (j.detail || j.message)) ? JSON.stringify(j.detail || j.message) : `quick backtest failed (${res.status})`;
        throw new Error(msg);
    }
    return j;
}


/* =========================================================
   Component
   ========================================================= */
export default function FiltersPanel({ setNotice }) {
    const { strategies = [], activeId, setActiveId, active, setStrategies } =
        useStrategies() || {};
    const safeActiveId = useMemo(
        () => activeId || strategies[0]?.id || null,
        [activeId, strategies]
    );
    const activeStrat = useMemo(
        () => strategies.find((s) => s.id === safeActiveId) || active || null,
        [strategies, safeActiveId, active]
    );

    // ---------- local state ----------
    const [filtersLocal, setFiltersLocal] = useState([]); // [{key, enabled, min, max}]
    const [pristineFilters, setPristineFilters] = useState([]); // Reset baz hâli (min/max boş)
    const [filterCoverage, setFilterCoverage] = useState(70); // UI: %
    const [filterMethod, setFilterMethod] = useState("random");
    const [algoParams, setAlgoParams] = useState({ samples: 12000 });
    const [filterSuggest, setFilterSuggest] = useState(null);
    const [suggestCache, setSuggestCache] = useState({}); // { [strategyId]: suggestionObj }
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState("");
    const [outputKeys, setOutputKeys] = useState([]);

    // Sekmeler
    const Tabs = () => (
        <div className="flex gap-2 mb-3">
            {strategies.map((s) => (
                <button
                    key={s.id}
                    onClick={() => setActiveId && setActiveId(s.id)}
                    className={`px-3 py-1.5 rounded text-sm border ${s.id === safeActiveId
                            ? "bg-blue-600 border-blue-500"
                            : "bg-gray-800 border-gray-700 hover:bg-gray-700"
                        }`}
                    disabled={busy}
                >
                    {s.name || "Strategy"}{" "}
                    {String(s.side).toLowerCase() === "short" || s.side === -1
                        ? "(Short)"
                        : "(Long)"}
                </button>
            ))}
        </div>
    );

    // Backend’den col_stats çek (varsa snapshot veya gerekli alanlar)
    async function fetchColStatsForStrategy(s) {
        const snapshotId =
            s?.dataSnapshotId ||
            s?.snapshotId ||
            (typeof window !== "undefined" &&
                (window.__DATA_SNAPSHOT_ID__ || window.__SNAPSHOT_ID__)) ||
            null;

        if (!snapshotId && !(s?.symbol && s?.timeframe && s?.start && s?.end))
            return null;

        const payload = {
            data_snapshot_id: snapshotId,
            symbol: s.symbol || null,
            timeframe: s.timeframe || "5m",
            start: s.start || null,
            end: s.end || null,
            indicators: { ...(s.indicators || {}) },
        };

        const res = await fetch(api("/data/col_stats"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });

        let j = null;
        try {
            j = await res.json();
        } catch { }
        if (!res.ok) throw new Error(j?.detail || `col_stats failed (${res.status})`);
        return j?.col_stats || null;
    }

    // Aktif strateji değişince outcome listesini ve filtreleri hazırla
    useEffect(() => {
        (async () => {
            if (!activeStrat) {
                setOutputKeys([]);
                setFiltersLocal([]);
                return;
            }
            setErr("");
            
            const fromCache = suggestCache[safeActiveId] || null;
            const fromStrategy = activeStrat?.filtersSuggest || null;
            let fromStorage = null;
            try {
                fromStorage = JSON.parse(localStorage.getItem(`FILTERS:suggest:${safeActiveId}`) || "null");
            } catch { }
            setFilterSuggest(fromCache || fromStrategy || fromStorage || null);


            // 1) Strategy üstü exprOutputs
            let keys = exprOutputKeysFromStrategy(activeStrat);

            // 2) Gruplar + (varsa) col_stats
            let stats = null;
            try {
                stats = await fetchColStatsForStrategy(activeStrat);
            } catch {
                // yut, UI çalışsın
            }
            if (!keys.length) keys = outputsFromActiveStrategy(activeStrat, stats || null);

            if (!keys.length) {
                setOutputKeys([]);
                setFiltersLocal([]);
                setPristineFilters([]);
                setErr(
                    "Bu strateji için exprOutputs bulunamadı. Snapshot/Backtest sonrası tekrar deneyin."
                );
                return;
            }

            const uniq = Array.from(new Set(keys)).filter(Boolean);
            setOutputKeys(uniq);

            // — Varsayılan/başlangıç (pristine) set: tüm outcome'lar, enabled=true, min/max boş
            const defaultRows = uniq.map((k) => ({
                key: k,
                enabled: true,
                min: "",
                max: "",
            }));

            // Eğer stratejide kayıtlı filtreler varsa onları kullan; yoksa default
            const arr = activeStrat?.filters?.length
                ? deepClone(activeStrat.filters)
                : defaultRows;

            setFiltersLocal(arr);
            setPristineFilters(defaultRows); // RESET her zaman min/max boş olan ilk hâle dönecek

            setFilterCoverage(clamp(Number(activeStrat?.minCoveragePct ?? 70), 5, 95));
            setFilterMethod(String(activeStrat?.filterMethod || "random"));
            setAlgoParams(activeStrat?.filterMethodParams || { samples: 12000 });
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        safeActiveId,
        JSON.stringify(activeStrat?.groups || null),
        JSON.stringify(activeStrat?.indicators || null),
        JSON.stringify(activeStrat?.exprOutputs || null),
    ]);

    // Store’a filtreleri yaz (flicker guard)
    const lastSavedRef = useRef("");
    useEffect(() => {
        const json = JSON.stringify(filtersLocal);
        if (json !== lastSavedRef.current && safeActiveId) {
            lastSavedRef.current = json;
            setStrategies?.((prev) =>
                prev.map((s) =>
                    s.id === safeActiveId ? { ...s, filters: filtersLocal } : s
                )
            );
        }
    }, [filtersLocal, safeActiveId, setStrategies]);

    const updateFilter = (i, patch) =>
        setFiltersLocal((prev) =>
            prev.map((f, idx) => (idx === i ? { ...f, ...patch } : f))
        );
    const removeFilter = (i) =>
        setFiltersLocal((prev) => prev.filter((_, idx) => idx !== i));

    // RESET — suggest ile yazılmış min/max’lar dahil her şey sıfır (pristine’e dön)
    const handleResetFilters = () => {
        setFiltersLocal(deepClone(pristineFilters || [])); // min/max boş, enabled=true
        setFilterCoverage(70);
        setFilterMethod("random");
        setAlgoParams({ samples: 12000 });
        setFilterSuggest(null);
        setSuggestCache(prev => ({ ...prev, [safeActiveId]: null }));
        setStrategies?.(prev =>
            prev.map(st => (st.id === safeActiveId ? { ...st, filtersSuggest: null } : st))
        );
        try {
            localStorage.removeItem(`FILTERS:suggest:${safeActiveId}`);
        } catch { }

        setErr("");
        setNotice?.("Filtreler başlangıç durumuna alındı.");
    };

    // SUGGEST — YALNIZCA ENABLED outcome’lar optimize edilir + quick backtest doğrulaması
    const suggestFilters = async () => {
        try {
            setBusy(true);
            setErr("");
            setFilterSuggest(null);
            const s = activeStrat;
            if (!s) throw new Error("Aktif strateji bulunamadı.");

            const exitScheme = buildExitSchemeFromStrategy(s);
            const tp = Number(exitScheme?.tp_pct ?? 0);
            const sl = Number(exitScheme?.sl_pct ?? 0);

            const include = (filtersLocal || [])
                .filter(f => f.enabled && f.key)
                .map(f => f.key);
            const q = readQFromStorage();
            if (!q?.symbol || !q?.timeframe || !q?.start || !q?.end) {
                throw new Error("Setup eksik: symbol/timeframe/start/end bulunamadı. Setup’ta doldurup 'Download Snapshot' çalıştırın veya en az bir backtest koşun.");
            }
            const sim = readSimFromStorage();


            const payload = {
                data_snapshot_id:
                    s?.dataSnapshotId ||
                    s?.snapshotId ||
                    (typeof window !== "undefined" && (window.__DATA_SNAPSHOT_ID__ || window.__SNAPSHOT_ID__)) ||
                    null,
                symbol: q.symbol,                    // <-- q'dan
                timeframe: q.timeframe,              // <-- q'dan
                start: q.start,                      // <-- q'dan
                end: q.end,                          // <-- q'dan
                side: (s.side === "short" || s.side === -1) ? -1 : 1,
                tp, sl,
                expr: s.expr,
                params: { ...(s.extraParams || {}) },
                indicators: { ...(s.indicators || {}) },
                exit_scheme: exitScheme,
                leverage: Number(s.leverage ?? sim?.leverage ?? 1),
                fee_pct: Number(sim?.fee_pct ?? s.feePct ?? 0),
                slippage_pct: Number(sim?.slippage_pct ?? s.slipPct ?? s.slippage_pct ?? 0),
                include,
                topk: 8,
                min_cov: Number(filterCoverage) / 100,
                method: filterMethod,
                method_params: { ...(algoParams || {}) },
            };


            
            const res = await fetch(api("/filters/suggest"), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            let j = await res.json().catch(() => ({}));
            if (!res.ok) {
                const emsg = normalizeApiErrorBody(j, res.status) || `filters_suggest failed (${res.status})`;
                throw new Error(emsg);
            }


            const cov = Number(j?.coverage ?? j?.best?.metrics?.coverage ?? j?.metrics?.coverage);
            if (Number.isFinite(cov) && cov < Number(filterCoverage) / 100) {
                setNotice?.(
                    `Coverage ${(cov * 100).toFixed(1)}% < Min ${filterCoverage.toFixed(0)}%. Sonuç uygulanmadı.`
                );
                setBusy(false);
                return;
            }

            if (j?.best?.intervals) {
                // Yalnız ENABLED satırlara min/max uygula; yeni satır ekleme
                setFiltersLocal((prev) => {
                    const enabledSet = new Set(include);
                    return prev.map((row) => {
                        if (!enabledSet.has(row.key)) return row; // disabled → dokunma
                        const iv = j.best.intervals[row.key];
                        if (!iv) return row;
                        return {
                            ...row,
                            enabled: true,
                            min: asNum(iv.min),
                            max: asNum(iv.max),
                        };
                    });
                });
            }

            // ---- Quick Backtest ile DOĞRULA ----
            const enabledSet = new Set(include);
            const { ruleExpr, params } = buildRulesAndParams(j?.best?.intervals || {}, enabledSet);
            const combinedExpr = ruleExpr ? `(${activeStrat?.expr || ""}) & (${ruleExpr})` : (activeStrat?.expr || "");

            // ↓ ekle
            const paramsClean = sanitizeParams(params);

            let verifiedStats = null;
            let verifiedTrades = null;
            let verifyError = null;
            try {
                const verified = await runQuickBacktest(activeStrat, combinedExpr, params);
                verifiedStats = verified?.stats || null;
                verifiedTrades = Array.isArray(verified?.signals)
                    ? verified.signals.length
                    : null;
            } catch (e) {
                verifyError = String(e?.message || e);
            }

            const jWithVerification = {
                ...j,
                rules: ruleExpr ? [ruleExpr] : [],
                combined_expr: combinedExpr,
                metrics_verified: verifiedStats,
                verified_trades: verifiedTrades,
                verify_error: verifyError,
            };

            setFilterSuggest(jWithVerification);
            setSuggestCache(prev => ({ ...prev, [safeActiveId]: jWithVerification }));
            // Strateji objesine de yaz (sekme değişse de kalsın)
            setStrategies?.(prev =>
                prev.map(st =>
                    st.id === safeActiveId ? { ...st, filtersSuggest: jWithVerification } : st
                )
            );
            // LocalStorage yedeği (komponent tamamen unmount olsa da kalsın)
            try {
                localStorage.setItem(`FILTERS:suggest:${safeActiveId}`, JSON.stringify(jWithVerification));
            } catch { }


            setNotice?.("Suggestion tamamlandı.");
        } catch (e) {
            const emsg = e?.message ? String(e.message) : msgFromDetail(e);
            setErr(emsg);
            setNotice?.(emsg);
        } finally {

            setBusy(false);
        }
    };

    // APPLY — yalnız ENABLED satırlardan expr kuralı üret + $flt_* yaz
    const applyFiltersToExpr = () => {
        const s = activeStrat;
        if (!s) return;

        const enabledRows = (filtersLocal || []).filter(
            (f) => f.enabled && f.key && (f.min !== "" || f.max !== "")
        );
        if (!enabledRows.length) {
            setNotice?.("Etkin outcome filtresi yok.");
            return;
        }

        // UI’daki satırlardan intervals derle
        const intervals = {};
        for (const r of enabledRows) {
            intervals[r.key] = { min: asNum(r.min), max: asNum(r.max) };
        }

        // rules & params üret
        const { ruleExpr, params } = buildRulesAndParams(
            intervals,
            new Set(enabledRows.map((r) => r.key))
        );

        const extra = ruleExpr;
        const nextExpr = extra ? `(${s.expr}) & (${extra})` : s.expr;
        const nextParams = { ...(s.extraParams || {}), ...(params || {}) };

        setStrategies?.((prev) =>
            prev.map((x) =>
                x.id === safeActiveId
                    ? {
                        ...x,
                        expr: nextExpr,
                        extraParams: nextParams,
                        filters: filtersLocal,
                        minCoveragePct: filterCoverage,
                        filterMethod,
                        filterMethodParams: algoParams,
                    }
                    : x
            )
        );
        setNotice?.("Filtreler stratejiye uygulandı.");
    };

    if (!safeActiveId) {
        return (
            <div className="p-4 rounded-md bg-yellow-900/30 border border-yellow-700 text-yellow-100 text-sm">
                Hiç strateji yok. Strategy sekmesinden bir strateji ekleyin.
            </div>
        );
    }

    const headerTitle = `${activeStrat?.name || ""}${String(activeStrat?.side).toLowerCase() === "short" || activeStrat?.side === -1
            ? " (Short)"
            : " (Long)"
        }`;

    return (
        <div className="space-y-6">
            {/* Strategy tabs */}
            <Tabs />

            <div className="p-4 rounded-xl bg-gray-800/60 border border-gray-700/50">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-base font-semibold">Filters for: {headerTitle}</h3>
                    <div className="flex gap-2">
                        <button
                            onClick={handleResetFilters}
                            disabled={busy}
                            className="px-3 py-1.5 rounded bg-gray-600 hover:bg-gray-500 disabled:opacity-50 text-sm"
                        >
                            Reset
                        </button>
                        <button
                            onClick={suggestFilters}
                            disabled={busy}
                            className="px-3 py-1.5 rounded bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-sm"
                        >
                            Suggest
                        </button>
                        <button
                            onClick={applyFiltersToExpr}
                            disabled={busy}
                            className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-sm"
                        >
                            Apply Filter to Strategy
                        </button>
                        <button
                            onClick={() =>
                                setFiltersLocal((prev) => [
                                    ...prev,
                                    { key: outputKeys[0] || "", enabled: true, min: "", max: "" },
                                ])
                            }
                            disabled={busy}
                            className="px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-sm"
                        >
                            + Add
                        </button>
                    </div>
                </div>

                <div className="grid md:grid-cols-2 gap-4 pt-4 border-t border-gray-700/50">
                    <div className="flex items-center gap-3 text-sm">
                        <span className="text-gray-300 font-medium">Min. Coverage:</span>
                        <input
                            type="range"
                            min={5}
                            max={95}
                            step={5}
                            value={Number(filterCoverage)}
                            onChange={(e) => setFilterCoverage(Number(e.target.value))}
                            className="w-full"
                            disabled={busy}
                        />
                        <span className="text-blue-300 font-semibold w-12 text-center">
                            {Number(filterCoverage)}%
                        </span>
                    </div>

                    <div className="flex items-center gap-3 text-sm">
                        <span className="text-gray-300 font-medium">Suggestion Method:</span>
                        <select
                            value={filterMethod}
                            onChange={(e) => setFilterMethod(e.target.value)}
                            className="w-full px-3 py-1.5 rounded bg-gray-900/60 border border-gray-700 focus:border-blue-500 focus:outline-none"
                            disabled={busy}
                        >
                            <option value="random">Random Search</option>
                            <option value="bayesian">Bayesian</option>
                            <option value="genetic">Genetic Algorithm</option>
                            <option value="tpe">TPE (Optuna)</option>
                            <option value="cmaes">CMA-ES (Optuna)</option>
                        </select>
                    </div>
                </div>
            </div>

            {/* Algoritma parametreleri */}
            {filterMethod && (
                <div className="p-3 rounded-md bg-gray-900/40 border border-gray-700/50">
                    <h4 className="text-xs font-semibold text-gray-400 mb-3">
                        {`${filterMethod.charAt(0).toUpperCase() + filterMethod.slice(1)} Parameters`}
                    </h4>
                    <div className="grid grid-cols-3 gap-3 text-sm">
                        {filterMethod === "random" && (
                            <div>
                                <label className="block text-xs text-gray-400 mb-1">Samples</label>
                                <input
                                    type="number"
                                    value={algoParams.samples || 12000}
                                    onChange={(e) =>
                                        setAlgoParams({ samples: Number(e.target.value) })
                                    }
                                    className="w-full px-2 py-1 rounded bg-gray-900/80 border border-gray-600"
                                />
                            </div>
                        )}
                        {filterMethod === "bayesian" && (
                            <>
                                <div>
                                    <label className="block text-xs text-gray-400 mb-1">
                                        Number of Calls
                                    </label>
                                    <input
                                        type="number"
                                        value={algoParams.n_calls || 150}
                                        onChange={(e) =>
                                            setAlgoParams((p) => ({
                                                ...p,
                                                n_calls: Number(e.target.value),
                                            }))
                                        }
                                        className="w-full px-2 py-1 rounded bg-gray-900/80 border border-gray-600"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs text-gray-400 mb-1">
                                        Initial Random Points
                                    </label>
                                    <input
                                        type="number"
                                        value={algoParams.n_initial_points || 10}
                                        onChange={(e) =>
                                            setAlgoParams((p) => ({
                                                ...p,
                                                n_initial_points: Number(e.target.value),
                                            }))
                                        }
                                        className="w-full px-2 py-1 rounded bg-gray-900/80 border border-gray-600"
                                    />
                                </div>
                            </>
                        )}
                        {filterMethod === "genetic" && (
                            <>
                                <div>
                                    <label className="block text-xs text-gray-400 mb-1">
                                        Iterations
                                    </label>
                                    <input
                                        type="number"
                                        value={algoParams.max_num_iteration || 100}
                                        onChange={(e) =>
                                            setAlgoParams((p) => ({
                                                ...p,
                                                max_num_iteration: Number(e.target.value),
                                            }))
                                        }
                                        className="w-full px-2 py-1 rounded bg-gray-900/80 border border-gray-600"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs text-gray-400 mb-1">
                                        Population Size
                                    </label>
                                    <input
                                        type="number"
                                        value={algoParams.population_size || 20}
                                        onChange={(e) =>
                                            setAlgoParams((p) => ({
                                                ...p,
                                                population_size: Number(e.target.value),
                                            }))
                                        }
                                        className="w-full px-2 py-1 rounded bg-gray-900/80 border border-gray-600"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs text-gray-400 mb-1">
                                        Mutation Prob.
                                    </label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        max="1"
                                        value={algoParams.mutation_probability || 0.1}
                                        onChange={(e) =>
                                            setAlgoParams((p) => ({
                                                ...p,
                                                mutation_probability: Number(e.target.value),
                                            }))
                                        }
                                        className="w-full px-2 py-1 rounded bg-gray-900/80 border border-gray-600"
                                    />
                                </div>
                            </>
                        )}
                        {filterMethod === "tpe" && (
                            <>
                                <div>
                                    <label className="block text-xs text-gray-400 mb-1">
                                        Number of Trials
                                    </label>
                                    <input
                                        type="number"
                                        value={algoParams.n_trials || 200}
                                        onChange={(e) =>
                                            setAlgoParams((p) => ({
                                                ...p,
                                                n_trials: Number(e.target.value),
                                            }))
                                        }
                                        className="w-full px-2 py-1 rounded bg-gray-900/80 border border-gray-600"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs text-gray-400 mb-1">
                                        Startup Trials
                                    </label>
                                    <input
                                        type="number"
                                        value={algoParams.n_startup_trials || 10}
                                        onChange={(e) =>
                                            setAlgoParams((p) => ({
                                                ...p,
                                                n_startup_trials: Number(e.target.value),
                                            }))
                                        }
                                        className="w-full px-2 py-1 rounded bg-gray-900/80 border border-gray-600"
                                    />
                                </div>
                            </>
                        )}
                        {filterMethod === "cmaes" && (
                            <div>
                                <label className="block text-xs text-gray-400 mb-1">
                                    Number of Trials
                                </label>
                                <input
                                    type="number"
                                    value={algoParams.n_trials || 200}
                                    onChange={(e) =>
                                        setAlgoParams({ n_trials: Number(e.target.value) })
                                    }
                                    className="w-full px-2 py-1 rounded bg-gray-900/80 border border-gray-600"
                                />
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Filtre satırları */}
            <div className="p-4 rounded-xl bg-gray-800/60 border border-gray-700/50 space-y-2">
                {filtersLocal.length === 0 && (
                    <div className="text-xs text-gray-400 px-2">
                        Bu strateji için outcome bulunamadı. (Snapshot/Backtest çalıştırıp tekrar
                        açın.)
                    </div>
                )}
                {filtersLocal.map((f, i) => (
                    <div key={i} className="grid grid-cols-12 gap-2 items-center">
                        <select
                            className="col-span-4 px-3 py-2 rounded bg-gray-900/60 border border-gray-700 text-sm"
                            value={f.key}
                            onChange={(e) => updateFilter(i, { key: e.target.value })}
                        >
                            <option value="" disabled>
                                select outcome
                            </option>
                            {outputKeys.map((k) => (
                                <option key={k} value={k}>
                                    {k}
                                </option>
                            ))}
                        </select>

                        <label className="col-span-2 flex items-center gap-2 text-sm">
                            <input
                                type="checkbox"
                                checked={!!f.enabled}
                                onChange={(e) => updateFilter(i, { enabled: e.target.checked })}
                            />
                            enabled
                        </label>

                        <input
                            type="number"
                            step="any"
                            className="col-span-2 px-3 py-2 rounded bg-gray-900/60 border border-gray-700 text-sm"
                            placeholder="min"
                            value={f.min}
                            onChange={(e) => updateFilter(i, { min: e.target.value })}
                        />
                        <input
                            type="number"
                            step="any"
                            className="col-span-2 px-3 py-2 rounded bg-gray-900/60 border border-gray-700 text-sm"
                            placeholder="max"
                            value={f.max}
                            onChange={(e) => updateFilter(i, { max: e.target.value })}
                        />
                        <button
                            onClick={() => removeFilter(i)}
                            className="col-span-2 px-3 py-2 rounded bg-red-600 hover:bg-red-500 text-sm"
                        >
                            Remove
                        </button>
                    </div>
                ))}
            </div>

            {/* Suggestion Result */}
            <div className="p-4 rounded-lg bg-gray-800/50 border border-gray-700/60">
                <div className="font-semibold mb-2 text-base">Suggestion Result</div>
                <div className="p-3 rounded-md bg-gray-900/50">
                    {filterSuggest ? (
                        <pre className="text-xs text-gray-300 whitespace-pre-wrap">
                            {JSON.stringify(filterSuggest, null, 2)}
                        </pre>
                    ) : (
                        <div className="text-xs text-gray-400">
                            Henüz öneri yok. “Suggest” butonuna basın.
                        </div>
                    )}
                </div>
                {err && (
                    <div className="mt-2 p-3 rounded bg-red-900/40 border border-red-600/50 text-sm text-red-100">
                        {err}
                    </div>
                )}
            </div>
        </div>
    );
}
