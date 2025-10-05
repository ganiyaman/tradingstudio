import React from "react";
import { TrendingUp, TrendingDown } from "lucide-react";

/**
 * MetricCard
 * - title: üst başlık
 * - value: ana metrik (string/number)
 * - subtitle: alt açıklama (opsiyonel)
 * - trend: sayıysa yukarı/aşağı oku ve % gösterir (opsiyonel)
 * - color: blue|green|red|yellow|purple
 */
export default function MetricCard({ title, value, subtitle, trend, color = "blue" }) {
    const palette = {
        blue: "from-blue-500/20 to-blue-600/10 border-blue-500/30",
        green: "from-green-500/20 to-green-600/10 border-green-500/30",
        red: "from-red-500/20 to-red-600/10 border-red-500/30",
        yellow: "from-yellow-500/20 to-yellow-600/10 border-yellow-500/30",
        purple: "from-purple-500/20 to-purple-600/10 border-purple-500/30",
    };
    const up = typeof trend === "number" && trend >= 0;

    return (
        <div className={`p-4 rounded-xl bg-gradient-to-br ${palette[color] || palette.blue} border backdrop-blur-sm`}>
            <div className="text-xs text-gray-300 uppercase mb-1">{title}</div>
            <div className="text-2xl font-bold text-white mb-1">{value}</div>
            {subtitle && <div className="text-xs text-gray-400">{subtitle}</div>}

            {typeof trend === "number" && (
                <div className={`flex items-center mt-2 text-xs ${up ? "text-emerald-400" : "text-red-400"}`}>
                    {up ? <TrendingUp className="w-3 h-3 mr-1" /> : <TrendingDown className="w-3 h-3 mr-1" />}
                    {Math.abs(trend).toFixed(2)}%
                </div>
            )}
        </div>
    );
}
