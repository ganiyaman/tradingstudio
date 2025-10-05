// src/hooks/useStrategies.js
import { useCallback, useMemo, useState } from "react";

/**
 * Strategy model
 * {
 *   id: string,
 *   name: string,
 *   side: "long" | "short",
 *   enabled: boolean,
 *   expr: string,
 *   indicators: { [paramKey: string]: number },
 *   groups: Array<{ id: string, name: string, params: string[] }>,
 *   exit: { type: "fixed_pct"|"atr"|"chandelier"|"boll"|"trailing_pct", ... },
 *   optimize: {
 *     method: string,           // "grid" | "random" | "bayesian" | ...
 *     maxIters: number,         // UI'de samples/iterations
 *     params: Array<{           // optimize edilebilir param listesi
 *       key: string,
 *       value: number,
 *       opt: boolean,
 *       lo?: number,
 *       hi?: number,
 *       step?: number
 *     }>
 *   }
 * }
 */

const DEFAULT_EXIT = { type: "fixed_pct", tp: 1, sl: 2 };
const DEFAULT_OPT = { method: "grid", maxIters: 200, params: [] };

const uid = (n = 8) =>
  Math.random().toString(36).slice(2, 2 + n) + Date.now().toString(36).slice(-2);

export function useStrategies() {
  const [strategies, setStrategies] = useState([]);   // Strategy[]
  const [activeId, setActiveId] = useState(null);

  const active = useMemo(
    () => strategies.find((s) => s.id === activeId) || null,
    [strategies, activeId]
  );

  /** normalize */
  const ensure = (s) => ({
    ...s,
    indicators: s.indicators ?? {},
    groups: Array.isArray(s.groups) ? s.groups : [],
    exit: s.exit ? { ...DEFAULT_EXIT, ...s.exit } : { ...DEFAULT_EXIT },
    optimize: s.optimize ? { ...DEFAULT_OPT, ...s.optimize } : { ...DEFAULT_OPT },
  });

  const keysUsedByGroups = (groups = []) =>
    new Set(groups.flatMap((g) => g.params || []));

  /** Strategy CRUD */
  const createStrategy = useCallback((partial = {}) => {
    const id = partial.id || `S_${uid()}`;
    const next = ensure({
      id,
      name: partial.name || `Strategy ${strategies.length + 1}`,
      side: partial.side || "long",
      enabled: partial.enabled ?? true,
      expr: partial.expr || "",
      indicators: partial.indicators || {},
      groups: partial.groups || [],
      exit: partial.exit || DEFAULT_EXIT,
      optimize: partial.optimize || DEFAULT_OPT,
    });
    setStrategies((prev) => [...prev, next]);
    if (!activeId) setActiveId(id);
    return id;
  }, [strategies.length, activeId]);

  const removeStrategy = useCallback((id) => {
    setStrategies((prev) => prev.filter((s) => s.id !== id));
    if (activeId === id) {
      const first = strategies.find((s) => s.id !== id);
      setActiveId(first?.id ?? null);
    }
  }, [activeId, strategies]);

  const patchStrategy = useCallback((id, patch) => {
    setStrategies((prev) =>
      prev.map((s) => (s.id === id ? ensure({ ...s, ...patch }) : s))
    );
  }, []);

  /** Expr */
  const setExpr = useCallback((id, expr) => {
    setStrategies((prev) => prev.map((s) => (s.id === id ? { ...s, expr } : s)));
  }, []);

  /** Exit */
  const setExit = useCallback((id, patch) => {
    setStrategies((prev) =>
      prev.map((s) =>
        s.id === id ? { ...s, exit: { ...(s.exit || DEFAULT_EXIT), ...patch } } : s
      )
    );
  }, []);

  /** Indicators: add/remove & value set */
  const addIndicatorGroup = useCallback((group, strategyId) => {
    if (!group) return;
    setStrategies((prev) =>
      prev.map((s) => {
        if (s.id !== strategyId) return s;
        const indicators = { ...(s.indicators || {}) };
        const groups = [...(s.groups || [])];

        // yoksa ekle
        if (!groups.find((g) => g.id === group.id)) {
          groups.push({
            id: group.id,
            name: group.name,
            params: (group.params || []).map((p) => p.key),
          });
        }

        // varsayılan paramları yaz
        (group.params || []).forEach((p) => {
          if (indicators[p.key] == null) indicators[p.key] = p.def;
        });

        // optimize param listesini doldur (çakışmaları atla)
        const optParams = [...(s.optimize?.params || [])];
        (group.params || []).forEach((p) => {
          if (!optParams.find((x) => x.key === p.key)) {
            const v = indicators[p.key];
            optParams.push({
              key: p.key,
              value: Number(v),
              opt: false,
              lo: typeof v === "number" ? Math.max(1, Math.floor(v / 2)) : 1,
              hi: typeof v === "number" ? Math.ceil(v * 2) : 100,
              step: 1,
            });
          }
        });

        return ensure({ ...s, indicators, groups, optimize: { ...(s.optimize || DEFAULT_OPT), params: optParams } });
      })
    );
  }, []);

  const removeIndicatorGroup = useCallback((groupId, strategyId) => {
    setStrategies((prev) =>
      prev.map((s) => {
        if (s.id !== strategyId) return s;
        const oldGroups = s.groups || [];
        const removed = oldGroups.find((g) => g.id === groupId);
        const groups = oldGroups.filter((g) => g.id !== groupId);
        if (!removed) return s;

        const still = keysUsedByGroups(groups);
        const indicators = { ...(s.indicators || {}) };
        for (const k of removed.params || []) {
          if (!still.has(k)) delete indicators[k];
        }

        // optimize listesinden de paramları çıkar
        const optParams = (s.optimize?.params || []).filter((p) => !removed.params?.includes(p.key));

        return ensure({ ...s, indicators, groups, optimize: { ...(s.optimize || DEFAULT_OPT), params: optParams } });
      })
    );
  }, []);

  const setIndicatorValue = useCallback((strategyId, key, value) => {
    setStrategies((prev) =>
      prev.map((s) =>
        s.id === strategyId
          ? ensure({
              ...s,
              indicators: { ...(s.indicators || {}), [key]: value },
              optimize: {
                ...(s.optimize || DEFAULT_OPT),
                params: (s.optimize?.params || []).map((p) =>
                  p.key === key ? { ...p, value: value } : p
                ),
              },
            })
          : s
      )
    );
  }, []);

  /** Optimize ayarları */
  const setOptimizeMethod = useCallback((strategyId, method) => {
    setStrategies((prev) =>
      prev.map((s) =>
        s.id === strategyId ? ensure({ ...s, optimize: { ...(s.optimize || DEFAULT_OPT), method } }) : s
      )
    );
  }, []);

  const setOptimizeMaxIters = useCallback((strategyId, n) => {
    setStrategies((prev) =>
      prev.map((s) =>
        s.id === strategyId ? ensure({ ...s, optimize: { ...(s.optimize || DEFAULT_OPT), maxIters: Number(n) || 200 } }) : s
      )
    );
  }, []);

  const updateOptimizeParam = useCallback((strategyId, key, patch) => {
    setStrategies((prev) =>
      prev.map((s) => {
        if (s.id !== strategyId) return s;
        const opt = s.optimize || DEFAULT_OPT;
        const params = opt.params || [];
        const updated = params.map((p) => (p.key === key ? { ...p, ...patch } : p));
        return ensure({ ...s, optimize: { ...opt, params: updated } });
      })
    );
  }, []);

  const applyOptimizationResult = useCallback((strategyId, paramMap) => {
    // sonuçtan gelen paramları indikatora yaz
    setStrategies((prev) =>
      prev.map((s) => {
        if (s.id !== strategyId) return s;
        const indicators = { ...(s.indicators || {}) };
        Object.entries(paramMap || {}).forEach(([k, v]) => {
          indicators[k] = Number(v);
        });
        // optimize ekranındaki "value"ları da senkronla
        const opt = s.optimize || DEFAULT_OPT;
        const params = (opt.params || []).map((p) =>
          paramMap[p.key] != null ? { ...p, value: Number(paramMap[p.key]) } : p
        );
        return ensure({ ...s, indicators, optimize: { ...opt, params } });
      })
    );
  }, []);

  /** public api */
  return {
    strategies, setStrategies,
    activeId, setActiveId,
    active,

    // strategy
    createStrategy, removeStrategy, patchStrategy,

    // expr & exit
    setExpr, setExit,

    // indicators
    addIndicatorGroup, removeIndicatorGroup, setIndicatorValue,

    // optimize
    setOptimizeMethod, setOptimizeMaxIters, updateOptimizeParam, applyOptimizationResult,
  };
}
