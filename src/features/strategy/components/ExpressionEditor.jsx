// src/features/strategy/components/ExpressionEditor.jsx
import React, { useCallback } from "react";

function Labeled({ label, children }) {
    return (
        <label className="text-sm block">
            <div className="text-gray-300">{label}</div>
            {children}
        </label>
    );
}

function ExprOutputsChips({ outputs = [], suffix = "", stats = null, onPick }) {
    const items = Array.isArray(outputs) ? outputs.map(o => (typeof o === "string" ? { key: o, label: o } : o)) : [];
    if (!items.length) return null;

    const joinKey = (base, suf) => (suf ? `${base}${suf}` : base);
    const isFiniteNum = (x) => Number.isFinite(x);

    const handleClick = (it, suf, e) => {
        const fullKey = joinKey(it.key, suf);
        const stat = stats?.[fullKey] || null;
        onPick?.(fullKey, stat, e);
    };

    return (
        <div className="flex flex-wrap gap-2 mt-2">
            {items.map((it, i) => {
                const key = joinKey(it.key, suffix);
                const st = stats?.[key];
                const showRange = st && isFiniteNum(st.min) && isFiniteNum(st.max);
                const tip = showRange
                    ? `Click: data['${key}']\nShift: < ${st.min}\nCtrl/Cmd: > ${st.max}`
                    : `Click: data['${key}']`;

                return (
                    <button key={`${it.key}:${i}:${suffix}`} title={tip} onClick={(e) => handleClick(it, suffix, e)} className="px-2 py-0.5 rounded-full text-xs bg-slate-800 text-slate-200 border border-slate-700 hover:bg-slate-700" type="button">
                        {key}
                        {showRange && (
                            <span className="ml-2 text-[10px] opacity-70">[{Number(st.min).toFixed(2)}..{Number(st.max).toFixed(2)}]</span>
                        )}
                    </button>
                );
            })}
        </div>
    );
}

export default function ExpressionEditor({ PRESETS, presetId, setPresetId, exprLocal, setExprLocal, active, setExpr, setNotice }) {
    const onApplyExpr = () => { if (!active) return; setExpr(active.id, exprLocal); setNotice?.("Strategy expression updated."); };
    const applyPreset = () => {
        if (!active) return;
        const p = PRESETS.find((x) => x.id === presetId);
        if (!p) return setNotice?.("Preset not found.");
        setExprLocal(p.code);
        setExpr(active.id, p.code);
        setNotice?.(`Applied preset: ${p.label}`);
    };

    const appendToExpression = useCallback((fullKey, stat, evt) => {
        const has = (x) => Number.isFinite(x);
        let inner;
        if (evt?.shiftKey && has(stat?.min)) {
            inner = `data['${fullKey}'] > ${Number(stat.min).toFixed(6)}`;
        } else if ((evt?.ctrlKey || evt?.metaKey) && has(stat?.max)) {
            inner = `data['${fullKey}'] < ${Number(stat.max).toFixed(6)}`;
        } else {
            inner = `data['${fullKey}']`;
        }
        setExprLocal((prev) => { const base = (prev ?? "").trim(); const wrapped = `(${inner})`; return base ? `${base} & ${wrapped}` : wrapped; });
    }, [setExprLocal]);

    return (
        <div className="card">
            <div className="flex items-center justify-between mb-2">
                <div className="font-semibold">Custom Strategy Expression</div>
                <div className="flex gap-2">
                    <select className="input" value={presetId} onChange={(e) => setPresetId(e.target.value)}>
                        {PRESETS.map((p) => (<option key={p.id} value={p.id}>{p.label}</option>))}
                    </select>
                    <button className="px-3 py-2 rounded border border-gray-700" onClick={applyPreset} disabled={!active}>Use Preset</button>
                    <button className="btn-primary" onClick={onApplyExpr} disabled={!active}>Apply</button>
                </div>
            </div>

            <textarea className="input w-full min-h-[160px]" value={exprLocal} onChange={(e) => setExprLocal(e.target.value)} disabled={!active} />
            <p className="text-xs text-gray-400 mt-2">
                Tek satır boolean ifade: <code>data['SMA'] &gt; data['EMA']</code> gibi.
                <code> &amp;</code> ve <code> |</code> kullanın, <code>shift()</code> serbest.
            </p>

            {/* İsteğe bağlı: Chips alanını parent'dan geçirerek kullan */}
            {/* <ExprOutputsChips outputs={...} suffix={...} stats={...} onPick={appendToExpression} /> */}
        </div>
    );
}

export { ExprOutputsChips }; // İndicatorSection içinde kullanmak için
