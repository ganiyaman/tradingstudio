// Exit / Filter / Optimization seçenekleri tek yerde
export const EXIT_TYPES = [
  { id: "fixed_pct",     label: "Fixed (%)" },
  { id: "atr",           label: "ATR Based" },
  { id: "chandelier",    label: "Chandelier Exit" },
  { id: "boll",          label: "Bollinger Bands" },
  { id: "trailing_pct",  label: "Trailing %" },
];

export const FILTER_METHODS = [
  { id: "random", label: "Random Search" },
  { id: "bayes",  label: "Bayesian" },
  { id: "ga",     label: "Genetic Algorithm" },
  { id: "tpe",    label: "TPE (Optuna)" },
  { id: "cmaes",  label: "CMA-ES (Optuna)" },
];

export const OPT_METHODS = [
  { id: "random",  label: "Random Search" },
  { id: "grid",    label: "Grid Search" },
  { id: "bayes",   label: "Bayesian Optimization" },
  { id: "ga",      label: "Genetic Algorithm" },
  { id: "tpe",     label: "TPE (Optuna)" },
  { id: "cmaes",   label: "CMA-ES (Optuna)" },
  { id: "sa",      label: "Simulated Annealing" },
];

export const DEFAULT_EXIT = {
  type: "fixed_pct",
  tp: 1,  // %
  sl: 2,  // %
  overrideGlobal: true,
  compareVariants: true,
};
export const DEFAULT_BOLL = {
  type: "bollinger",
  bbMa: "SMA", // MA Type
  bbN: 22,     // Period (n)
  bbStd: 2,    // Std Dev
  bbSide: "upper", // Band Side: "upper" | "lower" | "mid"
};