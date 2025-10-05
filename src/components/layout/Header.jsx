// src/components/layout/Header.jsx
import React, { useEffect, useState } from "react";
import { Activity } from "lucide-react";
import { BusyBus } from "../../utils/helpers"; // ← düzeltilmiş yol

export default function Header() {
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        // BusyBus global yük göstergesi
        const unsub = BusyBus.subscribe(setBusy);
        return () => unsub?.();
    }, []);

    return (
        <header className="border-b border-gray-800 bg-gray-900/60 backdrop-blur-sm">
            <div className="container mx-auto px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Activity className="w-5 h-5 text-blue-400" />
                    <div className="font-semibold">Trading Strategy Studio</div>
                </div>
                <div className="text-xs text-gray-400">
                    {busy ? (
                        <span className="inline-flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                            working…
                        </span>
                    ) : (
                        "idle"
                    )}
                </div>
            </div>
        </header>
    );
}
