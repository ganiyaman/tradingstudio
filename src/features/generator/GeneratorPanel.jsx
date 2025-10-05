import React, { useMemo, useState } from "react";
import { useStrategies } from "../../hooks/useStrategies";
// src/features/generator/GeneratorPanel.jsx
import { PRESET_STRATEGIES, RANDOM_PARAM_RANGES, exportStrategiesToJSON, importStrategiesFromJSON } from "../../utils/presets";
import { normalizeIndicatorKeys } from "../../utils/helpers";

function KeyVal({ k, v }) {
    return (
        <div className="flex items-center gap-2 text-xs">
            <code className="bg-black/30 border border-gray-700 px-2 py-0.5 rounded">{k}</code>
            <span className="text-gray-300">{String(v)}</span>
        </div>
    );
}

export default function GeneratorPanel({ setNotice }) {
    const { strategies, setStrategies, setActiveId } = useStrategies();
    const [presetId, setPresetId] = useState(PRESET_STRATEGIES[0]?.id || "MACD_SWING");
    const [count, setCount] = useState(3);
    const [importText, setImportText] = useState("");
    const selected = useMemo(() => PRESET_STRATEGIES.find(p => p.id === presetId), [presetId]);

    const addFromPreset = () => {
        if (!selected) return;
        const nid = "S" + (strategies.length + 1);
        const s = { id: nid, name: selected.name, side: selected.side || "long", indicators: normalizeIndicatorKeys(selected.indicators || {}) };
        setStrategies(prev => [...prev, s]); setActiveId(nid); setNotice?.(`Added preset: ${selected.name}`);
    };

    const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
    const randFloat = (min, max, d = 2) => Number((Math.random() * (max - min) + min).toFixed(d));

    const generateRandom = () => {
        const batch = [];
        for (let i = 0; i < count; i++) {
            const id = "S" + (strategies.length + batch.length + 1);
            const ind = {};
            Object.entries(RANDOM_PARAM_RANGES).forEach(([k, conf]) => {
                ind[k] = conf.type === "int" ? randInt(conf.min, conf.max) : randFloat(conf.min, conf.max, conf.decimals ?? 2);
            });
            batch.push({ id, name: `Random ${id}`, side: Math.random() < 0.2 ? "both" : (Math.random() < 0.5 ? "long" : "short"), indicators: normalizeIndicatorKeys(ind) });
        }
        setStrategies(prev => [...prev, ...batch]); setActiveId(batch[0]?.id); setNotice?.(`Generated ${batch.length} strategies`);
    };

    const exportJSON = () => {
        const text = exportStrategiesToJSON(strategies);
        const blob = new Blob([text], { type: "application/json" });
        const url = URL.createObjectURL(blob); const a = document.createElement("a");
        a.href = url; a.download = "strategies.json"; a.click(); URL.revokeObjectURL(url);
    };

    const importJSON = () => {
        try {
            const { strategies: list, warnings } = importStrategiesFromJSON(importText, "new");
            setStrategies(prev => [...prev, ...list]); setActiveId(list[0]?.id); setImportText("");
            setNotice?.(`Imported ${list.length} strategies${warnings?.length ? ` (+${warnings.length} warnings)` : ''}`);
        } catch (e) { alert(e.message); }
    };

    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl border border-gray-700 bg-gray-800/50">
                <div className="font-semibold mb-3">Create from Preset</div>
                <div className="grid grid-cols-2 gap-3">
                    <select className="input" value={presetId} onChange={e => setPresetId(e.target.value)}>
                        {PRESET_STRATEGIES.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    <button className="btn-primary" onClick={addFromPreset}>Add Preset</button>
                </div>
                <div className="mt-3 text-xs text-gray-400">
                    <div className="mb-1">Preview:</div>
                    {selected ? (
                        <div className="space-y-1">
                            <div className="text-gray-300">side: {selected.side}</div>
                            <div className="flex flex-wrap gap-2">
                                {Object.entries(selected.indicators || {}).map(([k, v]) => <KeyVal key={k} k={k} v={v} />)}
                            </div>
                        </div>
                    ) : <div className="text-gray-500">-</div>}
                </div>
            </div>

            <div className="p-4 rounded-xl border border-gray-700 bg-gray-800/50">
                <div className="font-semibold mb-3">Generate / Import / Export</div>
                <div className="grid grid-cols-2 gap-3">
                    <label className="flex items-center gap-2"><span className="w-28 text-sm text-gray-300">Count</span>
                        <input className="input" type="number" value={count} min={1} max={20} onChange={e => setCount(Number(e.target.value) || 1)} />
                    </label>
                    <button className="btn-primary" onClick={generateRandom}>Generate</button>
                    <button className="px-4 py-2 rounded-lg border border-gray-600 text-gray-200 hover:bg-gray-700/40" onClick={exportJSON}>Export JSON</button>
                </div>
                <textarea className="input w-full min-h-[120px] mt-3" value={importText} onChange={e => setImportText(e.target.value)} placeholder='Paste strategies JSON here' />
                <button className="btn-primary mt-2" onClick={importJSON}>Import JSON</button>
            </div>
        </div>
    );
}
