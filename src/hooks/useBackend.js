// src/hooks/useBackend.js
import { useRef, useMemo } from "react";

export function useBackendClient() {
  const BASE = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";
  const lastCtrlRef = useRef(null);

  const request = async (method, path, body, opts = {}) => {
    // önceki isteği iptal ETMEYELİM (uzun süren backtest/optimize iptal olmasın)
    // İstersen manual iptal için api.abort() çağırabilirsin.
    const controller = new AbortController();
    lastCtrlRef.current = controller;

    const timeoutMs = opts.timeout ?? 10 * 60 * 1000; // 10 dk
    let timeoutId = null;
    if (timeoutMs) {
      timeoutId = setTimeout(() => {
        // AbortError'a anlamlı mesaj katalım
        controller.abort(new DOMException("timeout", "AbortError"));
      }, timeoutMs);
    }

    try {
      const res = await fetch(`${BASE}${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
        cache: "no-store",
        keepalive: true, // sekme kapanırken de gönder
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `HTTP ${res.status}`);
      }
      return await res.json();
    } catch (e) {
      // AbortError ise daha okunur bir mesaj döndür
      if (e?.name === "AbortError") {
        const reason = e?.message || "Request aborted";
        throw new Error(reason === "timeout" ? "Request timed out" : reason);
      }
      throw e;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  };

  const api = useMemo(() => ({
    get: (path, opts) => request("GET", path, null, opts),
    post: (path, body, opts) => request("POST", path, body, opts),
    abort: () => lastCtrlRef.current?.abort(),
  }), []);

  return api;
}
