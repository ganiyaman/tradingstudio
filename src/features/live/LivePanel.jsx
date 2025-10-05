import React, { useEffect, useRef, useState } from "react";
import { useWebSocket } from "../../hooks/useWebSocket";

const highlight = (text, q) => {
    if (!q) return String(text);
    const s = String(text); const i = s.toLowerCase().indexOf(q.toLowerCase()); if (i === -1) return s;
    return (<>{s.slice(0, i)}<mark className="bg-yellow-600/60 text-white px-0.5 rounded">{s.slice(i, i + q.length)}</mark>{s.slice(i + q.length)}</>);
};

export default function LivePanel() {
    const { status, last, send } = useWebSocket("/ws/live");
    const [symbol, setSymbol] = useState("ORDIUSDT");
    const [log, setLog] = useState([]);
    const [query, setQuery] = useState("");
    const [typeFilter, setTypeFilter] = useState("any");
    const [symFilter, setSymFilter] = useState("");
    const [autoScroll, setAutoScroll] = useState(true);
    const listRef = useRef(null);

    useEffect(() => { if (!last) return; setLog(prev => [last, ...prev].slice(0, 200)); }, [last]);
    useEffect(() => { if (!autoScroll) return; const el = listRef.current; if (el) el.scrollTop = 0; }, [log, autoScroll]);

    const subscribe = () => send({ type: "subscribe", symbol });
    const filtered = log.filter(m => {
        const t = (m?.type || "info").toLowerCase();
        const s = (m?.symbol || m?.sym || "").toUpperCase();
        const passT = typeFilter === "any" ? true : (t === typeFilter);
        const passS = symFilter ? s.includes(symFilter.toUpperCase()) : true;
        const passQ = query ? JSON.stringify(m).toLowerCase().includes(query.toLowerCase()) : true;
        return passT && passS && passQ;
    });

    return (
        <div className="space-y-4">
            <div className="p-4 rounded-xl border border-gray-700 bg-gray-800/50">
                <div className="flex items-center justify-between">
                    <div className="font-semibold">Live Feed</div>
                    <div className="text-xs text-gray-400">WS: {status}</div>
                </div>
                <div className="mt-3 grid grid-cols-1 md:grid-cols-5 gap-2">
                    <input className="input" value={symbol} onChange={e => setSymbol(e.target.value)} placeholder="Symbol" />
                    <button className="btn-primary" onClick={subscribe}>Subscribe</button>
                    <select className="input" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
                        <option value="any">any</option><option value="price">price</option><option value="trade">trade</option><option value="signal">signal</option><option value="info">info</option>
                    </select>
                    <input className="input" value={symFilter} onChange={e => setSymFilter(e.target.value)} placeholder="Filter symbol" />
                    <input className="input" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search in JSON…" />
                </div>
                <div className="flex items-center gap-3 mt-2">
                    <label className="flex items-center gap-2 text-sm text-gray-300"><input type="checkbox" checked={autoScroll} onChange={e => setAutoScroll(e.target.checked)} /> Auto-scroll</label>
                    <button className="text-sm text-gray-300 hover:text-white" onClick={() => setLog([])}>Clear</button>
                </div>
            </div>

            <div className="p-4 rounded-xl border border-gray-700 bg-gray-800/50">
                <div className="font-semibold mb-2">Messages</div>
                <div className="space-y-2 max-h-[420px] overflow-auto" ref={listRef}>
                    {filtered.map((m, i) => {
                        const label = `${m?.type || "info"} • ${m?.symbol || m?.sym || ""}`; return (
                            <div key={i} className="p-2 rounded border border-gray-700 bg-gray-900/40">
                                <div className="text-xs text-gray-400 mb-1">{highlight(label, query)}</div>
                                <pre className="text-xs text-gray-300">{highlight(JSON.stringify(m, null, 2), query)}</pre>
                            </div>
                        );
                    })}
                    {filtered.length === 0 && <div className="text-sm text-gray-500">No messages.</div>}
                </div>
            </div>
        </div>
    );
}
