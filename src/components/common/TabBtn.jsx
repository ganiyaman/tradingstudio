import React from "react";

/**
 * Basit sekme düğmesi.
 * - active: boolean
 * - onClick: handler
 */
export default function TabBtn({ active, onClick, children }) {
    return (
        <button
            onClick={onClick}
            className={`px-4 py-2 rounded-lg text-sm transition-colors
        ${active ? "bg-blue-600 text-white" : "text-gray-300 border border-gray-700 hover:bg-gray-800/60"}`}
        >
            {children}
        </button>
    );
}
