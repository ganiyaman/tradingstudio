import { useMemo, useState } from "react";

const deepEqual = (a, b) => {
  try { return JSON.stringify(a) === JSON.stringify(b); }
  catch { return a === b; }
};

export function useFilters(initial = { expr: "", params: {} }) {
  const [state, setState] = useState(initial);
  const [pristine, setPristine] = useState(initial);
  const isDirty = useMemo(() => !deepEqual(state, pristine), [state, pristine]);
  const update = (patch) => setState((s) => ({ ...s, ...patch }));
  const reset = () => setState(pristine);
  const apply = (updates) => { setState((s) => ({ ...s, ...updates })); setPristine((p) => ({ ...p, ...updates })); };
  return { state, setState, pristine, setPristine, update, reset, apply, isDirty };
}
