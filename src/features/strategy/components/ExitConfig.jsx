// src/features/strategy/components/ExitConfig.jsx
import React from "react";
import { EXIT_TYPES, DEFAULT_EXIT } from "../../../constants/enums";
import { normalizeBollExit } from "../utils/strategyHelpers";

// Daha modern ve düzenli bir etiketleme stili için güncellenmiş Labeled bileşeni
function Labeled({ label, children, description = null }) {
    return (
        // Etiket ve içeriği dikeyde boşlukla ayırma (space-y-1)
        <label className="block space-y-1">
            <div className="text-sm font-medium text-gray-200 dark:text-gray-300">{label}</div>
            {description && <p className="text-xs text-gray-400 dark:text-gray-500">{description}</p>}
            {children}
        </label>
    );
}

// Giriş ve seçim alanları için ortak, modernleştirilmiş ve koyu temaya uyumlu stil
const inputClasses = "w-full px-3 py-2 text-sm bg-gray-700 border border-gray-600 rounded-md shadow-sm text-white placeholder-gray-400 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:bg-gray-800 dark:border-gray-700 dark:focus:border-indigo-400 transition duration-150 ease-in-out";

function ExitFields({ exit, onChange }) {
    const type = exit?.type || "fixed_pct";
    if (type === "fixed_pct") {
        return (
            <>
                <Labeled label="Take Profit (%)">
                    <input
                        className={inputClasses}
                        type="number"
                        value={exit.tp ?? 1}
                        onChange={(e) => onChange({ tp: Number(e.target.value) })}
                    />
                </Labeled>
                <Labeled label="Stop Loss (%)">
                    <input
                        className={inputClasses}
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
                <Labeled label="ATR n" description="ATR periyodu">
                    <input
                        className={inputClasses}
                        type="number"
                        value={exit.atr_n ?? 14}
                        onChange={(e) => onChange({ atr_n: Number(e.target.value) })}
                    />
                </Labeled>
                <Labeled label="k (SL)" description="Stop Loss için ATR çarpanı">
                    <input
                        className={inputClasses}
                        type="number"
                        step="0.1"
                        value={exit.k_sl ?? 1.5}
                        onChange={(e) => onChange({ k_sl: Number(e.target.value) })}
                    />
                </Labeled>
                <Labeled label="m (TP)" description="Take Profit için ATR çarpanı">
                    <input
                        className={inputClasses}
                        type="number"
                        step="0.1"
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
                <Labeled label="n" description="Periyot">
                    <input
                        className={inputClasses}
                        type="number"
                        value={exit.n ?? 22}
                        onChange={(e) => onChange({ n: Number(e.target.value) })}
                    />
                </Labeled>
                <Labeled label="factor" description="ATR çarpanı">
                    <input
                        className={inputClasses}
                        type="number"
                        step="0.1"
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
                        className={inputClasses}
                        value={boll.bbMa}
                        onChange={(e) => onChange({ type: 'bollinger', bbMa: e.target.value })}
                    >
                        <option value="SMA">SMA</option>
                        <option value="EMA">EMA</option>
                    </select>
                </Labeled>
                <Labeled label="Period (n)">
                    <input
                        className={inputClasses}
                        type="number"
                        min={1}
                        value={boll.bbN}
                        onChange={(e) => onChange({ type: 'bollinger', bbN: Number(e.target.value) })}
                    />
                </Labeled>
                <Labeled label="Std Dev" >
                    <input
                        className={inputClasses}
                        type="number"
                        step="0.1"
                        min="0"
                        value={boll.bbStd}
                        onChange={(e) => onChange({ type: 'bollinger', bbStd: Number(e.target.value) })}
                    />
                </Labeled>
                <Labeled label="Band Side">
                    <select
                        className={inputClasses}
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
            <Labeled label="Trail (%)" description="Takip yüzdesi">
                <input
                    className={inputClasses}
                    type="number"
                    value={exit.trail_pct ?? 1}
                    onChange={(e) => onChange({ trail_pct: Number(e.target.value) })}
                />
            </Labeled>
        );
    }
    return null;
}

