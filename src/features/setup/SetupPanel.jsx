// src/features/setup/SetupPanel.jsx
import React, { useEffect, useMemo, useState } from "react";

/**
 * Tek parça Setup Panel
 * - Snapshot indirme: POST /data/snapshot
 * - Cache: localStorage'da saklanır, "Use Cached" ile geri yüklenir
 * - Basit bağlantı testi: GET /data/snapshot/{snapshot_id}
 * - Ortak backtest/optimizasyon paramları (leverage, fees) burada tutulur
 *
 * Not:
 *  - API tabanı: VITE_API_URL (yoksa http://127.0.0.1:8000)
 *  - Bu panel, snapshotId'yi hem localStorage'a hem de üst seviyeye prop ile iletebilir.
 *    İstersen <SetupPanel onSnapshot={(id, meta)=>{...}} /> üzerinden yakala.
 */

const API_BASE = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

const TF_LIST = ["1m", "3m", "5m", "15m", "30m", "1h", "4h", "1d"];

// localStorage key yardımcıları
const metaKey = (q) =>
    `SNAPSHOT:meta:${q.symbol}:${q.timeframe}:${q.start}:${q.end}`;
const lastKey = "SNAPSHOT:last";

export default function SetupPanel({
    setNotice, // opsiyonel uyarı bildirimi
    onSnapshot, // opsiyonel callback: (snapshotId, meta) => void
}) {
    // ---- form state
    const [form, setForm] = useState({
        symbol: "ORDIUSDT",
        timeframe: "5m",
        start: "2025-09-01T00:00:00Z",
        end: "2025-09-05T00:00:00Z",
        leverage: 2,
        fee_pct: 0.0004, // %0.04
        slippage_pct: 0.0002,
    });

    // ---- UI state
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState("");
    const [snapshot, setSnapshot] = useState(null); // { id, rows, cached?, savedAt, q }

    // açılışta son kullanılan snapshot'ı çek
    useEffect(() => {
        const last = safeRead(lastKey);
        if (last?.id) {
            setSnapshot(last);
        }
    }, []);

    const q = useMemo(
        () => ({
            symbol: form.symbol.trim(),
            timeframe: form.timeframe,
            start: form.start.trim(),
            end: form.end.trim(),
        }),
        [form.symbol, form.timeframe, form.start, form.end]
    );

    const hasCache = !!safeRead(metaKey(q));

    const onChange = (k, v) => setForm((s) => ({ ...s, [k]: v }));

    // ---- HTTP yardımcıları
    const jsonFetch = async (path, init = {}) => {
        const r = await fetch(`${API_BASE}${path}`, {
            headers: { "Content-Type": "application/json" },
            ...init,
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j?.detail || j?.message || r.statusText);
        return j;
    };

    // ---- İşlemler
    const downloadSnapshot = async () => {
        setBusy(true);
        setErr("");
        try {
            /** BEKLENEN BODY (optimizer_api.py):
             * {symbol, timeframe, start, end}
             * Cevap: { snapshot_id, rows, ... }
             */
            const res = await jsonFetch("/data/snapshot", {
                method: "POST",
                body: JSON.stringify(q),
            });
            const meta = {
                id: res.snapshot_id,
                rows: res.rows ?? res.count ?? null,
                savedAt: new Date().toISOString(),
                cached: false,
                q,
                sim: {
                    leverage: Number(form.leverage || 1),
                    fee_pct: Number(form.fee_pct || 0),
                    slippage_pct: Number(form.slippage_pct || 0),
                },
            };
            // hem query-özel kaydet hem de "last" kaydı güncelle
            safeWrite(metaKey(q), meta);
            safeWrite(lastKey, meta);
            setSnapshot(meta);
            setNotice?.(`Snapshot hazır: ${meta.id} · Rows: ${meta.rows ?? "-"}`);
            onSnapshot?.(meta.id, meta);
        } catch (e) {
            setErr(String(e.message || e));
            setNotice?.(`Hata: ${String(e.message || e)}`);
        } finally {
            setBusy(false);
        }
    };

    const useCached = () => {
        const m = safeRead(metaKey(q));
        if (!m) {
            setNotice?.("Bu aralık için önbellek yok.");
            return;
        }
        m.cached = true;
        setSnapshot(m);
        safeWrite(lastKey, m);
        onSnapshot?.(m.id, m);
        setNotice?.(`Cache yüklendi: ${m.id}`);
    };

    const clearCached = () => {
        localStorage.removeItem(metaKey(q));
        setNotice?.("Bu aralığa ait cache temizlendi.");
    };

    const probeSnapshot = async () => {
        if (!snapshot?.id) return;
        setBusy(true);
        setErr("");
        try {
            // GET /data/snapshot/{id} basit doğrulama
            const r = await jsonFetch(`/data/snapshot/${snapshot.id}`, { method: "GET" });
            setNotice?.(
                `Snapshot OK · id=${snapshot.id} · rows=${r?.rows ?? r?.count ?? "-"}`
            );
        } catch (e) {
            setErr(String(e.message || e));
            setNotice?.(`Probe error: ${String(e.message || e)}`);
        } finally {
            setBusy(false);
        }
    };

    const saveDefaults = () => {
        const meta = {
            id: snapshot?.id || null,
            q,
            sim: {
                leverage: Number(form.leverage || 1),
                fee_pct: Number(form.fee_pct || 0),
                slippage_pct: Number(form.slippage_pct || 0),
            },
            savedAt: new Date().toISOString(),
        };
        safeWrite("SETUP:defaults", meta);
        setNotice?.("Varsayılanlar kaydedildi.");
    };

    const loadDefaults = () => {
        const d = safeRead("SETUP:defaults");
        if (!d) return setNotice?.("Kayıtlı varsayılan bulunamadı.");
        if (d.q) {
            setForm((s) => ({
                ...s,
                symbol: d.q.symbol,
                timeframe: d.q.timeframe,
                start: d.q.start,
                end: d.q.end,
            }));
        }
        if (d.sim) {
            setForm((s) => ({
                ...s,
                leverage: d.sim.leverage,
                fee_pct: d.sim.fee_pct,
                slippage_pct: d.sim.slippage_pct,
            }));
        }
        setNotice?.("Varsayılanlar yüklendi.");
    };

    return (
        <div className="space-y-5">
            {/* Başlık */}
            <div className="flex items-center justify-between">
                <div className="text-lg font-semibold">Setup</div>
                {snapshot?.id ? (
                    <span className="text-xs px-2 py-1 rounded bg-gray-700 border border-gray-600">
                        snapshot: <b>{snapshot.id}</b> {snapshot.cached ? "(cached)" : ""}
                    </span>
                ) : (
                    <span className="text-xs text-gray-400">snapshot yok</span>
                )}
            </div>

            {/* Veri Aralığı + Aksiyonlar */}
            <div className="p-4 rounded-xl border border-gray-700 bg-gray-800/40">
                <div className="grid gap-3 md:grid-cols-5">
                    <label className="text-sm">
                        <div className="text-gray-300">Symbol</div>
                        <input
                            className="input mt-1"
                            value={form.symbol}
                            onChange={(e) => onChange("symbol", e.target.value)}
                        />
                    </label>
                    <label className="text-sm">
                        <div className="text-gray-300">Timeframe</div>
                        <select
                            className="input mt-1"
                            value={form.timeframe}
                            onChange={(e) => onChange("timeframe", e.target.value)}
                        >
                            {TF_LIST.map((tf) => (
                                <option key={tf}>{tf}</option>
                            ))}
                        </select>
                    </label>
                    <label className="text-sm">
                        <div className="text-gray-300">Start (ISO)</div>
                        <input
                            className="input mt-1"
                            value={form.start}
                            onChange={(e) => onChange("start", e.target.value)}
                            placeholder="YYYY-MM-DDTHH:mm:ssZ"
                        />
                    </label>
                    <label className="text-sm">
                        <div className="text-gray-300">End (ISO)</div>
                        <input
                            className="input mt-1"
                            value={form.end}
                            onChange={(e) => onChange("end", e.target.value)}
                            placeholder="YYYY-MM-DDTHH:mm:ssZ"
                        />
                    </label>

                    <div className="flex items-end gap-2">
                        <button
                            className="btn-primary w-full"
                            disabled={busy}
                            onClick={downloadSnapshot}
                            title="POST /data/snapshot"
                        >
                            {busy ? "Downloading…" : "Download Snapshot"}
                        </button>
                    </div>
                </div>

                <div className="flex flex-wrap gap-2 mt-3">
                    <button
                        className="px-3 py-2 rounded border border-gray-700"
                        onClick={useCached}
                        disabled={!hasCache || busy}
                        title="Cache'den yükle"
                    >
                        Use Cached
                    </button>
                    <button
                        className="px-3 py-2 rounded border border-gray-700"
                        onClick={clearCached}
                        disabled={!hasCache || busy}
                    >
                        Clear Cache (this range)
                    </button>
                    <button
                        className="px-3 py-2 rounded border border-gray-700"
                        onClick={probeSnapshot}
                        disabled={!snapshot?.id || busy}
                        title="GET /data/snapshot/{id}"
                    >
                        Probe Snapshot
                    </button>
                </div>

                {err && (
                    <div className="mt-2 text-xs text-red-300">
                        <b>Hata:</b> {err}
                    </div>
                )}
            </div>

            {/* Simülasyon Varsayılanları */}
            <div className="p-4 rounded-xl border border-gray-700 bg-gray-800/40">
                <div className="font-medium mb-3">Simulation Defaults</div>
                <div className="grid gap-3 md:grid-cols-4">
                    <label className="text-sm">
                        <div className="text-gray-300">Leverage</div>
                        <input
                            className="input mt-1"
                            type="number"
                            value={form.leverage}
                            onChange={(e) => onChange("leverage", Number(e.target.value))}
                        />
                    </label>
                    <label className="text-sm">
                        <div className="text-gray-300">Fee (fraction)</div>
                        <input
                            className="input mt-1"
                            type="number"
                            step="0.0001"
                            value={form.fee_pct}
                            onChange={(e) => onChange("fee_pct", Number(e.target.value))}
                        />
                    </label>
                    <label className="text-sm">
                        <div className="text-gray-300">Slippage (fraction)</div>
                        <input
                            className="input mt-1"
                            type="number"
                            step="0.0001"
                            value={form.slippage_pct}
                            onChange={(e) =>
                                onChange("slippage_pct", Number(e.target.value))
                            }
                        />
                    </label>
                    <div className="flex items-end gap-2">
                        <button
                            className="px-3 py-2 rounded border border-gray-700"
                            onClick={saveDefaults}
                        >
                            Save Defaults
                        </button>
                        <button
                            className="px-3 py-2 rounded border border-gray-700"
                            onClick={loadDefaults}
                        >
                            Load
                        </button>
                    </div>
                </div>

                {/* küçük özet */}
                <div className="text-xs text-gray-400 mt-3">
                    {snapshot?.id ? (
                        <>
                            Active snapshot: <b>{snapshot.id}</b> · rows:{" "}
                            {snapshot.rows ?? "-"} · {snapshot.cached ? "cached" : "fresh"}
                        </>
                    ) : (
                        "Henüz snapshot yok."
                    )}
                </div>
            </div>
        </div>
    );
}

/* ---------------- little utils ---------------- */

function safeRead(k) {
    try {
        const s = localStorage.getItem(k);
        return s ? JSON.parse(s) : null;
    } catch {
        return null;
    }
}
function safeWrite(k, v) {
    try {
        localStorage.setItem(k, JSON.stringify(v));
    } catch { }
}
