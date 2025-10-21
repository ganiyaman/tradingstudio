// src/features/strategy/components/StrategyTabs.jsx
import React from "react";
import { makeId } from "../utils/strategyHelpers";

export default function StrategyTabs({ strategies, activeId, setActiveId, setStrategies, active, LEGACY_LONG_EXPR, LEGACY_SHORT_EXPR, LEGACY_LONG_INDICATORS, LEGACY_SHORT_INDICATORS }) {
    return (
        <div className="flex flex-wrap gap-2">
            {(strategies || []).map((s) => (
                <button
                    key={s.id}
                    className={`px-3 py-1 rounded ${s.id === activeId ? "bg-blue-600" : "bg-gray-700"}`}
                    onClick={() => setActiveId(s.id)}
                >
                    {s.name} ({s.side === "short" ? "Short" : "Long"})
                </button>
            ))}

            
            {/* quick legacy */}
            <button
                className="px-2 py-1 rounded border border-gray-700 text-xs"
                onClick={() => active && setStrategies((prev) => prev.map((s) => s.id === active.id ? { ...s, side: "long", expr: LEGACY_LONG_EXPR, indicators: { ...LEGACY_LONG_INDICATORS }, enabled: s.enabled ?? true } : s))}
            >
                Use Legacy A (Long)
            </button>
            <button
                className="px-2 py-1 rounded border border-gray-700 text-xs"
                onClick={() => active && setStrategies((prev) => prev.map((s) => s.id === active.id ? { ...s, side: "short", expr: LEGACY_SHORT_EXPR, indicators: { ...LEGACY_SHORT_INDICATORS }, enabled: s.enabled ?? true } : s))}
            >
                Use Legacy B (Short)
            </button>
        </div>
    );
}
