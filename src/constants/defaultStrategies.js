// src/constants/defaultStrategies.js
// Strategy A (Long) ve Strategy B (Short) - eski programdaki hazır şablonlar

export const DEFAULT_STRATEGIES = [
  {
    id: "S_A",
    name: "Strategy A",
    side: "long",
    enabled: true,
    // Eski görseldeki Long örneği (Boll + RSI diff + MACD + SMA koşulları)
    expr: `
(
  (data['bb_lo'].shift(1) - data['close'].shift(1)) < 0
  & (data['RSI_diff'].shift(1) > -13)
  & ((data['SMA'].shift(1) > data['SMA'].shift(2))
     & (data['SMA'] < data['SMA'].shift(1))
     & (data['hist'] < 0))
)
`.trim(),
    // Bu expr'nin çalışması için gereken default paramlar:
    indicators: {
      // MACD
      macd_fast: 6, macd_slow: 18, macd_signal: 9,
      // SMA
      sma_period: 21,
      // Bollinger
      bb_length: 20, bb_k: 2,
      // RSI difference
      rsi_short: 10, rsi_long: 60,
    },
    exit: { type: "fixed_pct", tp: 1, sl: 2, compareVariants: true, overrideGlobal: true },
  },

  {
    id: "S_B",
    name: "Strategy B",
    side: "short",
    enabled: true,
    // Eski görseldeki Short örneği (NDMA + EMA + MACD histogram flip varyasyonu)
    expr: `
(
  ((data['NDMA'] > 0.00022) & (data['NDMA'] < 0.0252))
  & ((data['EMA'].shift(1) > data['EMA'].shift(2))
     & (data['EMA'] < data['EMA'].shift(1))
     & (data['hist'] < 0)) & (data['hist'].shift(1) > 0)
)
`.trim(),
    indicators: {
      macd_fast: 6, macd_slow: 18, macd_signal: 9,
      ema_period: 21,
      ndma_window: 20,
    },
    exit: { type: "fixed_pct", tp: 1, sl: 2, compareVariants: true, overrideGlobal: true },
  },
];