export default function ExitConfig({ active, exit, setExit, toggleEnabled, patchStrategy, onNewStrategy, onRemoveActive, canRemove = true }) {
    // Kart ve arka plan stilini modern koyu tema için güncelleme
    const cardClasses = "bg-gray-800 dark:bg-gray-900 shadow-xl rounded-lg p-6 border border-gray-700 dark:border-gray-800 text-white";

    // Düğme stilleri
    const primaryButtonClasses = "px-4 py-2 font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition duration-150 ease-in-out dark:focus:ring-offset-gray-900";
    const dangerButtonClasses = "px-4 py-2 font-medium text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 transition duration-150 ease-in-out dark:focus:ring-offset-gray-900";
    const secondaryButtonClasses = "px-4 py-2 font-medium text-gray-300 bg-gray-700 border border-gray-600 rounded-md hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition duration-150 ease-in-out dark:focus:ring-offset-gray-900";

    // Checkbox stili
    const checkboxClasses = "form-checkbox h-4 w-4 text-indigo-600 bg-gray-700 border-gray-600 rounded focus:ring-indigo-500 dark:bg-gray-800 dark:border-gray-700 dark:checked:bg-indigo-500";


    return (
        <div className={cardClasses}>
            {/* Başlık ve Eylem Düğmeleri - Üst kısım */}
            <div className="flex items-center justify-between mb-6 border-b border-gray-700 pb-4">
                <h2 className="text-xl font-bold text-white">Stop / Exit Configuration — {active?.name || "No Active Strategy"}</h2>
                <div className="flex items-center gap-3">
                    <button
                        className={secondaryButtonClasses}
                        type="button"
                        onClick={onNewStrategy}
                    >
                        + New Strategy
                    </button>
                    <button
                        className={dangerButtonClasses}
                        type="button"
                        disabled={!canRemove}
                        onClick={onRemoveActive}
                    >
                        Remove
                    </button>
                </div>
            </div>

            {/* Temel Ayarlar - 4 Sütunlu Izgara (Enabled, Side, Exit Type) */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
                {/* Enabled */}
                <Labeled label="Enabled">
                    <label className="inline-flex items-center gap-2 text-sm pt-2">
                        <input
                            type="checkbox"
                            checked={!!active.enabled}
                            onChange={(e) => toggleEnabled(active.id, e.target.checked)}
                            className={checkboxClasses}
                        />
                        <span className="text-gray-300">Strategy Enabled</span>
                    </label>
                </Labeled>

                {/* Side */}
                <Labeled label="Side">
                    <select
                        className={inputClasses}
                        value={active?.side || "long"}
                        onChange={(e) => active && patchStrategy(active.id, { side: e.target.value })}
                    >
                        <option value="long">Long</option>
                        <option value="short">Short</option>
                    </select>
                </Labeled>

                {/* Exit Type */}
                <Labeled label="Exit Type">
                    <select
                        className={inputClasses}
                        value={exit.type}
                        onChange={(e) => active && setExit(active.id, { type: e.target.value })}
                    >
                        {EXIT_TYPES.map((o) => (<option key={o.id} value={o.id}>{o.label}</option>))}
                    </select>
                </Labeled>

                {/* 4. Sütun (Boş bırakıldı veya farklı bir öğe için) */}
                <div className="hidden md:block"></div>

            </div>

            {/* Çıkış Tipi Alanları - Dinamik 4 Sütunlu Izgara */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6 mb-6">
                <ExitFields exit={exit} onChange={(patch) => active && setExit(active.id, patch)} />
            </div>

            {/* Global Ayarlar - Alt kısım */}
            <div className="pt-4 border-t border-gray-700">
                <div className="flex flex-wrap items-center gap-6">
                    {/* Compare exit strategies */}
                    <label className="inline-flex items-center gap-2 text-sm text-gray-300">
                        <input
                            type="checkbox"
                            checked={!!exit.compareVariants}
                            onChange={(e) => active && setExit(active.id, { compareVariants: e.target.checked })}
                            className={checkboxClasses}
                        />
                        Compare exit strategies
                    </label>

                    {/* Override global TP/SL */}
                    <label className="inline-flex items-center gap-2 text-sm text-gray-300">
                        <input
                            type="checkbox"
                            checked={!!exit.overrideGlobal}
                            onChange={(e) => active && setExit(active.id, { overrideGlobal: e.target.checked })}
                            className={checkboxClasses}
                        />
                        Override global TP/SL
                    </label>
                </div>
            </div>
        </div>
    );
}