import React, { useMemo, useState } from "react";
import { useStrategies } from "../../hooks/useStrategies";
import { FILTER_METHODS } from "../../constants/enums";

export default function FiltersPanel({ setNotice }) {
    const {
        strategies, activeId, setActiveId, active,
        setFilterMethod, setFilterMinCoverage, setFilterItems, applyFilterToStrategy,
    } = useStrategies();

    const [items, setItems] = useState(active?.filters?.items || []);
    React.useEffect(() => setItems(active?.filters?.items || []), [active?.id]);

    const method = active?.filters?.method || "random";
    const minCov = active?.filters?.minCoverage ?? 0.7;

    const addKey = () => setItems((it) => [...it, { key: "", enabled: false }]);
    const rmKey = (idx) => setItems((it) => it.filter((_, i) => i !== idx));

    const suggest = async () => {
        // burada backend'e çağrı entegre edebilirsin; şimdilik min/max'ları dolduran basit örnek
        setItems((it) => it.map(x => ({ ...x, min: x.min ?? -10, max: x.max ?? 10 })));
        setNotice?.("Suggestions updated.");
    };

    const applyToStrategy = () => {
        // çok basit DSL derleyici: enabled olanları 'and' ile bağla
        const enabled = items.filter(x => x.enabled && x.key);
        const clauses = enabled.map(x => {
            const k = x.key.trim();
            const lo = (x.min ?? "").toString();
            const hi = (x.max ?? "").toString();
            return `(${lo !== "" ? `${k} >= ${lo}` : "True"} and ${hi !== "" ? `${k} <= ${hi}` : "True"})`;
        });
        const dsl = clauses.length ? clauses.join(" and ") : "";
        applyFilterToStrategy(active.id, dsl);
        setFilterItems(active.id, items);
        setNotice?.("Applied filter to strategy expression.");
    };

    return (
        <div className="space-y-4">
            {/* Strategytab */}
            <div className="flex flex-wrap gap-2">
                {strategies.map((s) => (
                    <button key={s.id}
                        className={`px-3 py-1 rounded ${s.id === activeId ? "bg-blue-600" : "bg-gray-700"}`}
                        onClick={() => setActiveId(s.id)}>
                        {s.name} · {s.side}
                    </button>
                ))}
            </div>

            <div className="card">
                <div className="font-semibold mb-2">Filters for: {active?.name}</div>

                <div className="grid md:grid-cols-3 gap-3 items-center">
                    <label className="text-sm">
                        <div className="text-gray-300">Min. Coverage</div>
                        <input type="range" min="0" max="1" step="0.01" value={minCov}
                            onChange={(e) => setFilterMinCoverage(active.id, Number(e.target.value))} />
                        <div className="text-xs text-gray-400 mt-1">{Math.round(minCov * 100)}%</div>
                    </label>

                    <label className="text-sm">
                        <div className="text-gray-300">Suggestion Method</div>
                        <select className="input mt-1" value={method}
                            onChange={(e) => setFilterMethod(active.id, e.target.value)}>
                            {FILTER_METHODS.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
                        </select>
                    </label>

                    <div className="flex gap-2 md:justify-end pt-5">
                        <button className="px-3 py-2 rounded border border-gray-700" onClick={() => { setItems([]); setFilterItems(active.id, []); }}>Reset</button>
                        <button className="px-3 py-2 rounded bg-purple-600" onClick={suggest}>Suggest</button>
                        <button className="btn-primary" onClick={applyToStrategy}>Apply Filter to Strategy</button>
                        <button className="px-3 py-2 rounded border border-gray-700" onClick={addKey}>+ Add</button>
                    </div>
                </div>
            </div>

            <div className="card">
                <div className="grid md:grid-cols-3 gap-3">
                    {items.map((x, i) => (
                        <div key={i} className="p-3 rounded border border-gray-700">
                            <div className="flex items-center gap-2">
                                <input className="input" placeholder="key" value={x.key}
                                    onChange={(e) => setItems((it) => it.map((t, idx) => idx === i ? { ...t, key: e.target.value } : t))} />
                                <label className="text-xs inline-flex items-center gap-2">
                                    <input type="checkbox" checked={!!x.enabled}
                                        onChange={(e) => setItems((it) => it.map((t, idx) => idx === i ? { ...t, enabled: e.target.checked } : t))} />
                                    enabled
                                </label>
                                <button className="px-2 py-1 bg-red-600 rounded ml-auto" onClick={() => rmKey(i)}>Remove</button>
                            </div>
                            <div className="grid grid-cols-2 gap-2 mt-2">
                                <input className="input" placeholder="min" value={x.min ?? ""} onChange={(e) => setItems((it) => it.map((t, idx) => idx === i ? { ...t, min: e.target.value } : t))} />
                                <input className="input" placeholder="max" value={x.max ?? ""} onChange={(e) => setItems((it) => it.map((t, idx) => idx === i ? { ...t, max: e.target.value } : t))} />
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
