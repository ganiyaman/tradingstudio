// src/constants/expressions.js
export const STRATEGY_EXPR_PRESETS = [
  {
    id: "boll_rsi_macd_short",
    label: "Boll + RSI diff + MACD (Short bias)",
    code: `
(
  (data['bb_lo'].shift(1) - data['close'].shift(1)) < 0
  & (data['RSI_diff'].shift(1) > -13)
  & ((data['SMA'].shift(1) > data['SMA'].shift(2))
     & (data['SMA'] < data['SMA'].shift(1))
     & (data['hist'] < 0))
)
`.trim(),
  },
  {
    id: "ema_cross_rsi_long",
    label: "EMA Cross + RSI (Long)",
    code: `
(
  (data['EMA_fast'].shift(1) > data['EMA_slow'].shift(1))
  & (data['RSI'] < 30)
)
`.trim(),
  },
  {
    id: "macd_hist_flip",
    label: "MACD Histogram Flip",
    code: `
(
  (data['hist'].shift(1) <= 0) & (data['hist'] > 0)
)
`.trim(),
  },
  {
    id: "boll_meanrev",
    label: "Bollinger Mean-Reversion",
    code: `
(
  (data['close'] < data['bb_lo']) & (data['RSI'] < 35)
)
`.trim(),
  },
];
