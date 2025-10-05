import { useCallback, useEffect, useRef, useState } from "react";

/**
 * useWebSocket
 * - path: backend WS path (örn: "/ws/live")
 * - options:
 *    - parse: (raw) => parsedMessage, default JSON.parse
 *    - heartbeatMs: ping/süreklilik için interval (default 25_000)
 *    - reconnect: otomatik yeniden bağlanma (default true)
 *    - protocols: WebSocket alt protokolleri
 *
 * Dönüş:
 * - status: "idle" | "connecting" | "open" | "closing" | "closed" | "error"
 * - last: son gelen mesaj (parse edilmiş)
 * - send(payload): JSON.stringify ile gönderir
 * - close(): manuel kapat
 * - url: tam ws url
 */
export function useWebSocket(
  path = "/ws",
  { parse, heartbeatMs = 25_000, reconnect = true, protocols } = {}
) {
  const parseFn = useRef(typeof parse === "function" ? parse : (x) => JSON.parse(x));
  const [status, setStatus] = useState("idle");
  const [last, setLast] = useState(null);
  const wsRef = useRef(null);
  const hbRef = useRef(null);
  const retryRef = useRef({ tries: 0, timer: null });
  const closedByUser = useRef(false);

  // ws base url (http => ws, https => wss)
  const base =
    import.meta.env.VITE_API_URL?.replace(/^http/, "ws") ||
    (typeof window !== "undefined"
      ? `${window.location.origin.replace(/^http/, "ws")}`
      : "ws://127.0.0.1:8000");

  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;

  const clearHeartbeat = () => {
    if (hbRef.current) {
      clearInterval(hbRef.current);
      hbRef.current = null;
    }
  };

  const startHeartbeat = () => {
    clearHeartbeat();
    if (!heartbeatMs) return;
    hbRef.current = setInterval(() => {
      try {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: "ping", t: Date.now() }));
        }
      } catch {}
    }, heartbeatMs);
  };

  const cleanup = () => {
    clearHeartbeat();
    if (retryRef.current.timer) {
      clearTimeout(retryRef.current.timer);
      retryRef.current.timer = null;
    }
  };

  const connect = useCallback(() => {
    cleanup();
    setStatus("connecting");
    closedByUser.current = false;

    try {
      const ws = new WebSocket(url, protocols);
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus("open");
        retryRef.current.tries = 0;
        startHeartbeat();
      };

      ws.onmessage = (ev) => {
        const raw = ev.data;
        try {
          const parsed = parseFn.current ? parseFn.current(raw) : raw;
          setLast(parsed);
        } catch {
          // parse edilemezse raw string döndür
          setLast(raw);
        }
      };

      ws.onerror = () => {
        setStatus("error");
      };

      ws.onclose = () => {
        clearHeartbeat();
        setStatus("closed");
        wsRef.current = null;

        if (reconnect && !closedByUser.current) {
          const t = Math.min(10_000, 500 * Math.pow(2, retryRef.current.tries++)); // exponential backoff
          retryRef.current.timer = setTimeout(() => connect(), t);
        }
      };
    } catch (e) {
      setStatus("error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, protocols, reconnect, heartbeatMs]);

  useEffect(() => {
    connect();
    return () => {
      closedByUser.current = true;
      try {
        wsRef.current?.close();
      } catch {}
      cleanup();
    };
  }, [connect]);

  const send = useCallback((payload) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    try {
      ws.send(typeof payload === "string" ? payload : JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }, []);

  const close = useCallback(() => {
    closedByUser.current = true;
    try {
      wsRef.current?.close();
    } catch {}
  }, []);

  return { status, last, send, close, url };
}
