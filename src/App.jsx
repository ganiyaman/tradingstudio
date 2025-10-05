// App.jsx — Trading Strategy Studio (çalışır, tek dosya)
// Stack: React + Vite + Tailwind + react-chartjs-2 + lucide-react
import React, { useEffect, useState, useMemo, useRef } from "react";

import {
  Activity,
  Settings,
  Play,
  Zap,
  BarChart3,
  AlertCircle,
  CheckCircle,
  TrendingUp,
  TrendingDown,
  RotateCcw,

} from "lucide-react";

import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  Tooltip as ChartTooltip,
  Legend,
  BarElement,
  PointElement,
  LineElement,
  Filler,
} from "chart.js";
import {
  Line, Bar
} from "react-chartjs-2";

ChartJS.register(
  CategoryScale,
  LinearScale,
  ChartTooltip,
  Legend,
  BarElement,
  PointElement,
  LineElement,
  Filler
);

const API_BASE = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

/* --------------------------- Error Boundary --------------------------- */
class ErrorBoundary extends React.Component {
  constructor(p) {
    super(p);
    this.state = {
      hasError: false, error: null
    };
  }
  static getDerivedStateFromError() {
    return {
      hasError: true
    };
  }
  componentDidCatch(error, info) {
    console.error(error, info); this.setState({
      error
    });
  }
  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center p-6">
        <div className="bg-gray-800/90 border border-red-500/30 rounded-xl p-6 max-w-md w-full">
          <h2 className="text-xl font-bold text-red-400 mb-4 flex items-center gap-2">
            <AlertCircle className="w-5 h-5" /> Something went wrong
          </h2>
          <pre className="text-xs text-red-200 bg-black/40 p-3 rounded max-h-48 overflow-auto">
            {String(this.state.error)
            }
          </pre>
          <button
            onClick={() => window.location.reload()
            }
            className="w-full py-2 mt-3 bg-blue-600 hover:bg-blue-500 rounded-lg"
          >
            Reload Application
          </button>
        </div>
      </div>
    );
  }
}

/* ------------------------------------ Utils ------------------------------------ */
const fmt = (x, d = 2) =>
  x === null || x === undefined ? "-" : typeof x === "number" ? x.toFixed(d) : x;

const uid = () => {
  try {
    if (typeof window !== "undefined" && window.crypto?.randomUUID) {
      return window.crypto.randomUUID();
    }
  } catch { }
  return `id-${Date.now().toString(36)
    }-${Math.random().toString(36).slice(2)
    }`;
};

const clone = (x) => JSON.parse(JSON.stringify(x));
const sideText = (x) =>
  (String(x).toLowerCase() === "long" || Number(x) === 1) ? "LONG" : "SHORT";

// utils/number.ts
const inferDecimals = (x) => {
  const s = String(x);
  if (s.includes("e") || s.includes("E")) return 6;
  const m = s.match(/\.(\d+)/);
  return m ? Math.min(m[1].length, 8) : 0;
};

export const fmtPx = (x, p) => {
  if (x === null || x === undefined) return "-";
  const n = Number(x);
  if (!Number.isFinite(n)) return "-";
  const maxFrac = Number.isFinite(p) ? p : inferDecimals(x);
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFrac,
  }).format(n);
};

const ds = (label, data, color) => ({
  label,
  data,
  borderColor: color,
  backgroundColor: color + "33",
  pointRadius: 0,
  borderWidth: 2,
  tension: .25,
  spanGaps: true
});
const getTs = (s) => new Date(s.time || s.entry_time || s.t || 0).getTime();
const combineDailyByDate = (arrays) => {
  const acc = new Map();
  arrays.flat().forEach(d => {
    const date = d.date;
    const p = Number(d.profit) || 0;
    acc.set(date, (acc.get(date) || 0) + p);
  });
  return Array.from(acc, ([date, profit
  ]) => ({
    date, profit
  }))
    .sort((a, b) => new Date(a.date) - new Date(b.date));
};


/* -------------------------- Lightweight indicators -------------------------- */
const sma = (arr, p) => {
  const out = new Array(arr.length).fill(null);
  let s = 0;
  for (let i = 0; i < arr.length; i++) {
    s += arr[i
    ];
    if (i >= p) s -= arr[i - p
    ];
    if (i >= p - 1) out[i
    ] = s / p;
  }
  return out;
};
const ema = (arr, p) => {
  const out = new Array(arr.length).fill(null);
  const k = 2 / (p + 1);
  let e = arr[
    0
  ] ?? 0;
  for (let i = 0; i < arr.length; i++) {
    e = i === 0 ? arr[i
    ] : arr[i
    ] * k + e * (1 - k);
    out[i
    ] = i < p - 1 ? null : e;
  }
  return out;
};
const rsiArr = (arr, p = 14) => {
  const out = new Array(arr.length).fill(null);
  let au = 0, ad = 0;
  for (let i = 1; i < arr.length; i++) {
    const ch = arr[i
    ] - arr[i - 1
      ];
    const u = Math.max(ch,
      0), d = Math.max(-ch,
        0);
    if (i <= p) {
      au += u; ad += d;
      if (i === p) {
        const rs = ad === 0 ? 1e9 : (au / p) / (ad / p);
        out[i
        ] = 100 - 100 / (1 + rs);
      }
    } else {
      au = (au * (p - 1) + u) / p;
      ad = (ad * (p - 1) + d) / p;
      const rs = ad === 0 ? 1e9 : (au / ad);
      out[i
      ] = 100 - 100 / (1 + rs);
    }
  }
  return out;
};

const macdArr = (arr, fast = 12, slow = 26, sig = 9) => {
  const ef = ema(arr, fast), es = ema(arr, slow);
  const m = arr.map((_, i) => (ef[i
  ] == null || es[i
  ] == null) ? null : ef[i
  ] - es[i
  ]);
  const s = ema(m.map(x => x ?? 0), sig);
  const h = m.map((x, i) => (x == null || s[i
  ] == null) ? null : x - s[i
  ]);
  return {
    macd: m, signal: s, hist: h
  };
};
const bbands = (arr, p = 20, k = 2) => {
  const mid = sma(arr, p), std = new Array(arr.length).fill(null);
  for (let i = p - 1; i < arr.length; i++) {
    let m = 0; for (let j = i - p + 1; j <= i; j++) m += arr[j
    ]; m /= p;
    let v = 0; for (let j = i - p + 1; j <= i; j++) {
      const d = arr[j
      ] - m; v += d * d;
    }
    v /= p; std[i
    ] = Math.sqrt(v);
  }
  const up = mid.map((m, i) => (m == null || std[i
  ] == null) ? null : m + k * std[i
  ]);
  const lo = mid.map((m, i) => (m == null || std[i
  ] == null) ? null : m - k * std[i
  ]);
  return {
    mid, up, lo
  };
};
// Kullanılacak parametre şablonları (compute_indicators ile uyumlu anahtarlar)
// --- GP param şablonları (compute_indicators ile uyumlu anahtarlar) ---
const GP_PARAM_TEMPLATES = {
  MACD: [
    { key: "macd_fast_default", label: "MACD Fast", type: "int", def: 12 },
    { key: "macd_slow_default", label: "MACD Slow", type: "int", def: 26 },
    { key: "macd_signal_default", label: "MACD Signal", type: "int", def: 9 },
  ],
  RSI: [{ key: "rsi_period", label: "RSI Period", type: "int", def: 14 }],
  EMA: [{ key: "ema_period", label: "EMA Period", type: "int", def: 20 }],
  SMA: [{ key: "sma_period", label: "SMA Period", type: "int", def: 50 }],
  CCI: [{ key: "cci_period", label: "CCI Period", type: "int", def: 20 }],
  ADX: [{ key: "adx_period", label: "ADX Period", type: "int", def: 14 }],
  AO: [
    { key: "ao_fast", label: "AO Fast", type: "int", def: 5 },
    { key: "ao_slow", label: "AO Slow", type: "int", def: 34 },
  ],
  // istersen buraya BB, MFI, vb. ekleyebilirsin
};

// indCatalog.params içindeki p.key → “aile” ismi
const GP_KEY_FAMILY = (rawKey) => {
  const k = String(rawKey).toLowerCase();
  if (k.includes("macd")) return "MACD";
  if (k.includes("rsi")) return "RSI";
  if (k.includes("ema")) return "EMA";
  if (k.includes("sma")) return "SMA";
  if (k.includes("cci")) return "CCI";
  if (k.includes("adx")) return "ADX";
  if (k.includes("ao")) return "AO";
  return null;
};

/* -------------------------------- UI micro components -------------------------------- */
function MetricCard({ title, value, subtitle, trend, color = "blue"
}) {
  const colorClasses = {
    blue: "from-blue-500/20 to-blue-600/10 border-blue-500/30",
    green: "from-green-500/20 to-green-600/10 border-green-500/30",
    red: "from-red-500/20 to-red-600/10 border-red-500/30",
    yellow: "from-yellow-500/20 to-yellow-600/10 border-yellow-500/30",
    purple: "from-purple-500/20 to-purple-600/10 border-purple-500/30"
  };
  return (
    <div className={`p-4 rounded-xl bg-gradient-to-br ${colorClasses[color
    ]
      } border backdrop-blur-sm`
    }>
      <div className="text-xs text-gray-300 uppercase tracking-wide mb-1">{title
      }</div>
      <div className="text-2xl font-bold text-white mb-1">{value
      }</div>
      {subtitle && <div className="text-xs text-gray-400">{subtitle
      }</div>
      }
      {typeof trend === "number" && (
        <div className={`flex items-center mt-2 text-xs ${trend >= 0 ? 'text-green-400' : 'text-red-400'
          }`
        }>
          {trend >= 0 ? <TrendingUp className="w-3 h-3 mr-1" /> : <TrendingDown className="w-3 h-3 mr-1" />
          }
          {Math.abs(trend).toFixed(2)
          }%
        </div>
      )
      }
    </div>
  );
}

const TabBtn = ({ active, onClick, children
}) => (
  <button onClick={onClick
  }
    className={`px-4 py-2 rounded-lg text-sm ${active ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white hover:bg-gray-700/50"
      }`
    }>
    {children
    }
  </button>
);
// --- PRESETS: Kaydet & Yükle ---
const exportPresets = () => {
  try {
    // İstediğimiz alanları topla (UI state adlarını kendi dosyana göre bırakıyorum)
    const payload = {
      version: 1,
      symbol, timeframe, // referans için
      costs: {
        fee_pct: Number(feePct), slippage_pct: Number(slipPct), leverage: Number(leverage)
      },
      strategies: strategies.map(s => ({
        id: s.id, name: s.name, enabled: !!s.enabled,
        side: s.side, method: s.method, maxIter: s.maxIter,
        expr: s.expr,
        indicators: s.indicators || {},
        optimize: s.optimize || {},
        extraParams: s.extraParams || {}
      })),
    };
    const blob = new Blob([JSON.stringify(payload,
      null,
      2)
    ],
      {
        type: "application/json"
      });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `presets_${symbol
      }_${timeframe
      }.json`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert("Export failed: " + e);
  }
};

const importPresets = (file) => {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const j = JSON.parse(String(reader.result || "{}"));
      if (!j || !Array.isArray(j.strategies)) throw new Error("Invalid file");

      // Basit şema-temizleme (alias → *_default normalizasyonu için istersen uygula)
      const cleaned = j.strategies.map(s => ({
        id: s.id || crypto.randomUUID?.() || String(Math.random()),
        name: s.name || "Imported",
        enabled: !!s.enabled,
        side: s.side ?? 1,
        method: s.method || "grid",
        maxIter: s.maxIter ?? 200,
        expr: s.expr || "",
        indicators: s.indicators || {},
        optimize: s.optimize || {},
        extraParams: s.extraParams || {},
      }));

      setStrategies(cleaned);
      // İsteğe bağlı: shared costs
      if (j.costs) {
        if (j.costs.fee_pct != null) setFeePct(Number(j.costs.fee_pct));
        if (j.costs.slippage_pct != null) setSlipPct(Number(j.costs.slippage_pct));
        if (j.costs.leverage != null) setLeverage(Number(j.costs.leverage));
      }
      setNotice?.("Presets imported ✔︎");
    } catch (e) {
      alert("Import failed: " + e);
    }
  };
  reader.readAsText(file);
};
// Bir grubun (örn. SMA) aktif stratejide hangi kopyaları ("" , "1", "2" …) olduğunu bul
function groupInstances(g, indicators) {
  const keys = Object.keys(indicators || {});
  const sufSet = new Set([""]); // "" = ilk kopya (suffix yok)
  (g.params || []).forEach(p => {
    const re = new RegExp(`^${p.key}(\\d*)$`);
    keys.forEach(k => {
      const m = k.match(re);
      if (m) sufSet.add(m[1] || "");
    });
  });
  // Eğer hiç yoksa boş küme döndür
  const out = Array.from(sufSet).filter(s => {
    return (g.params || []).some(p => indicators?.[p.key + s] != null);
  });
  return out.sort((a, b) => (a === "" ? -1 : +a) - (b === "" ? -1 : +b));
}

// Yeni kopya ekle: kullanılmayan en küçük suffix'i bul ve varsayılanları yaz
function addIndicatorGroup(groupId) {
  const g = indCatalog.find(x => x.id === groupId);
  if (!g || !activeStratId) return;
  patchStrategyDeep(activeStratId, s => {
    const ind = { ...(s.indicators || {}) };
    // mevcut suffix'leri topla
    const used = new Set([""]);
    (g.params || []).forEach(p => {
      const re = new RegExp(`^${p.key}(\\d*)$`);
      Object.keys(ind).forEach(k => {
        const m = k.match(re);
        if (m) used.add(m[1] || "");
      });
    });
    // boş (ilk) kullanılmışsa 1,2,3 … dene
    let suf = "";
    if (used.has("")) {
      let i = 1;
      while (used.has(String(i))) i++;
      suf = String(i);
    }
    // paramları yaz
    (g.params || []).forEach(p => {
      ind[p.key + suf] = ind[p.key + suf] ?? p.def;
    });
    s.indicators = ind;
    return s;
  });
}
// NEW: Strategy -> exit_scheme builder (event-driven için)
function buildExitSchemeFromStrategy(strategy) {
  const exit = strategy?.exitConfig || {};

  switch (exit.type || "fixed") {
    case "fixed":
      return {
        type: "fixed",
        tp_pct: (exit.tpPct || 1.0) / 100,
        sl_pct: (exit.slPct || 2.0) / 100
      };

    case "atr":
      return {
        type: "atr",
        atr_n: exit.atrN || 14,
        k_sl: exit.kSL || 2.0,
        m_tp: exit.mTP || 2.0
      };

    case "chandelier":
      return {
        type: "chandelier",
        n: exit.chN || 22,
        factor: exit.chK || 3.0
      };

    case "bollinger":
      return {
        type: "bollinger",
        n: exit.bbN || 20,
        std: exit.bbStd || 2.0,
        ma: exit.bbMa || "SMA",
        side: exit.bbSide || "upper"
      };

    case "trailing_pct":
      return {
        type: "trailing_pct",
        trail_pct: (exit.trailPct || 1.0) / 100
      };

    default:
      return { type: "fixed", tp_pct: 0.01, sl_pct: 0.02 };
  }
}

// Etikete suffix ekler (örn. "SMA Period" -> "SMA Period 1")
const labelWithSuf = (txt, suf) => txt + (suf ? ` ${suf}` : "");



