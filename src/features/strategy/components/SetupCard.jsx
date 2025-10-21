
// src/features/strategy/components/SetupCard.jsx
import React from "react";
import { SNAP_LAST_KEY, SETUP_DEF_KEY, COLSTATS_LAST_KEY, EV_COLSTATS_UPDATE, getBody, pickColStats } from "../utils/strategyHelpers";
import { ensureParamsForExpr } from "../utils/strategyHelpers"; // aynı dosyada ise import et


function Labeled({ label, children }) {
  return (
    <label className="text-sm block">
      <div className="text-gray-300">{label}</div>
      {children}
    </label>
  );
}

export default function SetupCard({ q, setQ, sim, setSim, api, setNotice, snapBusy, setSnapBusy, strategies = [] })  {
  const lastSnap = React.useMemo(() => {
    try { return JSON.parse(localStorage.getItem(SNAP_LAST_KEY) || "null"); } catch { return null; }
  }, []);

  const downloadSnapshot = async () => {
    setSnapBusy(true);
    try {
      const res = await api.post(
        "/data/snapshot",
        { symbol: q.symbol, timeframe: q.timeframe, start: q.start, end: q.end },
        { timeout: 10 * 60 * 1000 }
      );
      const body = getBody(res);
      const pack = { id: body?.snapshot_id, rows: body?.rows ?? 0, q, sim };
      localStorage.setItem(SNAP_LAST_KEY, JSON.stringify(pack));
      localStorage.setItem(SETUP_DEF_KEY, JSON.stringify({ q, sim }));
      // ➊ Stratejilerden "col_stats" için birleşik indikatör seti
      const mergedIndicators = {};
      (strategies || []).forEach(s => {
        const expr = String(s?.expr || "").replace(/\s+/g, " ").trim();
        const baseInds = s?.indicators || {};
        const { indicatorsForCompute } = ensureParamsForExpr(expr, baseInds);
        Object.assign(mergedIndicators, indicatorsForCompute);
      });
      



      // 1) BE doğrudan col_stats döndürüyor olabilir
      let colStats = pickColStats(res);

      // 2) Dönmüyorsa: fallback olarak ayrı endpoint'le iste
      if (!colStats && pack.id) {
        try {
          const cs = await api.post("/data/col_stats",
                     { data_snapshot_id: pack.id, indicators: mergedIndicators, symbol: q.symbol, timeframe: q.timeframe, start: q.start, end: q.end },
            { timeout: 3 * 60 * 1000 }
          );
          colStats = pickColStats(cs);
        } catch (e) {
          // opsiyonel: sessiz geç — col_stats zorunlu değil
          console.warn("colstats fetch failed:", e);
        }
      }

      // 3) Varsa depola ve event yayınla (Results beklemeden)
      if (colStats && typeof colStats === "object") {
        localStorage.setItem(COLSTATS_LAST_KEY, JSON.stringify(colStats));
        // Minimal özel event
        window.dispatchEvent(new CustomEvent(EV_COLSTATS_UPDATE, { detail: { col_stats: colStats } }));
        // Mevcut Results dinleyicileri de faydalansın
        window.dispatchEvent(new CustomEvent("results:update-map", { detail: { col_stats: colStats } }));
      }




      setNotice?.(`Snapshot OK — id: ${ pack.id }, rows: ${ pack.rows } `);
    } catch (e) {
      setNotice?.(`Snapshot error: ${ e.message || e } `);
    } finally {
      setSnapBusy(false);
    }
    // ❶ LocalStorage’a yaz
    localStorage.setItem(
      "SNAPSHOT:last",
      JSON.stringify({ id: pack.id, rows: pack.rows ?? pack.df_len ?? 0 })
    );

    // ❷ Panellere haber ver (OptimizationPanel dinleyecek)
    window.dispatchEvent(new CustomEvent("snapshot:update", {
      detail: { id: pack.id, rows: pack.rows ?? pack.df_len ?? 0 }
    }));

  };

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <div className="font-semibold">Setup</div>
        <div className="text-xs text-gray-400">
          snapshot: {lastSnap?.id || "-"} {lastSnap?.rows ? `· bars:${ lastSnap.rows } ` : ""}
        </div>
      </div>

      <div className="grid md:grid-cols-4 gap-3">
        <Labeled label="Symbol">
          <input className="input mt-1" value={q.symbol} onChange={(e) => setQ({ ...q, symbol: e.target.value })} />
        </Labeled>
        <Labeled label="Timeframe">
          <select className="input mt-1" value={q.timeframe} onChange={(e) => setQ({ ...q, timeframe: e.target.value })}>
            {["1m","3m","5m","15m","30m","1h","2h","4h","8h","12h","1d","1W","1M"].map(tf => (
              <option key={tf} value={tf}>{tf}</option>
            ))}
          </select>
        </Labeled>
        <Labeled label="Start (ISO)">
          <input className="input mt-1" value={q.start} onChange={(e) => setQ({ ...q, start: e.target.value })} />
        </Labeled>
        <Labeled label="End (ISO)">
          <input className="input mt-1" value={q.end} onChange={(e) => setQ({ ...q, end: e.target.value })} />
        </Labeled>
      </div>

      <div className="grid md:grid-cols-3 gap-3 mt-3">
        <Labeled label="Leverage">
          <input className="input mt-1" type="number" value={sim.leverage} onChange={(e) => setSim({ ...sim, leverage: Number(e.target.value) })} />
        </Labeled>
        <Labeled label="Fee %">
          <input className="input mt-1" type="number" value={sim.fee_pct} onChange={(e) => setSim({ ...sim, fee_pct: Number(e.target.value) })} />
        </Labeled>
        <Labeled label="Slippage %">
          <input className="input mt-1" type="number" value={sim.slippage_pct} onChange={(e) => setSim({ ...sim, slippage_pct: Number(e.target.value) })} />
        </Labeled>
      </div>

      <div className="flex items-center gap-2 mt-4">
        <button className="btn-primary" onClick={downloadSnapshot} disabled={snapBusy}>
          {snapBusy ? "Downloading…" : "Download Snapshot"}
        </button>
        <button
          className="px-3 py-2 rounded border border-gray-700"
          onClick={() => { localStorage.setItem(SETUP_DEF_KEY, JSON.stringify({ q, sim })); setNotice?.("Setup saved."); }}
        >
          Save Setup
        </button>
      </div>
    </div>
  );
}
