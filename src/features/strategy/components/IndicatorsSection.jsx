// src/features/strategy/components/IndicatorsSection.jsx
import React, { useMemo } from "react";
import { DEFAULT_IND_CATALOG } from "../../../constants/indicatorCatalog";
import { collectSuffixesForGroup } from "../utils/strategyHelpers";
import { ExprOutputsChips } from "./ExpressionEditor";

function Labeled({ label, children }) {
    return (
        <label className="text-sm block">
            <div className="text-gray-300">{label}</div>
            {children}
        </label>
    );
}

function AddIndicator({ onAdd, disabled }) {
    const [sel, setSel] = React.useState(DEFAULT_IND_CATALOG[0]?.id || "");
    const group = useMemo(() => DEFAULT_IND_CATALOG.find((x) => x.id === sel), [sel]);
    return (
        <div className="flex items-center gap-2">
            <select className="input" value={sel} onChange={(e) => setSel(e.target.value)} disabled={disabled}>
                {DEFAULT_IND_CATALOG.map((g) => (<option key={g.id} value={g.id}>{g.name}</option>))}
            </select>
            <button className="btn-primary" onClick={() => group && onAdd?.(group)} disabled={disabled}>+ Add Indicator</button>
        </div>
    );
}

export default function IndicatorsSection({ active, addIndicatorGroup, removeIndicatorGroup, groupInstances, removeIndicatorInstance, setIndicatorValue, colStats, onPickExprChip }) {
    return (
        <div className="card">
            <div className="flex items-center justify-between mb-3">
                <div className="font-semibold">Indicator Defaults</div>
                <div className="flex items-center gap-2">
                    <AddIndicator onAdd={(g) => active && addIndicatorGroup(g, active.id)} disabled={!active} />
                </div>
            </div>

            {active?.groups?.length ? (
                <div className="space-y-4">
                    {active.groups.map((g) => (
                        <div key={g.id} className="p-3 rounded border border-gray-700 bg-gray-800/40">
                            <div className="flex items-center justify-between mb-2">
                                <div className="font-medium">{g.name}</div>
                                <button className="px-2 py-1 rounded bg-red-600 text-sm" onClick={() => removeIndicatorGroup(g.id, active.id)}>Remove Indicator</button>
                            </div>

                            {(groupInstances(g, active?.indicators || {})).map((suf) => (
                                <div key={suf || "root"} className="rounded border border-slate-700 p-3 mb-3 bg-slate-800/30">
                                    <div className="flex items-center justify-between mb-2">
                                        <div className="text-xs text-slate-300">Instance: <b>{suf === "" ? "• (base)" : suf}</b></div>
                                        {suf !== "" && (
                                            <button className="px-2 py-1 text-xs rounded bg-red-600 hover:bg-red-500" onClick={() => active && removeIndicatorInstance(g.id, suf, active.id)}>
                                                Remove Instance
                                            </button>
                                        )}
                                    </div>

                                    <div className="grid md:grid-cols-3 gap-3">
                                        {g.params.map((base) => {
                                            const key = suf ? `${base}${suf}` : base;
                                            return (
                                                <Labeled key={key} label={key}>
                                                    <input className="input mt-1" type="number" value={active?.indicators?.[key] ?? ""} onChange={(e) => setIndicatorValue(active.id, key, Number(e.target.value))} />
                                                </Labeled>
                                            );
                                        })}
                                    </div>

                                    <div className="mt-2">
                                        <ExprOutputsChips outputs={g.exprOutputs || []} suffix={suf} stats={colStats || {}} onPick={onPickExprChip} />
                                    </div>
                                </div>
                            ))}
                        </div>
                    ))}
                </div>
            ) : Object.keys(active?.indicators || {}).length ? (
                <div className="grid md:grid-cols-3 gap-3">
                    {Object.entries(active.indicators).map(([k, v]) => (
                        <Labeled key={k} label={k}>
                            <input className="input mt-1" type="number" value={v ?? ""} onChange={(e) => setIndicatorValue(active.id, k, Number(e.target.value))} />
                        </Labeled>
                    ))}
                </div>
            ) : (
                <div className="text-xs text-gray-400">No indicators yet. Add from the catalog or press “Sync Groups”.</div>
            )}
        </div>
    );
}
