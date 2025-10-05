// src/constants/indicatorCatalog.js
// Büyük katalog: her öğe bir "grup" ve içine ilgili param anahtarları gelir.
// "params:[{key, def}]": key = param adı (state anahtarı), def = varsayılan değer.
export const DEFAULT_IND_CATALOG = [
  // --- Trend / Averages
  { id: "sma", name: "Simple Moving Average", params: [{ key: "sma_period", def: 21 }] },
  { id: "ema", name: "Exponential Moving Average", params: [{ key: "ema_period", def: 21 }] },
  { id: "wma", name: "Weighted Moving Average", params: [{ key: "wma_period", def: 21 }] },
  { id: "hma", name: "Hull Moving Average", params: [{ key: "hma_period", def: 21 }] },
  { id: "rma", name: "RMA (Wilder)", params: [{ key: "rma_period", def: 14 }] },
  { id: "zlema", name: "Zero Lag EMA", params: [{ key: "zlema_period", def: 34 }] },
  { id: "kama", name: "Kaufman AMA", params: [{ key: "kama_er", def: 10 }, { key: "kama_fast", def: 2 }, { key: "kama_slow", def: 30 }] },
  { id: "alma", name: "ALMA", params: [{ key: "alma_period", def: 9 }, { key: "alma_sigma", def: 6 }, { key: "alma_offset", def: 0.85 }] },
  { id: "dpo", name: "Detrended Price Oscillator", params: [{ key: "dpo_period", def: 21 }] },
  { id: "trix", name: "TRIX", params: [{ key: "trix_period", def: 15 }] },

  // --- Volatility / Bands / Channels
  { id: "bb", name: "Bollinger Bands", params: [{ key: "bb_length", def: 20 }, { key: "bb_k", def: 2 }] },
  { id: "kc", name: "Keltner Channel", params: [{ key: "kc_length", def: 20 }, { key: "kc_mult", def: 1.5 }] },
  { id: "dc", name: "Donchian Channel", params: [{ key: "dc_length", def: 20 }] },
  { id: "atr", name: "ATR", params: [{ key: "atr_period", def: 14 }] },
  { id: "natr", name: "NATR", params: [{ key: "natr_period", def: 14 }] },
  { id: "supertrend", name: "SuperTrend", params: [{ key: "st_atr", def: 10 }, { key: "st_mult", def: 3 }] },
  { id: "psar", name: "Parabolic SAR", params: [{ key: "psar_af", def: 0.02 }, { key: "psar_max", def: 0.2 }] },

  // --- Momentum / Oscillators
  { id: "rsi", name: "RSI", params: [{ key: "rsi_period", def: 14 }] },
  { id: "rsi_diff", name: "RSI Difference (short - long)", params: [{ key: "rsi_short", def: 10 }, { key: "rsi_long", def: 60 }] },
  { id: "stoch", name: "Stochastic", params: [{ key: "stoch_k", def: 14 }, { key: "stoch_d", def: 3 }, { key: "stoch_smooth", def: 3 }] },
  { id: "stochrsi", name: "Stoch RSI", params: [{ key: "stochrsi_period", def: 14 }, { key: "stochrsi_k", def: 3 }, { key: "stochrsi_d", def: 3 }] },
  { id: "cci", name: "CCI", params: [{ key: "cci_period", def: 20 }] },
  { id: "roc", name: "Rate of Change", params: [{ key: "roc_period", def: 9 }] },
  { id: "mom", name: "Momentum", params: [{ key: "mom_period", def: 10 }] },
  { id: "tsi", name: "TSI", params: [{ key: "tsi_long", def: 25 }, { key: "tsi_short", def: 13 }] },
  { id: "willr", name: "Williams %R", params: [{ key: "willr_period", def: 14 }] },
  { id: "uo", name: "Ultimate Oscillator", params: [{ key: "uo_s", def: 7 }, { key: "uo_m", def: 14 }, { key: "uo_l", def: 28 }] },
  { id: "mfi", name: "Money Flow Index", params: [{ key: "mfi_period", def: 14 }] },
  { id: "cmf", name: "Chaikin Money Flow", params: [{ key: "cmf_period", def: 20 }] },
  { id: "obv", name: "OBV", params: [] },
  { id: "eom", name: "Ease of Movement", params: [{ key: "eom_period", def: 14 }] },
  { id: "vortex", name: "Vortex", params: [{ key: "vortex_period", def: 14 }] },

  // --- MACD / PPO / PVO
  { id: "macd", name: "MACD", params: [{ key: "macd_fast", def: 12 }, { key: "macd_slow", def: 26 }, { key: "macd_signal", def: 9 }] },
  { id: "ppo", name: "PPO", params: [{ key: "ppo_fast", def: 12 }, { key: "ppo_slow", def: 26 }, { key: "ppo_signal", def: 9 }] },
  { id: "pvo", name: "PVO (Volume PPO)", params: [{ key: "pvo_fast", def: 12 }, { key: "pvo_slow", def: 26 }, { key: "pvo_signal", def: 9 }] },

  // --- Trend Strength / DMI-ADX
  { id: "adx", name: "ADX", params: [{ key: "adx_period", def: 14 }] },
  { id: "dmi", name: "DMI (+DI/-DI)", params: [{ key: "dmi_period", def: 14 }] },

  // --- Volume Ağırlıklı / VWAP / Z-Score vb.
  { id: "vwap", name: "VWAP (session)", params: [] },
  { id: "vwap_n", name: "VWAP (rolling)", params: [{ key: "vwap_period", def: 20 }] },
  { id: "zscore", name: "Z-Score", params: [{ key: "zscore_period", def: 20 }] },

  // --- Ichimoku (bileşenleri ayrı ayrı da kullanılabilsin diye)
  { id: "ichimoku", name: "Ichimoku Cloud", params: [{ key: "ichi_tenkan", def: 9 }, { key: "ichi_kijun", def: 26 }, { key: "ichi_spanB", def: 52 }] },

  // --- BB tabanlı histogram/meanr ev.
  { id: "bb_width", name: "BB Width", params: [{ key: "bbw_length", def: 20 }, { key: "bbw_k", def: 2 }] },
  { id: "bb_percent", name: "BB %B", params: [{ key: "bbp_length", def: 20 }, { key: "bbp_k", def: 2 }] },

  // --- Heiken / Renko (göstergesi olarak kullanılan basit formlar)
  { id: "heiken", name: "Heiken-Ashi Trend", params: [{ key: "heiken_smooth", def: 3 }] },

  // --- Ehler / NDMA vb. (Senin eski kodundan)
  { id: "ndma", name: "NDMA", params: [{ key: "ndma_window", def: 20 }] },
  { id: "ndma1", name: "NDMA1", params: [{ key: "ndma1_window", def: 50 }] },

  // --- Elder / Chaikin / DeMark türevleri
  { id: "elder_ray", name: "Elder Ray", params: [{ key: "elder_len", def: 13 }] },
  { id: "chaikin_osc", name: "Chaikin Oscillator", params: [{ key: "cho_fast", def: 3 }, { key: "cho_slow", def: 10 }] },
  { id: "demarker", name: "DeMarker", params: [{ key: "dem_period", def: 14 }] },

  // --- Correlation / Beta (tek parametreli)
  { id: "correl", name: "Rolling Correlation", params: [{ key: "correl_period", def: 20 }] },
  { id: "beta", name: "Rolling Beta", params: [{ key: "beta_period", def: 20 }] },

  // --- QQE / RVI / KST
  { id: "qqe", name: "QQE", params: [{ key: "qqe_rsi", def: 14 }, { key: "qqe_factor", def: 4.236 }] },
  { id: "rvi", name: "Relative Vigor Index", params: [{ key: "rvi_period", def: 10 }] },
  { id: "kst", name: "KST", params: [{ key: "kst_r1", def: 10 }, { key: "kst_r2", def: 15 }, { key: "kst_r3", def: 20 }, { key: "kst_r4", def: 30 }] },

  // --- Aroon / Williams Fractal / Gator
  { id: "aroon", name: "Aroon", params: [{ key: "aroon_period", def: 25 }] },
  { id: "fractal", name: "Williams Fractal (swing)", params: [{ key: "frac_l", def: 2 }, { key: "frac_r", def: 2 }] },
  { id: "gator", name: "Gator Oscillator", params: [{ key: "gator_jaw", def: 13 }, { key: "gator_teeth", def: 8 }, { key: "gator_lips", def: 5 }] },

  // --- Donanım / özel osilatörler (dummy) – eski projede kullanılan yardımcılar
  { id: "hist", name: "MACD Histogram (alias)", params: [] },
  { id: "signal", name: "MACD Signal (alias)", params: [] },

  // --- Ekstra birkaç tane (60+ tamamlamak için)
  { id: "ema2", name: "EMA (2nd)", params: [{ key: "ema2_period", def: 50 }] },
  { id: "ema3", name: "EMA (3rd)", params: [{ key: "ema3_period", def: 100 }] },
  { id: "sma_fast", name: "SMA Fast", params: [{ key: "sma_fast", def: 10 }] },
  { id: "sma_slow", name: "SMA Slow", params: [{ key: "sma_slow", def: 50 }] },
  { id: "ema_fast", name: "EMA Fast", params: [{ key: "ema_fast", def: 10 }] },
  { id: "ema_slow", name: "EMA Slow", params: [{ key: "ema_slow", def: 50 }] },
  { id: "adx_smooth", name: "ADX (Smoothed)", params: [{ key: "adx_smooth", def: 14 }] },
  { id: "atr_trailing", name: "ATR Trailing", params: [{ key: "atr_trail_n", def: 14 }, { key: "atr_trail_k", def: 1.5 }] },
];
