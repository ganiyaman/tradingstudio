import React from "react";

/**
 * Bildirim çubuğu
 * - message: string | null
 * - onClose: () => void
 */
export default function NotificationBar({ message, onClose }) {
    if (!message) return null;
    return (
        <div className="mb-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm
                    flex items-center justify-between">
            <span>{message}</span>
            <button className="text-emerald-300 hover:text-emerald-100" onClick={onClose}>
                ✕
            </button>
        </div>
    );
}