/* ===================================== APP ===================================== */
export default function App() {

  /* ---------- Global/UI state ---------- */
  const [activeTab, setActiveTab
  ] = useState("setup");
  const [busy, setBusy
  ] = useState(false);
  // indirme meta bilgisi (UI rozetleri için)
  const [downloadInfo, setDownloadInfo
  ] = useState(null);
  const [exitResults, setExitResults] = useState(null);
  // --- Generator Tab state'leri ---
  // Seçili indikatör anahtarları (indCatalog -> p.key)
  const [gpSelectedKeys, setGpSelectedKeys] = useState(new Set());
  // --- GP indicator select + param edit ---
  const [gpTerms, setGpTerms] = useState([]);              // sol listedeki seçenekler (label+key)
  const [gpSelected, setGpSelected] = useState(new Set()); // seçili anahtarlar (örn. "RSI", "SMA", "MACD_hist")
  const [gpParamMap, setGpParamMap] = useState({});        // { "RSI": { rsi_period: 14 }, "SMA": { sma_period: 50 }, ... }
  const [gpIndParams, setGpIndParams] = useState({});

  const [gpPopulation, setGpPopulation] = useState(100);
  const [gpGenerations, setGpGenerations] = useState(50);
  const [gpCrossover, setGpCrossover] = useState(0.7);
  const [gpMutation, setGpMutation] = useState(0.2);
  const [gpObjective, setGpObjective] = useState("sharpe"); // "sharpe" | "profit" | "winRate"
  const [gpResult, setGpResult] = useState(null);

  useEffect(() => {
    if (activeTab !== "generator") return;
    // Statik, anlaşılır bir liste:
    const terms = [
      { key: "RSI", label: "RSI" },
      { key: "SMA", label: "SMA" },
      { key: "EMA", label: "EMA" },
      { key: "MACD", label: "MACD (fast/slow/signal)" },
      { key: "MACD_hist", label: "MACD Histogram" },
      { key: "CCI", label: "CCI" },
      { key: "ADX", label: "ADX" },
      { key: "AO", label: "Awesome Oscillator" },
      { key: "BB", label: "Bollinger Bands" },
      { key: "MFI", label: "MFI" },
      // istediğini ekle
    ];
    setGpTerms(terms);

    // varsayılan seçimler ve param map
    const defaultSel = new Set(["RSI", "SMA", "EMA", "MACD_hist"]);
    setGpSelected(defaultSel);

    const initParams = {};
    for (const k of defaultSel) {
      (GP_PARAM_TEMPLATES[k] || []).forEach(p => {
        initParams[p.key] = p.def;
      });
    }
    setGpParamMap(initParams);
  }, [activeTab]);


  const toggleTerm = (key) => {
    setGpSelected(prev => {
      const next = new Set(prev);
      const willSelect = !next.has(key);
      if (willSelect) {
        next.add(key);
        // Varsayılan paramları yoksa ekle
        setGpParamMap(prevParams => {
          const cur = { ...prevParams };
          (GP_PARAM_TEMPLATES[key] || []).forEach(p => {
            if (typeof cur[p.key] === "undefined") cur[p.key] = p.def;  // <-- p.def
          });
          return cur;
        });
      } else {
        next.delete(key);
        // Aynı param anahtarını başka aile de kullanabildiği için SILMEK zorunda değiliz.
        // İstersen tüm paramlarını kaldırmak için aşağıyı aç:
        /*
        setGpParamMap(prevParams => {
          const cur = { ...prevParams };
          (GP_PARAM_TEMPLATES[key] || []).forEach(p => { delete cur[p.key]; });
          return cur;
        });
        */
      }
      return next;
    });
  };

  const updateParam = (pkey, raw, typ) => {
    let v = raw;
    if (typ === "int") v = parseInt(raw || 0, 10);
    if (typ === "float") v = parseFloat(String(raw || "0").replace(",", "."));
    setGpParamMap(prev => ({ ...prev, [pkey]: v }));
  };





  // küçük yardımcılar
  const fmtBytes = (b) => {
    if (b == null) return "";
    const u = [
      "B",
      "KB",
      "MB",
      "GB",
      "TB"
    ]; let i = 0, v = Number(b);
    while (v >= 1024 && i < u.length - 1) {
      v /= 1024; i++;
    }
    return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)
      } ${u[i
      ]
      }`;
  };
  const shortId = (s) => (s ? String(s).slice(0,
    8) : "");

  const [progress, setProgress
  ] = useState(0);
  const [err, setErr
  ] = useState("");
  const [notice, setNotice
  ] = useState("");
  const [jobId, setJobId
  ] = useState(null);
  const [abortCtrl, setAbortCtrl
  ] = useState(null);
  const DEFAULT_IND_CATALOG = [
    {
      id: "MACD", name: "MACD", params: [
        { key: "macd_fast_default", label: "MACD Fast", def: 6 },
        { key: "macd_slow_default", label: "MACD Slow", def: 18 },
        { key: "macd_signal_default", label: "MACD Signal", def: 9 },
      ]
    },
    {
      id: "SMA", name: "Simple Moving Average", params: [
        { key: "sma_period", label: "SMA Period", def: 21 },
      ]
    },
    {
      id: "EMA", name: "Exponential Moving Average", params: [
        { key: "ema_period", label: "EMA Period", def: 21 },
      ]
    },
    {
      id: "RSI", name: "RSI", params: [
        { key: "rsi_range", label: "RSI Range", def: 340 },
      ]
    },
    {
      id: "BOLL", name: "Bollinger Bands", params: [
        { key: "bb_period", label: "BB Length", def: 20 },
        { key: "bb_std", label: "BB StdDev (k)", def: 2.0 },
      ]
    },
    { id: "ADX", name: "ADX", params: [{ key: "adx_period", label: "ADX Period", def: 11 }] },
    {
      id: "ChaikinVol", name: "Chaikin Volatility", params: [
        { key: "chaikin_vol_span", label: "EMA Span", def: 10 },
        { key: "chaikin_vol_change", label: "Change Period", def: 10 },
      ]
    },
    { id: "Momentum", name: "Momentum", params: [{ key: "mom_period", label: "Period", def: 10 }] },
    { id: "ROC", name: "Rate of Change", params: [{ key: "roc_period", label: "Period", def: 10 }] },
    { id: "MFI", name: "Money Flow Index", params: [{ key: "mfi_period", label: "Period", def: 14 }] },
    { id: "DeM", name: "DeMarker", params: [{ key: "dem_period", label: "Period", def: 14 }] },
    {
      id: "StochRSI", name: "Stochastic RSI", params: [
        { key: "stoch_rsi_rsi_period", label: "RSI Period", def: 14 },
        { key: "stoch_rsi_length", label: "Stoch Length", def: 14 },
        { key: "stoch_rsi_smooth_k", label: "Smooth K", def: 3 },
        { key: "stoch_rsi_smooth_d", label: "Smooth D", def: 3 },
      ]
    },
    {
      id: "WeightedStd", name: "Weighted Std", params: [
        { key: "weighted_std_win0", label: "Win 0", def: 10 },
        { key: "weighted_std_win1", label: "Win 1", def: 20 },
      ]
    },
    {
      id: "NDMA", name: "NDMA (wstd1/close)", params: [
        { key: "weighted_std_win1", label: "wstd1 Window", def: 20 },
      ]
    },
  ];



  /* ---------- Inputs ---------- */
  const [symbol, setSymbol
  ] = useState("ORDIUSDT");
  const [timeframe, setTimeframe
  ] = useState("5m");
  const [start, setStart
  ] = useState("2025-09-01T00:00:00Z");
  const [end, setEnd
  ] = useState("2025-09-05T00:00:00Z");
  const [useSnapshot, setUseSnapshot
  ] = useState(true);
  const [snapshotId, setSnapshotId
  ] = useState("");
  const [validateMsg, setValidateMsg
  ] = useState("");

  // --- [STATE] Exits UI kontrolleri (dosyanın üst kısmında, diğer useState'lerin yanına) ---
  const [stopType, setStopType] = useState("fixed"); // "fixed" | "atr" | "chandelier" | "bollinger" | "trailing_pct"
  const [compareExits, setCompareExits] = useState(true);
  const [overrideGlobalStops, setOverrideGlobalStops] = useState(true);


  // Fixed %
  const [tpPct, setTpPct] = useState(1.0);
  const [slPct, setSlPct] = useState(2.0);

  // ATR
  const [atrN, setAtrN] = useState(14);
  const [kSL, setKSL] = useState(2.0);
  const [mTP, setMTP] = useState(2.0);

  // Chandelier
  const [chN, setChN] = useState(22);
  const [chK, setChK] = useState(3.0);

  // Bollinger
  const [bbMa, setBbMa] = useState("SMA"); // "SMA" | "EMA"
  const [bbN, setBbN] = useState(20);
  const [bbStd, setBbStd] = useState(2.0);
  const [bbSide, setBbSide] = useState("upper"); // "upper" | "lower" | "mid"

  // Trailing %
  const [trailPct, setTrailPct] = useState(1.0);

  const [leverage, setLeverage
  ] = useState(2);
  const [feePct, setFeePct
  ] = useState(0.1);
  const [slipPct, setSlipPct
  ] = useState(0.05);
  const [backtestMode, setBacktestMode
  ] = useState("vectorized"); // "vectorized" | "event"
  // Strategy (DSL) state'leri
  const [expr, setExpr
  ] = useState("close > open"); // örnek başlangıç
  const [paramJson, setParamJson
  ] = useState("{}"); // JSON string; {"rsi_len":14} gibi
  // Yanlış (alias) indikatör isimlerini doğru *_default isimlerine taşır ve temizler
  // alias → *_default dönüştürüp alias'ları kaldırır
  const normalizeIndicatorKeys = (inds) => {
    const out = {
      ...(inds || {})
    };
    const alias = {
      macd_fast: "macd_fast_default",
      macd_slow: "macd_slow_default",
      macd_signal: "macd_signal_default",
    };
    for (const [src, dst
    ] of Object.entries(alias)) {
      if (src in out) {
        if (!(dst in out)) out[dst
        ] = Number(out[src
        ]);
        delete out[src
        ];
      }
    }
    return out;
  };
  const readWinRate = (stats) => {
    if (!stats) return 0;
    const wr = (stats.winrate ?? stats.wr);
    if (wr !== undefined && wr !== null) return Number(wr);
    const wins = Number(stats.wins ?? 0);
    const n = Number(stats.trades ?? 0);
    return n > 0 ? (wins / n) * 100 : 0;
  };

  const fmtPct = (x, digits = 3) => `${(Number(x) || 0).toFixed(digits)}%`;


  // --- [HELPER] seçime göre exit scheme üret ---

  function buildExitSchemes() {
    // Tek şema
    const single = (() => {
      switch (stopType) {
        case "fixed":
          return { type: "fixed", tp_pct: tpPct / 100, sl_pct: slPct / 100 };
        case "atr":
          return { type: "atr", atr_n: atrN, k_sl: kSL, m_tp: mTP };
        case "chandelier":
          return { type: "chandelier", n: chN, factor: chK };
        case "bollinger":
          return { type: "bollinger", ma: bbMa, n: bbN, std: bbStd, side: bbSide };
        case "trailing_pct":
          return { type: "trailing_pct", trail_pct: trailPct / 100 };
        default:
          return { type: "fixed", tp_pct: tpPct / 100, sl_pct: slPct / 100 };
      }
    })();

    if (!compareExits) return [single];

    // Karşılaştırma açıkken: seçili şemaya ek 2–3 referans şema
    const baseline = { type: "fixed", tp_pct: 0.01, sl_pct: 0.02 }; // %1/%2
    const alt1 = { type: "chandelier", n: 22, factor: 3.0 };
    const alt2 = { type: "atr", atr_n: 14, k_sl: 2.0, m_tp: 2.0 };

    // yineleneni filtrele
    const uniq = [single, baseline, alt1, alt2].filter(
      (v, i, a) => i === a.findIndex(t => JSON.stringify(t) === JSON.stringify(v))
    );
    return uniq;
  }


  // --- helpers (top-level) ---
  const pickParamPairs = (r) => Object.entries(r?.params || {})
    .filter(([k
    ]) => /^macd_(fast|slow|signal)_default$/.test(k));

  const shortKey = (k) =>
    k.replace('_default', '')
      .replace('macd_fast', 'm.fast')
      .replace('macd_slow', 'm.slow')
      .replace('macd_signal', 'm.sig');

  const applyParamsFromResult = (r) => {
    const p = r?.params || {};
    patchStrategyDeep(activeStratId, s => {
      s.indicators = {
        ...(s.indicators || {}),
        ...(p.macd_fast_default != null ? {
          macd_fast_default: Number(p.macd_fast_default)
        } : {}),
        ...(p.macd_slow_default != null ? {
          macd_slow_default: Number(p.macd_slow_default)
        } : {}),
        ...(p.macd_signal_default != null ? {
          macd_signal_default: Number(p.macd_signal_default)
        } : {}),
      };
      return s;
    });
  };
  // Preset Export/Import Functions
  const exportPresets = () => {
    try {
      // Strategies array'inden preset verilerini topla
      const presetData = {
        version: "1.0",
        exportDate: new Date().toISOString(),
        strategies: strategies.map(strategy => ({
          id: strategy.id,
          name: strategy.name,
          method: strategy.method || "grid",
          maxIter: strategy.maxIter ?? 200,
          indicators: strategy.indicators || {},
          optimize: strategy.optimize || {}
        }))
      };

      // JSON'u string'e çevir
      const dataStr = JSON.stringify(presetData, null, 2);

      // Blob oluştur
      const blob = new Blob([dataStr], { type: "application/json" });

      // Download URL oluştur
      const url = URL.createObjectURL(blob);

      // Gizli link oluştur ve tıkla
      const link = document.createElement('a');
      link.href = url;
      link.download = `trading-presets-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(link);
      link.click();

      // Cleanup
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      console.log('Preset successfully exported!');
    } catch (error) {
      console.error('Error exporting presets:', error);
      alert('Preset export failed: ' + error.message);
    }
  };


  const importPresets = (file) => {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const presetData = JSON.parse(e.target.result);

        // Veri formatını kontrol et
        if (!presetData.strategies || !Array.isArray(presetData.strategies)) {
          throw new Error('Invalid preset format: missing strategies array');
        }

        // Her strateji için verileri güncelle
        presetData.strategies.forEach(importedStrategy => {
          const existingStrategyIndex = strategies.findIndex(s => s.id === importedStrategy.id);

          if (existingStrategyIndex >= 0) {
            // Mevcut stratejiyi güncelle
            patchStrategy(importedStrategy.id, {
              method: importedStrategy.method || "grid",
              maxIter: importedStrategy.maxIter ?? 200,
              indicators: importedStrategy.indicators || {},
              optimize: importedStrategy.optimize || {}
            });
          } else {
            console.warn(`Strategy with id "${importedStrategy.id}" not found, skipping...`);
          }
        });

        console.log('Presets successfully imported!');
        alert(`Successfully imported ${presetData.strategies.length} strategy presets!`);

      } catch (error) {
        console.error('Error importing presets:', error);
        alert('Preset import failed: ' + error.message);
      }
    };

    reader.onerror = () => {
      alert('Error reading file');
    };

    reader.readAsText(file);
  };

  // Ana Component'te Preset Butonları
  <div className="flex items-center gap-2">
    <button
      type="button"
      onClick={exportPresets}
      className="px-3 py-2 rounded bg-slate-600 hover:bg-slate-500 text-white text-sm transition-colors flex items-center gap-2"
      title="Export all strategy settings to JSON file"
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
      Export Presets
    </button>

    <label className="px-3 py-2 rounded bg-slate-700 hover:bg-slate-600 text-white text-sm cursor-pointer transition-colors flex items-center gap-2">
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
      </svg>
      Import Presets
      <input
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={e => {
          const f = e.target.files?.[0];
          if (f) importPresets(f);
          e.target.value = "";
        }}
      />
    </label>

    {/* Optional: Clear all presets button */}
    <button
      type="button"
      onClick={() => {
        if (confirm('Are you sure you want to reset all strategies to default values?')) {
          strategies.forEach(strategy => {
            patchStrategy(strategy.id, {
              method: "grid",
              maxIter: 200,
              indicators: {},
              optimize: {}
            });
          });
          alert('All presets cleared!');
        }
      }}
      className="px-3 py-2 rounded bg-red-600 hover:bg-red-500 text-white text-sm transition-colors flex items-center gap-2"
      title="Reset all strategies to default values"
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
      </svg>
      Clear All
    </button>
  </div>

  // Export Edilen JSON Format Örneği:
  /*
  {
    "version": "1.0",
    "exportDate": "2024-09-16T10:30:00.000Z",
    "strategies": [
      {
        "id": "strategy_a",
        "name": "Strategy A",
        "method": "grid",
        "maxIter": 200,
        "indicators": {
          "macd_fast_default": 12,
          "macd_slow_default": 26,
          "macd_signal_default": 9,
          "rsi_period": 14,
          "bb_period": 20
        },
        "optimize": {
          "macd_fast_default": {
            "min": 6,
            "max": 20,
            "step": 2
          },
          "rsi_period": {
            "min": 10,
            "max": 30,
            "step": 2
          }
        }
      }
    ]
  }
  */

  // === Costs state (v1) — BEGIN ===
  // Costs defaults — leverage'ı BURADAN kaldır
  const [costs, setCosts] = useState({
    fee_mode: "Manual",
    maker_bps: 1.0,
    taker_bps: 5.0,
    slip_model: "FixedBps",
    slip_params: { fixed_bps: 8.0, k: 20, alpha: 0.7, n: 20, cap_bps: 50 },
    funding_mode: "Off",
    funding_rate_bps: 0,
    funding_interval_h: 8,
    // leverage: (KALDIRILDI) — tek kaynak: Setup'taki leverage state
    notional_mode: "FixedUSD",
    fixed_usd: 1000,
    pct_equity: 0.10,
  });

  // Çift yönlü senkronizasyonu TAMAMEN kaldır
  // (Aşağıdaki iki useEffect BLOĞUNU silin)

  const [indCatalog, setIndCatalog] = useState(DEFAULT_IND_CATALOG);
  const [showIndAdd, setShowIndAdd] = useState(false);

  // 1) Katalogu yükle
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${API_BASE}/indicators/catalog`);
        const j = await r.json();
        const filteredGroups = (j.groups || []).filter(g => g.id !== "volatility");
        setIndCatalog(filteredGroups);
      } catch (e) {
        console.error("indicators/catalog failed", e);
      }
    })();
  }, []);

  // 2) Sadece costs.leverage -> leverage (tek yön, loop yok)
  const prevCostsLev = useRef();
  useEffect(() => {
    const v = Number(costs.leverage ?? 1);
    if (prevCostsLev.current !== v) {
      prevCostsLev.current = v;
      if (v !== leverage) setLeverage(v);
    }
  }, [costs.leverage, leverage]);

  // 3) Strateji indikatörlerini normalize + MACD temizlik (tek sefer)
  useEffect(() => {
    setStrategies(prev =>
      prev.map(st => {
        const norm = normalizeIndicatorKeys(st.indicators);
        const cleaned = Object.fromEntries(
          Object.entries(norm || {}).filter(([k]) => !/^macd_(?!.*_default)/i.test(k))
        );
        return { ...st, indicators: cleaned };
      })
    );
  }, []);





  // === Costs state (v1) — END ===
  /* ---------- Default expressions (Long & Short) ---------- */
  const longExpr = `
    (
  (data['bb_lo'].shift(1) - data['close'].shift(1)) < 0
  & (data['RSI_diff'].shift(1) > -13)
  & ((data['SMA'].shift(1) > data['SMA'].shift(2))
     & (data['SMA'] < data['SMA'].shift(1))
     & (data['hist'] < 0))
)

  `;

  const shortExpr = `(
    ((data['NDMA'
    ] > 0.00022) & (data['NDMA'
    ] < 0.0252)) &
    
    ((data['EMA'
    ].shift(1) > data['EMA'
    ].shift(2)) &
     (data['EMA'
    ] < data['EMA'
    ].shift(1)) &
     (data['hist'
    ] < 0)) &
    (data['hist'
    ].shift(1) > 0)
  )`;

  // App.jsx dosyasındaki initialStrategies sabitini bu blokla değiştirin.
  const initialStrategies = useMemo(() => [
    {
      id: uid(), name: "Strategy A (Long)", enabled: true, side: 1, leverage: 2, exitConfig: {
        type: "fixed",  // "fixed" | "atr" | "chandelier" | "bollinger" | "trailing_pct"

        // Fixed params
        tpPct: 1.0,
        slPct: 2.0,

        // ATR params  
        atrN: 14,
        kSL: 2.0,
        mTP: 2.0,

        // Chandelier params
        chN: 22,
        chK: 3.0,

        // Bollinger params
        bbMa: "SMA",
        bbN: 20,
        bbStd: 2.0,
        bbSide: "upper",

        // Trailing params
        trailPct: 1.0
      },

      expr: longExpr,


      filters: [],
      indicators: {
        // MACD (Mevcut)
        macd_fast_default: 6, macd_slow_default: 18, macd_signal_default: 9,

        // --- YENİ EKLENENLER ---
        // SMA
        sma_period: 21,

        // Bollinger
        bb_period: 20,
        bb_std: 2.0,

        // RSI_Diff (RSI Farkı)
        rsi_short: 10,
        rsi_long: 60,
        // --- EKLENENLER SONU ---
      },
      optimize: {
        macd_fast_default: {
          min: 6, max: 20, step: 2
        }, macd_slow_default: {
          min: 18, max: 40, step: 2
        }, macd_signal_default: {
          min: 5, max: 15, step: 1
        }
      },
      method: "grid", maxIter: 200
    },
    {
      id: uid(), name: "Strategy B (Short)", enabled: true, side: -1, leverage: 2, exitConfig: {
        type: "fixed",  // "fixed" | "atr" | "chandelier" | "bollinger" | "trailing_pct"

        // Fixed params
        tpPct: 1.0,
        slPct: 2.0,

        // ATR params  
        atrN: 14,
        kSL: 2.0,
        mTP: 2.0,

        // Chandelier params
        chN: 22,
        chK: 3.0,

        // Bollinger params
        bbMa: "SMA",
        bbN: 20,
        bbStd: 2.0,
        bbSide: "upper",

        // Trailing params
        trailPct: 1.0
      }, expr: shortExpr,
      filters: [],
      indicators: {
        macd_fast_default: 6, macd_slow_default: 18, macd_signal_default: 9,
        ema_period: 21, ndma_window: 20,
      },
      optimize: {
        macd_fast_default: {
          min: 6, max: 20, step: 2
        }, macd_slow_default: {
          min: 18, max: 40, step: 2
        }, macd_signal_default: {
          min: 5, max: 15, step: 1
        }
      },
      method: "grid", maxIter: 200
    }
  ],
    []);

  // Aynı grup için benzersiz sonek üret ( "", "1", "2", ... )
  // --- suffix helpers (tek kaynak) ---
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // Bu grup için (mevcut indicators'a bakarak) kullanılan sonekleri topla.
  // "" = soneksiz ilk örnek
  const usedSuffixesForGroup = (ind = {}, group) => {
    const used = new Set();
    for (const p of (group.params || [])) {
      const base = p.key; // örn: "sma_period"
      if (Object.prototype.hasOwnProperty.call(ind, base)) used.add("");
      const re = new RegExp("^" + esc(base) + "(\\d+)$");
      for (const k of Object.keys(ind)) {
        const m = k.match(re);
        if (m) used.add(m[1]); // "1","2",...
      }
    }
    return used;
  };

  // Bir sonraki uygun soneki üret: "" -> "1" -> "2" ...
  const nextSuffixForGroup = (ind = {}, group) => {
    const used = usedSuffixesForGroup(ind, group);
    if (!used.has("")) return "";            // hiç eklenmemişse ilk örnek soneksiz
    let i = 1; while (used.has(String(i))) i++;
    return String(i);
  };


  // Katalogtan eklenen grubu, benzersiz anahtarlarla indicators'a yaz
  const addIndicatorGroup = (groupId) => {
    const g = indCatalog.find(x => x.id === groupId);
    if (!g || !activeStratId) return;

    patchStrategyDeep(activeStratId, (s) => {
      const ind = { ...(s.indicators || {}) };
      const suf = nextSuffixForGroup(ind, g); // ← YENİ: param anahtarlarına göre sonek

      for (const p of (g.params || [])) {
        const key = suf ? `${p.key}${suf}` : p.key;  // örn: "sma_period2"
        if (ind[key] == null) ind[key] = p.def;
      }
      s.indicators = ind;
      return s;
    });
  };
  const groupInstances = (group, indicators) => {
    const ind = indicators || {};
    const bases = (group.params || []).map(p => p.key);
    if (!bases.length) return [];

    // Bu gruba ait tüm sonekleri yakala
    const suffixes = new Set();
    for (const base of bases) {
      // soneksiz (ilk) var mı?
      if (Object.prototype.hasOwnProperty.call(ind, base)) suffixes.add("");
      // son ekli anahtarları tara
      const re = new RegExp("^" + esc(base) + "(\\d+)$");
      for (const k of Object.keys(ind)) {
        const m = k.match(re);
        if (m) suffixes.add(m[1]);
      }
    }

    // filtre: bu gruba ait paramlardan EN AZ BİRİ gerçekten varsa
    const out = Array.from(suffixes).filter(suf =>
      (group.params || []).some(p => ind[suf ? `${p.key}${suf}` : p.key] != null)
    );

    // "" (ilk) öne; sonra numerikler artan
    return out.sort((a, b) => (a === "" ? -1 : +a) - (b === "" ? -1 : +b));
  };





  /* ---------- Multi-Strategy ---------- */
  const [strategies, setStrategies
  ] = useState(() => clone(initialStrategies));
  const [activeStratId, setActiveStratId
  ] = useState(() => initialStrategies[
    0
  ].id);
  const activeStrat = useMemo(
    () => strategies.find(s => s.id === activeStratId) || strategies[
      0
    ],
    [strategies, activeStratId
    ]
  );
  const patchStrategy = (id, patch) => setStrategies(p => p.map(s => (s.id === id ? {
    ...s, ...patch
  } : s)));
  const patchStrategyDeep = (id, updater) => setStrategies(p => p.map(s => (s.id === id ? updater(clone(s)) : s)));
  const removeStrategy = (id) => {
    setStrategies(prev => {
      // Son stratejinin silinmesini engelle
      if (prev.length <= 1) {
        return prev;
      }

      const nextStrategies = prev.filter(s => s.id !== id);

      // Eğer silinen strateji aktif olan ise, yeni bir aktif strateji seç
      if (activeStratId === id) {
        // Kalan stratejilerden ilkini yeni aktif strateji olarak ata
        setActiveStratId(nextStrategies[0].id);
      }

      return nextStrategies;
    });
  };
  // removeIndicatorInstance: belirli bir grup + sonek için paramları siler
  const removeIndicatorInstance = (groupId, suffix = "") => {
    if (!activeStratId) return;
    const g = indCatalog.find(x => x.id === groupId);
    if (!g) return;

    // suffix "" (ilk kopya) olabilir; "1","2"... da olabilir
    const suf = suffix == null ? "" : String(suffix);

    patchStrategyDeep(activeStratId, (s) => {
      const nextIndicators = { ...(s.indicators || {}) };
      const nextOptimize = { ...(s.optimize || {}) };

      (g.params || []).forEach(p => {
        const key = suf ? `${p.key}${suf}` : p.key;
        if (Object.prototype.hasOwnProperty.call(nextIndicators, key)) {
          delete nextIndicators[key];
        }
        if (Object.prototype.hasOwnProperty.call(nextOptimize, key)) {
          delete nextOptimize[key];
        }
      });

      s.indicators = nextIndicators;
      s.optimize = nextOptimize;
      return s;
    });
  };



  // ------------------------------------------------------------
  // Preset İndir/Yükle yardımcıları
  // ------------------------------------------------------------
  function downloadJson(filename, data) {
    const blob = new Blob([JSON.stringify(data,
      null,
      2)
    ],
      {
        type: "application/json"
      });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
  // Tüm kurulum + stratejileri dışa aktar (DSL + indicators + extraParams + optimize + filters + global ayarlar)
  const exportPreset = () => {
    try {
      const payload = {
        meta: {
          version: 1,
          exported_at: new Date().toISOString()
        },
        globals: {
          symbol, timeframe, start, end,
          useSnapshot, snapshotId,
          tpPct, slPct, leverage, feePct, slipPct,
          backtestMode,
          // varsa setCosts kullanılan bir state'in varsa buraya ekleyebilirsin:
          // costs
        },
        strategies: strategies.map(s => ({
          name: s.name,
          enabled: !!s.enabled,
          side: Number(s.side || 1),
          expr: s.expr || "",
          // indicator default değerleri (ör. macd_fast_default vs)
          indicators: {
            ...(s.indicators || {})
          },
          // manuel parametreler
          extraParams: {
            ...(s.extraParams || {})
          },
          // optimize aralıkları (search space)
          optimize: {
            ...(s.optimize || {})
          },
          // stratejiye kaydedilen filtreler (UI'dan geliyor)
          filters: Array.isArray(s.filters) ? s.filters : [],
          method: s.method || "grid",
          maxIter: Number(s.maxIter ?? 200)
        }))
      };

      const fname = `preset_${symbol
        }_${timeframe
        }.json`;
      downloadJson(fname, payload);
    } catch (e) {
      setErr(`Preset export hatası: ${e.message || e
        }`);
    }
  };


  // JSON dosyasından içe aktar
  const importPresetFile = async (file) => {
    try {
      const text = await file.text();
      const j = JSON.parse(text);

      // Global alanları uygula (varsa)
      if (j.globals && typeof j.globals === "object") {
        const g = j.globals;
        if (g.symbol != null) setSymbol(String(g.symbol));
        if (g.timeframe != null) setTimeframe(String(g.timeframe));
        if (g.start != null) setStart(String(g.start));
        if (g.end != null) setEnd(String(g.end));
        if (g.useSnapshot != null) setUseSnapshot(!!g.useSnapshot);
        if (g.snapshotId != null) setSnapshotId(String(g.snapshotId));
        if (g.tpPct != null) setTpPct(Number(g.tpPct));
        if (g.slPct != null) setSlPct(Number(g.slPct));
        if (g.leverage != null) setLeverage(Number(g.leverage));
        if (g.feePct != null) setFeePct(Number(g.feePct));
        if (g.slipPct != null) setSlipPct(Number(g.slipPct));
        if (g.backtestMode != null) setBacktestMode(String(g.backtestMode));
        // if (g.costs) setCosts(g.costs);  // projende costs state'i varsa aç
      }
      // Stratejiler
      const imported = Array.isArray(j.strategies) ? j.strategies : [];
      const arr = imported.map((s, i) => ({
        id: uid(),
        name: s.name || `Strategy ${i + 1
          }`,
        enabled: !!s.enabled,
        side: Number(s.side ?? 1),
        expr: s.expr || "",
        indicators: normalizeIndicatorKeys(s.indicators || {}), // alias -> *_default
        extraParams: {
          ...(s.extraParams || {})
        },
        optimize: {
          ...(s.optimize || {})
        },
        filters: Array.isArray(s.filters) ? s.filters : [],
        method: s.method || "grid",
        maxIter: Number(s.maxIter ?? 200)
      }));

      if (arr.length) {
        setStrategies(arr);
        setActiveStratId(arr[
          0
        ].id);
        setNotice(`Preset içe aktarıldı (${arr.length
          } strateji).`);
      } else {
        setNotice("Preset içe aktarıldı ama strateji bulunamadı.");
      }
    } catch (e) {
      setErr(`Preset import hatası: ${e.message || e
        }`);
    }
  };



  /* ---------- Strategy Preview state ---------- */
  const [lookbackDays, setLookbackDays
  ] = useState(5);
  const [previewBars, setPreviewBars
  ] = useState([]);
  const [overlay, setOverlay
  ] = useState({
    emaFast: true, emaSlow: false, bb: false, rsi: false, macd: false
  });
  const [bbP, setBbP
  ] = useState(20);
  const [bbK, setBbK
  ] = useState(2);
  const [rsiP, setRsiP
  ] = useState(14);
  // Varsayılan katalog (veya backend'ten çektiğin şema aynı olmalı)

  /* ---------- Filters (UI local) ---------- */

  const defaultFilterKeys = [
    "NDMA",
    "NDMA1",
    "hist",
    "RSI_10",
    "rsi_diff",
    "lower_band",
    "SMA",
    "roc",
    "adx",
    "cci",
    "vi_diff",
    "money_flow_index",
    "chaikin_volatility",
    "Demarker"
  ];
  const [filtersLocal, setFiltersLocal
  ] = useState(defaultFilterKeys.slice(0,
    3).map(k => ({
      key: k, enabled: false, min: "", max: ""
    })));
  const [pristineFilters, setPristineFilters] = useState([]);
  const [filterSuggest, setFilterSuggest
  ] = useState(null);
  const [filterCoverage, setFilterCoverage
  ] = useState(70); // %
  const [filterMethod, setFilterMethod] = useState("random"); // Varsayılan: random
  const [algoParams, setAlgoParams] = useState({ samples: 12000 });



  useEffect(() => {
    const s = strategies.find(x => x.id === activeStratId);
    const arr = s?.filters?.length ? s.filters : defaultFilterKeys.slice(0,
      3).map(k => ({
        key: k, enabled: false, min: "", max: ""
      }));
    setFiltersLocal(arr);
    setPristineFilters(clone(arr));
  },
    [activeStratId
    ]); // değiştikçe UI'ya aktar


  // Flicker fix: filtersLocal -> strategy.filters sadece "değiştiyse" yaz
  const lastSavedFiltersRef = useRef("");
  useEffect(() => {
    const json = JSON.stringify(filtersLocal);
    if (json !== lastSavedFiltersRef.current) {
      lastSavedFiltersRef.current = json;
      patchStrategy(activeStratId,
        {
          filters: filtersLocal
        });
    }
  },
    [filtersLocal, activeStratId
    ]);
  const handleResetFilters = () => {
    if (pristineFilters) {
      setFiltersLocal(clone(pristineFilters));
    }
    // Reset other filter-related UI states to their defaults
    setFilterCoverage(70);
    setFilterMethod("random");
    setAlgoParams({ samples: 12000 });
    setFilterSuggest(null); // Clear any suggestion results
    setNotice("Filtreler bu stratejinin başlangıç durumuna sıfırlandı.");
  };

  /* ---------- Data & results (per strategy) ---------- */
  const [dataInfo, setDataInfo
  ] = useState(null);
  const [backStatsById, setBackStatsById
  ] = useState({});
  const [signalsById, setSignalsById
  ] = useState({});
  const [dailyById, setDailyById
  ] = useState({});
  // Optimize paneli için aktif sekme
  // Optimize paneli için aktif sekme
  const [optTabId, setOptTabId] = useState(strategies[0]?.id || null);

  useEffect(() => {
    if (!strategies.some(s => s.id === optTabId)) {
      setOptTabId(strategies[0]?.id || null);
    }
  }, [strategies, optTabId]);

  // (isteğe bağlı) Strategy sekmesiyle senkron olsun:
  useEffect(() => {
    if (activeStratId && strategies.some(s => s.id === activeStratId)) {
      setOptTabId(activeStratId);
    }
  }, [activeStratId, strategies]);

  const tabLabel = (s) => `${s.name} ${s.side > 0 ? "(Long)" : "(Short)"}`;

  const [bestById, setBestById
  ] = useState({});
  const [optTopById, setOptTopById
  ] = useState({});
  // Top Results sekmesi için aktif strateji id'si
  const [activeTopResId, setActiveTopResId
  ] = useState(null);

  // optTopById güncellenince geçerli bir sekme seç
  useEffect(() => {
    const ids = Object.keys(optTopById || {});
    if (ids.length === 0) {
      setActiveTopResId(null); return;
    }
    if (!activeTopResId || !ids.includes(activeTopResId)) {
      setActiveTopResId(ids[
        0
      ]);
    }
  },
    [optTopById, activeTopResId
    ]);




  /* ---------- Live-lite ---------- */
  const [liveDays, setLiveDays
  ] = useState(6);
  const [liveSeries, setLiveSeries
  ] = useState([]); // {t, p}
  const [liveStatus, setLiveStatus
  ] = useState("idle");
  const [liveEvents, setLiveEvents
  ] = useState([]);
  const liveWS = useRef(null);

  /* ---------- Progress anim ---------- */
  useEffect(() => {
    let t;
    if (busy && progress < 90) {
      t = setInterval(() => setProgress(p => Math.min(90, p + Math.random() * 15)),
        500);
    }
    return () => clearInterval(t);
  },
    [busy, progress
    ]);

  /* ------------------- Simultaneous opposite signal guard ------------------- */
  const stripOppositeAtSameTime = (obj) => {
    const map = new Map(); // t -> [{sid, idx, side}]
    for (const [sid, arr
    ] of Object.entries(obj)) {
      (arr || []).forEach((s, idx) => {
        const t = getTs(s);
        const side =
          (typeof s.side === 'string') ? (s.side.toUpperCase() === 'LONG' ? 1 : -1) : Number(s.side);
        if (!map.has(t)) map.set(t,
          []);
        map.get(t).push({
          sid, idx, side
        });
      });
    }
    const remove = new Map();
    for (const [t, list
    ] of map) {
      const hasLong = list.some(x => x.side > 0);
      const hasShort = list.some(x => x.side < 0);
      if (hasLong && hasShort) {
        for (const it of list) {
          if (!remove.has(it.sid)) remove.set(it.sid, new Set());
          remove.get(it.sid).add(it.idx);
        }
      }
    }
    if (remove.size === 0) return obj;
    const out = {};
    for (const [sid, arr
    ] of Object.entries(obj)) {
      const rm = remove.get(sid) || new Set();
      out[sid
      ] = (arr || []).filter((_, i) => !rm.has(i));
    }
    return out;
  };

  /* ----------------------------------- API calls ----------------------------------- */
  const stopCurrent = async () => {
    try {
      if (abortCtrl) abortCtrl.abort();
      setNotice("Cancelled by user.");
    } finally {
      setBusy(false); setJobId(null); setAbortCtrl(null); setProgress(0);
    }
  };


  // Boolean expr → işaretli (-1/0/+1) kombinasyon:
  // long ise * +1, short ise * -1; hepsi toplanıp cliplenir.
  const buildCombinedSignedExpr = (enabled) => {
    if (!enabled.length) return "0";
    const terms = enabled.map(s => `((${s.expr
      }) * ${Number(s.side) >= 0 ? 1 : -1
      })`);
    // Not: pd.eval booleanları çarparken int'e (0/1) döner; toplam [-k, +k] aralığında olur.
    // Backend tarafı işaret serisini np.sign ile normalize ediyor.
    return terms.length === 1 ? terms[
      0
    ] : `(${terms.join(" + ")
    })`;
  };

  // Basit param birleşimi (aynı isim çakışırsa son strateji kazanır)
  const mergeParams = (enabled) => {
    const out = {};
    for (const s of enabled) Object.assign(out, s.extraParams || {});
    return out;
  };

  // İndikatör birleşimi
  const mergeIndicators = (enabled) => {
    const out = {};
    for (const s of enabled) Object.assign(out, s.indicators || {});
    return out;
  };
  // Snapshot helper: endpoint tipine göre doğru alanı ekler
  const snap = (kind /* 'event' | 'vector' | 'validate' */) => {
    if (!(useSnapshot && snapshotId)) return {};
    if (kind === "vector" || kind === "validate") return {
      snapshot_id: snapshotId
    };
    return {
      data_snapshot_id: snapshotId
    }; // default: event
  };

  // % → kesir (örn. 1.5 → 0.015)
  const pctToFrac = (p) => {
    const v = Number(p);
    return Number.isFinite(v) ? v / 100 : 0;
  };
  // Download Data -> cache/snapshot
  // Download Data -> cache/snapshot
  const downloadData = async () => {
    setBusy(true); setErr(""); setNotice("");
    try {
      // 💡 Hızlı validasyon
      if (!symbol || !timeframe || !start || !end) {
        throw new Error("Lütfen symbol, timeframe, start ve end alanlarını doldurun.");
      }
      const tStart = new Date(start);
      const tEnd = new Date(end);
      if (!(tStart instanceof Date) || !(tEnd instanceof Date) || isNaN(tStart) || isNaN(tEnd)) {
        throw new Error("Tarih formatı hatalı. YYYY-MM-DD veya ISO formatta girin.");
      }
      if (tEnd <= tStart) {
        throw new Error("End, Start'tan büyük olmalı.");
      }

      const ac = new AbortController();
      setAbortCtrl?.(ac);

      const r = await fetch(`${API_BASE}/data/snapshot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, timeframe, start, end }),
        signal: ac.signal
      });

      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || "Download failed");

      const snap = j.snapshot_id || j.data_snapshot_id || j.id;
      if (!snap) throw new Error("Snapshot id missing from response");

      setSnapshotId(snap);
      setUseSnapshot(true);
      setDownloadInfo({
        bars: j.rows ?? j.n_bars ?? j.bars ?? j.n ?? null,
        from: j.from ?? j.start ?? start,
        to: j.to ?? j.end ?? end,
        timeframe
      });
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  // --- HELPERS: Aynı timestamp'te en fazla bir sinyal kalsın ---
  // Öncelik: enabled stratejilerin UI sırası (soldan sağa).
  function coalesceSignalsByTime(outSigsMap, priorityIds) {
    const ids = (priorityIds && priorityIds.length)
      ? priorityIds
      : Object.keys(outSigsMap || {});
    const chosen = new Set(); // aynı bar anahtarı
    const out = {};

    for (const id of ids) {
      const arr = Array.isArray(outSigsMap?.[id]) ? outSigsMap[id] : [];
      const keep = [];

      for (const sig of arr) {
        // Sende hangi alan varsa onu kullan: ts | time | t_in | timestamp
        const ts = sig.ts ?? sig.time ?? sig.t ?? sig.t_in ?? sig.timestamp ?? null;

        if (ts == null) continue;

        // Eğer "aynı bar + aynı taraf" için istiyorsan şu satırı kullan:
        // const key = `${ts}:${(sig.side ?? 1) > 0 ? 'L' : 'S'}`;
        const key = String(ts);

        if (chosen.has(key)) continue; // o bar başka strateji tarafından alındı
        chosen.add(key);
        keep.push(sig);
      }
      out[id] = keep;
    }
    return out;
  }


  // === REPLACE ENTIRE FUNCTION ===
  const runBacktest = async () => {
    // 0) Snapshot zorunluluğu (mevcut UX'inle uyumlu)
    if (!useSnapshot || !snapshotId) {
      setErr("No cached data. Please use 'Download Data' in Setup first.");
      return;
    }

    // UI temizliği
    setBusy(true);
    setErr("");
    setNotice("");
    setBackStatsById({});
    setSignalsById({});
    setDailyById({});
    setExitResults(null);
    setProgress(0);

    const ac = new AbortController();
    setAbortCtrl(ac);

    try {
      // 1) Ortak yardımcılar
      const pctToFrac = (x) => Number(x) / 100;
      const enabled = Array.isArray(strategies) ? strategies.filter(s => s.enabled) : [];
      if (!enabled.length) throw new Error("No enabled strategy to backtest.");

      // Snapshot alanı (mode'a göre doğru key)
      const snapshotFields = useSnapshot && snapshotId
        ? (backtestMode === "vectorized"
          ? { snapshot_id: snapshotId }     // vectorized endpoint bunu bekliyor
          : { data_snapshot_id: snapshotId } // event-driven endpoint bunu bekliyor
        )
        : {};

      // 2) (Opsiyonel) Exit şemaları karşılaştırma — aktif strateji üstünden
      //    BE'de /backtest endpoint'in varsa çalışır; yoksa hata yutulur (UI çökmez)
      try {
        if (typeof buildExitSchemes === "function" && API_BASE) {
          const exit_schemes = buildExitSchemes(); // compareExits kapalıysa tek item dönmeli

          const body = {
            symbol, timeframe, start, end,
            expr: activeStrat?.expr || "",
            side: activeStrat?.side ?? 1,
            params: activeStrat?.indicators || {},
            leverage,
            exit_schemes,                       // ← burada olmalı
            compare_on_same_entries: true
          };
          // fetch(`${API_BASE}/backtest`, { method:'POST', body: JSON.stringify(body) })



          const res = await fetch(`${API_BASE}/backtest`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(exitBody),
            signal: ac.signal
          });
          const exitBody = body;

          // JSON garantisi yoksa bile UI'yi çökertme
          const textOrJson = async (r) => {
            const ct = r.headers.get("content-type") || "";
            return ct.includes("application/json") ? r.json() : r.text().then(raw => ({ raw }));
          };

          if (res.ok) {
            const data = await textOrJson(res);
            setExitResults({
              schemes: Array.isArray(data?.schemes) ? data.schemes : [],
              trades_by_scheme: data?.trades_by_scheme || {},
              _raw: data
            });
          } else {
            // Exit kıyas isteği başarısızsa sadece uyar, ana backtest akışını bozma
            const errText = await res.text();
            console.warn("Exit compare failed:", errText);
          }
        }
      } catch (ex) {
        console.warn("Exit compare call error:", ex);
        // burada setErr yapmıyoruz; ana backtest'i etkilemesin
      }

      // 3) Asıl backtest: tüm ENABLED stratejiler için
      const outStats = {};
      const outSigs = {};
      const outDaily = {};

      for (const strategy of enabled) {
        const pctToFrac = (x) => {
          const n = Number(String(x ?? 0).replace(",", "."));
          return Number.isFinite(n) ? n / 100 : 0;
        };

        // 1) Stratejiye özel exit scheme
        const ec = strategy.exitConfig || {};
        const t = ec.type || "fixed";

        // 2) Stratejiye özel leverage/fee/slip
        const lev = Number(strategy.leverage ?? leverage ?? 1);
        const feeFrac = pctToFrac(feePct || 0) * 100;
        const slipFrac = pctToFrac(slipPct || 0) * 100;

        // 3) Base
        const base = {
          symbol, timeframe, start, end,
          side: Number(strategy.side),
          expr: String(strategy.expr || ""),
          params: { ...(strategy.extraParams || {}) },
          indicators: typeof normalizeIndicatorKeys === "function"
            ? normalizeIndicatorKeys(strategy.indicators || {})
            : (strategy.indicators || {}),
          respect_expr_sign: true,
          leverage: lev,
          fee_pct: feeFrac,
          slippage_pct: slipFrac,
          mode: "event",
          ...(useSnapshot && snapshotId ? { data_snapshot_id: snapshotId } : {}),
        };

        // 4) Exit paramları
        let payload;
        if (t === "fixed") {
          payload = {
            ...base,
            // tp ve sl üst seviyeden kaldırıldı
            exit_scheme: {
              type: "fixed",
              tp_pct: pctToFrac(ec.tpPct ?? 1.0), // Değerleri exit_scheme içine taşıdık
              sl_pct: pctToFrac(ec.slPct ?? 2.0)
            },
          };
        } else if (t === "atr") {

          payload = {
            ...base,
            tp: 0, sl: 0,
            exit_scheme: {
              type: "atr",
              atr_n: Number(ec.atrN ?? 14),
              k_sl: Number(ec.kSL ?? 2.0),
              m_tp: Number(ec.mTP ?? 2.0),
            },
          };
        } else if (t === "chandelier") {
          payload = {
            ...base,
            tp: 0, sl: 0,
            exit_scheme: {
              type: "chandelier",
              n: Number(ec.n ?? 22),
              factor: Number(ec.factor ?? 3.0),
            },
          };
        } else if (t === "bollinger") {
          payload = {
            ...base,
            tp: 0, sl: 0,
            exit_scheme: {
              type: "bollinger",
              ma: ec.ma ?? "SMA",
              n: Number(ec.n ?? 20),
              std: Number(ec.std ?? 2.0),
              side: ec.side ?? "upper",
            },
          };
        } else if (t === "trailing_pct") {
          payload = {
            ...base,
            tp: 0, sl: 0,
            exit_scheme: {
              type: "trailing_pct",
              trail_pct: pctToFrac(ec.trailPct ?? 1.0),
            },
          };
        } else {
          // bilinmeyen tip -> fixed: 0/0
          payload = { ...base, tp: 0, sl: 0, exit_scheme: null };
        }

        // 5) Tek endpoint
        const url = `${API_BASE}/backtest/run_with_exit`;

        console.log("PAYLOAD", strategy.name, payload.exit_scheme?.type || "fixed", payload);

        const r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: ac.signal,
        });

        const ct = r.headers.get("content-type") || "";
        const data = ct.includes("application/json") ? await r.json() : { raw: await r.text() };
        if (!r.ok) throw new Error(data?.detail || JSON.stringify(data));

        outStats[strategy.id] = data?.stats || null;
        outSigs[strategy.id] = Array.isArray(data?.signals) ? data.signals : [];
        outDaily[strategy.id] = Array.isArray(data?.daily_profits) ? data.daily_profits : [];
        setProgress(Math.round((Object.keys(outStats).length / enabled.length) * 100));
      }

      // 4) Sinyal temizliği (projendeki yardımcı fonksiyon)
      // Strateji öncelik sırası: enabled dizisinin sırası
      const priority = strategies.filter(s => s.enabled).map(s => s.id);
      const baseFiltered = typeof stripOppositeAtSameTime === "function"
        ? stripOppositeAtSameTime(outSigs)
        : outSigs;
      const coalesced = coalesceSignalsByTime(baseFiltered, priority);

      setSignalsById(coalesced);


      // 3) Ekrana yaz
      setBackStatsById(outStats);
      setSignalsById(coalesced);
      setDailyById(outDaily);



      setActiveTab("results");
      setProgress(100);
    } catch (e) {
      if (e.name !== "AbortError") {
        setErr(String(e?.message || e));
      }
    } finally {
      setBusy(false);
      setAbortCtrl(null);
      setTimeout(() => setProgress(0), 800);
    }
  };


  // Optimize sonuç satırındaki param'ları ilgili stratejiye uygular
  const applyParamsFromRow = (row, sid) => {
    const targetId = sid ?? activeStratId;

    // Kaynak param objesi: önce row.params, yoksa row'un kendisi
    let src = row?.params ?? row?.indicators ?? row?.opt_params ?? row?.optParams ?? row;
    if (typeof src === "string") {
      try {
        src = JSON.parse(src);
      } catch { /* parse edilemezse bırak */ }
    }
    if (!src || typeof src !== "object") {
      alert("Bu satırda uygulanacak parametre bulunamadı.");
      return;
    }

    setStrategies(prev => prev.map(s => {
      if (s.id !== targetId) return s;

      const next = {
        ...s,
        indicators: {
          ...(s.indicators || {})
        },
        optimize: {
          ...(s.optimize || {})
        }
      };

      // 1) Tercihen stratejinin optimize ettiği anahtarları uygula
      // 2) Yoksa src içindeki *_default / fast / slow / signal / period / len / length anahtarlarını uygula
      const keys = next.optimize && Object.keys(next.optimize).length
        ? Object.keys(next.optimize)
        : Object.keys(src).filter(k => /(_default|fast|slow|signal|period|len|length)$/i.test(k));

      keys.forEach(k => {
        const raw = src[k
        ];
        if (raw == null) return;
        const v = Number(raw);
        if (!Number.isFinite(v)) return;

        // Indicator Defaults
        next.indicators[k
        ] = v;

        // *_default => baz anahtarını da doldur (macd_fast_default -> macd_fast)
        if (/_default$/i.test(k)) {
          next.indicators[k.replace(/_default$/i,
            "")
          ] = v;
        }
        // Search Space varsa güncelle
        if (next.optimize[k
        ] && typeof next.optimize[k
        ] === "object") {
          const spec = {
            ...next.optimize[k
            ]
          };
          if ("start" in spec) spec.start = v;
          if ("min" in spec && "max" in spec) {
            spec.min = v; spec.max = v;
          }
          if ("low" in spec && "high" in spec) {
            spec.low = v; spec.high = v;
          }
          next.optimize[k
          ] = spec;
        } else if (next.optimize[k
        ] !== undefined) {
          // optimize[k] basit sayı ise
          next.optimize[k
          ] = v;
        }
      });
      return next;
    }));

    // Uyguladığın strateji aktif değilse, ona geç
    if (sid && sid !== activeStratId) setActiveStratId(sid);
  };
  // WFO config (varsayılanlar)
  const [wfoTrain, setWfoTrain
  ] = useState(5000);
  const [wfoTest, setWfoTest
  ] = useState(500);
  const [wfoStep, setWfoStep
  ] = useState(500);
  const [wfoObjective, setWfoObjective
  ] = useState("J");
  const [wfoAgg, setWfoAgg
  ] = useState("median");
  const [wfoMinTrades, setWfoMinTrades
  ] = useState(10);

  const [wfoRes, setWfoRes
  ] = useState(null);

  // basit grid builder (optimize panelindeki min/max/step'ten kartesyen ürün)
  const buildGrid = (spec = {}) => {
    const keys = Object.keys(spec || {});
    if (!keys.length) return [
      {}
    ];
    const ranges = keys.map(k => {
      const o = spec[k
      ] || {};
      const min = Number(o.min ?? 0), max = Number(o.max ?? 0), step = Number(o.step ?? 1);
      const arr = [];
      for (let v = min; v <= max; v += step) arr.push({
        [k
        ]: Number(v)
      });
      return arr.length ? arr : [
        {
          [k
          ]: Number(o.default ?? min)
        }
      ];
    });
    let grid = [
      {}
    ];
    for (const opts of ranges) grid = grid.flatMap(g => opts.map(o => ({
      ...g, ...o
    })));
    return grid.slice(0,
      500); // güvenlik: 500 adayı geçme
  };

  const startWFO = async () => {
    const s = strategies.find(x => x.id === activeStratId);
    if (!s) return alert("No active strategy");
    const grid = buildGrid(s.optimize || {});
    const payload = {
      symbol, timeframe, start, end,
      expr: s.expr,
      params: {
        ...(s.extraParams || {})
      },
      indicators: s.indicators || {},

      respect_expr_sign: true,
      tp: backtestMode === "event" ? Number(tpPct) / 100 : 0,
      sl: backtestMode === "event" ? Number(slPct) / 100 : 0,
      leverage: Number(leverage || 1),
      fee_pct: Number(feePct || 0),
      slippage_pct: Number(slipPct || 0),
      side: Number(s.side ?? 1),

      maker_bps: Number(costs?.maker_bps ?? 10),
      taker_bps: Number(costs?.taker_bps ?? 20),
      slip_bps: Number(costs?.slip_params?.fixed_bps ?? 4),
      train_len: Number(wfoTrain),
      test_len: Number(wfoTest),
      step_len: Number(wfoStep),
      objective: wfoObjective,
      aggregation: wfoAgg,
      min_trades: Number(wfoMinTrades),
      grid
    };
    setBusy(true);
    try {
      const r = await fetch(`${API_BASE
        }/optimize/wfo`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(payload)
        });
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || "WFO failed");
      setWfoRes(j);
    } catch (e) {
      alert(e);
    } finally {
      setBusy(false);
    }
  };
  // App.jsx dosyanızdaki mevcut startGeneration fonksiyonunu bununla tamamen değiştirin

  const startGeneration = async () => {
    if (!useSnapshot || !snapshotId) {
      setErr("Strategy Generation requires downloaded data. Use 'Download Data' in Setup first.");
      setActiveTab("setup");
      return;
    }

    setBusy(true);
    setErr("");
    setNotice("Genetic Programming process started...");
    setGpResult(null);
    setProgress?.(0);
    const ac = new AbortController();
    setAbortCtrl?.(ac);

    try {
      const activeStrategyForConfig = strategies.find(s => s.enabled) || strategies[0];
      if (!activeStrategyForConfig) throw new Error("At least one strategy must exist to provide context for settings.");

      // timeframe/start/end için güvenli fallback
      const tf = (typeof stratTf !== "undefined" && stratTf) ? stratTf : timeframe;
      const startIso = start || new Date(Date.now() - (lookbackDays || 180) * 864e5).toISOString();
      const endIso = end || new Date().toISOString();

      // Sol panel seçimlerinden p.key -> df sütun adı map
      const keyToCol = (key) => {
        const k = String(key).toLowerCase();
        if (k.includes("rsi")) return "RSI";
        if (k.includes("macd")) return "hist";   // sende 'hist' ise buna 'hist' yaz
        if (k.includes("sma")) return "SMA";
        if (k.includes("ema")) return "EMA";
        if (k.includes("cci")) return "CCI";
        if (k.includes("adx")) return "adx";
        if (k.includes("obv")) return "obv";
        if (k.includes("ao")) return "ao";
        if (k.includes("open")) return "open";
        if (k.includes("close")) return "close";
        return key; // zaten sütun adı olabilir
      };

      // UI seçimleri → indicators_to_use
      let indicators_to_use = null;
      if (gpSelectedKeys && gpSelectedKeys.size) {
        const selectedCols = Array.from(gpSelectedKeys).map(keyToCol);
        indicators_to_use = selectedCols.length ? selectedCols : null;
      }

      // Operatörler
      const operators_to_use = ["&", "|", ">", "<", ">=", "<=", "+", "-", "*"];

      const payload = {
        // Data & Backtest
        symbol,
        timeframe: tf,
        start: startIso,
        end: endIso,
        side: Number(activeStrategyForConfig.side ?? 1),
        leverage: Number(activeStrategyForConfig.leverage ?? leverage ?? 1),
        fee_pct: Number(feePct || 0),
        slippage_pct: Number(slipPct || 0),
        data_snapshot_id: snapshotId,

        // Exit scheme guard
        exit_scheme: typeof buildExitSchemeFromStrategy === "function"
          ? buildExitSchemeFromStrategy(activeStrategyForConfig)
          : undefined,

        // GP yapı taşları
        indicators_to_use,
        operators_to_use,

        // GP parametreleri
        population_size: Number(gpPopulation),
        generations: Number(gpGenerations),
        crossover_prob: Number(gpCrossover),
        mutation_prob: Number(gpMutation),
        objective: gpObjective,
        ind_params: gpIndParams

      };

      const r = await fetch(`${API_BASE}/optimize/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: ac.signal,
      });

      let j;
      try { j = await r.json(); }
      catch { throw new Error("Response is not JSON (server down or CORS)."); }

      if (!r.ok) {
        const detail = (typeof j?.detail === "object") ? JSON.stringify(j.detail) : (j?.detail || "Strategy generation failed");
        throw new Error(detail);
      }

      // Yanıtı normalize et
      const bestExpr = j?.best?.expr || j?.best_strategy_expr || "";
      const bestStats = j?.best?.stats || j?.stats || {};
      setGpResult({ expr: bestExpr, stats: bestStats });

      // (opsiyonel) top adaylar varsa sakla
      if (Array.isArray(j?.top) && typeof setGpResults === "function") {
        setGpResults(j.top);
      }

      setNotice("Strategy generation completed successfully!");
      setProgress?.(100);
    } catch (e) {
      if (e.name !== "AbortError") setErr(String(e?.message || e));
    } finally {
      setBusy(false);
      setAbortCtrl?.(null);
      setTimeout(() => setProgress?.(0), 800);
    }
  };

  const startOptimization = async () => {
    if (!useSnapshot || !snapshotId) {
      setErr("Optimization requires downloaded data. Setup → Download Data ile önce veri indir.");
      setActiveTab("setup");
      return;
    }

    setBusy(true); setErr(""); setNotice("");
    setOptTopById({}); setBestById({}); setProgress(0);
    const ac = new AbortController(); setAbortCtrl(ac);

    try {
      const enabled = strategies.filter(s => s.enabled);
      if (!enabled.length) throw new Error("No enabled strategy to optimize.");

      const outBest = {}, outTop = {};
      const commonSnap = (useSnapshot && snapshotId) ? { data_snapshot_id: snapshotId } : {};

      for (const s of enabled) {
        // Hata buradaki döngüdeydi. 's' değişkeni doğru kullanılmıyordu.
        const lev = Number(s.leverage ?? leverage ?? 1);
        const exit_scheme = buildExitSchemeFromStrategy(s); // Stratejiye özel exit scheme'i al

        const basePayload = {
          symbol, timeframe, start, end,
          side: Number(s.side ?? 1),
          tp: (exit_scheme?.type === "fixed") ? (s.exitConfig?.tpPct ?? tpPct) / 100 : 0,
          sl: (exit_scheme?.type === "fixed") ? (s.exitConfig?.slPct || slPct) / 100 : 0,
          leverage: lev,
          fee_pct: Number(feePct || 0),
          slippage_pct: Number(slipPct || 0),
          expr: String(s.expr ?? ""),
          params: { ...(s.extraParams || {}) },
          indicators: normalizeIndicatorKeys ? normalizeIndicatorKeys(s.indicators) : (s.indicators || {}),
          method: s.method || "grid",
          limits: { max_iterations: Number(s.maxIter || 200) },
          optimize: s.optimize || {},
          exit_scheme,
          ...commonSnap,
        };

        const r = await fetch(`${API_BASE}/optimize/core`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(basePayload),
          signal: ac.signal,
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.detail || "Optimize failed");

        const bestInd = (j.best?.indicators) || (j.best?.params) || {};
        const mergedIndicators = normalizeIndicatorKeys({
          ...(s.indicators || {}), ...(bestInd || {})
        });

        const backUrl = `${API_BASE}/backtest/run_with_exit`;
        const backPayload = {
          symbol, timeframe, start, end, side: Number(s.side),
          leverage: lev,
          fee_pct: Number(feePct || 0),
          slippage_pct: Number(slipPct || 0),
          expr: s.expr,
          params: { ...(s.extraParams || {}) },
          indicators: mergedIndicators,
          respect_expr_sign: true,
          exit_scheme,
          ...commonSnap,
          // ### YENİ EKLENEN SATIRLAR ###
          // Yeniden testin, optimizasyonla aynı TP/SL değerlerini kullanmasını sağla
          tp: (exit_scheme?.type === "fixed") ? (s.exitConfig?.tpPct ?? tpPct) / 100 : 0,
          sl: (exit_scheme?.type === "fixed") ? (s.exitConfig?.slPct || slPct) / 100 : 0,
          // #############################
        };

        const rb = await fetch(backUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(backPayload),
          signal: ac.signal,
        });

        const bj = await rb.json();
        if (!rb.ok) throw new Error(bj.detail || "Backtest recheck failed");

        outBest[s.id] = { ...j.best, indicators: mergedIndicators, stats: bj.stats };
        outTop[s.id] = j.top || [];
      }

      setBestById(outBest);
      setOptTopById(outTop);
      setProgress(100);
      setActiveTab("optimization");
    } catch (e) {
      if (e.name !== "AbortError") setErr(String(e.message || e));
    } finally {
      setBusy(false); setAbortCtrl(null); setTimeout(() => setProgress(0), 800);
    }
  };
  const [portfolio, setPortfolio
  ] = useState(null); // { combinedDaily, combinedStats, legs: [...] }

  const startPortfolioCombine = async () => {
    try {
      setBusy(true); setErr("");

      const enabled = strategies.filter(s => s.enabled);
      if (!enabled.length) throw new Error("No enabled strategy to combine.");

      const commonSnap = (useSnapshot && snapshotId) ? {
        data_snapshot_id: snapshotId
      } : {};
      const legs = [];

      for (const s of enabled) {
        // aktif stratejinin param/indicator birleşimi (Apply sonrası güncel değerler)
        const isFixedF = (stopType === "fixed");
        let exit_schemeF = null;
        if (!isFixedF) {
          if (stopType === "atr") {
            exit_schemeF = { type: "atr", atr_n: atrN, k_sl: kSL, m_tp: mTP };
          } else if (stopType === "chandelier") {
            exit_schemeF = { type: "chandelier", n: chN, factor: chK };
          } else if (stopType === "bollinger") {
            exit_schemeF = { type: "bollinger", ma: bbMa, n: bbN, std: bbStd, side: bbSide };
          } else if (stopType === "trailing_pct") {
            exit_schemeF = { type: "trailing_pct", trail_pct: (trailPct / 100) };
          }
        }

        const payload = {
          symbol, timeframe, start, end,

          tp: isFixedF ? pctToFrac(tpPct) : 0,
          sl: isFixedF ? pctToFrac(slPct) : 0,
          leverage: Number(leverage || 1),
          fee_pct: Number(feePct || 0),
          slippage_pct: Number(slipPct || 0),
          side: Number(s.side ?? 1),

          expr, params, indicators,
          exit_scheme: exit_schemeF,               // <<< eklendi
          include: includeCols,
          topk: Number(topK), samples: Number(samples), min_cov: Number(minCov),
          ...commonSnap,
        };


        const r = await fetch(`${API_BASE
          }/backtest/run`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify(payload),
          });
        const j = await r.json();
        if (!r.ok) throw new Error(j.detail || "Backtest failed in combine.");

        // backend daily_profits formatı: { "YYYY-MM-DD": 0.0042, ... } / bazen list de olabilir
        const dailyRaw = j.daily_profits || j.daily || {};
        const daily = Array.isArray(dailyRaw)
          ? Object.fromEntries(dailyRaw.map(d => [d.date, Number(d.profit) || 0
          ]))
          : dailyRaw;
        legs.push({
          id: s.id, name: s.name, w: 1, daily
        });
      }

      const combinedDaily = combineDaily(legs);
      const combinedStats = statsFromDaily(combinedDaily);
      setPortfolio({
        combinedDaily, combinedStats, legs
      });
      setActiveTab("portfolio"); // yeni sekmeye geç
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  const previewStrategy = async () => {
    setBusy(true); setErr(""); setNotice(""); setProgress(0);
    try {
      const endISO = new Date().toISOString();
      const startISO = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
      const s = activeStrat;
      const payload = {
        symbol, timeframe: stratTf, start: startISO, end: endISO, side: Number(s.side),
        tp: pctToFrac(tpPct), sl: pctToFrac(slPct),
        leverage: Number(leverage || 1),
        fee_pct: Number(feePct || 0),
        slippage_pct: Number(slipPct || 0),

        ...snap("event"),
        maker_bps: Number(costs.maker_bps ?? 10),
        taker_bps: Number(costs.taker_bps ?? 20),
        slip_bps: costs.slip_model === "FixedBps"
          ? Number(costs.slip_params?.fixed_bps ?? 4)
          : null,
        funding_bps_interval: costs.funding_mode === "ProRata"
          ? Number(costs.funding_rate_bps ?? 0)
          : null,
        funding_interval_hours: costs.funding_mode === "ProRata"
          ? Number(costs.funding_interval_h ?? 8)
          : null,

        expr: s.expr, params: {
          ...(s.extraParams || {})
        }, indicators: normalizeIndicatorKeys(s.indicators), respect_expr_sign: true, debug_bars: true
      };
      if (useSnapshot && snapshotId) payload.data_snapshot_id = snapshotId;

      const r = await fetch(`${API_BASE
        }/backtest/run`,
        {
          method: "POST", headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(payload)
        });
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || "Preview failed");
      setPreviewBars(Array.isArray(j.bars) ? j.bars : []);
      setBackStatsById(prev => ({
        ...prev,
        [s.id
        ]: j.stats || null
      }));
      setSignalsById(prev => ({
        ...prev,
        [s.id
        ]: j.signals || []
      }));
      setDailyById(prev => ({
        ...prev,
        [s.id
        ]: j.daily_profits || []
      }));
      setProgress(100);
    } catch (e) {
      setErr(String(e.message || e));
    }
    finally {
      setBusy(false); setTimeout(() => setProgress(0),
        800);
    }
  };
  // Günlük yüzde getirilerden (örn. { "2025-01-02": 0.006, ... }) birleşik seri kur
  const _sortDates = (obj) => Object.keys(obj).sort();
  const _toVector = (obj) => _sortDates(obj).map(d => ({
    d, r: Number(obj[d
    ]) || 0
  }));

  const combineDaily = (legs /* [{daily, w}] */) => {
    const allDays = Array.from(new Set(legs.flatMap(l => Object.keys(l.daily || {})))).sort();
    const out = {};
    for (const day of allDays) {
      let v = 0;
      for (const { daily, w
      } of legs) v += (Number(daily?.[day
      ]) || 0) * (Number(w) || 1);
      out[day
      ] = v;
    }
    return out; // { day: combinedReturn }
  };

  const equityFromDaily = (dailyMap) => {
    const vec = _toVector(dailyMap);
    const eq = []; // cumulative equity (%)
    let cum = 0;
    for (const { d, r
    } of vec) {
      cum = (1 + cum) * (1 + r) - 1; // bileşik
      eq.push({
        d, eq: cum
      });
    }
    return eq;
  };

  const statsFromDaily = (dailyMap) => {
    const vec = _toVector(dailyMap).map(x => x.r);
    if (!vec.length) return {
      profit: 0, sharpe: 0, maxDD: 0, days: 0
    };
    const mean = vec.reduce((a, b) => a + b,
      0) / vec.length;
    const sd = Math.sqrt(vec.reduce((a, b) => a + (b - mean) * (b - mean),
      0) / Math.max(1, vec.length - 1));
    const sharpe = sd > 0 ? (mean / sd) * Math.sqrt(365) : 0;

    // Max drawdown (equity üzerinden)
    let peak = 0, maxDD = 0, cum = 0;
    for (const r of vec) {
      cum = (1 + cum) * (1 + r) - 1;
      if (cum > peak) peak = cum;
      const dd = (cum - peak); // negatif
      if (dd < maxDD) maxDD = dd;
    }
    const total = equityFromDaily(dailyMap).at(-1)?.eq ?? 0; // toplam (%) bileşik
    return {
      profit: total * 100, sharpe, maxDD: maxDD * 100, days: vec.length
    };
  };

  /* ------------------------------------ Filters helpers ------------------------------------ */
  const updateFilter = (i, patch) =>
    setFiltersLocal(prev => prev.map((f, idx) => (idx === i ? {
      ...f, ...patch
    } : f)));
  const removeFilter = (i) => setFiltersLocal(prev => prev.filter((_, idx) => idx !== i));

  const applyFiltersToExpr = () => {
    const enabledFilters = filtersLocal.filter(
      f => f.enabled && f.key && (f.min !== "" || f.max !== "")
    );
    if (!enabledFilters.length || !activeStratId) return;

    const parts = [];
    const newParams = {
      ...(activeStrat?.extraParams || {})
    };

    for (const f of enabledFilters) {
      const pmin = `flt_${f.key
        }_min`;
      const pmax = `flt_${f.key
        }_max`;

      if (f.min !== "" && f.max !== "") {
        parts.push(`(data['${f.key
          }'
                ] >= $${pmin
          }) & (data['${f.key
          }'
                ] <= $${pmax
          })`);
        newParams[pmin
        ] = Number(f.min);
        newParams[pmax
        ] = Number(f.max);
      } else if (f.min !== "") {
        parts.push(`(data['${f.key
          }'
                ] >= $${pmin
          })`);
        newParams[pmin
        ] = Number(f.min);
      } else if (f.max !== "") {
        parts.push(`(data['${f.key
          }'
                ] <= $${pmax
          })`);
        newParams[pmax
        ] = Number(f.max);
      }
    }

    const extra = parts.join(" & ");
    patchStrategy(activeStratId,
      {
        expr: `(${activeStrat.expr
          }) & (${extra
          })`,
        extraParams: newParams
      });

    setActiveTab("strategy");
  };




  // App.jsx dosyanızdaki mevcut suggestFilters fonksiyonunu bu blokla değiştirin

  // App.jsx dosyanızdaki mevcut suggestFilters fonksiyonunu bu blokla değiştirin

  const suggestFilters = async () => {
    setBusy(true); setErr(""); setNotice(""); setFilterSuggest(null); setProgress(0);
    try {
      const s = activeStrat;
      if (!s) {
        throw new Error("Aktif bir strateji bulunamadı.");
      }

      const include = filtersLocal.map(f => f.key).filter(Boolean);

      const ec = s.exitConfig || {};
      const exit_scheme = buildExitSchemeFromStrategy(s);
      const feeFrac = pctToFrac(feePct);
      const slipFrac = pctToFrac(slipPct);
      const lev = Number(s.leverage ?? leverage ?? 1);

      const payload = {
        symbol, timeframe, start, end,
        side: Number(s.side),
        tp: 0,
        sl: 0,
        exit_scheme,
        leverage: lev,
        fee_pct: feeFrac * 100,
        slippage_pct: slipFrac * 100,
        expr: s.expr,
        params: { ...(s.extraParams || {}) },
        indicators: normalizeIndicatorKeys(s.indicators),
        include,
        topk: 8,
        samples: 12000,
        min_cov: Number(filterCoverage) / 100,
        method: filterMethod,


        // --- YENİ EKLENEN SATIR: Seçilen metodu payload'a ekle ---
        method_params: algoParams,

        // ---------------------------------------------------------

        ...snap("event"),
      };

      console.log("Suggest Filters Payload:", payload);

      const r = await fetch(`${API_BASE}/filters/suggest`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || "filters_suggest failed");

      if (j?.best?.intervals) {
        setFiltersLocal(prev => {
          const next = [...prev];
          for (const [k, v] of Object.entries(j.best.intervals)) {
            const idx = next.findIndex(x => x.key === k);
            const min = Number(v.min?.toFixed?.(6) ?? v.min);
            const max = Number(v.max?.toFixed?.(6) ?? v.max);
            if (idx >= 0) {
              next[idx] = { ...next[idx], enabled: true, min, max };
            } else {
              next.push({ key: k, enabled: true, min, max });
            }
          }
          return next;
        });
      }
      setFilterSuggest(j);
      setProgress(100);
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setBusy(false);
      setTimeout(() => setProgress(0), 800);
    }
  };
  /* ------------------------------------ Live ------------------------------------ */
  const wsURL = (API_BASE.replace(/^http/i,
    "ws")) + "/ws/live";
  const startLive = () => {
    try {
      if (liveWS.current) liveWS.current.close();
    } catch { }
    setLiveSeries([]); setLiveEvents([]); setLiveStatus("streaming");
    const ws = new WebSocket(wsURL); liveWS.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({
        symbol, timeframe: stratTf, days: liveDays,
        tp: pctToFrac(tpPct), sl: pctToFrac(slPct),
        leverage: Number(leverage || 1),
        fee_pct: Number(feePct || 0),
        slippage_pct: Number(slipPct || 0),
        side: Number(s.side ?? 1),

        strategies: strategies.filter(s => s.enabled).map(s => ({
          id: s.id, side: Number(s.side), respect_expr_sign: true,
          expr: s.expr, params: {
            ...(s.extraParams || {})
          }, indicators: normalizeIndicatorKeys(s.indicators),
        })),
        indicators: (strategies[
          0
        ]?.indicators) || {
          macd_fast_default: 6, macd_slow_default: 18, macd_signal_default: 9
        },
        interval_sec: 3
      }));
    };

    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data || "{}");
      if (msg.type === "error") {
        console.warn("[live error]", msg.message); return;
      }
      // price ticks
      const price = msg.price || msg;
      if (msg.type === "tick" && price && price.close !== undefined) {
        const tLabel = new Date(price.time || Date.now()).toLocaleTimeString();
        const p = Number(price.close);
        setLiveSeries(s => [...s.slice(-200),
        {
          t: tLabel, p
        }
        ]);
      }
      // events (same-time opposite guard for batch)
      if (Array.isArray(msg.events) && msg.events.length) {
        const groups = new Map();
        for (const e of msg.events) {
          const t = new Date(e.entry_time || e.time || Date.now()).getTime();
          if (!groups.has(t)) groups.set(t,
            []);
          groups.get(t).push(e);
        }
        const kept = [];
        for (const [t, arr
        ] of groups) {
          const hasLong = arr.some(x => (x.side === 1 || String(x.side).toUpperCase() === 'LONG'));
          const hasShort = arr.some(x => (x.side === -1 || String(x.side).toUpperCase() === 'SHORT'));
          if (hasLong && hasShort) continue; // çatışanları at
          kept.push(...arr);
        }
        setLiveEvents(prev => {
          const toRows = kept.map(e => {
            const t = String(e.type || "").toUpperCase();
            const isExit = (t === "EXIT" || t === "TP" || t === "SL" || e.exit_price != null || e.exit != null || e.exit_reason != null);
            const exitReason = (e.exit_reason || (t === "TP" ? "tp" : t === "SL" ? "sl" : "")).toLowerCase();
            return {
              strategy: e.strategy_id || "-",
              time: new Date(e.entry_time || e.time || Date.now()).toLocaleString(),
              type: t || (isExit ? "EXIT" : "ENTRY"),
              side: sideText(e.side),
              entry: (e.entry_price ?? e.entry) != null ? Number(e.entry_price ?? e.entry).toFixed(4) : "-",
              tp: (isExit && (exitReason === "tp" || e.tp_hit)) ? "✔" : "-",
              sl: (isExit && (exitReason === "sl" || e.sl_hit)) ? "✔" : "-",
              exit: isExit && (e.exit_price ?? e.exit) != null ? Number(e.exit_price ?? e.exit).toFixed(4) : "-",
              pnl: isExit ? (e.pnl != null ? (e.pnl * 100).toFixed(2) + "%" : e.pnl_pct != null ? e.pnl_pct.toFixed(2) + "%" : "-") : "0.00%"
            };
          });
          return [...toRows, ...prev
          ].slice(0,
            300);
        });
      }
    };

    ws.onclose = () => setLiveStatus("stopped");
    ws.onerror = () => setLiveStatus("stopped");
  };
  const stopLive = () => {
    try {
      if (liveWS.current) liveWS.current.close();
    } catch { }
    liveWS.current = null; setLiveStatus("stopped");
  };
  useEffect(() => () => {
    try {
      if (liveWS.current) liveWS.current.close();
    } catch { }
  },
    []);

  /* ----------------------------------- Charts & metrics ----------------------------------- */
  // Returns view: D=Daily, W=Weekly, M=Monthly
  const [retView, setRetView] = useState("D");

  // ---- helpers for resampling daily returns ----
  const _fmtDate = (d) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  const _fmtMonth = (d) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  const _weekStartUTC = (d) => { // Monday-based week start
    const dow = (d.getUTCDay() + 6) % 7; // Mon=0
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow));
  };

  // daily: [{date:'YYYY-MM-DD', profit: 0.0123}], mode: 'D' | 'W' | 'M'
  const aggregateReturns = (daily, mode) => {
    if (!daily?.length) return [];
    if (mode === "D") {
      return daily.map(d => ({ label: d.date, v: Number(d.profit) || 0 }));
    }
    const map = new Map();
    for (const d of daily) {
      const [y, m, dd] = String(d.date).split("-").map(Number);
      const dt = new Date(Date.UTC(y, m - 1, dd));
      let key, label;
      if (mode === "W") {
        const ws = _weekStartUTC(dt);
        key = "W" + _fmtDate(ws);
        label = _fmtDate(ws);        // haftanın başlangıç tarihi
      } else {
        key = "M" + _fmtMonth(dt);
        label = _fmtMonth(dt);       // YYYY-MM
      }
      const r = Number(d.profit) || 0;
      const obj = map.get(key) || { label, acc: 1 };
      obj.acc *= (1 + r);
      map.set(key, obj);
    }
    return Array.from(map.values())
      .map(o => ({ label: o.label, v: o.acc - 1 }))
      .sort((a, b) => a.label.localeCompare(b.label));
  };

  const enabledIds = useMemo(() => strategies.filter(s => s.enabled).map(s => s.id),
    [strategies
    ]);
  const combinedSignals = useMemo(() => {
    if (enabledIds.length <= 1) return null;
    const all = enabledIds.flatMap(id => (signalsById[id
    ] || []).map(sig => ({
      ...sig, _sid: id
    })));
    return all.sort((a, b) => getTs(a) - getTs(b));
  },
    [enabledIds, signalsById
    ]);
  const combinedDaily = useMemo(() => {
    if (enabledIds.length <= 1) return null;
    return combineDailyByDate(enabledIds.map(id => dailyById[id
    ] || []));
  },
    [enabledIds, dailyById
    ]);
  const useCombined = (enabledIds.length > 1);
  const activeSignals = useCombined ? (combinedSignals || []) : (signalsById[enabledIds[
    0
  ]
  ] || []);
  const activeDaily = useCombined ? (combinedDaily || []) : (dailyById[enabledIds[
    0
  ]
  ] || []);

  const metrics = useMemo(() => {
    const dr = activeDaily.map(d => Number(d.profit) || 0);
    // bileşik getiri = exp(∑log(1+r)) - 1
    const profitPct = (Math.exp(dr.reduce((s, r) => s + Math.log1p(r), 0)) - 1) * 100;

    const mean = dr.length ? dr.reduce((a, b) => a + b,
      0) / dr.length : 0;
    const sd = dr.length ? Math.sqrt(dr.reduce((a, b) => a + (b - mean) ** 2,
      0) / dr.length) : 0;
    const sharpe = sd > 0 ? (mean / sd) * Math.sqrt(252) : 0;
    let eq = 1, peak = 1, maxDD = 0;
    for (const r of dr) {
      eq *= (1 + r);
      if (eq > peak) peak = eq;
      const dd = eq / peak - 1;       // [-1, 0]
      if (dd < maxDD) maxDD = dd;
    }
    const maxDDPct = maxDD * 100;


    const closed = (activeSignals || []).filter(s => (s.exit_price ?? s.exit) != null || s.exit_reason != null || s.tp_hit || s.sl_hit);
    const wins = closed.filter(s => {
      const v = (s.pnl_pct != null) ? s.pnl_pct : (s.pnl != null ? s.pnl : null);
      return v != null ? v > 0 : (String(s.exit_reason || "").toLowerCase() === "tp" || s.tp_hit === true);
    }).length;
    const winRate = closed.length ? (wins / closed.length) * 100 : 0;
    return {
      trades: (activeSignals || []).length, winRate, profitPct, sharpe, maxDDPct
    };
  },
    [activeDaily, activeSignals
    ]);

  const chartDaily = useMemo(() => {
    const rows = aggregateReturns(activeDaily, retView);
    if (!rows.length) return null;
    const labels = rows.map(d => d.label);
    const vals = rows.map(d => d.v * 100); // %'ye çevir

    const labelTxt = (retView === "D" ? "Daily" : retView === "W" ? "Weekly" : "Monthly") + " Return (%)";
    return {
      data: {
        labels,
        datasets: [{
          type: "bar",
          label: labelTxt,
          data: vals,
          backgroundColor: vals.map(v => v >= 0 ? "rgba(16,185,129,0.7)" : "rgba(239,68,68,0.7)"),
          borderWidth: 0
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { mode: "index", intersect: false } },
        scales: { x: { ticks: { color: "#9CA3AF" } }, y: { ticks: { color: "#9CA3AF" } } }
      }
    };
  }, [activeDaily, retView]);

  const chartEquity = useMemo(() => {
    if (!activeDaily?.length) return null;
    let acc = 1; const labels = []; const vals = [];
    for (const d of activeDaily) {
      acc *= (1 + (Number(d.profit) || 0));   // bileşik büyüme
      labels.push(d.date);
      vals.push((acc - 1) * 100);             // % olarak çiz
    }

    return {
      data: {
        labels, datasets: [ds("Cumulative Return (%)", vals,
          "#3B82F6")
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false, plugins: {
          legend: {
            display: false
          }
        },
        scales: {
          x: {
            ticks: {
              color: "#9CA3AF"
            }
          }, y: {
            ticks: {
              color: "#9CA3AF"
            }
          }
        }
      }
    };
  },
    [activeDaily
    ]);

  const priceChart = useMemo(() => {
    if (!previewBars?.length) return null;
    const labels = previewBars.map(b => new Date(b.time).toLocaleString());
    const close = previewBars.map(b => Number(b.close));
    const lines = [ds("Close", close,
      "#60A5FA")
    ];
    const mf = Number(activeStrat?.indicators?.macd_fast_default ?? 6);
    const ms = Number(activeStrat?.indicators?.macd_slow_default ?? 18);
    if (overlay.emaFast) lines.push(ds(`EMA(${mf
      })`, ema(close, mf),
      "#10B981"));
    if (overlay.emaSlow) lines.push(ds(`EMA(${ms
      })`, ema(close, ms),
      "#F59E0B"));
    if (overlay.bb) {
      const b = bbands(close, Number(bbP), Number(bbK));
      lines.push(ds("BB mid", b.mid,
        "#9CA3AF"));
      lines.push(ds("BB up", b.up,
        "#9CA3AF"));
      lines.push(ds("BB low", b.lo,
        "#9CA3AF"));
    }
    return {
      data: {
        labels, datasets: lines
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: {
            labels: {
              color: "#E5E7EB"
            }
          }
        },
        scales: {
          x: {
            ticks: {
              color: "#9CA3AF"
            }
          }, y: {
            ticks: {
              color: "#9CA3AF"
            }
          }
        }
      }
    };
  },
    [previewBars, overlay, activeStrat?.indicators, bbP, bbK
    ]);

  const rsiChart = useMemo(() => {
    if (!overlay.rsi || !previewBars?.length) return null;
    const labels = previewBars.map(b => new Date(b.time).toLocaleString());
    const close = previewBars.map(b => Number(b.close));
    const rs = rsiArr(close, Number(rsiP));
    return {
      data: {
        labels, datasets: [ds(`RSI(${rsiP
          })`, rs,
          "#F472B6")
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false
          }
        },
        scales: {
          y: {
            min: 0, max: 100, ticks: {
              color: "#9CA3AF"
            }
          }, x: {
            ticks: {
              color: "#9CA3AF"
            }
          }
        }
      }
    };
  },
    [previewBars, overlay.rsi, rsiP
    ]);

  const macdChart = useMemo(() => {
    if (!overlay.macd || !previewBars?.length) return null;
    const labels = previewBars.map(b => new Date(b.time).toLocaleString());
    const close = previewBars.map(b => Number(b.close));
    const mf = Number(activeStrat?.indicators?.macd_fast_default ?? 6);
    const ms = Number(activeStrat?.indicators?.macd_slow_default ?? 18);
    const sg = Number(activeStrat?.indicators?.macd_signal_default ?? 9);
    const { macd: m, signal: s, hist: h
    } = macdArr(close, mf, ms, sg);
    return {
      data: {
        labels, datasets: [ds("MACD", m,
          "#22D3EE"), ds("Signal", s,
            "#EAB308"), ds("Hist", h,
              "#A78BFA")
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: {
            labels: {
              color: "#E5E7EB"
            }
          }
        },
        scales: {
          x: {
            ticks: {
              color: "#9CA3AF"
            }
          }, y: {
            ticks: {
              color: "#9CA3AF"
            }
          }
        }
      }
    };
  },
    [previewBars, overlay.macd, activeStrat?.indicators
    ]);

  const exportData = (data, filename) => {
    const blob = new Blob([JSON.stringify(data,
      null,
      2)
    ],
      {
        type: "application/json"
      });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = filename; a.click();
    URL.revokeObjectURL(a.href);
  };
  function dedupeTradesByKey(arr) {
    const seen = new Set();
    const out = [];
    for (const t of (arr || [])) {
      const key = [
        t.ts ?? t.time ?? t.t_in ?? "",
        t.side ?? "",
        t.entry ?? "",
        t.exit ?? ""
      ].join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(t);
    }
    return out;
  }

  // kullanırken:
  const trades = dedupeTradesByKey(exitResults?.trades_by_scheme?.[someKey]);


  /* =================================== RENDER =================================== */
  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gray-900 text-gray-100">
        { /* Header */}
        <header className="border-b border-gray-800 bg-gray-900/80 sticky top-0 z-10 backdrop-blur">
          <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Activity className="w-5 h-5 text-blue-400" />
              <h1 className="text-lg font-semibold">Trading Strategy Studio</h1>
              <span className="text-xs text-gray-400 ml-2">
                Multi-Strategy • Backtest • Optimize • Live
              </span>
            </div>



            <div className="ml-auto flex items-center gap-2">
              {busy && (
                <>
                  <span className="px-2 py-1 rounded-full bg-amber-500/15 text-amber-300 text-xs border border-amber-500/30">
                    Working…
                  </span>
                  <button
                    onClick={stopCurrent
                    }
                    className="px-2 py-1 rounded bg-red-600 hover:bg-red-500 text-white text-xs"
                    title="Cancel running job"
                  >
                    Abort
                  </button>
                </>
              )
              }
            </div>

          </div>
          { /* Tabs */}
          <div className="max-w-7xl mx-auto px-4 pb-3 flex gap-2">
            <TabBtn active={activeTab === "setup"
            } onClick={() => setActiveTab("setup")
            }>Setup</TabBtn>
            <TabBtn active={activeTab === "portfolio"
            } onClick={() => setActiveTab("portfolio")
            }>
              Portfolio
            </TabBtn>

            <TabBtn active={activeTab === "strategy"
            } onClick={() => setActiveTab("strategy")
            }>Strategy</TabBtn>
            <TabBtn active={activeTab === "generator"} onClick={() => setActiveTab("generator")}>
              Generator
            </TabBtn>

            <TabBtn active={activeTab === "filters"
            } onClick={() => setActiveTab("filters")
            }>Filters</TabBtn>
            <TabBtn active={activeTab === "results"
            } onClick={() => setActiveTab("results")
            }>Results</TabBtn>
            <TabBtn active={activeTab === "optimization"
            } onClick={() => setActiveTab("optimization")
            }>Optimization</TabBtn>
            <TabBtn active={activeTab === "live"
            } onClick={() => setActiveTab("live")
            }>Live</TabBtn>
          </div>
        </header>

        { /* Notices & Errors */}
        {(err || notice) && (
          <div className="max-w-7xl mx-auto px-4 mt-4">
            {err && (
              <div className="mb-3 p-3 rounded-lg bg-red-900/30 border border-red-700/40 text-red-200 text-sm flex items-start gap-2">
                <AlertCircle className="w-4 h-4 mt-0.5" />
                <div className="leading-5">{String(err)
                }</div>
              </div>
            )
            }
            {notice && (
              <div className="mb-3 p-3 rounded-lg bg-blue-900/30 border border-blue-700/40 text-blue-200 text-sm flex items-start gap-2">
                <CheckCircle className="w-4 h-4 mt-0.5" />
                <div className="leading-5">{String(notice)
                }</div>
              </div>
            )
            }
          </div>
        )
        }

        { /* Body */}
        <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">

          { /* =============== SETUP =============== */}
          {activeTab === "setup" && (
            <div className="grid lg:grid-cols-3 gap-6">
              { /* Inputs */}
              <div className="lg:col-span-2 space-y-6">
                { /* Backtest Window */}
                <div className="p-5 rounded-xl bg-gray-800/60 border border-gray-700/50">
                  <h3 className="text-base font-semibold mb-3 flex items-center gap-2">
                    <Settings className="w-4 h-4 text-blue-300" /> Backtest Window
                  </h3>
                  <div className="grid md:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Symbol</label>
                      <input
                        className="w-full px-3 py-2 rounded bg-gray-900/60 border border-gray-700"
                        value={symbol
                        }
                        onChange={(e) => setSymbol(e.target.value)
                        }
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Timeframe</label>
                      <select
                        className="w-full px-3 py-2 rounded bg-gray-900/60 border border-gray-700"
                        value={timeframe
                        }
                        onChange={(e) => setTimeframe(e.target.value)
                        }
                      >
                        {
                          [
                            "1m",
                            "3m",
                            "5m",
                            "15m",
                            "30m",
                            "1h",
                            "2h",
                            "4h",
                            "6h",
                            "8h",
                            "12h",
                            "1d"
                          ].map((tf) => (
                            <option key={tf
                            } value={tf
                            }>
                              {tf
                              }
                            </option>
                          ))
                        }
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Start (ISO)</label>
                      <input
                        className="w-full px-3 py-2 rounded bg-gray-900/60 border border-gray-700"
                        value={start
                        }
                        onChange={(e) => setStart(e.target.value)
                        }
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">End (ISO)</label>
                      <input
                        className="w-full px-3 py-2 rounded bg-gray-900/60 border border-gray-700"
                        value={end
                        }
                        onChange={(e) => setEnd(e.target.value)
                        }
                      />
                    </div>
                  </div>
                  { /* Snapshot controls */}
                  <div className="mt-3 flex items-center gap-3">
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          const r = await fetch(`${API_BASE
                            }/data/snapshot`,
                            {
                              method: "POST",
                              headers: {
                                "Content-Type": "application/json"
                              },
                              body: JSON.stringify({
                                symbol, timeframe, start, end
                              }),
                            });
                          const j = await r.json();
                          if (r.ok && j.snapshot_id) {
                            setSnapshotId(j.snapshot_id);
                            alert(`Snapshot created: ${j.snapshot_id.substring(0,
                              8)
                              }…`);
                          } else {
                            alert(`Snapshot error: ${j.detail || JSON.stringify(j)
                              }`);
                          }
                        } catch (e) {
                          alert(`Snapshot failed: ${e
                            }`);
                        }
                      }
                      }
                      className="px-3 py-2 rounded bg-blue-600 hover:bg-blue-500 text-white text-sm"
                    >
                      Create Snapshot
                    </button>
                    <button
                      type="button"
                      onClick={downloadData
                      }
                      className="px-4 py-2 rounded bg-indigo-600 hover:bg-indigo-500 text-white"
                      title="Seçili aralığın OHLCV verisini indir ve cache'e/snapshot'a kaydet"
                    >
                      Download Data
                    </button>

                    <label className="inline-flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={useSnapshot
                        }
                        onChange={(e) => setUseSnapshot(e.target.checked)
                        }
                      />
                      Use Snapshot {snapshotId ? <span className="text-gray-400">({snapshotId.slice(0,
                        8)
                      }…)</span> : null
                      }
                    </label>
                  </div>


                </div>

                { /* Risk & Costs */}
                <div className="p-5 rounded-xl bg-gray-800/60 border border-gray-700/50">
                  <h3 className="text-base font-semibold mb-3 flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-green-300" /> Risk &amp; Costs
                  </h3>

                  <div className="grid md:grid-cols-6 gap-3">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">TP (%)</label>
                      <input
                        type="number"
                        step="0.1" // yüzde giriliyor: 1.5 gibi
                        min="0"
                        value={tpPct
                        }
                        onChange={e => setTpPct(Number(e.target.value))
                        }
                        placeholder="örn. 1.5 = %1.5"
                        disabled={backtestMode === "vectorized"
                        }
                        title={backtestMode === "vectorized" ? "Vectorized v1 TP/SL uygulamaz; Event-Driven'ı seçin." : ""
                        }
                        className="w-full px-3 py-2 rounded bg-gray-900/60 border border-gray-700"


                      />

                    </div>

                    <div>
                      <label className="block text-xs text-gray-400 mb-1">SL (%)</label>
                      <input
                        type="number"
                        step="0.1" // yüzde giriliyor: 1.5 gibi
                        min="0"
                        value={slPct
                        }
                        onChange={e => setSlPct(Number(e.target.value))
                        }
                        placeholder="örn. 1.5 = %1.5"
                        disabled={backtestMode === "vectorized"
                        }
                        title={backtestMode === "vectorized" ? "Vectorized v1 TP/SL uygulamaz; Event-Driven'ı seçin." : ""
                        }
                        className="w-full px-3 py-2 rounded bg-gray-900/60 border border-gray-700"


                      />

                    </div>



                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Fee (%)</label>
                      <input
                        type="number"
                        step="0.01"
                        className="w-full px-3 py-2 rounded bg-gray-900/60 border border-gray-700"
                        value={feePct
                        }
                        onChange={(e) => setFeePct(Number(e.target.value))
                        }
                      />
                    </div>

                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Slippage (%)</label>
                      <input
                        type="number"
                        step="0.01"
                        className="w-full px-3 py-2 rounded bg-gray-900/60 border border-gray-700"
                        value={slipPct
                        }
                        onChange={(e) => setSlipPct(Number(e.target.value))
                        }
                      />
                    </div>

                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Backtest Mode</label>
                      <select
                        className="w-full px-3 py-2 rounded bg-gray-900/60 border border-gray-700"
                        value={backtestMode
                        }
                        onChange={(e) => setBacktestMode(e.target.value)
                        }
                      >
                        <option value="vectorized">Vectorized</option>
                        <option value="event">Event-Driven</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Maker (bps)</label>
                      <input
                        type="number"
                        step="0.1"
                        className="w-full px-3 py-2 rounded bg-gray-900/60 border border-gray-700"
                        value={Number(costs?.maker_bps ?? 1)
                        }
                        onChange={(e) =>
                          setCosts((c) => ({
                            ...c, maker_bps: Number(e.target.value)
                          }))
                        }
                      />
                    </div>

                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Taker (bps)</label>
                      <input
                        type="number"
                        step="0.1"
                        className="w-full px-3 py-2 rounded bg-gray-900/60 border border-gray-700"
                        value={Number(costs?.taker_bps ?? 5)
                        }
                        onChange={(e) =>
                          setCosts((c) => ({
                            ...c, taker_bps: Number(e.target.value)
                          }))
                        }
                      />
                    </div>

                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Slip (bps)</label>
                      <input
                        type="number"
                        step="0.1"
                        className="w-full px-3 py-2 rounded bg-gray-900/60 border border-gray-700"
                        value={Number(costs?.slip_params?.fixed_bps ?? 4)
                        }
                        onChange={(e) =>
                          setCosts((c) => ({
                            ...c,
                            slip_params: {
                              ...(c.slip_params || {}),
                              fixed_bps: Number(e.target.value),
                            },
                          }))
                        }
                      />
                    </div>
                  </div>
                </div>
                { /* Strategy (DSL) */}
                <div className="p-5 rounded-xl bg-gray-800/60 border border-gray-700/50">
                  <h3 className="text-base font-semibold mb-3 flex items-center gap-2">
                    <Settings className="w-4 h-4 text-indigo-300" /> Strategy (DSL)
                  </h3>

                  <div className="grid grid-cols-1 gap-4 mb-4">


                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Expression</label>
                      <textarea
                        rows={
                          4
                        }
                        className="w-full px-3 py-2 rounded bg-gray-900/60 border border-gray-700"
                        placeholder="Örn: crosses_above(ema21, ema50) | (rsi14 < 30)"
                        value={expr
                        }
                        onChange={(e) => setExpr(e.target.value)
                        }
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Params (JSON)</label>
                      <textarea
                        rows={
                          4
                        }
                        className="w-full px-3 py-2 rounded bg-gray-900/60 border border-gray-700 font-mono text-xs"
                        placeholder='{
                           "rsi_len": 14,
                           "ema_fast": 21,
                           "ema_slow": 50
                       }'
                        value={paramJson
                        }
                        onChange={(e) => setParamJson(e.target.value)
                        }
                      />
                      <p className="text-[11px] text-gray-500 mt-1">
                        Geçerli JSON olmalı. Boş bırakılırsa <code>{
                          "{}"
                        }</code> olarak gönderilir.
                      </p>
                    </div>
                  </div>
                </div>
                { /* Preview */}

              </div>
              { /* Data quick stats */}
            </div>
          )
          }

          { /* =============== STRATEGY =============== */}
          { /* =============== STRATEGY =============== */}
          {activeTab === "strategy" && (
            <div className="space-y-6">
              {/* Strategy selector bar */}
              <div className="p-4 rounded-xl bg-gray-800/60 border border-gray-700/50">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  {/* Strategy tabs */}
                  <div className="flex flex-wrap gap-2">
                    {strategies.map(s => (
                      <button
                        key={s.id}
                        onClick={() => setActiveStratId(s.id)}
                        className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${activeStratId === s.id
                          ? "bg-blue-600 border-blue-500 text-white"
                          : "bg-gray-900/60 border-gray-700 text-gray-300 hover:bg-gray-800"
                          }`}
                      >
                        {s.name}{!s.enabled && " (off)"} {s.side > 0 ? "· Long" : "· Short"}
                      </button>
                    ))}
                  </div>

                  {/* Leverage (strategy-specific) */}
                  <label className="text-xs text-gray-400">Leverage</label>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={Number(activeStrat?.leverage ?? 1)}
                    onChange={e => patchStrategy(activeStratId, { leverage: Number(e.target.value || 1) })}
                    className="w-24 px-2 py-1 rounded bg-gray-800 border border-gray-700 text-gray-100"
                  />
                </div>

                {/* === Exit Configuration (Strategy-specific) === */}
                <div className="mt-4 p-4 rounded-xl bg-gray-800/60 border border-gray-700/50">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-semibold">
                      Stop / Exit Configuration — {activeStrat?.name}
                    </h3>

                    <div className="flex items-center gap-4">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={compareExits}
                          onChange={e => setCompareExits(e.target.checked)}
                        />
                        Compare exit strategies
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={overrideGlobalStops}
                          onChange={e => setOverrideGlobalStops(e.target.checked)}
                        />
                        Override global TP/SL
                      </label>
                    </div>
                  </div>

                  {(() => {
                    // helpers (virgüllü giriş desteği)
                    const num = (v, def = 0) => {
                      const n = Number(String(v ?? "").replace(",", "."));
                      return Number.isFinite(n) ? n : def;
                    };
                    const int = (v, def = 0) => {
                      const n = parseInt(String(v ?? "").replace(",", "."), 10);
                      return Number.isFinite(n) ? n : def;
                    };
                    const type = activeStrat?.exitConfig?.type || "fixed";

                    return (
                      <div className="grid md:grid-cols-4 gap-4 mb-2">
                        {/* Exit Type */}
                        <div>
                          <label className="block text-xs text-gray-400 mb-2">Exit Type</label>
                          <select
                            className="w-full px-3 py-2 rounded bg-gray-900/60 border border-gray-700 focus:border-blue-500 focus:outline-none"
                            value={type}
                            onChange={(e) => {
                              const newType = e.target.value;
                              const prev = activeStrat?.exitConfig || {};
                              // type değişince uygun defaultları dolduralım (boşsa)
                              const defaultsByType = {
                                fixed: { tpPct: prev.tpPct ?? 1.0, slPct: prev.slPct ?? 2.0 },
                                atr: { atrN: prev.atrN ?? 14, kSL: prev.kSL ?? 2.0, mTP: prev.mTP ?? 2.0 },
                                chandelier: { n: prev.n ?? 22, factor: prev.factor ?? 3.0 },
                                bollinger: { ma: prev.ma ?? "SMA", n: prev.n ?? 20, std: prev.std ?? 2.0, side: prev.side ?? "upper" },
                                trailing_pct: { trailPct: prev.trailPct ?? 1.0 },
                              };
                              patchStrategy(activeStratId, {
                                exitConfig: {
                                  ...prev,
                                  type: newType,
                                  ...(defaultsByType[newType] || {})
                                }
                              });
                            }}
                          >
                            <option value="fixed">Fixed (%)</option>
                            <option value="atr">ATR Based</option>
                            <option value="chandelier">Chandelier Exit</option>
                            <option value="bollinger">Bollinger Bands</option>
                            <option value="trailing_pct">Trailing %</option>
                          </select>
                        </div>

                        {/* FIXED */}
                        {type === "fixed" && (
                          <>
                            <div>
                              <label className="block text-xs text-gray-400 mb-2">Take Profit (%)</label>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                className="w-full px-3 py-2 rounded bg-gray-900/60 border border-gray-700 focus:border-blue-500 focus:outline-none"
                                value={activeStrat?.exitConfig?.tpPct ?? 1.0}
                                onChange={e =>
                                  patchStrategy(activeStratId, {
                                    exitConfig: { ...(activeStrat?.exitConfig || {}), tpPct: num(e.target.value, 1.0) }
                                  })
                                }
                              />
                            </div>
                            <div>
                              <label className="block text-xs text-gray-400 mb-2">Stop Loss (%)</label>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                className="w-full px-3 py-2 rounded bg-gray-900/60 border border-gray-700 focus:border-blue-500 focus:outline-none"
                                value={activeStrat?.exitConfig?.slPct ?? 2.0}
                                onChange={e =>
                                  patchStrategy(activeStratId, {
                                    exitConfig: { ...(activeStrat?.exitConfig || {}), slPct: num(e.target.value, 2.0) }
                                  })
                                }
                              />
                            </div>
                          </>
                        )}

                        {/* ATR */}
                        {type === "atr" && (
                          <>
                            <div>
                              <label className="block text-xs text-gray-400 mb-2">ATR Period</label>
                              <input
                                type="number"
                                min="1"
                                step="1"
                                className="w-full px-3 py-2 rounded bg-gray-900/60 border border-gray-700 focus:border-blue-500 focus:outline-none"
                                value={activeStrat?.exitConfig?.atrN ?? 14}
                                onChange={e =>
                                  patchStrategy(activeStratId, {
                                    exitConfig: { ...(activeStrat?.exitConfig || {}), atrN: int(e.target.value, 14) }
                                  })
                                }
                              />
                            </div>
                            <div>
                              <label className="block text-xs text-gray-400 mb-2">SL Multiplier (k)</label>
                              <input
                                type="number"
                                step="0.1"
                                min="0"
                                className="w-full px-3 py-2 rounded bg-gray-900/60 border border-gray-700 focus:border-blue-500 focus:outline-none"
                                value={activeStrat?.exitConfig?.kSL ?? 2.0}
                                onChange={e =>
                                  patchStrategy(activeStratId, {
                                    exitConfig: { ...(activeStrat?.exitConfig || {}), kSL: num(e.target.value, 2.0) }
                                  })
                                }
                              />
                            </div>
                            <div>
                              <label className="block text-xs text-gray-400 mb-2">TP Multiplier (m)</label>
                              <input
                                type="number"
                                step="0.1"
                                min="0"
                                className="w-full px-3 py-2 rounded bg-gray-900/60 border border-gray-700 focus:border-blue-500 focus:outline-none"
                                value={activeStrat?.exitConfig?.mTP ?? 2.0}
                                onChange={e =>
                                  patchStrategy(activeStratId, {
                                    exitConfig: { ...(activeStrat?.exitConfig || {}), mTP: num(e.target.value, 2.0) }
                                  })
                                }
                              />
                            </div>
                          </>
                        )}

                        {/* CHANDELIER */}
                        {type === "chandelier" && (
                          <>
                            <div>
                              <label className="block text-xs text-gray-400 mb-2">Period (n)</label>
                              <input
                                type="number"
                                min="1"
                                step="1"
                                className="w-full px-3 py-2 rounded bg-gray-900/60 border border-gray-700 focus:border-blue-500 focus:outline-none"
                                value={activeStrat?.exitConfig?.n ?? 22}
                                onChange={e =>
                                  patchStrategy(activeStratId, {
                                    exitConfig: { ...(activeStrat?.exitConfig || {}), n: int(e.target.value, 22) }
                                  })
                                }
                              />
                            </div>
                            <div>
                              <label className="block text-xs text-gray-400 mb-2">Factor (k)</label>
                              <input
                                type="number"
                                step="0.1"
                                min="0"
                                className="w-full px-3 py-2 rounded bg-gray-900/60 border border-gray-700 focus:border-blue-500 focus:outline-none"
                                value={activeStrat?.exitConfig?.factor ?? 3.0}
                                onChange={e =>
                                  patchStrategy(activeStratId, {
                                    exitConfig: { ...(activeStrat?.exitConfig || {}), factor: num(e.target.value, 3.0) }
                                  })
                                }
                              />
                            </div>
                          </>
                        )}

                        {/* BOLLINGER */}
                        {type === "bollinger" && (
                          <>
                            <div>
                              <label className="block text-xs text-gray-400 mb-2">MA Type</label>
                              <select
                                className="w-full px-3 py-2 rounded bg-gray-900/60 border border-gray-700 focus:border-blue-500 focus:outline-none"
                                value={activeStrat?.exitConfig?.ma ?? "SMA"}
                                onChange={e =>
                                  patchStrategy(activeStratId, {
                                    exitConfig: { ...(activeStrat?.exitConfig || {}), ma: e.target.value }
                                  })
                                }
                              >
                                <option value="SMA">SMA</option>
                                <option value="EMA">EMA</option>
                                <option value="WMA">WMA</option>
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs text-gray-400 mb-2">Period (n)</label>
                              <input
                                type="number"
                                min="1"
                                step="1"
                                className="w-full px-3 py-2 rounded bg-gray-900/60 border border-gray-700 focus:border-blue-500 focus:outline-none"
                                value={activeStrat?.exitConfig?.n ?? 20}
                                onChange={e =>
                                  patchStrategy(activeStratId, {
                                    exitConfig: { ...(activeStrat?.exitConfig || {}), n: int(e.target.value, 20) }
                                  })
                                }
                              />
                            </div>
                            <div>
                              <label className="block text-xs text-gray-400 mb-2">Std Dev</label>
                              <input
                                type="number"
                                step="0.1"
                                min="0"
                                className="w-full px-3 py-2 rounded bg-gray-900/60 border border-gray-700 focus:border-blue-500 focus:outline-none"
                                value={activeStrat?.exitConfig?.std ?? 2.0}
                                onChange={e =>
                                  patchStrategy(activeStratId, {
                                    exitConfig: { ...(activeStrat?.exitConfig || {}), std: num(e.target.value, 2.0) }
                                  })
                                }
                              />
                            </div>
                            <div>
                              <label className="block text-xs text-gray-400 mb-2">Band Side</label>
                              <select
                                className="w-full px-3 py-2 rounded bg-gray-900/60 border border-gray-700 focus:border-blue-500 focus:outline-none"
                                value={activeStrat?.exitConfig?.side ?? "upper"}
                                onChange={e =>
                                  patchStrategy(activeStratId, {
                                    exitConfig: { ...(activeStrat?.exitConfig || {}), side: e.target.value }
                                  })
                                }
                              >
                                <option value="upper">Upper</option>
                                <option value="lower">Lower</option>
                                <option value="mid">Mid</option>
                              </select>
                            </div>
                          </>
                        )}

                        {/* TRAILING % */}
                        {type === "trailing_pct" && (
                          <div>
                            <label className="block text-xs text-gray-400 mb-2">Trailing %</label>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              className="w-full px-3 py-2 rounded bg-gray-900/60 border border-gray-700 focus:border-blue-500 focus:outline-none"
                              value={activeStrat?.exitConfig?.trailPct ?? 1.0}
                              onChange={e =>
                                patchStrategy(activeStratId, {
                                  exitConfig: { ...(activeStrat?.exitConfig || {}), trailPct: num(e.target.value, 1.0) }
                                })
                              }
                            />
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Strategy controls */}
                  <div className="flex items-center gap-2 flex-wrap mt-4">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={!!activeStrat?.enabled}
                        onChange={e => patchStrategy(activeStratId, { enabled: e.target.checked })}
                      />
                      Enabled
                    </label>

                    <select
                      value={activeStrat?.side ?? 1}
                      onChange={(e) => patchStrategy(activeStratId, { side: Number(e.target.value) })}
                      className="px-2 py-1 rounded bg-slate-900/60 border border-slate-700 text-sm text-slate-200 focus:border-cyan-400 focus:outline-none"
                    >
                      <option value={1}>Long</option>
                      <option value={-1}>Short</option>
                    </select>

                    <button
                      onClick={() => {
                        const newStrategy = {
                          id: uid(),
                          name: `Strategy ${String.fromCharCode(65 + strategies.length)}`,
                          enabled: true,
                          side: 1,
                          leverage: 1,
                          expr: longExpr, // Always start with the default long expression
                          extraParams: {},
                          filters: [],
                          indicators: { // Start with default indicators only
                            macd_fast_default: 6,
                            macd_slow_default: 18,
                            macd_signal_default: 9,
                          },
                          optimize: { // Default optimization space for MACD
                            macd_fast_default: { min: 6, max: 20, step: 2 },
                            macd_slow_default: { min: 18, max: 40, step: 2 },
                            macd_signal_default: { min: 5, max: 15, step: 1 },
                          },
                          method: "grid",
                          maxIter: 200,
                          exitConfig: { // Default exit config
                            type: "fixed",
                            tpPct: 1.0,
                            slPct: 2.0,
                          }
                        };
                        setStrategies(prev => [...prev, newStrategy]);
                        setActiveStratId(newStrategy.id);
                      }}
                      className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm transition-colors"
                    >
                      + New
                    </button>

                    {strategies.length > 1 && (
                      <button
                        onClick={() => removeStrategy(activeStratId)}
                        className="px-3 py-1.5 bg-red-600 hover:bg-red-500 rounded text-sm transition-colors"
                      >
                        Remove
                      </button>
                    )}
                  </div>

                  {/* Snapshot info */}
                  <div className="mt-3 pt-3 border-t border-gray-700/50">
                    {useSnapshot && snapshotId ? (
                      <span className="text-xs text-emerald-300" title={`snapshot ${snapshotId}`}>
                        snapshot {shortId(snapshotId)}
                        {downloadInfo?.bars ? ` • bars=${downloadInfo.bars}` : ""}
                      </span>
                    ) : (
                      <span className="text-xs text-amber-300">
                        no cached data — use "Download Data" in Setup
                      </span>
                    )}
                  </div>
                </div>

                {/* Main content grid */}
                <div className="grid lg:grid-cols-2 gap-6 mt-4">
                  {/* Expression editor */}
                  <div className="space-y-4">
                    <div className="p-4 rounded-xl bg-gray-800/60 border border-gray-700/50">
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-semibold">Custom Strategy Expression</h3>
                        <button
                          onClick={() =>
                            patchStrategy(activeStratId, {
                              expr: (activeStrat?.side ?? 1) > 0 ? longExpr : shortExpr
                            })
                          }
                          className="text-xs px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 border border-gray-600"
                        >
                          Use Default ({(activeStrat?.side ?? 1) > 0 ? "Long" : "Short"})
                        </button>
                      </div>

                      <textarea
                        rows={12}
                        className="w-full font-mono text-sm p-4 rounded-lg bg-gray-900/50 border border-gray-600 focus:border-blue-500 focus:outline-none"
                        value={activeStrat?.expr ?? ""}
                        onChange={e => patchStrategy(activeStratId, { expr: e.target.value })}
                        placeholder="(data['NDMA'] > 0.0003) & (data['hist'] < 0) & ..."
                      />

                      <p className="text-xs text-gray-500 mt-2">
                        Tek satır Pythonic boolean ifade. Stratejiye özel parametreleri "Indicator Defaults"
                        kısmından ekleyebilir, optimize aralıklarını tanımlayabilirsin.
                      </p>
                    </div>

                    {/* Preset buttons */}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={exportPresets}
                        className="px-3 py-2 rounded bg-slate-600 hover:bg-slate-500 text-white text-sm transition-colors flex items-center gap-2"
                        title="Export presets to JSON"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        Export Presets
                      </button>

                      <label className="px-3 py-2 rounded bg-slate-700 hover:bg-slate-600 text-white text-sm cursor-pointer transition-colors flex items-center gap-2">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
                        </svg>
                        Import Presets
                        <input
                          type="file"
                          accept="application/json,.json"
                          className="hidden"
                          onChange={e => {
                            const f = e.target.files?.[0];
                            if (f) importPresets(f);
                            e.target.value = "";
                          }}
                        />
                      </label>
                    </div>
                  </div>

                  {/* Indicator Defaults */}
                  <div className="p-4 rounded-xl bg-gray-800/60 border border-gray-700/50">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-sm font-semibold">Indicator Defaults</h3>

                      <div className="relative">
                        <button
                          onClick={() => setShowIndAdd(v => !v)}
                          className="px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-sm transition-colors"
                        >
                          + Add Indicator
                        </button>
                        {showIndAdd && (
                          <div className="absolute right-0 mt-2 z-10 w-56 p-1 rounded-lg bg-gray-900 border border-gray-700 shadow-lg max-h-64 overflow-auto">
                            {indCatalog.map(g => (
                              <button
                                key={g.id}
                                onClick={() => {
                                  addIndicatorGroup(g.id);
                                  setShowIndAdd(false);
                                }}
                                className="w-full text-left px-3 py-1.5 rounded hover:bg-gray-800 text-sm transition-colors"
                              >
                                {g.name || g.id}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Tüm indikatörler (MACD dahil) artık bu tek dinamik blokta render ediliyor */}
                    {indCatalog
                      .flatMap(g => {
                        const sufs = groupInstances(g, activeStrat?.indicators || {});
                        return sufs.map(suf => ({ g, suf }));
                      })
                      .map(({ g, suf }) => (
                        <div key={g.id + ":" + (suf || "0")} className="mb-6">
                          <div className="flex items-center justify-between mb-3">
                            <div className="text-xs text-gray-400 font-medium">
                              {g.name}{suf ? ` ${suf}` : ""}
                            </div>
                            <button
                              onClick={() => removeIndicatorInstance(g.id, suf)}
                              className="text-xs px-2 py-1 rounded bg-red-600 hover:bg-red-500 text-white transition-colors"
                              title={`Remove ${g.name}${suf ? ` ${suf}` : ""}`}
                            >
                              Remove
                            </button>
                          </div>

                          <div className={`grid ${g.params.length > 3 ? 'grid-cols-4' : 'grid-cols-3'} ${g.params.length > 3 ? 'gap-2' : 'gap-3'}`}>
                            {g.params.map(p => {
                              const k = p.key + (suf || "");
                              return (
                                <div key={k} className="space-y-1">
                                  <label className="block text-xs text-gray-400">
                                    {labelWithSuf(p.label, suf)}
                                  </label>
                                  <input
                                    type="number"
                                    step="any"
                                    className="w-full px-2 py-1.5 rounded bg-gray-900/60 border border-gray-700 focus:border-blue-500 focus:outline-none text-sm"
                                    value={activeStrat?.indicators?.[k] ?? p.def}
                                    onChange={e =>
                                      patchStrategyDeep(activeStratId, s => {
                                        s.indicators = {
                                          ...(s.indicators || {}),
                                          [k]: Number(e.target.value)
                                        };
                                        return s;
                                      })
                                    }
                                  />
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                  </div>
                </div>

                {/* Run Backtest Button */}
                <div className="flex items-center justify-between pt-4 border-t border-gray-700/50">
                  <button
                    onClick={runBacktest}
                    disabled={!useSnapshot || !snapshotId}
                    className={`px-4 py-2 rounded text-white transition-colors ${!useSnapshot || !snapshotId
                      ? 'bg-gray-600 cursor-not-allowed'
                      : 'bg-emerald-600 hover:bg-emerald-500'
                      }`}
                  >
                    Run Backtest
                  </button>

                  {err && (
                    <div className="text-sm text-red-400 bg-red-900/20 px-3 py-2 rounded">
                      {err}
                    </div>
                  )}
                </div>
              </div>

              {/* Exit Comparison Results */}
              {exitResults && (
                <div className="p-4 rounded-xl bg-gray-800/60 border border-gray-700/50">
                  <h3 className="text-sm font-semibold mb-4">Exit Strategy Comparison</h3>
                  <div className="grid md:grid-cols-3 gap-4">
                    {(exitResults.schemes || []).map((s, i) => {
                      const sum = s?.summary || {};
                      return (
                        <div key={i} className="p-4 rounded-lg bg-gray-900/40 border border-gray-700/40">
                          <div className="text-xs text-gray-400 mb-1">Strategy</div>
                          <div className="font-medium mb-3 uppercase text-cyan-300">{s?.type || "unknown"}</div>
                          <div className="text-sm space-y-2">
                            <div className="flex justify-between">
                              <span className="text-gray-400">PnL:</span>
                              <span className="font-medium">{Number(sum.pnl ?? 0).toFixed(2)}</span>
                            </div>
                            {"pf" in sum && (
                              <div className="flex justify-between">
                                <span className="text-gray-400">PF:</span>
                                <span className="font-medium">{Number(sum.pf).toFixed(2)}</span>
                              </div>
                            )}
                            {"maxdd" in sum && (
                              <div className="flex justify-between">
                                <span className="text-gray-400">Max DD:</span>
                                <span className="font-medium text-red-400">{Number(sum.maxdd).toFixed(2)}%</span>
                              </div>
                            )}
                            <div className="flex justify-between">
                              <span className="text-gray-400">Trades:</span>
                              <span className="font-medium">{sum.trades ?? 0}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
          {activeTab === "generator" && (
            <div className="space-y-6">
              <div className="p-4 rounded-xl bg-gray-800/60 border border-gray-700/50">
                <h3 className="text-base font-semibold mb-4">
                  Auto Strategy Generator (Genetic Programming)
                </h3>

                <div className="grid md:grid-cols-3 gap-6">
                  {/* Sol panel: info / (ileride checkbox list) */}
                  <div className="space-y-4 p-4 rounded-lg bg-gray-900/40">
                    <h4 className="font-semibold text-sm">Building Blocks</h4>

                    <div>
                      <label className="text-xs text-gray-400">Indicators (Terminals)</label>
                      <p className="text-xs text-gray-500 mb-2">Select indicators for the GP to use.</p>

                      <div className="max-h-40 overflow-auto space-y-1 p-2 border border-gray-700 rounded-md">
                        {indCatalog.flatMap(g =>
                          g.params.map(p => {
                            const checked = gpSelectedKeys.has(p.key);
                            return (
                              <label key={p.key} className="flex items-center gap-2 text-sm">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) => {
                                    const fam = GP_KEY_FAMILY(p.key); // MACD/RSI/EMA...
                                    setGpSelectedKeys(prev => {
                                      const next = new Set(prev);
                                      if (e.target.checked) next.add(p.key); else next.delete(p.key);

                                      // Parametre şablonlarını ekle/çıkar
                                      if (fam && GP_PARAM_TEMPLATES[fam]) {
                                        // Bu ailede seçili kalan başka key var mı?
                                        const stillHasFamily = Array.from(next).some(k => GP_KEY_FAMILY(k) === fam);

                                        setGpIndParams(prevParams => {
                                          const cur = { ...prevParams };
                                          if (e.target.checked) {
                                            // Varsayılanları ekle (varsa üzerine yazma)
                                            GP_PARAM_TEMPLATES[fam].forEach(f => {
                                              if (typeof cur[f.key] === "undefined") cur[f.key] = f.def;
                                            });
                                          } else if (!stillHasFamily) {
                                            // Bu aileden hiç kalmadı → ilgili param anahtarlarını sil
                                            GP_PARAM_TEMPLATES[fam].forEach(f => { delete cur[f.key]; });
                                          }
                                          return cur;
                                        });
                                      }
                                      return next;
                                    });
                                  }}

                                />
                                <span className="truncate">{p.label}</span>
                              </label>
                            );
                          })
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-400">{gpSelectedKeys.size} selected</span>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className="px-2 py-1 text-xs rounded bg-zinc-700/70"
                          onClick={() =>
                            setGpSelectedKeys(new Set(indCatalog.flatMap(g => g.params.map(p => p.key))))
                          }
                        >
                          Select all
                        </button>
                        <button
                          type="button"
                          className="px-2 py-1 text-xs rounded bg-zinc-700/70"
                          onClick={() => setGpSelectedKeys(new Set())}
                        >
                          Clear
                        </button>
                      </div>
                    </div>

                    <div>
                      <label className="text-xs text-gray-400">Operators (Functions)</label>
                      <div className="flex flex-wrap gap-2 mt-2 text-xs">
                        <span className="px-2 py-1 bg-blue-600/50 rounded-md">&</span>
                        <span className="px-2 py-1 bg-blue-600/50 rounded-md">|</span>
                        <span className="px-2 py-1 bg-green-600/50 rounded-md">&gt;</span>
                        <span className="px-2 py-1 bg-green-600/50 rounded-md">&lt;</span>
                        <span className="px-2 py-1 bg-zinc-700/70 rounded-md">&gt;=</span>
                        <span className="px-2 py-1 bg-zinc-700/70 rounded-md">&lt;=</span>
                        <span className="px-2 py-1 bg-zinc-700/70 rounded-md">+</span>
                        <span className="px-2 py-1 bg-zinc-700/70 rounded-md">-</span>
                        <span className="px-2 py-1 bg-zinc-700/70 rounded-md">*</span>
                        <span className="px-2 py-1 bg-zinc-700/70 rounded-md">/</span>
                      </div>
                    </div>
                  </div>
                  {/* Seçilen indikatörlerin parametreleri */}
                  <div className="mt-4 p-3 rounded-md border border-gray-700/50 bg-gray-900/40">
                    <h5 className="text-xs font-semibold mb-2">Selected Indicator Parameters</h5>

                    {/* Aile başlıkları */}
                    {Object.entries(GP_PARAM_TEMPLATES).map(([fam, fields]) => {
                      // Bu ailenin en az bir param anahtarı gpIndParams’ta varsa göster
                      const show = fields.some(f => typeof gpIndParams[f.key] !== "undefined");
                      if (!show) return null;

                      return (
                        <div key={fam} className="mb-3">
                          <div className="text-xs text-gray-300 font-semibold mb-1">{fam}</div>
                          <div className="grid grid-cols-2 gap-2">
                            {fields.map(f => (
                              <label key={f.key} className="text-xs text-gray-400">
                                {f.label}
                                <input
                                  className="mt-1 w-full px-2 py-1 rounded bg-gray-900/60 border border-gray-700 text-sm"
                                  type="number"
                                  step={f.type === "float" ? "0.1" : "1"}
                                  value={gpIndParams[f.key] ?? ""}
                                  onChange={e => {
                                    const v = e.target.value;
                                    setGpIndParams(prev => ({
                                      ...prev,
                                      [f.key]:
                                        f.type === "float" ? parseFloat(v || 0) :
                                          f.type === "int" ? parseInt(v || 0, 10) :
                                            v
                                    }));
                                  }}
                                />
                              </label>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>


                  {/* Orta panel: ayarlar */}
                  <div className="space-y-4 p-4 rounded-lg bg-gray-900/40 border border-gray-700/50">
                    <h4 className="font-semibold text-sm">Generator Settings</h4>

                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Population Size</label>
                      <input
                        type="number"
                        value={gpPopulation}
                        onChange={e => setGpPopulation(Number(e.target.value || 0))}
                        className="w-full px-2 py-1.5 rounded bg-gray-900/60 border border-gray-700 text-sm"
                      />
                    </div>

                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Generations</label>
                      <input
                        type="number"
                        value={gpGenerations}
                        onChange={e => setGpGenerations(Number(e.target.value || 0))}
                        className="w-full px-2 py-1.5 rounded bg-gray-900/60 border border-gray-700 text-sm"
                      />
                    </div>

                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Objective</label>
                      <select
                        value={gpObjective}
                        onChange={e => setGpObjective(e.target.value)}
                        className="w-full px-2 py-1.5 rounded bg-gray-900/60 border border-gray-700 text-sm"
                      >
                        <option value="sharpe">Sharpe Ratio</option>
                        <option value="profit">Net Profit</option>
                        <option value="winRate">Win Rate</option>
                      </select>
                    </div>

                    <button
                      onClick={startGeneration}
                      disabled={busy || !snapshotId}
                      className="w-full py-2 rounded bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white mt-4"
                    >
                      {busy ? "Generating..." : "Start Generation"}
                    </button>
                  </div>

                  {/* Sağ panel: sonuç */}
                  <div className="space-y-4 p-4 rounded-lg bg-gray-900/40 border border-gray-700/50">
                    <h4 className="font-semibold text-sm">Best Strategy Found</h4>
                    {gpResult ? (
                      <>
                        <div>
                          <label className="block text-xs text-gray-400 mb-1">
                            Generated Expression (`expr`)
                          </label>
                          <textarea
                            readOnly
                            value={gpResult.expr || ""}
                            rows={4}
                            className="w-full font-mono text-xs p-2 rounded bg-gray-800 border border-gray-700"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-center">
                          <div className="p-2 bg-gray-800 rounded-md">
                            <div className="text-xs text-gray-400">Profit</div>
                            <div className="text-lg font-bold text-green-400">
                              {Number(gpResult?.stats?.profit ?? 0).toFixed(2)}%
                            </div>
                          </div>
                          <div className="p-2 bg-gray-800 rounded-md">
                            <div className="text-xs text-gray-400">Sharpe</div>
                            <div className="text-lg font-bold text-yellow-400">
                              {Number(gpResult?.stats?.sharpe ?? 0).toFixed(2)}
                            </div>
                          </div>
                        </div>
                        <button
                          onClick={() =>
                            patchStrategy?.(activeStrat?.id, { expr: String(gpResult?.expr || "") })
                          }
                          disabled={!activeStrat?.id || !gpResult?.expr}
                          className="w-full py-2 rounded bg-blue-600 hover:bg-blue-500 text-white text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Apply to Active Strategy
                        </button>
                      </>
                    ) : (
                      <div className="text-sm text-gray-400 text-center pt-10">No results yet.</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}


          {activeTab === "filters" && (
            <div className="space-y-6">
              <div className="p-4 rounded-xl bg-gray-800/60 border border-gray-700/50">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-base font-semibold">Filters for: {activeStrat?.name || ""}</h3>
                  <div className="flex gap-2">
                    <button
                      onClick={handleResetFilters}
                      disabled={busy}
                      className="px-3 py-1.5 rounded bg-gray-600 hover:bg-gray-500 disabled:opacity-50 text-sm flex items-center gap-2"
                    >
                      <RotateCcw className="w-4 h-4" />
                      Reset
                    </button>

                    <button
                      onClick={suggestFilters}
                      disabled={!useSnapshot || !snapshotId || busy}
                      title={!useSnapshot || !snapshotId ? "Önce Setup -> Download Data" : ""}
                      className="px-3 py-1.5 rounded bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                    >
                      <Zap className="w-4 h-4 inline -mt-0.5 mr-1.5" />
                      Suggest
                    </button>
                    <button
                      onClick={applyFiltersToExpr}
                      disabled={busy}
                      className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-sm"
                    >
                      Apply Filter to Strategy
                    </button>
                    <button
                      onClick={() => setFiltersLocal(prev => [...prev, { key: "", enabled: true, min: "", max: "" }])}
                      disabled={busy}
                      className="px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-sm"
                    >
                      + Add
                    </button>
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-4 pt-4 border-t border-gray-700/50">
                  {/* Min Coverage Slider */}
                  <div className="flex items-center gap-3 text-sm">
                    <span className="text-gray-300 font-medium">Min. Coverage:</span>
                    <input
                      type="range"
                      min={5} max={95} step={5}
                      value={filterCoverage}
                      onChange={e => setFilterCoverage(Number(e.target.value))}
                      className="w-full"
                      disabled={busy}
                    />
                    <span className="text-blue-300 font-semibold w-12 text-center">{filterCoverage}%</span>
                  </div>

                  {/* GÜNCELLENMİŞ: Hardcoded ama yeni algoritmaları içeren Dropdown */}
                  <div className="flex items-center gap-3 text-sm">
                    <span className="text-gray-300 font-medium">Suggestion Method:</span>
                    <select
                      value={filterMethod}
                      onChange={e => setFilterMethod(e.target.value)}
                      className="w-full px-3 py-1.5 rounded bg-gray-900/60 border border-gray-700 focus:border-blue-500 focus:outline-none"
                      disabled={busy}
                    >
                      <option value="random">Random Search</option>
                      <option value="bayesian">Bayesian</option>
                      <option value="genetic">Genetic Algorithm</option>
                      {/* YENİ EKLENEN METOTLAR */}
                      <option value="tpe">TPE (Optuna)</option>
                      <option value="cmaes">CMA-ES (Optuna)</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* --- GÜNCELLENMİŞ: Hardcoded ama yeni algoritmaları içeren Parametre Alanları --- */}
              <div className="p-3 mt-4 rounded-md bg-gray-900/40 border border-gray-700/50">
                <h4 className="text-xs font-semibold text-gray-400 mb-3">
                  {/* Başlığı dinamik olarak daha güvenli hale getirelim */}
                  {`${filterMethod.charAt(0).toUpperCase() + filterMethod.slice(1)} Parameters`}
                </h4>
                <div className="grid grid-cols-3 gap-3 text-sm">
                  {filterMethod === 'random' && (
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Samples</label>
                      <input
                        type="number"
                        value={algoParams.samples || 12000}
                        onChange={e => setAlgoParams({ samples: Number(e.target.value) })}
                        className="w-full px-2 py-1 rounded bg-gray-900/80 border border-gray-600"
                      />
                    </div>
                  )}
                  {filterMethod === 'bayesian' && (
                    <>
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">Number of Calls</label>
                        <input
                          type="number"
                          value={algoParams.n_calls || 150}
                          onChange={e => setAlgoParams(p => ({ ...p, n_calls: Number(e.target.value) }))}
                          className="w-full px-2 py-1 rounded bg-gray-900/80 border border-gray-600"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">Initial Random Points</label>
                        <input
                          type="number"
                          value={algoParams.n_initial_points || 10}
                          onChange={e => setAlgoParams(p => ({ ...p, n_initial_points: Number(e.target.value) }))}
                          className="w-full px-2 py-1 rounded bg-gray-900/80 border border-gray-600"
                        />
                      </div>
                    </>
                  )}
                  {filterMethod === 'genetic' && (
                    <>
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">Iterations</label>
                        <input
                          type="number"
                          value={algoParams.max_num_iteration || 100}
                          onChange={e => setAlgoParams(p => ({ ...p, max_num_iteration: Number(e.target.value) }))}
                          className="w-full px-2 py-1 rounded bg-gray-900/80 border border-gray-600"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">Population Size</label>
                        <input
                          type="number"
                          value={algoParams.population_size || 20}
                          onChange={e => setAlgoParams(p => ({ ...p, population_size: Number(e.target.value) }))}
                          className="w-full px-2 py-1 rounded bg-gray-900/80 border border-gray-600"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">Mutation Prob.</label>
                        <input
                          type="number" step="0.01" min="0" max="1"
                          value={algoParams.mutation_probability || 0.1}
                          onChange={e => setAlgoParams(p => ({ ...p, mutation_probability: Number(e.target.value) }))}
                          className="w-full px-2 py-1 rounded bg-gray-900/80 border border-gray-600"
                        />
                      </div>
                    </>
                  )}
                  {/* YENİ EKLENEN METOTLARIN PARAMETRELERİ */}
                  {filterMethod === 'tpe' && (
                    <>
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">Number of Trials</label>
                        <input
                          type="number"
                          value={algoParams.n_trials || 200}
                          onChange={e => setAlgoParams(p => ({ ...p, n_trials: Number(e.target.value) }))}
                          className="w-full px-2 py-1 rounded bg-gray-900/80 border border-gray-600"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">Startup Trials</label>
                        <input
                          type="number"
                          value={algoParams.n_startup_trials || 10}
                          onChange={e => setAlgoParams(p => ({ ...p, n_startup_trials: Number(e.target.value) }))}
                          className="w-full px-2 py-1 rounded bg-gray-900/80 border border-gray-600"
                        />
                      </div>
                    </>
                  )}
                  {filterMethod === 'cmaes' && (
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Number of Trials</label>
                      <input
                        type="number"
                        value={algoParams.n_trials || 200}
                        onChange={e => setAlgoParams({ n_trials: Number(e.target.value) })}
                        className="w-full px-2 py-1 rounded bg-gray-900/80 border border-gray-600"
                      />
                    </div>
                  )}
                </div>
              </div>

              <div className="p-4 rounded-xl bg-gray-800/60 border border-gray-700/50 space-y-2">
                {filtersLocal.map((f, i) => (
                  <div key={i} className="grid grid-cols-12 gap-2 items-center">
                    <input
                      readOnly={busy}
                      className="col-span-4 px-3 py-2 rounded bg-gray-900/60 border border-gray-700 text-sm"
                      placeholder="indicator key (örn: NDMA, rsi_diff)"
                      value={f.key}
                      onChange={e => updateFilter(i, { key: e.target.value })}
                    />
                    <label className="col-span-2 flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={!!f.enabled} onChange={e => updateFilter(i, { enabled: e.target.checked })} />
                      enabled
                    </label>
                    <input
                      readOnly={busy}
                      type="number"
                      step="any"
                      className="col-span-2 px-3 py-2 rounded bg-gray-900/60 border border-gray-700 text-sm"
                      placeholder="min"
                      value={f.min}
                      onChange={e => updateFilter(i, { min: e.target.value })}
                    />
                    <input
                      readOnly={busy}
                      type="number"
                      step="any"
                      className="col-span-2 px-3 py-2 rounded bg-gray-900/60 border border-gray-700 text-sm"
                      placeholder="max"
                      value={f.max}
                      onChange={e => updateFilter(i, { max: e.target.value })}
                    />
                    <button
                      onClick={() => removeFilter(i)}
                      className="col-span-2 px-3 py-2 rounded bg-red-600 hover:bg-red-500 text-sm"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>

              {filterSuggest && (
                <div className="p-4 rounded-lg bg-gray-800/50 border border-gray-700/60">
                  <div className="font-semibold mb-2 text-base">Suggestion Result</div>
                  <div className="p-3 rounded-md bg-gray-900/50">
                    <pre className="text-xs text-gray-300 whitespace-pre-wrap">
                      {JSON.stringify(filterSuggest, null, 2)}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          )}
          { /* =============== RESULTS =============== */}
          {activeTab === "results" && (
            <div className="space-y-6">
              <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
                <MetricCard title="Trades" value={metrics.trades
                } color="blue" />
                <MetricCard title="Win rate" value={`${metrics.winRate.toFixed(1)
                  }%`
                } color="green" />
                <MetricCard title="Profit" value={`${metrics.profitPct.toFixed(2)
                  }%`
                } color="purple" />
                <MetricCard title="Sharpe (≈)" value={fmt(metrics.sharpe,
                  2)
                } color="yellow" />
                <MetricCard title="Max DD" value={`${metrics.maxDDPct.toFixed(2)
                  }%`
                } color="red" />
              </div>

              <div className="grid lg:grid-cols-2 gap-6">
                {chartEquity && (
                  <div className="p-4 rounded-xl bg-gray-800/60 border border-gray-700/50">
                    <h3 className="text-sm font-semibold mb-3">Equity Curve %</h3>
                    <div className="h-64">
                      <Line data={chartEquity.data
                      } options={chartEquity.options
                      } />
                    </div>
                  </div>
                )
                }
                {chartDaily && (
                  <div className="p-4 rounded-xl bg-gray-800/60 border border-gray-700/50">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-semibold">
                        {(retView === "D" ? "Daily" : retView === "W" ? "Weekly" : "Monthly")} Returns %
                      </h3>
                      <div className="flex items-center gap-1">
                        {[
                          ["D", "Daily"],
                          ["W", "Weekly"],
                          ["M", "Monthly"],
                        ].map(([k, lbl]) => (
                          <button
                            key={k}
                            onClick={() => setRetView(k)}
                            className={
                              "px-2 py-1 rounded text-xs border " +
                              (retView === k
                                ? "bg-cyan-600 border-cyan-500 text-white"
                                : "bg-gray-900/50 border-gray-700 text-gray-300 hover:bg-gray-800")
                            }
                          >
                            {lbl}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="h-64">
                      <Bar data={chartDaily.data} options={chartDaily.options} />
                    </div>

                  </div>
                )
                }
              </div>

              { /* Trades table */}
              {/* Trades table */}
              <div className="p-4 rounded-xl bg-gray-800/60 border border-gray-700/50 overflow-auto">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold">Trades ({activeSignals?.length || 0})</h3>
                  <button
                    onClick={() => exportData(activeSignals || [], "signals.json")}
                    className="px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-sm"
                    title="Hem entry hem exit zamanları JSON’a dahil edilir"
                  >
                    Export JSON
                  </button>
                </div>

                <table className="w-full text-sm">
                  <thead className="text-gray-400">
                    <tr className="text-left">
                      <th className="py-2 pr-4">Entry Time</th>
                      <th className="py-2 pr-4">Exit Time</th>
                      <th className="py-2 pr-4">Side</th>
                      <th className="py-2 pr-4">Entry</th>
                      <th className="py-2 pr-4">Exit</th>
                      <th className="py-2 pr-4">TP</th>
                      <th className="py-2 pr-4">SL</th>
                      <th className="py-2 pr-4">PnL%</th>
                    </tr>
                  </thead>

                  <tbody>
                    {(activeSignals || []).map((s, i) => {
                      const entryTs = s.entry_ts || s.entry_time || s.time;   // backend çeşitlerine uyum
                      const exitTs = s.exit_ts || s.exit_time || s.time;   // exit yoksa time’a düşer
                      const entryPx = s.entry_price ?? s.entry;
                      const exitPx = s.exit_price ?? s.exit;
                      const tpHit = (s.tp_hit ?? s.hit_tp) ? "✔" : "-";
                      const slHit = (s.sl_hit ?? s.hit_sl) ? "✔" : "-";
                      const pnlPct = s.pnl_pct != null
                        ? s.pnl_pct
                        : (s.pnl != null ? s.pnl * 100 : null);

                      return (
                        <tr key={i} className="border-t border-gray-800">
                          <td className="py-2 pr-4">
                            {entryTs ? new Date(entryTs).toLocaleString() : "-"}
                          </td>
                          <td className="py-2 pr-4">
                            {exitTs ? new Date(exitTs).toLocaleString() : "-"}
                          </td>
                          <td className="py-2 pr-4">{sideText(s.side)}</td>
                          <td className="py-2 pr-4">{fmtPx(s.entry_price ?? s.entry, s.price_precision)}</td>
                          <td className="py-2 pr-4">{fmtPx(s.exit_price ?? s.exit, s.price_precision)}</td>

                          <td className="py-2 pr-4">{tpHit}</td>
                          <td className="py-2 pr-4">{slHit}</td>
                          <td className="py-2 pr-4">
                            {pnlPct != null ? pnlPct.toFixed(2) + "%" : "-"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

          )
          }


          { /* =============== OPTIMIZATION =============== */}
          {activeTab === "optimization" && (
            <div className="space-y-6">
              { /* Run Settings (per-strategy) */}
              <div className="p-4 rounded-xl bg-gray-800/60 border border-gray-700/50">
                <h3 className="text-sm font-semibold mb-3">Optimization Settings (per strategy)</h3>

                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {strategies.map(s => (
                    <div key={s.id} className="p-3 rounded-lg bg-gray-900/40 border border-gray-700/40">
                      <div className="text-xs text-gray-400">{s.name || s.id}</div>

                      <div className="grid grid-cols-1 gap-3 mt-2">
                        {/* Method Selection - UPDATED WITH ALL ALGORITHMS */}
                        <div>
                          <label className="block text-xs text-gray-400 mb-1">Method</label>
                          <select
                            className="w-full px-3 py-2 rounded bg-gray-900/60 border border-gray-700"
                            value={s.method || "random"}
                            onChange={e => patchStrategy(s.id, { method: e.target.value })}
                          >
                            <option value="random">Random Search</option>
                            <option value="grid">Grid Search</option>
                            <option value="bayesian">Bayesian Optimization</option>
                            <option value="genetic">Genetic Algorithm</option>
                            <option value="tpe">TPE (Optuna)</option>
                            <option value="cmaes">CMA-ES (Optuna)</option>
                            <option value="annealing">Simulated Annealing</option>
                          </select>
                        </div>

                        {/* Dynamic Parameters Based on Method */}
                        <div className="space-y-2">
                          {/* Random Search Parameters */}
                          {s.method === 'random' && (
                            <div>
                              <label className="block text-xs text-gray-400 mb-1">Samples</label>
                              <input
                                type="number"
                                className="w-full px-3 py-2 rounded bg-gray-900/60 border border-gray-700"
                                value={s.methodParams?.samples ?? 1000}
                                onChange={e => patchStrategy(s.id, {
                                  methodParams: { ...s.methodParams, samples: Number(e.target.value) }
                                })}
                              />
                            </div>
                          )}

                          {/* Grid Search Parameters */}
                          {s.method === 'grid' && (
                            <div>
                              <label className="block text-xs text-gray-400 mb-1">Max Iterations</label>
                              <input
                                type="number"
                                className="w-full px-3 py-2 rounded bg-gray-900/60 border border-gray-700"
                                value={s.methodParams?.max_iterations ?? s.maxIter ?? 200}
                                onChange={e => patchStrategy(s.id, {
                                  methodParams: { ...s.methodParams, max_iterations: Number(e.target.value) }
                                })}
                              />
                            </div>
                          )}

                          {/* Bayesian Optimization Parameters */}
                          {s.method === 'bayesian' && (
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="block text-xs text-gray-400 mb-1">N Calls</label>
                                <input
                                  type="number"
                                  className="w-full px-2 py-1 rounded bg-gray-900/60 border border-gray-700 text-xs"
                                  value={s.methodParams?.n_calls ?? 150}
                                  onChange={e => patchStrategy(s.id, {
                                    methodParams: { ...s.methodParams, n_calls: Number(e.target.value) }
                                  })}
                                />
                              </div>
                              <div>
                                <label className="block text-xs text-gray-400 mb-1">Initial Points</label>
                                <input
                                  type="number"
                                  className="w-full px-2 py-1 rounded bg-gray-900/60 border border-gray-700 text-xs"
                                  value={s.methodParams?.n_initial_points ?? 10}
                                  onChange={e => patchStrategy(s.id, {
                                    methodParams: { ...s.methodParams, n_initial_points: Number(e.target.value) }
                                  })}
                                />
                              </div>
                            </div>
                          )}

                          {/* Genetic Algorithm Parameters */}
                          {s.method === 'genetic' && (
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="block text-xs text-gray-400 mb-1">Max Iterations</label>
                                <input
                                  type="number"
                                  className="w-full px-2 py-1 rounded bg-gray-900/60 border border-gray-700 text-xs"
                                  value={s.methodParams?.max_num_iteration ?? 100}
                                  onChange={e => patchStrategy(s.id, {
                                    methodParams: { ...s.methodParams, max_num_iteration: Number(e.target.value) }
                                  })}
                                />
                              </div>
                              <div>
                                <label className="block text-xs text-gray-400 mb-1">Population</label>
                                <input
                                  type="number"
                                  className="w-full px-2 py-1 rounded bg-gray-900/60 border border-gray-700 text-xs"
                                  value={s.methodParams?.population_size ?? 20}
                                  onChange={e => patchStrategy(s.id, {
                                    methodParams: { ...s.methodParams, population_size: Number(e.target.value) }
                                  })}
                                />
                              </div>
                              <div className="col-span-2">
                                <label className="block text-xs text-gray-400 mb-1">Mutation Probability</label>
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  max="1"
                                  className="w-full px-2 py-1 rounded bg-gray-900/60 border border-gray-700 text-xs"
                                  value={s.methodParams?.mutation_probability ?? 0.1}
                                  onChange={e => patchStrategy(s.id, {
                                    methodParams: { ...s.methodParams, mutation_probability: Number(e.target.value) }
                                  })}
                                />
                              </div>
                            </div>
                          )}

                          {/* TPE Parameters */}
                          {s.method === 'tpe' && (
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="block text-xs text-gray-400 mb-1">N Trials</label>
                                <input
                                  type="number"
                                  className="w-full px-2 py-1 rounded bg-gray-900/60 border border-gray-700 text-xs"
                                  value={s.methodParams?.n_trials ?? 200}
                                  onChange={e => patchStrategy(s.id, {
                                    methodParams: { ...s.methodParams, n_trials: Number(e.target.value) }
                                  })}
                                />
                              </div>
                              <div>
                                <label className="block text-xs text-gray-400 mb-1">Startup Trials</label>
                                <input
                                  type="number"
                                  className="w-full px-2 py-1 rounded bg-gray-900/60 border border-gray-700 text-xs"
                                  value={s.methodParams?.n_startup_trials ?? 10}
                                  onChange={e => patchStrategy(s.id, {
                                    methodParams: { ...s.methodParams, n_startup_trials: Number(e.target.value) }
                                  })}
                                />
                              </div>
                            </div>
                          )}

                          {/* CMA-ES Parameters */}
                          {s.method === 'cmaes' && (
                            <div>
                              <label className="block text-xs text-gray-400 mb-1">N Trials</label>
                              <input
                                type="number"
                                className="w-full px-3 py-2 rounded bg-gray-900/60 border border-gray-700"
                                value={s.methodParams?.n_trials ?? 200}
                                onChange={e => patchStrategy(s.id, {
                                  methodParams: { ...s.methodParams, n_trials: Number(e.target.value) }
                                })}
                              />
                            </div>
                          )}

                          {/* Simulated Annealing Parameters */}
                          {s.method === 'annealing' && (
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="block text-xs text-gray-400 mb-1">Max Iter</label>
                                <input
                                  type="number"
                                  className="w-full px-2 py-1 rounded bg-gray-900/60 border border-gray-700 text-xs"
                                  value={s.methodParams?.maxiter ?? 1000}
                                  onChange={e => patchStrategy(s.id, {
                                    methodParams: { ...s.methodParams, maxiter: Number(e.target.value) }
                                  })}
                                />
                              </div>
                              <div>
                                <label className="block text-xs text-gray-400 mb-1">Initial Temp</label>
                                <input
                                  type="number"
                                  className="w-full px-2 py-1 rounded bg-gray-900/60 border border-gray-700 text-xs"
                                  value={s.methodParams?.initial_temp ?? 5230}
                                  onChange={e => patchStrategy(s.id, {
                                    methodParams: { ...s.methodParams, initial_temp: Number(e.target.value) }
                                  })}
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              { /* Indicator Defaults / Search Space - Tek Strateji Tab Yapısında */}
              <div className="p-4 rounded-xl bg-gray-800/60 border border-gray-700/50">
                <h3 className="text-base font-semibold mb-3">Indicator Defaults / Search Space &nbsp;•&nbsp; Custom Params</h3>

                { /* Strategy Tabs */}
                <div className="mb-4 border-b border-gray-700">
                  <div className="flex flex-wrap gap-2">
                    {strategies.map(s => (
                      <button
                        key={s.id}
                        onClick={() => setOptTabId(s.id)}
                        className={`px-3 py-1.5 rounded-t-lg text-sm border-b-2 transition-colors
                          ${optTabId === s.id
                            ? "border-cyan-400 text-cyan-300 bg-slate-900/60"
                            : "border-transparent text-gray-400 hover:text-gray-200 hover:bg-slate-900/40"}`}
                      >
                        {s.name || s.id}
                      </button>
                    ))}
                  </div>
                </div>

                { /* Active Strategy Content */}
                {(() => {
                  const activeStrategy = strategies.find(s => s.id === optTabId) || strategies[0];
                  if (!activeStrategy) return null;

                  return (
                    <div className="space-y-6">
                      { /* MACD Parameters */}
                      <div>
                        <h4 className="text-sm font-medium mb-3 text-gray-300">MACD Parameters</h4>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          {[
                            ["macd_fast_default", 6, { min: 6, max: 20, step: 2 }, "MACD Fast"],
                            ["macd_slow_default", 18, { min: 18, max: 40, step: 2 }, "MACD Slow"],
                            ["macd_signal_default", 9, { min: 5, max: 15, step: 1 }, "MACD Signal"],
                          ].map(([key, def, defOpt, label]) => (
                            <div key={key} className="p-3 rounded-lg bg-gray-900/40 border border-gray-700/40">
                              <label className="block text-xs text-gray-400 mb-2 font-medium">{label}</label>
                              <input
                                type="number"
                                className="w-full px-3 py-2 rounded bg-gray-900/60 border border-gray-700"
                                value={activeStrategy?.indicators?.[key] ?? def}
                                onChange={(e) =>
                                  patchStrategyDeep(activeStrategy.id, (ss) => {
                                    ss.indicators = {
                                      ...(ss.indicators || {}),
                                      [key]: Number(e.target.value)
                                    };
                                    return ss;
                                  })
                                }
                              />
                              <label className="flex items-center gap-2 text-xs mt-2">
                                <input
                                  type="checkbox"
                                  checked={!!(activeStrategy?.optimize?.[key])}
                                  onChange={(e) =>
                                    patchStrategyDeep(activeStrategy.id, (ss) => {
                                      const on = e.target.checked;
                                      ss.optimize = { ...(ss.optimize || {}) };
                                      if (on) ss.optimize[key] = ss.optimize[key] || { ...defOpt };
                                      else delete ss.optimize[key];
                                      return ss;
                                    })
                                  }
                                />
                                <span className="text-gray-300">Optimize</span>
                              </label>

                              {activeStrategy?.optimize?.[key] && (
                                <div className="grid grid-cols-3 gap-2 mt-2">
                                  {["min", "max", "step"].map((k) => (
                                    <input
                                      key={k}
                                      type="number"
                                      className="px-2 py-1 rounded bg-gray-900/60 border border-gray-700 text-xs"
                                      placeholder={k}
                                      value={activeStrategy.optimize?.[key]?.[k] ?? ""}
                                      onChange={(e) =>
                                        patchStrategyDeep(activeStrategy.id, (ss) => {
                                          ss.optimize = { ...(ss.optimize || {}) };
                                          ss.optimize[key] = { ...(ss.optimize[key] || {}) };
                                          ss.optimize[key][k] = Number(e.target.value);
                                          return ss;
                                        })
                                      }

                                    />
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>


                      { /* Custom Parameters */}
                      <div className="p-4 rounded-lg bg-gray-900/40 border border-gray-700/40">
                        <div className="flex items-center justify-between mb-4">
                          <h4 className="text-sm font-medium text-gray-300">Custom Parameters</h4>
                          <button
                            onClick={() =>
                              patchStrategyDeep(activeStrategy.id, (ss) => {
                                ss.indicators = { ...(ss.indicators || {}) };
                                let idx = 1, key = `rsi_smooth_${idx}`;
                                while (ss.indicators[key] !== undefined) {
                                  idx += 1;
                                  key = `rsi_smooth_${idx}`;
                                }
                                ss.indicators[key] = 14;
                                return ss;
                              })
                            }
                            className="text-xs px-3 py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 text-white transition-colors"
                          >
                            + Add Parameter
                          </button>
                        </div>

                        <div className="space-y-3">
                          {Object.entries(activeStrategy?.indicators || {})
                            .filter(([k]) => !/^macd_/i.test(k))
                            .map(([key, val]) => (
                              <div key={key} className="p-3 rounded bg-gray-800/60 border border-gray-700/50">
                                <div className="grid grid-cols-12 gap-3 items-start">
                                  <div className="col-span-4">
                                    <label className="block text-xs text-gray-400 mb-1">Parameter Name</label>
                                    <input
                                      className="w-full px-2 py-1 rounded bg-gray-900/60 border border-gray-700 text-xs"
                                      value={key}
                                      onChange={(e) =>
                                        patchStrategyDeep(activeStrategy.id, (ss) => {
                                          const v = ss.indicators?.[key];
                                          const filtered = { ...(ss.indicators || {}) };
                                          delete filtered[key];
                                          const newKey = e.target.value || key;
                                          filtered[newKey] = v;
                                          ss.indicators = filtered;
                                          if (ss.optimize?.[key]) {
                                            const o = ss.optimize[key];
                                            delete ss.optimize[key];
                                            ss.optimize[newKey] = o;
                                          }
                                          return ss;
                                        })
                                      }
                                    />
                                  </div>

                                  <div className="col-span-2">
                                    <label className="block text-xs text-gray-400 mb-1">Value</label>
                                    <input
                                      type="number"
                                      className="w-full px-2 py-1 rounded bg-gray-900/60 border border-gray-700 text-xs"
                                      value={val}
                                      onChange={(e) =>
                                        patchStrategyDeep(activeStrategy.id, (ss) => {
                                          ss.indicators = {
                                            ...(ss.indicators || {}),
                                            [key]: Number(e.target.value)
                                          };
                                          return ss;
                                        })
                                      }
                                    />
                                  </div>

                                  <div className="col-span-2">
                                    <label className="flex items-center gap-1 text-xs mt-5">
                                      <input
                                        type="checkbox"
                                        checked={!!(activeStrategy?.optimize?.[key])}
                                        onChange={(e) =>
                                          patchStrategyDeep(activeStrategy.id, (ss) => {
                                            const on = e.target.checked;
                                            ss.optimize = { ...(ss.optimize || {}) };
                                            if (on)
                                              ss.optimize[key] = ss.optimize[key] || {
                                                min: Number(val) || 2,
                                                max: (Number(val) || 14) * 3,
                                                step: 1
                                              };
                                            else delete ss.optimize[key];
                                            return ss;
                                          })
                                        }
                                      />
                                      <span className="text-gray-300">Optimize</span>
                                    </label>
                                  </div>

                                  {activeStrategy?.optimize?.[key] && (
                                    <div className="col-span-3">
                                      <label className="block text-xs text-gray-400 mb-1">Min / Max / Step</label>
                                      <div className="grid grid-cols-3 gap-1">
                                        {["min", "max", "step"].map((k) => (
                                          <input
                                            key={k}
                                            type="number"
                                            className="px-2 py-1 rounded bg-gray-900/60 border border-gray-700 text-xs"
                                            placeholder={k}
                                            value={activeStrategy.optimize?.[key]?.[k] ?? ""}
                                            onChange={(e) =>
                                              patchStrategyDeep(activeStrategy.id, (ss) => {
                                                ss.optimize = { ...(ss.optimize || {}) };
                                                ss.optimize[key] = { ...(ss.optimize[key] || {}) };
                                                ss.optimize[key][k] = Number(e.target.value);
                                                return ss;
                                              })
                                            }

                                          />
                                        ))}
                                      </div>
                                    </div>
                                  )}

                                  <div className="col-span-1 flex justify-end mt-5">
                                    <button
                                      onClick={() =>
                                        patchStrategyDeep(activeStrategy.id, (ss) => {
                                          const filtered = { ...(ss.indicators || {}) };
                                          delete filtered[key];
                                          ss.indicators = filtered;
                                          if (ss.optimize?.[key]) {
                                            delete ss.optimize[key];
                                          }
                                          return ss;
                                        })
                                      }
                                      className="text-xs px-2 py-1 rounded bg-red-600 hover:bg-red-500 text-white"
                                    >
                                      ×
                                    </button>
                                  </div>
                                </div>
                              </div>
                            ))}
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={exportPresets}
                  className="px-3 py-2 rounded bg-slate-600 hover:bg-slate-500 text-white text-sm"
                >
                  Preset Kaydet (JSON)
                </button>

                <label className="px-3 py-2 rounded bg-slate-700 hover:bg-slate-600 text-white text-sm cursor-pointer">
                  Preset Yükle
                  <input
                    type="file"
                    accept="application/json"
                    className="hidden"
                    onChange={e => {
                      const f = e.target.files?.[0];
                      if (f) importPresets(f);
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>

              <button
                onClick={startOptimization}
                disabled={!useSnapshot || !snapshotId || busy}
                title={!useSnapshot || !snapshotId ? "Önce Setup → Download Data" : "Start Optimization"}
                className={
                  "px-4 py-2 rounded bg-purple-600 hover:bg-purple-500 text-white " +
                  ((!useSnapshot || !snapshotId || busy) ? "opacity-50 cursor-not-allowed" : "")
                }
              >
                Start Optimization
              </button>

              { /* ========== Top Results (Tabbed) ========== */}
              <div className="p-4 rounded-xl bg-gray-800/60 border border-gray-700/50">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold">Top Results</h3>
                  {activeTopResId && (
                    <span className="text-xs text-gray-400">
                      {strategies.find(s => s.id === activeTopResId)?.name || activeTopResId}
                    </span>
                  )}
                </div>

                { /* Sekme başlıkları */}
                <div className="flex flex-wrap gap-2 mb-3">
                  {Object.keys(optTopById || {}).map((sid) => {
                    const label = strategies.find(s => s.id === sid)?.name || sid;
                    const active = sid === activeTopResId;
                    return (
                      <button
                        key={sid}
                        onClick={() => setActiveTopResId(sid)}
                        className={
                          "px-3 py-1.5 rounded border text-xs " +
                          (active
                            ? "bg-blue-600 border-blue-500 text-white"
                            : "bg-gray-900/50 border-gray-700 text-gray-300 hover:bg-gray-800")
                        }
                        title={label}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>

                { /* Aktif sekmenin tablosu */}
                {activeTopResId ? (
                  <div className="overflow-auto">
                    <table className="w-full text-sm">
                      <thead className="text-gray-400">
                        <tr className="text-left">
                          <th className="py-2 pr-4">Params</th>
                          <th className="py-2 pr-4">Profit%</th>
                          <th className="py-2 pr-4">Trades</th>
                          <th className="py-2 pr-4">Win%</th>
                          <th className="px-2 py-1 text-right">Apply</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(optTopById[activeTopResId] || [])
                          .filter(r =>
                            ((r.trades ?? r.stats?.trades ?? 0) > 0) ||
                            Math.abs(r.profit ?? r.stats?.profit ?? 0) > 1e-9
                          )
                          .map((r, i) => {
                            const strat = strategies.find(s => s.id === activeTopResId);
                            const optKeys = strat?.optimize
                              ? Object.keys(strat.optimize)
                              : Object.keys(r).filter(k => k.endsWith("_default"));

                            const out = {};
                            (optKeys || []).forEach(k => {
                              if (r.params && r.params[k] != null) out[k] = r.params[k];
                              else if (r[k] != null) out[k] = r[k];
                            });
                            const paramTxt = JSON.stringify(out, null, 0);

                            return (
                              <tr key={i} className="border-t border-gray-800">
                                <td className="py-2 pr-4 whitespace-pre">
                                  <code className="text-xs">{paramTxt === "{}" ? "-" : paramTxt}</code>
                                </td>
                                <td className="py-2 pr-4">{fmt((r.profit ?? r.stats?.profit ?? 0), 2)}%</td>
                                <td className="py-2 pr-4">{r.trades ?? r.stats?.trades ?? "-"}</td>
                                <td className="py-2 pr-4">{fmt((r.winRate ?? r.stats?.winRate ?? 0), 2)}%</td>
                                <td className="px-2 py-1 text-right">
                                  <button
                                    className="px-2 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-xs"
                                    onClick={() => applyParamsFromRow(r, activeTopResId)}
                                    title="Set these parameters as Indicator Defaults & Search Space"
                                  >
                                    Apply
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-xs text-gray-400">Henüz sonuç yok.</div>
                )}
              </div>
            </div>
          )}

          { /* =============== PORTFOLIO =============== */}
          {activeTab === "portfolio" && (
            <div className="space-y-6">
              {!portfolio && (
                <div className="p-4 rounded-xl bg-gray-800/60 border border-gray-700/50 text-sm text-gray-300">
                  Henüz hesaplanmış bir portföy yok. Üstten "Portföyü Hesapla"ya bas.
                </div>
              )
              }

              {portfolio && (
                <>
                  { /* Özet metrikler */}
                  <div className="grid md:grid-cols-4 gap-4">
                    <MetricCard
                      title="Profit %"
                      value={`${(portfolio.combinedStats?.profit ?? 0).toFixed(2)
                        }%`
                      }
                      color="green"
                    />
                    <MetricCard
                      title="Sharpe"
                      value={(portfolio.combinedStats?.sharpe ?? 0).toFixed(2)
                      }
                      color="yellow"
                    />
                    <MetricCard
                      title="Max DD %"
                      value={`${(portfolio.combinedStats?.maxDD ?? 0).toFixed(2)
                        }%`
                      }
                      color="red"
                    />
                    <MetricCard
                      title="Gün"
                      value={String(portfolio.combinedStats?.days ?? 0)
                      }
                      color="purple"
                    />
                  </div>

                  { /* Equity grafiği */}
                  <div className="p-4 rounded-xl bg-gray-800/60 border border-gray-700/50">
                    <h3 className="text-sm font-semibold mb-3">Portfolio Equity</h3>
                    <Line
                      data={
                        {
                          labels: Object.keys(portfolio.combinedDaily || {}),
                          datasets: [
                            {
                              label: "Equity (%)",
                              data: Object.values(portfolio?.combinedDaily || {}).reduce((acc, r) => {
                                const prev = acc.length ? acc[acc.length - 1
                                ] : 0;
                                const cur = (1 + prev / 100) * (1 + (Number(r) || 0)) - 1;
                                acc.push(cur * 100);
                                return acc;
                              },
                                []),

                              borderWidth: 2,
                              fill: true,
                            },
                          ],
                        }
                      }
                      options={
                        {
                          responsive: true,
                          plugins: {
                            legend: {
                              display: true
                            }
                          },
                          interaction: {
                            mode: "index", intersect: false
                          },
                          scales: {
                            x: {
                              ticks: {
                                maxTicksLimit: 8
                              }
                            }
                          },
                        }
                      }
                    />
                  </div>

                  { /* Bacaklar (legs) tablosu */}
                  <div className="p-4 rounded-xl bg-gray-800/60 border border-gray-700/50">
                    <h3 className="text-sm font-semibold mb-3">Bacaklar (eşit ağırlık)</h3>
                    <div className="overflow-auto">
                      <table className="w-full text-sm">
                        <thead className="text-gray-400">
                          <tr className="text-left">
                            <th className="py-2 pr-4">Strategy</th>
                            <th className="py-2 pr-4">Weight</th>
                            <th className="py-2 pr-4">Days</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(portfolio.legs || []).map((leg, i) => (
                            <tr key={i
                            } className="border-t border-gray-800">
                              <td className="py-2 pr-4">{leg.name || leg.id
                              }</td>
                              <td className="py-2 pr-4">{leg.w
                              }</td>
                              <td className="py-2 pr-4">
                                {Object.keys(leg.daily || {}).length
                                }
                              </td>
                            </tr>
                          ))
                          }
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )
              }
            </div>
          )
          }


          { /* =============== LIVE =============== */}
          {activeTab === "live" && (
            <div className="space-y-6">
              <div className="p-4 rounded-xl bg-gray-800/60 border border-gray-700/50">
                <div className="flex flex-wrap items-center gap-3 mb-3">
                  <label className="flex items-center gap-2">
                    <span>Timeframe</span>
                    <select
                      className="px-2 py-1 rounded bg-gray-900/60 border border-gray-700"
                      value={stratTf
                      }
                      onChange={e => setStratTf(e.target.value)
                      }
                    >
                      {
                        [
                          "1m",
                          "3m",
                          "5m",
                          "15m",
                          "30m",
                          "1h",
                          "4h"
                        ].map(tf => (
                          <option key={tf
                          } value={tf
                          }>
                            {tf
                            }
                          </option>
                        ))
                      }
                    </select>
                  </label>
                  <label className="flex items-center gap-2">
                    <span>Days</span>
                    <input
                      type="number"
                      className="w-20 px-2 py-1 rounded bg-gray-900/60 border border-gray-700"
                      value={liveDays
                      }
                      onChange={e => setLiveDays(Number(e.target.value))
                      }
                    />
                  </label>
                  {liveStatus !== "streaming" ? (
                    <button
                      onClick={startLive
                      }
                      className="px-3 py-1.5 rounded bg-green-600 hover:bg-green-500 text-sm"
                    >
                      Start
                    </button>
                  ) : (
                    <button
                      onClick={stopLive
                      }
                      className="px-3 py-1.5 rounded bg-red-600 hover:bg-red-500 text-sm"
                    >
                      Stop
                    </button>
                  )
                  }
                  <span className="text-xs text-gray-400">Status: {liveStatus
                  }</span>
                </div>

                { /* live price mini chart */}
                <div className="h-48">
                  <Line
                    data={
                      {
                        labels: liveSeries.map(x => x.t),
                        datasets: [
                          {
                            label: "Price",
                            data: liveSeries.map(x => x.p),
                            borderColor: "#60A5FA",
                            backgroundColor: "#60A5FA33",
                            pointRadius: 0,
                            borderWidth: 2,
                            tension: 0.2
                          }
                        ]
                      }
                    }
                    options={
                      {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                          legend: {
                            display: false
                          }
                        },
                        scales: {
                          x: {
                            ticks: {
                              color: "#9CA3AF"
                            }
                          },
                          y: {
                            ticks: {
                              color: "#9CA3AF"
                            }
                          }
                        }
                      }
                    }
                  />
                </div>
              </div>

              { /* live events table */}
              <div className="p-4 rounded-xl bg-gray-800/60 border border-gray-700/50 overflow-auto">
                <h3 className="text-sm font-semibold mb-3">Live Events</h3>
                <table className="w-full text-sm">
                  <thead className="text-gray-400">
                    <tr className="text-left">
                      <th className="py-2 pr-4">Strategy</th>
                      <th className="py-2 pr-4">Time</th>
                      <th className="py-2 pr-4">Type</th>
                      <th className="py-2 pr-4">Side</th>
                      <th className="py-2 pr-4">Entry</th>
                      <th className="py-2 pr-4">Exit</th>
                      <th className="py-2 pr-4">TP</th>
                      <th className="py-2 pr-4">SL</th>
                      <th className="py-2 pr-4">PnL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {liveEvents.map((e, i) => (
                      <tr key={i
                      } className="border-t border-gray-800">
                        <td className="py-2 pr-4">{e.strategy
                        }</td>
                        <td className="py-2 pr-4">{e.time
                        }</td>
                        <td className="py-2 pr-4">{e.type
                        }</td>
                        <td className="py-2 pr-4">{e.side
                        }</td>
                        <td className="py-2 pr-4">{e.entry
                        }</td>
                        <td className="py-2 pr-4">{e.exit
                        }</td>
                        <td className="py-2 pr-4">{e.tp
                        }</td>
                        <td className="py-2 pr-4">{e.sl
                        }</td>
                        <td className="py-2 pr-4">{e.pnl
                        }</td>
                      </tr>
                    ))
                    }
                  </tbody>
                </table>
              </div>
            </div>
          )
          }
        </main>
      </div>
    </ErrorBoundary>
  );
}
