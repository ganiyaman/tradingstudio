# optimizer_api.py
from __future__ import annotations
import itertools, json, math, random, re, textwrap, time
from dataclasses import dataclass
import re, uuid, time
import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from typing import Any, Dict, Optional, Literal, List
from pydantic import BaseModel, Field, conint, confloat
import asyncio
from decimal import Decimal
import math, time
from deap import algorithms as deap_alg
from deap import base as deap_base, creator, tools as deap_tools, gp


# Gerekli yeni importlar ve kütüphane kontrolü
try:
    from skopt import gp_minimize
    from skopt.space import Real, Integer
    from geneticalgorithm import geneticalgorithm as ga
    import optuna
    from scipy.optimize import dual_annealing
    LIBRARIES_INSTALLED = True
except ImportError:
    LIBRARIES_INSTALLED = False
    print("UYARI: Gelişmiş optimizasyon kütüphaneleri (scikit-optimize, geneticalgorithm, optuna, scipy) yüklü değil. Sadece 'grid' ve 'random' metotları çalışacaktır.")

# === DEAP tabanlı GP için importlar ve yardımcılar ===
try:
    from deap import base, creator, gp, tools
    _HAS_DEAP = True
except Exception:
    _HAS_DEAP = False

# -----------------------------------------------------------------------------
# App & CORS
# -----------------------------------------------------------------------------
app = FastAPI(title="Trading Strategy Studio API", version="1.2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],          # geliştirirken serbest bırak
    allow_credentials=True,
    allow_methods=["*"],          # özellikle POST/OPTIONS
    allow_headers=["*"],
)

# === Snapshot memory store ===
from uuid import uuid4
def _sint(val: Any, default: int) -> int:
    """Bir değeri güvenli bir şekilde pozitif bir tamsayıya dönüştürür, başarısız olursa varsayılan değeri kullanır."""
    if val is None:
        return default
    try:
        # JSON'dan gelebilecek "20.0" gibi float formatları handle eder
        i = int(float(val))
        # Pandas rolling fonksiyonları genellikle 0'dan büyük pencere gerektirir
        return i if i > 0 else default
    except (ValueError, TypeError):
        return default

SNAPSHOT_STORE = {}  # { snapshot_id: {"df": DataFrame, "meta": {...}} }

def _make_snapshot_id():
    return uuid4().hex

# -----------------------------------------------------------------------------
# Costs Config (defaults & active)
# -----------------------------------------------------------------------------
COSTS_CONFIG_DEFAULT = {
    "fee_mode": "Manual",
    "maker_bps": 1.0,
    "taker_bps": 5.0,
    "slip_model": "FixedBps",
    "slip_bps": 8.0,  # per-side bps; round-trip = 2*slip_bps
    "funding_mode": "Off",
    "funding_bps_interval": 0.0,
    "funding_interval_hours": 8,
}
ACTIVE_COSTS_CONFIG = COSTS_CONFIG_DEFAULT.copy()

# -----------------------------------------------------------------------------
# Costs Config Endpoints
# -----------------------------------------------------------------------------
class CostsConfig(BaseModel):
    fee_mode: str = "Manual"
    maker_bps: float = 1.0
    taker_bps: float = 5.0
    slip_model: str = "FixedBps"
    slip_bps: float = 8.0
    funding_mode: str = "Off"
    funding_bps_interval: float = 0.0
    funding_interval_hours: int = 8

@app.get("/costs/config")
def get_costs_config():
    return {"active": ACTIVE_COSTS_CONFIG, "defaults": COSTS_CONFIG_DEFAULT}

@app.post("/costs/config")
def set_costs_config(cfg: CostsConfig):
    global ACTIVE_COSTS_CONFIG
    ACTIVE_COSTS_CONFIG = {**ACTIVE_COSTS_CONFIG, **cfg.dict()}
    return {"active": ACTIVE_COSTS_CONFIG}


# -----------------------------------------------------------------------------
# Helpers: timeframe & data
# -----------------------------------------------------------------------------
def timeframe_to_minutes(tf: str) -> int:
    m = {"1m":1,"3m":3,"5m":5,"15m":15,"30m":30,"1h":60,"4h":240,"6h":360,"8h":480,"12h":720,"1d":1440}
    return m.get(tf, 5)
def load_ohlcv(symbol: str, timeframe: str, start_iso: str, end_iso: str) -> pd.DataFrame:
    step_m = timeframe_to_minutes(timeframe)
    try:
        since = pd.Timestamp(start_iso, tz="UTC")
        until = pd.Timestamp(end_iso, tz="UTC")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"bad date(s): {e}")

    if until <= since:
        until = since + pd.Timedelta(minutes=max(step_m, 300*step_m))

    # --- DÜZELTİLECEK SATIRLAR ---
    since_aligned = since.floor(f"{step_m}min")
    until_aligned = (until + pd.Timedelta(minutes=step_m)).ceil(f"{step_m}min")
    idx = pd.date_range(since_aligned, until_aligned, freq=f"{step_m}min", tz="UTC", inclusive="left")
    # ----------------------------    
    
    if len(idx) == 0:
        # güvenlik: en az 10 bar
        until_aligned = since_aligned + pd.Timedelta(minutes=10*step_m)
        idx = pd.date_range(since_aligned, until_aligned, freq=f"{step_m}T", tz="UTC", inclusive="left")

    try:
        import ccxt
        ex = ccxt.binance()
        market = symbol if "/" in symbol else symbol.replace("USDT", "/USDT")
        ms = int(since_aligned.timestamp() * 1000)
        out = []
        while True:
            batch = ex.fetch_ohlcv(market, timeframe=timeframe, since=ms, limit=1000)
            if not batch:
                break
            out.extend(batch)
            last = batch[-1][0]
            if last >= int(until_aligned.timestamp() * 1000):
                break
            ms = last + step_m * 60_000

        if not out:
            raise RuntimeError("No ccxt data")
        df = pd.DataFrame(out, columns=["time","open","high","low","close","volume"])
        df["time"] = pd.to_datetime(df["time"], unit="ms", utc=True)
        df = df.set_index("time")
        df = df.reindex(df.index.union(idx)).sort_index().ffill().loc[idx.min():idx.max()]
        df = df.reindex(idx).ffill().dropna()
        return df[["open","high","low","close","volume"]]
    except Exception:
        # sentetik fallback
        rng = np.random.default_rng(42)
        base = 50 + np.cumsum(rng.normal(0, 0.25, len(idx)))
        open_ = pd.Series(base, index=idx).shift(1).fillna(base[0])
        close = pd.Series(base, index=idx)
        high = np.maximum(open_.values, close.values) + rng.normal(0.05, 0.05, len(idx)).clip(0, None)
        low  = np.minimum(open_.values, close.values) - rng.normal(0.05, 0.05, len(idx)).clip(0, None)
        vol  = rng.uniform(100, 500, len(idx))
        return pd.DataFrame(
            {"open":open_.values,"high":high,"low":low,"close":close.values,"volume":vol},
            index=idx
        )

import ccxt

# --- CCXT Piyasa Veri Önbelleği (YENİ) ---
MARKET_DATA_CACHE = {}
CACHE_LIFETIME_SECONDS = 3600 # Verileri 1 saatliğine önbelleğe al

def load_and_cache_markets():
    """Binance'ten piyasa verilerini çeker ve önbelleğe alır."""
    print("Piyasa verileri Binance'ten çekiliyor ve önbelleğe alınıyor...")
    try:
        # Not: proxy veya özel ayar gerekiyorsa burada konfigüre edilebilir
        exchange = ccxt.binance()
        markets = exchange.load_markets()
        MARKET_DATA_CACHE['markets'] = markets
        MARKET_DATA_CACHE['timestamp'] = time.time()
        print("Piyasa verileri başarıyla önbelleğe alındı.")
    except Exception as e:
        print(f"HATA: Piyasa verileri çekilemedi: {e}")
        MARKET_DATA_CACHE['markets'] = {}


CACHE_LIFETIME_SECONDS = 60 * 30
MARKET_DATA_CACHE = {}

def infer_decimals_from_price(price: float | str) -> int:
    """
    Verilen fiyatın string temsiline bakarak (float hatalarını yok sayıp)
    trailing sıfırları da kırparak ondalık basamak sayısını döndürür.
    """
    if price is None:
        return 0
    d = Decimal(str(price)).normalize()
    # exponent negatif ise, -exponent ondalık basamak sayısıdır
    exp = d.as_tuple().exponent
    return -exp if exp < 0 else 0

def get_price_precision(symbol: str, sample_price: float | None = None) -> int:
    """
    1) ccxt 'precision.price' (veya tickSize) varsa onu ondalık basamak sayısına çevirir.
    2) Yoksa sample_price üzerinden ondalık sayısını tahmin eder.
    3) Hâlâ yoksa 4 döner.
    """
    now = time.time()
    if 'markets' not in MARKET_DATA_CACHE or (now - MARKET_DATA_CACHE.get('timestamp', 0)) > CACHE_LIFETIME_SECONDS:
        load_and_cache_markets()

    markets = MARKET_DATA_CACHE.get('markets', {})
    formatted_symbol = symbol if '/' in symbol else symbol.replace('USDT', '/USDT')
    market = markets.get(formatted_symbol)

    # ccxt tarafı: precision.price veya tickSize benzeri alanlara bak
    tick_size = None
    if market:
        # Birçok borsada 'precision': {'price': x} olur; bazılarında 'limits'/'price'->'min' / 'tickSize'
        if 'precision' in market and isinstance(market['precision'], dict):
            ts = market['precision'].get('price')
            if ts and ts > 0:
                tick_size = float(ts)
        if not tick_size:
            # bazı ccxt market objelerinde 'info' altında tickSize olabilir
            info = market.get('info') or {}
            for k in ('tickSize', 'tick_size', 'minPrice'):
                v = info.get(k)
                if v:
                    try:
                        fv = float(v)
                        if fv > 0:
                            tick_size = fv
                            break
                    except Exception:
                        pass

    if tick_size and tick_size > 0:
        try:
            return int(abs(math.log10(tick_size)))
        except Exception:
            pass  # düşerse fallback'e geç

    # --- Fallback: fiyatın kendisinden ondalık basamak sayısı
    if sample_price is not None:
        return infer_decimals_from_price(sample_price)

    # Son çare: 4
    # print(f"UYARI: '{symbol}' için hassasiyet bulunamadı. Varsayılan=4.")
    return 4
def compute_indicators(
    data,
    timeframe: str = "5m",
    *,
    # ----- EXIT-SIDE (her zaman üret; strateji/exit bağımlı) -----
    atr_n: int = 14,          # ATR (exit)
    ch_n: int = 22,           # Chandelier (exit)
    ch_k: float = 3.0,        # Chandelier (exit)

    # ----- DEFAULTS (sadece add-indicator ile override edilir) -----
    rsi_range: int = 340,     # legacy kullanımlar için güvenli varsayılan
    **ind,                    # UI’dan gelen tüm paramlar (sonekli dahil)
):
    """
    Tek parça, katalogtaki TÜM indikatörler + 'difference' ailesi destekli.
    - İlk örnek (suffix yok) 'bb_lo', 'SMA', 'ema' gibi _soneksiz_ kolon adları üretir.
    - 2. ve sonrası 'bb_lo1', 'SMA1', 'ema1' ... biçiminde üretilir.
    - Bir gösterge ancak ilgili param anahtar(lar)ı ind içinde varsa hesaplanır.
    - Exit tarafı için ATR ve Chandelier her zaman hesaplanır.
    """
    import numpy as np
    import pandas as pd
    import re
    from math import ceil, sqrt

    # -------------------- OHLCV + timeframe/resample --------------------
    df = data.copy()

    def _ensure_dt_index(_df: pd.DataFrame) -> pd.DataFrame:
        if not isinstance(_df.index, pd.DatetimeIndex):
            for cand in ("time", "timestamp", "date", "datetime"):
                if cand in _df.columns:
                    _df[cand] = pd.to_datetime(_df[cand], errors="coerce", utc=True)
                    _df = _df.set_index(cand)
                    break
        if isinstance(_df.index, pd.DatetimeIndex):
            return _df.sort_index()
        return _df

    def _resample_ohlcv(_df: pd.DataFrame, rule: str) -> pd.DataFrame:
        agg = {"open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum"}
        return _df.resample(rule, label="right", closed="right").agg(agg).dropna(subset=["open","high","low","close"])

    _TIMEFRAME_MAP = {
        "1m":"1min","3m":"3min","5m":"5min","15m":"15min","30m":"30min",
   "1h":"1H","2h":"2H","4h":"4H","6h":"6H","8h":"8H","12h":"12H",
   "1d":"1D","3d":"3D","1w":"1W"
    }

    df = _ensure_dt_index(df)
    tf = (timeframe or "").lower()
    if tf and tf != "raw" and isinstance(df.index, pd.DatetimeIndex):
        rule = _TIMEFRAME_MAP.get(tf, tf)
        df = _resample_ohlcv(df, rule)

    for c in ("open","high","low","close","volume"):
        if c not in df.columns:
            raise ValueError(f"compute_indicators: missing '{c}'")

    open_, high, low, close = [df[c].astype(float) for c in ("open","high","low","close")]
    vol = df["volume"].astype(float)
    eps = 1e-12

    # ----------------------- küçük yardımcılar -----------------------
    def _geti(key, default):  # tek anahtar okuma
        v = ind.get(key, default)
        try: return int(float(str(v).replace(",", ".")))
        except: return int(default)

    def _getf(key, default):
        v = ind.get(key, default)
        try: return float(str(v).replace(",", "."))
        except: return float(default)
    def _collect_vals_typed(d: dict, base_key: str, typ="int") -> dict[str, float | int | str]:
        """
        {'x':1, 'x1':'2', 'x3':'2,5'} -> {'':1, '1':2.0, '3':2.5}
        typ: 'int' | 'float' | 'str'
        """
        import re
        pat = re.compile(rf"^{re.escape(base_key)}(\d*)$")
        out = {}
        for k, v in d.items():
            m = pat.fullmatch(k)
            if not m:
                continue
            suf = m.group(1) or ""
            s = str(v)
            if typ == "str":
                out[suf] = s
            else:
                s = s.replace(",", ".")
                out[suf] = int(float(s)) if typ == "int" else float(s)
        # "" önce, sonra 1,2,3...
        return dict(sorted(out.items(), key=lambda kv: (kv[0] != "", int(kv[0] or 0))))

    def _all_suffixes(*param_maps: dict[str, object]) -> list[str]:
        sufs = set()
        for m in param_maps:
            sufs |= set(m.keys())
        return sorted(sufs, key=lambda s: (s != "", int(s or 0)))


    def _suffix_maps(base_key: str, typ="int"):
        """
        ind içinden base_key, base_key1, base_key2 ... topla.
        typ: 'int' | 'float' | 'str'
        Dönüş: ordered dict: {'': val0, '1': val1, ...}  ('' her zaman önce)
        """
        pat = re.compile(rf"^{re.escape(base_key)}(\d*)$")
        out = {}
        for k, v in ind.items():
            m = pat.fullmatch(k)
            if not m: 
                continue
            suf = m.group(1) or ""
            try:
                s = str(v).replace(",", ".")
                out[suf] = int(float(s)) if typ == "int" else float(s) if typ == "float" else str(v)
            except: 
                pass
        return dict(sorted(out.items(), key=lambda kv: (kv[0] != "", int(kv[0] or 0))))

    def _collect_suffixes(*base_keys):
        sufs = set()
        for base in base_keys:
            pat = re.compile(rf"^{re.escape(base)}(\d*)$")
            for k in ind.keys():
                m = pat.fullmatch(k)
                if m: sufs.add(m.group(1) or "")
        return sorted(sufs, key=lambda s: (s != "", int(s or 0)))

    def _first(name, suf):
        """sonek '' için çıplak; diğerleri için name+suf"""
        return name if suf == "" else f"{name}{suf}"

    def _bb(s: pd.Series, n: int, k: float):
        mid = s.rolling(n, min_periods=n).mean()
        dev = s.rolling(n, min_periods=n).std(ddof=0)
        return mid, mid + k * dev, mid - k * dev

    def _rsi_core(s: pd.Series, n: int) -> pd.Series:
        d = s.diff()
        up = d.clip(lower=0)
        dn = (-d).clip(lower=0)
        au = up.ewm(alpha=1/n, adjust=False, min_periods=n).mean()
        ad = dn.ewm(alpha=1/n, adjust=False, min_periods=n).mean()
        rs = au / (ad + eps)
        return 100 - (100 / (1 + rs))

    # timeframe dakikası (PriceChangeMins için)
    def _tf_min(tf: str) -> int:
        tf = (tf or "").lower()
        if tf.endswith("m"): return int(tf[:-1] or 1)
        if tf.endswith("h"): return int(tf[:-1] or 1) * 60
        if tf.endswith("d"): return int(tf[:-1] or 1) * 1440
        if tf.endswith("w"): return int(tf[:-1] or 1) * 10080
        return 1
   

    def _collect_ints(d: dict, base_key: str) -> dict[str, int]:
        """
        'base', 'base1', 'base2' ... anahtarlarını derler.
        {'base': 20, 'base2': '30'} -> {'': 20, '2': 30}
        Sıralama: '' önce, sonra 1,2,3...
        """
        pat = re.compile(rf"^{re.escape(base_key)}(\d*)$")
        out: dict[str, int] = {}
        for k, v in d.items():
            m = pat.fullmatch(k)
            if not m:
                continue
            suf = m.group(1) or ""
            try:
                out[suf] = int(float(str(v).replace(",", ".")))
            except Exception:
                pass
        return dict(sorted(out.items(), key=lambda kv: (kv[0] != "", int(kv[0] or 0))))


    # -------------------- EXIT (daima üret) --------------------
    tr_raw = np.maximum.reduce([
        (high - low).to_numpy(),
        (high - close.shift(1)).abs().to_numpy(),
        (low  - close.shift(1)).abs().to_numpy()
    ])
    df["ATR"] = pd.Series(tr_raw, index=df.index).rolling(_geti("atr_n", atr_n), min_periods=_geti("atr_n", atr_n)).mean()

    _chN = _geti("ch_n", ch_n)
    _chK = _getf("ch_k", ch_k)
    df["ch_long"]  = high.rolling(_chN, min_periods=_chN).max() - df["ATR"] * _chK
    df["ch_short"] = low .rolling(_chN, min_periods=_chN).min() + df["ATR"] * _chK

    # =================================================================
    # ====================== KATALOG GÖSTERGELERİ =====================
    # Her blok: ilgili param anahtar(lar)ı geldiyse çalışır.
    # İLK instance -> soneksiz kolon adı; sonrakiler -> '1','2',...
    # =================================================================

    # ---------- SMA ----------
    smaP = _suffix_maps("sma_period", "int")
    for suf, n in smaP.items():
        s = close.rolling(int(n), min_periods=int(n)).mean()
        name = _first("SMA", suf)
        df[name] = s
        df[_first("sma", suf)] = s  # küçük harf aynası

    # ---------- EMA ----------
    emaP = _suffix_maps("ema_period", "int")
    for suf, n in emaP.items():
        e = close.ewm(span=int(n), adjust=False).mean()
        df[_first("EMA", suf)] = e
       

    # ---------- MACD ----------
    mF = _suffix_maps("macd_fast_default", "int")
    mS = _suffix_maps("macd_slow_default", "int")
    mG = _suffix_maps("macd_signal_default", "int")
    for suf in sorted(set(mF)|set(mS)|set(mG), key=lambda s: (s!="", int(s or 0))):
        f = int(mF.get(suf, 12)); s = int(mS.get(suf, 26)); g = int(mG.get(suf, 9))
        ef = close.ewm(span=f, adjust=False).mean()
        es = close.ewm(span=s, adjust=False).mean()
        macd = ef - es
        sig  = macd.ewm(span=g, adjust=False).mean()
        df[_first("macd", suf)] = macd
        df[_first("SMA_signal", suf)] = sig
        df[_first("hist", suf)] = macd - sig
        # ayrıca hızlı/yavaş EMA yansıt
        df[_first("ema_fast", suf)] = ef
        df[_first("ema_slow", suf)] = es

    # ---------- Bollinger ----------
    bbP = _suffix_maps("bb_period", "int")
    bbK = _suffix_maps("bb_std", "float")
    for suf in sorted(set(bbP)|set(bbK), key=lambda s: (s!="", int(s or 0))):
        n = int(bbP.get(suf, 20)); k = float(bbK.get(suf, 2.0))
        mid, up, lo = _bb(close, n, k)
        df[_first("bb_mid", suf)] = mid
        df[_first("bb_up",  suf)] = up
        df[_first("bb_lo",  suf)] = lo

    # ---------- RSI (tek param) ----------
    rsiP = _suffix_maps("rsi_period", "int")
    for suf, n in rsiP.items():
        r = _rsi_core(close, int(n))
        df[_first("RSI", suf)] = r
        

    # ---------- ADX ----------
    adxP = _suffix_maps("adx_period", "int")
    for suf, n in adxP.items():
        n = int(n)
        trn = pd.Series(tr_raw, index=df.index).rolling(n, min_periods=n).mean()
        up_move   = high.diff()
        down_move = -low.diff()
        plus_dm  = np.where((up_move > down_move) & (up_move > 0), up_move, 0.0)
        minus_dm = np.where((down_move > up_move) & (down_move > 0), down_move, 0.0)
        plus_di  = 100 * (pd.Series(plus_dm, index=df.index).rolling(n, min_periods=n).mean() / (trn + eps))
        minus_di = 100 * (pd.Series(minus_dm, index=df.index).rolling(n, min_periods=n).mean() / (trn + eps))
        dx = 100 * (plus_di - minus_di).abs() / (plus_di + minus_di + eps)
        df[_first("adx", suf)] = dx.rolling(n, min_periods=n).mean()
        df[_first("plus_di", suf)], df[_first("minus_di", suf)] = plus_di, minus_di

    # ---------- Chaikin Volatility ----------
    chv_span = _suffix_maps("chaikin_vol_span", "int")
    chv_chg  = _suffix_maps("chaikin_vol_change", "int")
    for suf in sorted(set(chv_span)|set(chv_chg), key=lambda s: (s!="", int(s or 0))):
        span = int(chv_span.get(suf, 10)); chg = int(chv_chg.get(suf, 10))
        ema_hl = (high - low).ewm(span=span, adjust=False).mean()
        df[_first("chaikin_volatility", suf)] = ema_hl.pct_change(chg) * 100
        df[_first("CHAIKIN", suf)] = df[_first("chaikin_volatility", suf)]

    # ---------- Momentum / ROC ----------
    momP = _suffix_maps("mom_period", "int")
    for suf, n in momP.items():
        n = int(n)
        df[_first("momentum", suf)] = close - close.shift(n)
    rocP = _suffix_maps("roc_period", "int")
    for suf, n in rocP.items():
        n = int(n)
        df[_first("roc", suf)] = (close / close.shift(n) - 1.0) * 100

    # ---------- MFI ----------
    mfiP = _suffix_maps("mfi_period", "int")
    if mfiP:
        typical = (high + low + close) / 3.0
        raw_mf = typical * vol
        pos_mf = raw_mf.where(typical > typical.shift(1), 0.0)
        neg_mf = raw_mf.where(typical < typical.shift(1), 0.0)
        for suf, n in mfiP.items():
            n = int(n)
            mfr = (pos_mf.rolling(n, min_periods=n).sum() /
                   (neg_mf.rolling(n, min_periods=n).sum() + eps))
            df[_first("MFI", suf)] = 100 - (100 / (1 + mfr))

    # ---------- DeMarker ----------
    demP = _suffix_maps("dem_period", "int")
    for suf, n in demP.items():
        n = int(n)
        demax = high.diff().clip(lower=0)
        demin = (-low.diff()).clip(lower=0)
        num = demax.rolling(n, min_periods=n).sum()
        den = num + demin.rolling(n, min_periods=n).sum() + eps
        df[_first("DeM", suf)] = (num / den).clip(0, 1)

    # ---------- StochRSI ----------
    srr = _suffix_maps("stoch_rsi_rsi_period", "int")
    srl = _suffix_maps("stoch_rsi_length", "int")
    srk = _suffix_maps("stoch_rsi_smooth_k", "int")
    srd = _suffix_maps("stoch_rsi_smooth_d", "int")
    for suf in sorted(set(srr)|set(srl)|set(srk)|set(srd), key=lambda s: (s!="", int(s or 0))):
        r  = int(srr.get(suf, 14))
        L  = int(srl.get(suf, 14))
        kN = int(srk.get(suf, 3))
        dN = int(srd.get(suf, 3))
        rsi_for = _rsi_core(close, r)
        rlo = rsi_for.rolling(L, min_periods=L).min()
        rhi = rsi_for.rolling(L, min_periods=L).max()
        k = (100 * (rsi_for - rlo) / (rhi - rlo + eps)).rolling(kN, min_periods=kN).mean()
        d = k.rolling(dN, min_periods=dN).mean()
        df[_first("stoch_rsi_k", suf)] = k
        df[_first("stoch_rsi_d", suf)] = d

    # ---------- NDMA ----------
    def _wstd_weighted(series: pd.Series, window: int) -> pd.Series:
        import numpy as np
        w = np.ones(window) / max(window, 1)
        def fn(x):
            avg = np.average(x, weights=w)
            var = np.average((x - avg) ** 2, weights=w)
            return float(np.sqrt(var))
        return series.rolling(window, min_periods=window).apply(fn, raw=True)

    _ndma_map = _collect_ints(ind, "ndma_window")  # {'':20, '1':30, ...}

    for suf, win in _ndma_map.items():
        sfx = suf  # <-- ilk örnek için sfx = "" kalsın; kolon adı "NDMA" olur
        n = int(win)
        if n <= 0:
            continue
        wstd_hidden = _wstd_weighted(close, n)
        df[f"NDMA{sfx}"] = wstd_hidden / (close + eps)



    # ---------- Awesome Oscillator ----------
    aoF = _suffix_maps("ao_fast", "int")
    aoS = _suffix_maps("ao_slow", "int")
    for suf in sorted(set(aoF)|set(aoS), key=lambda s: (s!="", int(s or 0))):
        f = int(aoF.get(suf, 5)); s = int(aoS.get(suf, 34))
        sma_f = close.rolling(f, min_periods=f).mean()
        sma_s = close.rolling(s, min_periods=s).mean()
        df[_first("ao", suf)] = sma_f - sma_s

    # ---------- Ichimoku ----------
    iTen = _suffix_maps("ichimoku_tenkan", "int")
    iKij = _suffix_maps("ichimoku_kijun", "int")
    iSen = _suffix_maps("ichimoku_senkou_b", "int")
    for suf in sorted(set(iTen)|set(iKij)|set(iSen), key=lambda s: (s!="", int(s or 0))):
        ten = int(iTen.get(suf, 9)); kij = int(iKij.get(suf, 26)); sen = int(iSen.get(suf, 52))
        conv = (high.rolling(ten).max() + low.rolling(ten).min()) / 2.0
        base = (high.rolling(kij).max() + low.rolling(kij).min()) / 2.0
        spanb = (high.rolling(sen).max() + low.rolling(sen).min()) / 2.0
        df[_first("ichimoku_conv", suf)]  = conv
        df[_first("ichimoku_base", suf)]  = base
        df[_first("ichimoku_spanb", suf)] = spanb

    # ---------- Williams %R ----------
    wrP = _suffix_maps("williams_r_period", "int")
    for suf, n in wrP.items():
        n = int(n)
        hh = high.rolling(n, min_periods=n).max()
        ll = low .rolling(n, min_periods=n).min()
        df[_first("WILLIAMSR", suf)] = -100 * (hh - close) / (hh - ll + eps)

    # ---------- CCI ----------
    cciP = _suffix_maps("cci_period", "int")
    for suf, n in cciP.items():
        n = int(n)
        tp = (high + low + close)/3.0
        sma_tp = tp.rolling(n, min_periods=n).mean()
        mad = (tp - sma_tp).abs().rolling(n, min_periods=n).mean()
        df[_first("CCI", suf)] = (tp - sma_tp) / (0.015 * (mad.replace(0, np.nan)))

    # ---------- OBV / AccumDist / VPT ----------
    if any(g in ind for g in ("OBV","obv")) or True:  # her zaman kullanılabilir
        df["obv"] = (np.sign(close.diff().fillna(0)) * vol).fillna(0).cumsum()
    if any(g in ind for g in ("AccumDist","adl")) or True:
        mfm = ((close - low) - (high - close)) / (high - low + eps)
        df["adl"] = (mfm * vol).cumsum()
    if any(g in ind for g in ("VPT","vpt")):
        df["vpt"] = (vol * (close.pct_change().fillna(0))).cumsum()

    # ---------- TEMA ----------
    temaP = _suffix_maps("tema_period", "int")
    for suf, n in temaP.items():
        n = int(n)
        e1 = close.ewm(span=n, adjust=False).mean()
        e2 = e1.ewm(span=n, adjust=False).mean()
        e3 = e2.ewm(span=n, adjust=False).mean()
        df[_first("tema", suf)] = 3*e1 - 3*e2 + e3

    # ---------- Ultimate Oscillator ----------
    uoF = _suffix_maps("uo_fast", "int")
    uoM = _suffix_maps("uo_mid", "int")
    uoS = _suffix_maps("uo_slow", "int")
    for suf in sorted(set(uoF)|set(uoM)|set(uoS), key=lambda s: (s!="", int(s or 0))):
        f = int(uoF.get(suf, 7)); m = int(uoM.get(suf, 14)); sN = int(uoS.get(suf, 28))
        bp = close - np.minimum(low, close.shift(1))
        tr_uo = (np.maximum(high, close.shift(1)) - np.minimum(low, close.shift(1))).fillna(0)
        def _uo(n): 
            return bp.rolling(n, min_periods=n).sum() / (tr_uo.rolling(n, min_periods=n).sum() + eps)
        df[_first("uo", suf)] = 100*(4*_uo(f) + 2*_uo(m) + 1*_uo(sN))/7

    # ---------- CMF ----------
    cmfP = _suffix_maps("cmf_period", "int")
    for suf, n in cmfP.items():
        n = int(n)
        mfm = ((close - low) - (high - close)) / (high - low + eps)
        mfv = mfm * vol
        df[_first("cmf", suf)] = (mfv.rolling(n, min_periods=n).sum()) / (vol.rolling(n, min_periods=n).sum() + eps)

    # ---------- Keltner ----------
    kE = _suffix_maps("keltner_ema", "int")
    kA = _suffix_maps("keltner_atr", "int")
    kM = _suffix_maps("keltner_multiplier", "float")
    for suf in sorted(set(kE)|set(kA)|set(kM), key=lambda s: (s!="", int(s or 0))):
        eN = int(kE.get(suf, 20)); aN = int(kA.get(suf, 10)); mult = float(kM.get(suf, 2.0))
        atr_ = pd.Series(tr_raw, index=df.index).rolling(aN, min_periods=aN).mean()
        mid = close.ewm(span=eN, adjust=False).mean()
        df[_first("kc_mid",   suf)] = mid
        df[_first("kc_upper", suf)] = mid + mult * atr_
        df[_first("kc_lower", suf)] = mid - mult * atr_

    # ---------- Donchian ----------
    donP = _suffix_maps("donchian_period", "int")
    for suf, n in donP.items():
        n = int(n)
        df[_first("donchian_upper", suf)] = high.rolling(n, min_periods=n).max()
        df[_first("donchian_lower", suf)] = low .rolling(n, min_periods=n).min()

    # ---------- Supertrend ----------
    stP = _suffix_maps("supertrend_period", "int")
    stM = _suffix_maps("supertrend_multiplier", "float")
    for suf in sorted(set(stP)|set(stM), key=lambda s: (s!="", int(s or 0))):
        p = int(stP.get(suf, 10)); mult = float(stM.get(suf, 3.0))
        atr_ = pd.Series(tr_raw, index=df.index).rolling(p, min_periods=p).mean()
        med = (high + low)/2.0
        up  = med + mult*atr_
        dn  = med - mult*atr_
        st_up, st_dn = up.copy(), dn.copy()
        trend = pd.Series(1, index=df.index)
        for i in range(1, len(df)):
            if close.iat[i-1] > st_up.iat[i-1]: trend.iat[i] = 1
            elif close.iat[i-1] < st_dn.iat[i-1]: trend.iat[i] = -1
            else: trend.iat[i] = trend.iat[i-1]
            if trend.iat[i] == 1:
                st_dn.iat[i] = max(st_dn.iat[i], st_dn.iat[i-1])
            else:
                st_up.iat[i] = min(st_up.iat[i], st_up.iat[i-1])
        df[_first("supertrend", suf)] = np.where(trend==1, st_dn, st_up)

    # ---------- PSAR ----------
    psStep = _suffix_maps("psar_step", "float")
    psInc  = _suffix_maps("psar_increment", "float")
    psMax  = _suffix_maps("psar_max", "float")
    for suf in sorted(set(psStep)|set(psInc)|set(psMax), key=lambda s:(s!="", int(s or 0))):
        step = float(psStep.get(suf, 0.02)); inc = float(psInc.get(suf, 0.02)); mx = float(psMax.get(suf, 0.2))
        ps = close.copy(); bull = True; af = step; epv = low.iloc[0]
        for i in range(2, len(close)):
            ps.iat[i] = ps.iat[i-1] + af * (epv - ps.iat[i-1])
            if bull:
                if high.iat[i] > epv: epv = high.iat[i]; af = min(af + inc, mx)
                if ps.iat[i] > low.iat[i]: bull=False; ps.iat[i]=epv; epv=low.iat[i]; af=step
            else:
                if low.iat[i] < epv: epv=low.iat[i]; af=min(af + inc, mx)
                if ps.iat[i] < high.iat[i]: bull=True; ps.iat[i]=epv; epv=high.iat[i]; af=step
        df[_first("psar", suf)] = ps

    # ---------- Aroon ----------
    aroonP = _suffix_maps("aroon_period", "int")
    for suf, n in aroonP.items():
        n = int(n)
        df[_first("aroon_up", suf)]   = 100 * high.rolling(n+1).apply(np.argmax, raw=True) / n
        df[_first("aroon_down", suf)] = 100 * low .rolling(n+1).apply(np.argmin, raw=True) / n
        df[_first("aroon_osc", suf)]  = df[_first("aroon_up", suf)] - df[_first("aroon_down", suf)]

    # ---------- Vortex ----------
    vortexP = _suffix_maps("vortex_period", "int")
    for suf, n in vortexP.items():
        n = int(n)
        vm_plus  = (high - high.shift(1)).abs()
        vm_minus = (low.shift(1) - low).abs()
        trn = pd.Series(tr_raw, index=df.index).rolling(n, min_periods=n).sum()
        df[_first("vi+", suf)] = vm_plus.rolling(n, min_periods=n).sum() / (trn + eps)
        df[_first("vi-", suf)] = vm_minus.rolling(n, min_periods=n).sum() / (trn + eps)
        df[_first("vi_diff", suf)] = df[_first("vi+", suf)] - df[_first("vi-", suf)]

    # ---------- Linear Regression ----------
    linP = _suffix_maps("linreg_period", "int")
    for suf, n in linP.items():
        n = int(n)
        x = np.arange(n)
        def lr(arr):
            if len(arr) < n: return np.nan
            y = np.asarray(arr)
            xm, ym = x.mean(), y.mean()
            b = ((x-xm)*(y-ym)).sum() / (((x-xm)**2).sum() + eps)
            a = ym - b*xm
            return a + b*(n-1)
        df[_first("linreg", suf)] = close.rolling(n, min_periods=n).apply(lr, raw=True)

    # ---------- HMA / ZLEMA / KAMA ----------
    hmaP = _suffix_maps("hma_period", "int")
    for suf, n in hmaP.items():
        n = int(n); w = int(sqrt(n)) or 1
        h = 2*close.rolling(n//2 or 1, min_periods=n//2 or 1).mean() - close.rolling(n, min_periods=n).mean()
        df[_first("hma", suf)] = h.rolling(w, min_periods=w).mean()
    zleP = _suffix_maps("zlema_period", "int")
    for suf, n in zleP.items():
        n = int(n)
        inp = close + (close - close.shift(1)).fillna(0)
        df[_first("zlema", suf)] = inp.ewm(span=n, adjust=False).mean()
    kamaER = _suffix_maps("kama_er_n", "int")
    kamaF  = _suffix_maps("kama_fast", "int")
    kamaS  = _suffix_maps("kama_slow", "int")
    for suf in sorted(set(kamaER)|set(kamaF)|set(kamaS), key=lambda s:(s!="", int(s or 0))):
        n  = int(kamaER.get(suf, 10)); fa = int(kamaF.get(suf, 2)); sl = int(kamaS.get(suf, 30))
        change = (close - close.shift(n)).abs()
        vol_   = close.diff().abs().rolling(n).sum()
        er = (change / (vol_ + eps)).clip(0,1)
        sc = (er*(2/(fa+1)) + (1-er)*(2/(sl+1)))**2
        kama = pd.Series(index=df.index, dtype=float)
        kama.iloc[0] = close.iloc[0]
        for i in range(1, len(close)):
            kama.iloc[i] = kama.iloc[i-1] + sc.iloc[i]*(close.iloc[i]-kama.iloc[i-1])
        df[_first("kama", suf)] = kama

    # ---------- VWAP / VWMA ----------
    vwmaP = _suffix_maps("vwma_period", "int")
    for suf, n in vwmaP.items():
        n = int(n)
        num = (close*vol).rolling(n, min_periods=n).sum()
        den = vol.rolling(n, min_periods=n).sum()
        df[_first("vwma", suf)] = num / (den + eps)
    vwapP = _suffix_maps("vwap_period", "int")
    for suf, n in vwapP.items():
        n = int(n)
        num = (close*vol).rolling(n, min_periods=n).sum()
        den = vol.rolling(n, min_periods=n).sum()
        df[_first("vwap", suf)] = num / (den + eps)

    # ---------- TSI ----------
    tsiL = _suffix_maps("tsi_long", "int")
    tsiS = _suffix_maps("tsi_short", "int")
    tsiG = _suffix_maps("tsi_signal", "int")
    for suf in sorted(set(tsiL)|set(tsiS)|set(tsiG), key=lambda s:(s!="", int(s or 0))):
        l = int(tsiL.get(suf, 25)); sh = int(tsiS.get(suf, 13)); si = int(tsiG.get(suf, 13))
        m = close.diff().fillna(0)
        m1 = m.ewm(span=sh, adjust=False).mean().ewm(span=l, adjust=False).mean()
        a1 = m.abs().ewm(span=sh, adjust=False).mean().ewm(span=l, adjust=False).mean()
        tsi = 100 * (m1 / (a1 + eps))
        df[_first("tsi", suf)] = tsi
        df[_first("tsi_signal", suf)] = tsi.ewm(span=si, adjust=False).mean()

    # ---------- DMI (DI) / RVI / CMO ----------
    dmiP = _suffix_maps("dmi_period", "int")
    dmiADX = _suffix_maps("dmi_adx_period", "int")
    for suf in sorted(set(dmiP)|set(dmiADX), key=lambda s:(s!="", int(s or 0))):
        dp  = int(dmiP.get(suf, 14))
        adp = int(dmiADX.get(suf, 14))
        up_move   = high.diff()
        down_move = -low.diff()
        plus_dm  = np.where((up_move > down_move) & (up_move > 0), up_move, 0.0)
        minus_dm = np.where((down_move > up_move) & (down_move > 0), down_move, 0.0)
        atr_adx = pd.Series(tr_raw, index=df.index).rolling(adp, min_periods=adp).mean()
        plus_di  = 100 * (pd.Series(plus_dm, index=df.index).rolling(dp, min_periods=dp).mean() / (atr_adx + eps))
        minus_di = 100 * (pd.Series(minus_dm, index=df.index).rolling(dp, min_periods=dp).mean() / (atr_adx + eps))
        dx = 100 * (plus_di - minus_di).abs() / (plus_di + minus_di + eps)
        df[_first("adx", suf)] = dx.rolling(adp, min_periods=adp).mean()
        df[_first("plus_di", suf)], df[_first("minus_di", suf)] = plus_di, minus_di
    rviP = _suffix_maps("rvi_period", "int")
    for suf, n in rviP.items():
        n = int(n)
        num = (close - close.shift(1)).rolling(n, min_periods=n).sum()
        den = (high - low).rolling(n, min_periods=n).sum() + eps
        df[_first("rvi", suf)] = 100 * (num / den)
    cmoP = _suffix_maps("cmo_period", "int")
    for suf, n in cmoP.items():
        n = int(n)
        up = (close.diff().clip(lower=0)).rolling(n, min_periods=n).sum()
        dn = ((-close.diff()).clip(lower=0)).rolling(n, min_periods=n).sum()
        df[_first("cmo", suf)] = 100 * (up - dn) / (up + dn + eps)

    # ---------- Coppock ----------
    copW = _suffix_maps("coppock_wma", "int")
    copR1 = _suffix_maps("coppock_roc1", "int")
    copR2 = _suffix_maps("coppock_roc2", "int")
    for suf in sorted(set(copW)|set(copR1)|set(copR2), key=lambda s:(s!="", int(s or 0))):
        w  = int(copW.get(suf, 10)); r1 = int(copR1.get(suf, 14)); r2 = int(copR2.get(suf, 11))
        roc1 = 100*(close/close.shift(r1) - 1.0)
        roc2 = 100*(close/close.shift(r2) - 1.0)
        df[_first("coppock", suf)] = (roc1 + roc2).rolling(w, min_periods=w).mean()

    # ---------- Schaff Trend Cycle ----------
    stcC = _suffix_maps("schaff_cycle", "int")
    stcF = _suffix_maps("schaff_fast", "int")
    stcS = _suffix_maps("schaff_slow", "int")
    for suf in sorted(set(stcC)|set(stcF)|set(stcS), key=lambda s:(s!="", int(s or 0))):
        cyc = int(stcC.get(suf, 10)); fast = int(stcF.get(suf, 23)); slow = int(stcS.get(suf, 50))
        ef = close.ewm(span=fast, adjust=False).mean()
        es = close.ewm(span=slow, adjust=False).mean()
        macd = ef - es
        mn = macd.rolling(cyc).min()
        mx = macd.rolling(cyc).max()
        df[_first("schaff", suf)] = 100*(macd - mn) / (mx - mn + eps)

    # ---------- TRIX / PPO / PVO ----------
    trixN = _suffix_maps("trix_n", "int")
    trixS = _suffix_maps("trix_signal", "int")
    for suf in sorted(set(trixN)|set(trixS), key=lambda s:(s!="", int(s or 0))):
        n = int(trixN.get(suf, 15)); s = int(trixS.get(suf, 9))
        e1 = close.ewm(span=n, adjust=False).mean()
        e2 = e1.ewm(span=n, adjust=False).mean()
        e3 = e2.ewm(span=n, adjust=False).mean()
        trix = 100 * e3.pct_change()
        df[_first("trix", suf)] = trix
        df[_first("trix_signal", suf)] = trix.ewm(span=s, adjust=False).mean()

    ppoF = _suffix_maps("ppo_fast", "int")
    ppoS = _suffix_maps("ppo_slow", "int")
    ppoG = _suffix_maps("ppo_signal", "int")
    for suf in sorted(set(ppoF)|set(ppoS)|set(ppoG), key=lambda s:(s!="", int(s or 0))):
        f = int(ppoF.get(suf, 12)); s = int(ppoS.get(suf, 26)); g = int(ppoG.get(suf, 9))
        ef = close.ewm(span=f, adjust=False).mean()
        es = close.ewm(span=s, adjust=False).mean()
        ppo = 100*(ef - es)/(es + eps)
        df[_first("ppo", suf)] = ppo
        df[_first("ppo_signal", suf)] = ppo.ewm(span=g, adjust=False).mean()

    pvoF = _suffix_maps("pvo_fast", "int")
    pvoS = _suffix_maps("pvo_slow", "int")
    pvoG = _suffix_maps("pvo_signal", "int")
    for suf in sorted(set(pvoF)|set(pvoS)|set(pvoG), key=lambda s:(s!="", int(s or 0))):
        f = int(pvoF.get(suf, 12)); s = int(pvoS.get(suf, 26)); g = int(pvoG.get(suf, 9))
        vf = vol.ewm(span=f, adjust=False).mean()
        vs = vol.ewm(span=s, adjust=False).mean()
        pvo = 100*(vf - vs)/(vs + eps)
        df[_first("pvo", suf)] = pvo
        df[_first("pvo_signal", suf)] = pvo.ewm(span=g, adjust=False).mean()

    # ---------- Fisher ----------
    fishP = _suffix_maps("fisher_period", "int")
    for suf, n in fishP.items():
        n = int(n)
        mn = low.rolling(n, min_periods=n).min()
        mx = high.rolling(n, min_periods=n).max()
        x = (2*((close - mn)/(mx - mn + eps)) - 1).clip(-0.999, 0.999)
        fish = 0.0 * close
        for i in range(1, len(close)):
            fish.iat[i] = 0.5*np.log((1+x.iat[i])/(1-x.iat[i] + eps)) + 0.5*fish.iat[i-1]
        df[_first("fisher", suf)] = fish

    # ---------- DPO / MMI ----------
    dpoP = _suffix_maps("dpo_n", "int")
    for suf, n in dpoP.items():
        n = int(n)
        ma = close.rolling(n, min_periods=n).mean()
        df[_first("dpo", suf)] = close - ma.shift(n//2 + 1)
    mmiP = _suffix_maps("mmi_period", "int")
    for suf, n in mmiP.items():
        n = int(n)
        chg = np.sign(close.diff())
        df[_first("mmi", suf)] = 100 * (chg.rolling(n, min_periods=n).apply(lambda a: (a[1:]!=a[:-1]).mean() if len(a)>1 else 0.0, raw=True))

    # ---------- Squeeze Momentum bayrağı ----------
    sqKC = _suffix_maps("squeeze_kclength", "int")
    sqKM = _suffix_maps("squeeze_kcmult", "float")
    sqBBL= _suffix_maps("squeeze_bblength", "int")
    sqBBM= _suffix_maps("squeeze_bbmult", "float")
    for suf in sorted(set(sqKC)|set(sqKM)|set(sqBBL)|set(sqBBM), key=lambda s:(s!="", int(s or 0))):
        kc_n = int(sqKC.get(suf, 20)); kc_m = float(sqKM.get(suf, 1.5))
        bb_n = int(sqBBL.get(suf, 20)); bb_m = float(sqBBM.get(suf, 2.0))
        bb_mid, bb_up, bb_lo = _bb(close, bb_n, bb_m)
        kc_mid = close.ewm(span=kc_n, adjust=False).mean()
        kc_atr = pd.Series(tr_raw, index=df.index).ewm(span=kc_n, adjust=False).mean()
        kc_up = kc_mid + kc_m * kc_atr
        kc_lo = kc_mid - kc_m * kc_atr
        df[_first("squeeze_on", suf)] = (bb_up < kc_up) & (bb_lo > kc_lo)

    # ---------- ZScore / StdErr ----------
    zP = _suffix_maps("zscore_period", "int")
    for suf, n in zP.items():
        n = int(n)
        mu = close.rolling(n, min_periods=n).mean()
        sd = close.rolling(n, min_periods=n).std(ddof=0)
        df[_first("zscore", suf)] = (close - mu) / (sd + eps)
    seP = _suffix_maps("stderr_period", "int")
    for suf, n in seP.items():
        n = int(n)
        sd = close.rolling(n, min_periods=n).std(ddof=0)
        df[_first("stderr", suf)] = sd / np.sqrt(n)

    # ---------- Fractals ----------
    frP = _suffix_maps("fractal_n", "int")
    for suf, n in frP.items():
        n = int(n)
        # basit high/low merkezli işaretçiler (Williams fraktal konsepti)
        hi = (high.shift(n) == high.rolling(2*n+1, center=True).max())
        lo = (low.shift(n)  == low.rolling(2*n+1, center=True).min())
        df[_first("fractal_high", suf)] = hi.astype(int)
        df[_first("fractal_low",  suf)] = lo.astype(int)

    # ---------- Volume Profile (özet; kayan pencerede toplam hacim) ----------
    vpRows = _suffix_maps("vp_rows", "int")
    for suf, rows in vpRows.items():
        rows = int(rows)
        df[_first("vp_total", suf)] = vol.rolling(rows, min_periods=1).sum()

    # ---------- Price Change (minutes) (max 5) ----------
    pcM = _suffix_maps("price_change_mins", "int")
    if pcM:
        tfmin = _tf_min(timeframe)
        for suf, mins in list(pcM.items())[:5]:
            bars = max(1, ceil(int(mins)/tfmin))
            df[_first("pc_m", suf)]     = (close/close.shift(bars) - 1.0)
            df[_first("pc_abs_m", suf)] = (close - close.shift(bars))
    

    # ==============================================================
    # ================== DIFFERENCE GÖSTERGELERİ ===================
    # 1) EMA diff: 'ema_diff' (EMA_fast - EMA_slow), params: ema_fast, ema_slow
    # 2) RSI difference: 'rsi_diff' (RSI_short - RSI_long), params: rsi_short, rsi_long
    # 3) Stoch diff: 'stoch_diff' (%K - %D), params: stoch_k, stoch_d, stoch_smooth
    # 4) PPO/TRIX diff: 'ppo_diff' = ppo - ppo_signal, 'trix_diff' = trix - trix_signal
    # 5) close - vwap/sma: 'close_vwap_diff', 'close_sma_diff' (ilgili periyot paramları gerekir)
    # 6) supertrend_dev: close - supertrend
    # 7) ichimoku_diff: tenkan - kijun
    # 8) vortex_diff: vi+ - vi-
    # ==============================================================
    # 1) EMA diff
    ema_fast = _suffix_maps("ema_fast", "int")
    ema_slow = _suffix_maps("ema_slow", "int")
    for suf in sorted(set(ema_fast)|set(ema_slow), key=lambda s:(s!="", int(s or 0))):
        f = int(ema_fast.get(suf, 12)); sN = int(ema_slow.get(suf, 26))
        ef = close.ewm(span=f, adjust=False).mean()
        es = close.ewm(span=sN, adjust=False).mean()
        df[_first("ema_diff", suf)] = ef - es

    # 2) RSI difference
    rsi_short = _suffix_maps("rsi_short", "int")
    rsi_long  = _suffix_maps("rsi_long",  "int")
    for suf in sorted(set(rsi_short)|set(rsi_long), key=lambda s:(s!="", int(s or 0))):
        rs = int(rsi_short.get(suf, 10)); rl = int(rsi_long.get(suf, 60))
        rS = _rsi_core(close, rs)
        rL = _rsi_core(close, rl)
        df[_first("RSI_diff", suf)] = rS - rL

    # 3) Stoch diff
    stK = _suffix_maps("stoch_k", "int")
    stD = _suffix_maps("stoch_d", "int")
    stS = _suffix_maps("stoch_smooth", "int")
    for suf in sorted(set(stK)|set(stD)|set(stS), key=lambda s:(s!="", int(s or 0))):
        kN = int(stK.get(suf, 14)); dN = int(stD.get(suf, 3)); sN = int(stS.get(suf, 3))
        fastK = 100*((close - low.rolling(kN).min())/(high.rolling(kN).max() - low.rolling(kN).min() + eps))
        K = fastK.rolling(sN, min_periods=sN).mean()
        D = K.rolling(dN, min_periods=dN).mean()
        df[_first("stoch_k", suf)] = K
        df[_first("stoch_d", suf)] = D
        df[_first("stoch_diff", suf)] = K - D

    # 4) ppo_diff / trix_diff (varsa sinyal)
    for suf in sorted(set(ppoF)|set(ppoS)|set(ppoG), key=lambda s:(s!="", int(s or 0))):
        p = df.get(_first("ppo", suf)); ps = df.get(_first("ppo_signal", suf))
        if p is not None and ps is not None:
            df[_first("ppo_diff", suf)] = p - ps
    for suf in sorted(set(trixN)|set(trixS), key=lambda s:(s!="", int(s or 0))):
        t = df.get(_first("trix", suf)); ts = df.get(_first("trix_signal", suf))
        if t is not None and ts is not None:
            df[_first("trix_diff", suf)] = t - ts

    # 5) close_vwap_diff / close_sma_diff
    for suf in vwapP.keys():
        df[_first("close_vwap_diff", suf)] = close - df[_first("vwap", suf)]
    for suf in smaP.keys():
        df[_first("close_sma_diff", suf)] = close - df[_first("SMA", suf)]

    # 6) supertrend_dev
    for suf in stP.keys() | stM.keys():
        stcol = _first("supertrend", suf)
        if stcol in df:
            df[_first("supertrend_dev", suf)] = close - df[stcol]

    # 7) ichimoku_diff (tenkan - kijun)
    for suf in iTen.keys() | iKij.keys():
        c1 = _first("ichimoku_conv", suf)
        c2 = _first("ichimoku_base", suf)
        if c1 in df and c2 in df:
            df[_first("ichimoku_diff", suf)] = df[c1] - df[c2]
    pvsS = _suffix_maps("pvs_sma_period", "int")  # '' , '1', ...
    for suf, n in pvsS.items():
        n = int(n)
        sma_tmp = close.rolling(n, min_periods=n).mean()
        col = _first("close_sma_diff", suf)
        if col not in df:  # zaten ürettiysek tekrar yazmayalım
            df[col] = close - sma_tmp

    # --- PriceVsVWAP (katalog anahtarları) ---
    pvsV = _suffix_maps("pvs_vwap_period", "int")
    for suf, n in pvsV.items():
        n = int(n)
        num = (close*vol).rolling(n, min_periods=n).sum()
        den =  vol.rolling(n, min_periods=n).sum()
        vwap_tmp = num / (den + eps)
        col = _first("close_vwap_diff", suf)
        if col not in df:
            df[col] = close - vwap_tmp
    # ================== #### EK: EKSİK GÖSTERGELER + ANCHOR DESTEK #### ==================

    # ---- KDJ (Stoch %K, %D, %J) ----
    _kdjK = _collect_vals_typed(ind, "kdj_k_period", "int")
    _kdjD = _collect_vals_typed(ind, "kdj_d_period", "int")
    _kdjJ = _collect_vals_typed(ind, "kdj_j_period", "int")  # genelde yumuşatma amaçlı
    for suf in _all_suffixes(_kdjK, _kdjD, _kdjJ):
        kN = int(_kdjK.get(suf, _geti("kdj_k_period", 9)))
        dN = int(_kdjD.get(suf, _geti("kdj_d_period", 3)))
        jN = int(_kdjJ.get(suf, _geti("kdj_j_period", 3)))
        HH = high.rolling(kN, min_periods=kN).max()
        LL = low .rolling(kN, min_periods=kN).min()
        fastK = 100 * (close - LL) / (HH - LL + eps)
        K = fastK.rolling(jN).mean()
        D = K.rolling(dN).mean()
        J = 3*K - 2*D
        df[f"kdj_k{suf}"] = K
        df[f"kdj_d{suf}"] = D
        df[f"kdj_j{suf}"] = J

    # ---- GAPO (Gopalakrishnan Range Index): log(range_n)/log(n) ----
    _gapoP = _collect_vals_typed(ind, "gapo_period", "int")
    for suf, n in _gapoP.items():
        n = max(2, int(n))
        HH = high.rolling(n, min_periods=n).max()
        LL = low .rolling(n, min_periods=n).min()
        df[f"gapo{suf}"] = np.log((HH - LL).clip(lower=eps)) / np.log(n)

    # ---- Elder Ray (Bull/Bear Power) ----
    _elE = _collect_vals_typed(ind, "elder_ema", "int")
    for suf, n in _elE.items():
        n = int(n)
        ema_ = close.ewm(span=n, adjust=False).mean()
        df[f"elder_bull{suf}"] = high - ema_
        df[f"elder_bear{suf}"] = low  - ema_

    # ---- Fractals (Williams) ----
    _frN = _collect_vals_typed(ind, "fractal_n", "int")
    for suf, n in _frN.items():
        n = max(1, int(n))
        # merkezdeki barın yerini işaretlemek için kaydırmalı pencereler
        win = 2*n + 1
        # up fractal: merkezin high'ı pencerenin maksimumu
        up = (high.rolling(win, center=True).apply(lambda a: 1.0 if len(a)==win and a[n]==a.max() else 0.0, raw=True)).fillna(0.0)
        dn = (low .rolling(win, center=True).apply(lambda a: 1.0 if len(a)==win and a[n]==a.min() else 0.0, raw=True)).fillna(0.0)
        df[f"fractal_up{suf}"] = up
        df[f"fractal_down{suf}"] = dn

    # ---- Pivot Points (classic floor pivots) ----
    # Not: 'pivot_timeframe' (örn. "D", "W", "M"). Sonekliler de desteklenir (pivot_timeframe1, vb.)
    _pivotTF = _collect_vals_typed(ind, "pivot_timeframe", "str")
    def _to_pandas_rule(tf: str) -> str:
        tf = str(tf or "D").upper().strip()
        # D/W/M/Y gibi, pandas resample ile uyumlu
        return {"D":"1D","W":"1W","M":"1M","Q":"1Q","Y":"1Y"}.get(tf, tf)

    for suf, tf in _pivotTF.items():
        rule = _to_pandas_rule(tf)
        if isinstance(df.index, pd.DatetimeIndex):
            # Önce dönemselle OHLC çıkar
            o = df["open"].resample(rule, label="right", closed="right").first()
            h = df["high"].resample(rule, label="right", closed="right").max()
            l = df["low" ].resample(rule, label="right", closed="right").min()
            c = df["close"].resample(rule, label="right", closed="right").last()
            piv = (h + l + c) / 3.0
            r1 = 2*piv - l
            s1 = 2*piv - h
            r2 = piv + (h - l)
            s2 = piv - (h - l)
            r3 = h + 2*(piv - l)
            s3 = l - 2*(h - piv)
            piv = piv.shift(1); r1=r1.shift(1); s1=s1.shift(1); r2=r2.shift(1); s2=s2.shift(1); r3=r3.shift(1); s3=s3.shift(1)
            # orijinal barlara geri yay
            df[f"pivot_p{suf}"] = piv.reindex(df.index, method="ffill")
            df[f"pivot_r1{suf}"] = r1.reindex(df.index, method="ffill")
            df[f"pivot_s1{suf}"] = s1.reindex(df.index, method="ffill")
            df[f"pivot_r2{suf}"] = r2.reindex(df.index, method="ffill")
            df[f"pivot_s2{suf}"] = s2.reindex(df.index, method="ffill")
            df[f"pivot_r3{suf}"] = r3.reindex(df.index, method="ffill")
            df[f"pivot_s3{suf}"] = s3.reindex(df.index, method="ffill")

    # ---- Fibonacci Retracement (lookback bar sayıları) ----
    _fibH = _collect_vals_typed(ind, "fib_high_bars", "int")
    _fibL = _collect_vals_typed(ind, "fib_low_bars",  "int")
    for suf in _all_suffixes(_fibH, _fibL):
        HB = int(_fibH.get(suf, _geti("fib_high_bars", 20)))
        LB = int(_fibL.get(suf, _geti("fib_low_bars", 20)))
        HH = high.rolling(HB, min_periods=HB).max()
        LL = low .rolling(LB, min_periods=LB).min()
        rng = (HH - LL).replace(0, np.nan)
        # Klasik oranlar
        for lvl, name in [(0.236,"236"),(0.382,"382"),(0.5,"500"),(0.618,"618"),(0.786,"786")]:
            df[f"fib_{name}{suf}"] = HH - lvl * rng

    # ---- OBV / ADL / VPT anchor desteği ----
    # Anchor mantığı: anchor=N ise seri, N bar önceki değerine göre yeniden bazlanır.
    def _rebase_with_anchor(series: pd.Series, anchor: int) -> pd.Series:
        anchor = int(anchor)
        if anchor <= 1: 
            return series
        base = series.shift(anchor-1)
        return (series - base).fillna(0)

    _obvA = _collect_vals_typed(ind, "obv_anchor", "int")
    for suf, anc in _obvA.items():
        # OBV kopyası (eğer base obv zaten varsa onu alıp rebase’leyelim; yoksa hesaplayalım)
        obv_series = df.get("obv", (np.sign(close.diff().fillna(0)) * vol).fillna(0).cumsum())
        df[f"obv{suf}"] = _rebase_with_anchor(obv_series, anc)

    _adlA = _collect_vals_typed(ind, "accumdist_anchor", "int")
    for suf, anc in _adlA.items():
        mfm = ((close - low) - (high - close)) / (high - low + eps)
        adl_series = (mfm * vol).cumsum()
        df[f"adl{suf}"] = _rebase_with_anchor(adl_series, anc)

    _vptA = _collect_vals_typed(ind, "vpt_anchor", "int")
    for suf, anc in _vptA.items():
        vpt_series = (vol * (close.pct_change().fillna(0))).cumsum()
        df[f"vpt{suf}"] = _rebase_with_anchor(vpt_series, anc)

    # ================== #### /EK: EKSİK GÖSTERGELER + ANCHOR #### ==================


    # 8) vortex_diff zaten yukarıda üretildi (vi_diff/vi_diff1 ...)

    # -------------------- temizlik --------------------
    df.replace([np.inf, -np.inf], np.nan, inplace=True)
    df = df.ffill().fillna(0)

    return df


# -----------------------------------------------------------------------------
def _sanitize_expr(expr: str) -> str:
    s = textwrap.dedent(expr or "").strip()
    if "\n" in s:
        s = re.sub(r"[ \t]*\n[ \t]*", " ", s)
    s = re.sub(r"\s+", " ", s)
    s = re.sub(r"\band\b", "&", s, flags=re.I)
    s = re.sub(r"\bor\b",  "|", s, flags=re.I)
    s = re.sub(r"\$([A-Za-z_]\w*)", r"\1", s)
    return s

def eval_expr(df: pd.DataFrame, expr: str, params: Dict[str, Any]) -> pd.Series:
    s = _sanitize_expr(expr)
    env = {"data": df, "np": np, "pd": pd, **(params or {})}
    try:
        out = pd.eval(s, engine="python", local_dict=env)
    except Exception:
        try:
            out = eval(s, {"__builtins__": {}}, env)
        except Exception as e:
            raise ValueError(
                f"Expr deÄŸerlendirilemedi: {type(e).__name__}: {e}. "
                "Tek satÄ±r, &/| ve data['...'] kullanÄ±n. $param deÄŸerlerini 'params'ta verin."
            )
    if isinstance(out, (pd.Series, np.ndarray, list)):
        return pd.Series(out, index=df.index) if not isinstance(out, pd.Series) else out
    raise ValueError("Expr bir bool veya iÅŸaret serisi (-1/0/+1) Ã¼retmeli.")

def expr_to_entries(df: pd.DataFrame, expr: str, params: Dict[str, Any], side: int, respect_expr_sign: bool) -> pd.Series:
    raw = eval_expr(df, expr, params or {})
    if respect_expr_sign:
        vals = pd.to_numeric(raw, errors="coerce")
        if (vals.fillna(0) < 0).any() or (vals.fillna(0) > 1).any():
            return np.sign(vals.fillna(0).astype(float)).astype(int)
    mask = raw.astype(bool)
    return (mask.astype(int) * int(np.sign(side) if side != 0 else 1)).astype(int)
class ExitSchemeEvt(BaseModel):
    type: str
    tp_pct: Optional[float] = None
    sl_pct: Optional[float] = None
    atr_n: Optional[int] = None
    k_sl: Optional[float] = None
    m_tp: Optional[float] = None
    n: Optional[int] = None
    factor: Optional[float] = None
    ma: Optional[str] = None
    std: Optional[float] = None
    side: Optional[str] = None
    trail_pct: Optional[float] = None
from typing import List, Optional
from pydantic import BaseModel

class GPStrategyReq(BaseModel):
    # Data & Backtest
    symbol: str
    timeframe: str
    start: str
    end: str
    side: int = 1
    exit_scheme: Optional[ExitSchemeEvt] = None
    leverage: float = 1.0
    fee_pct: float = 0.0
    slippage_pct: float = 0.0
    data_snapshot_id: Optional[str] = None

    # Terminals & Operators
    indicators_to_use: List[str] = []                    # df sütun adları
    operators_to_use: List[str] = ["&","|",">","<","+","-","*"]  # istersen ">=","<=" de eklenebilir

    # GP params
    population_size: int = 80
    generations: int = 30
    crossover_prob: float = 0.7
    mutation_prob: float = 0.2
    tournament_k: int = 5
    complexity_penalty: float = 0.001
    objective: str = "profit"  # "profit" | "sharpe" | "winRate"
    ind_params: Dict[str, Any] = {}    

# -----------------------------------------------------------------------------
# Backtest (ORDI-style)
# -----------------------------------------------------------------------------
@dataclass
class RunConfig:
    tp: float
    sl: float
    leverage: float
    # legacy alanlar (fallback)
    fee_pct: float = 0.1            # (% round-trip legacy)
    slippage_pct: float = 0.3       # (% round-trip legacy)
    side: int = 1
    # yeni maliyet profili (tercihli)
    maker_bps: Optional[float] = None
    taker_bps: Optional[float] = None
    slip_bps: Optional[float] = None            # "yan başına" bps; round-trip=2*slip_bps
    funding_bps_interval: Optional[float] = None
    funding_interval_hours: Optional[int] = None

def _round_digits_idx(i: int) -> int:
    return 3 if (i < 50000 or i > 155000) else 2
def _round_digits_by_price(price: float) -> int:
    # örnek: 0.1–1 → 4-5 hane, 1–100 → 2-3 hane, 100+ → 1-2 hane (ihtiyaca göre ayarla)
    p = max(abs(price), 1e-9)
    k = int(np.floor(np.log10(p)))
    return int(max(0, 3 - k))  # dilediğin kalibrasyonu yap

def walkforward_signals(df: pd.DataFrame, entries_signed: pd.Series, cfg: RunConfig) -> List[Dict[str, Any]]:
    signals: List[Dict[str, Any]] = []
    e = entries_signed.astype(int).values
    idx = df.index
    close = df["close"].to_numpy()
    high  = df["high"].to_numpy()
    low   = df["low"].to_numpy()
    n = len(df)
    # maliyet çözümlemesi:
    # - eğer maker/taker/slip bps verilmişse onları kullan (taker default), yoksa legacy % round-trip
    if (cfg.maker_bps is not None) or (cfg.taker_bps is not None) or (cfg.slip_bps is not None):
        taker_bps = cfg.taker_bps if cfg.taker_bps is not None else float(ACTIVE_COSTS_CONFIG.get("taker_bps", 5.0))
        slip_side_bps = cfg.slip_bps if cfg.slip_bps is not None else float(ACTIVE_COSTS_CONFIG.get("slip_bps", 8.0))
        fee  = (2.0 * taker_bps) / 10000.0          # round-trip fee (%)
        slip = (2.0 * slip_side_bps) / 10000.0      # round-trip slip (%)
    else:
        fee  = cfg.fee_pct / 100.0                  # legacy: round-trip %
        slip = cfg.slippage_pct / 100.0

    # rapora koymak üzere bps cinsinden de sakla
    fees_bps_round = fee * 10000.0
    slip_bps_round = slip * 10000.0

    

   

    i = 0
    while i < n:
        if e[i] == 0:
            i += 1
            continue
        side = int(np.sign(e[i]))
        if side == 0:
            i += 1
            continue

        rd = _round_digits_idx(i)
        entry_idx = i
        entry_price = float(close[i])

        if side > 0:
            tp_price = round(entry_price * (1 + cfg.tp), rd)
            sl_price = round(entry_price * (1 - cfg.sl), rd)
        else:
            tp_price = round(entry_price * (1 - cfg.tp), rd)
            sl_price = round(entry_price * (1 + cfg.sl), rd)

        # varsayÄ±lanlar (aÃ§Ä±k iÅŸlem)
        exit_idx: Optional[int] = None
        exit_price: Optional[float] = None
        exit_reason: Optional[str] = None
        tp_hit = False
        sl_hit = False
        closed = False

        # giriÅŸten sonra barlarda TP/SL ara
        for j in range(i+1, n):
            hi = float(high[j]); lo = float(low[j])
            if side > 0:
                sl_bar = (lo <= sl_price)
                tp_bar = (hi >= tp_price)
                if sl_bar or tp_bar:
                    if sl_bar:
                        exit_reason = "sl"; exit_price = sl_price; sl_hit = True
                    else:
                        exit_reason = "tp"; exit_price = tp_price; tp_hit = True
                    closed = True
                    exit_idx = j
                    i = j  # Ã§Ä±kÄ±ÅŸ barÄ±na atla (re-entry aynÄ± barda mÃ¼mkÃ¼n olsun)
                    break
            else:
                sl_bar = (hi >= sl_price)
                tp_bar = (lo <= tp_price)
                if sl_bar or tp_bar:
                    if sl_bar:
                        exit_reason = "sl"; exit_price = sl_price; sl_hit = True
                    else:
                        exit_reason = "tp"; exit_price = tp_price; tp_hit = True
                    closed = True
                    exit_idx = j
                    i = j
                    break
        

        if closed:
            # gerÃ§ekleÅŸen kapanÄ±ÅŸta PnL
            if side > 0:
                raw_ret = (exit_price - entry_price) / entry_price
            else:
                raw_ret = (entry_price - exit_price) / entry_price
            pnl = (raw_ret * cfg.leverage) - (fee + slip)
            
            signals.append({
                "time": str(idx[entry_idx]),
                "side": "long" if side > 0 else "short",
                "entry_price": round(entry_price, rd),
                "exit_price": round(float(exit_price), rd),
                "exit_reason": exit_reason,
                "t_exit": str(idx[i]),          # â†  Ã‡IKIÅž ZAMANINI EKLE
                "tp_hit": bool(tp_hit),
                "sl_hit": bool(sl_hit),
                "bar_index_entry": int(entry_idx),
                "bar_index_exit": int(i),
                "pnl": round(float(pnl), 6),
                "fees_bps_round": round(float(fees_bps_round), 2),
                "slip_bps_round": round(float(slip_bps_round), 2),
                "funding_bps": None,

            })

        
            # i ÅŸu anda exit_idx; bir sonraki iterasyonda tekrar kontrol edilir (re-entry olabilir)
        else:
            # aÃ§Ä±k iÅŸlem kaydÄ±: TP/SL tik yok, PnL=0, Ã§Ä±kÄ±ÅŸ zamanÄ± yok
            signals.append({
                "time": str(idx[entry_idx]),
                "side": "long" if side > 0 else "short",
                "entry_price": round(entry_price, rd),
                "exit_price": None,
                "exit_reason": None,
                "t_exit": None,
                "tp_hit": False,
                "sl_hit": False,
                "bar_index_entry": int(entry_idx),
                "bar_index_exit": None,
                "pnl": 0.0,
                "fees_bps_round": round(float(fees_bps_round), 2),
                "slip_bps_round": round(float(slip_bps_round), 2),
                "funding_bps": None,
            })
            i += 1  # veri sonuna kadar kapatmadÄ±ysak bir bar ilerle

    return signals


def stats_from_signals_ordi(signals: List[Dict[str, Any]], tp: float, sl: float, leverage: float) -> Dict[str, float]:
    if not signals:
        return {"profit": 0.0, "winRate": 0.0, "trades": 0, "wins": 0, "losses": 0, "sharpe": 0.0, "maxDD": 0.0, "pf": 0.0}
    wins = sum(1 for s in signals if s["exit_reason"] == "tp")
    losses = sum(1 for s in signals if s["exit_reason"] == "sl")
    trades = wins + losses

    win_mult  = 0.998 + (tp * leverage)
    loss_mult = 0.998 - ((sl + 0.0004) * leverage)
    total_profit = (win_mult ** wins) * (loss_mult ** losses) - 1.0
    profit_pct = float(total_profit * 100.0)

    ret = np.array([float(s["pnl"]) for s in signals], dtype=float)
    std = float(ret.std(ddof=0)) if ret.size > 1 else 0.0
    mean = float(ret.mean()) if ret.size else 0.0
    sharpe = (mean / (std + 1e-12)) * np.sqrt(max(ret.size, 1))

    eq = ret.cumsum()
    peak = np.maximum.accumulate(eq)
    dd = (eq - peak)
    maxDD = float(dd.min() * 100.0)

    gains = float(ret[ret > 0].sum())
    losses_abs = float(-ret[ret <= 0].sum())
    pf = gains / (losses_abs + 1e-12)

    winRate = (wins / trades * 100.0) if trades else 0.0
    return {"profit": profit_pct, "winRate": winRate, "trades": int(trades), "wins": int(wins),
            "losses": int(losses), "sharpe": float(sharpe), "maxDD": float(maxDD), "pf": float(pf)}

# -----------------------------------------------------------------------------
# Vectorized backtest core (Adım-1)
# -----------------------------------------------------------------------------
def _series_to_intent(raw: pd.Series, side: int, respect_expr_sign: bool=True) -> pd.Series:
    """Map expression result to intent series in {-1,0,+1}.
    - If respect_expr_sign and raw has negatives → sign(raw)
    - Else treat raw as boolean: True -> side, False -> 0
    """
    if respect_expr_sign:
        vals = pd.to_numeric(raw, errors="coerce").fillna(0.0).astype(float)
        if (vals < 0).any() or (vals > 1).any():
            out = np.sign(vals).astype(int)
            return pd.Series(out, index=raw.index)
    # boolean mask path
    mask = raw.astype(bool).astype(int) * int(np.sign(side) if side != 0 else 1)
    return pd.Series(mask, index=raw.index).astype(int)


# ---- pydantic v1/v2 uyumlu şema tanımı ----

try:
    # Pydantic v2
    from pydantic import BaseModel, ConfigDict
    V2 = True
except Exception:
    # Pydantic v1
    from pydantic import BaseModel  # type: ignore
    V2 = False

class BacktestRunReqPlusBase(BaseModel):
    symbol: str
    timeframe: str
    start: str
    end: str
    expr: str
    side: int = 1
    indicators: Dict[str, Any] = {}
    params: Dict[str, Any] = {}
    leverage: float = 1.0
    fee_pct: float = 0.0
    slippage_pct: float = 0.0
    mode: Optional[str] = None  # "vectorized" | "event" (UI'dan bilgi amaçlı)


    exit_scheme: Optional[ExitSchemeEvt] = None


# Pydantic sürümüne göre sadece config katmanı
if V2:
    class BacktestRunReqPlus(BacktestRunReqPlusBase):
        model_config = ConfigDict(extra='ignore')
else:
    class BacktestRunReqPlus(BacktestRunReqPlusBase):
        class Config:
            extra = 'ignore'


# -----------------------------------------------------------------------------
# Schemas
# -----------------------------------------------------------------------------

class BacktestRunReq(BaseModel):
    symbol: str
    timeframe: str
    start: str
    end: str

    indicators: Dict[str, Any] = Field(default_factory=dict)
    expr: str
    params: Dict[str, Any] = Field(default_factory=dict)

    # fixed TP/SL zorunlu
    tp: confloat(ge=0.0)
    sl: confloat(ge=0.0)

    leverage: confloat(gt=0.0) = 1.0
    fee_pct: confloat(ge=0.0) = 0.0          # yüzde (örn. 0.1 = %0.1)
    slippage_pct: confloat(ge=0.0) = 0.0

    side: conint(le=1, ge=-1) = Field(1, description="1=long, -1=short (expr bool ise yön)")
    respect_expr_sign: bool = True
    round_digits: conint(ge=0) = 2

    mode: Optional[Literal["vectorized", "event"]] = None

    maker_bps: Optional[confloat(ge=0.0)] = None
    taker_bps: Optional[confloat(ge=0.0)] = None
    slip_bps: Optional[confloat(ge=0.0)] = None
    funding_bps_interval: Optional[confloat(ge=0.0)] = None
    funding_interval_hours: Optional[conint(ge=1)] = None

    data_snapshot_id: Optional[str] = None

def _apply_trading_costs(entry_price, exit_price, side, lev, fee_pct, slip_pct):
    """
    Trading costs uygula: fee + slippage
    side: 1 = long, -1 = short
    """
    # Raw PnL (leveragesiz)
    if side > 0:  # LONG
        raw_pnl = (exit_price - entry_price) / entry_price
    else:  # SHORT
        raw_pnl = (entry_price - exit_price) / entry_price
    
    # Leverage uygula
    leveraged_pnl = raw_pnl * float(lev or 1.0)
    
    # Fee ve slippage uygula (round-trip)
    # Fee: giriş + çıkış = 2 * fee_pct
    # Slippage: giriş + çıkış = 2 * slip_pct
    total_costs = (2 * fee_pct) + (2 * slip_pct)
    
    net_pnl = leveraged_pnl - total_costs
    
    return net_pnl

class DataSnapshotReq(BaseModel):
    symbol: str; timeframe: str; start: str; end: str
    indicators: Dict[str, Any] = {}

class ExprValidateReq(BaseModel):
    symbol: str; timeframe: str; start: str; end: str
    expr: str
    params: Dict[str, Any] = {}
    indicators: Dict[str, Any] = {}
    respect_expr_sign: bool = True
    snapshot_id: Optional[str] = None
    

def _bb_level_at(df, i, n=20, std=2.0, ma="SMA", side="upper"):
    if i < n - 1:
        return None  # Yeterli veri yok
    
    window = df["close"].iloc[i - n + 1: i + 1]
    
    if ma.upper() == "EMA":
        mid = window.ewm(span=n, adjust=False).mean().iloc[-1]
    else:
        mid = window.rolling(n).mean().iloc[-1]
    
    std_dev = window.rolling(n).std(ddof=1).iloc[-1]
    
    if side.lower() == "mid":
        return mid
    elif side.lower() == "upper":
        return mid + std * std_dev
    else:  # lower
        return mid - std * std_dev
# -----------------------------------------------------------------------------
@app.get("/health")
def health():
    return {"ok": True}

@app.get("/optimize/methods/catalog")
def get_optimizer_methods_catalog():
    methods = [
        {
            "id": "grid",
            "name": "Grid Search",
            "params": [
                {"key": "max_iterations", "label": "Max Iterations", "type": "int", "default": 500}
            ]
        },
        {
            "id": "random",
            "name": "Random Search",
            "params": [
                {"key": "max_iterations", "label": "Max Samples", "type": "int", "default": 2000}
            ]
        }
    ]
    if LIBRARIES_INSTALLED:
        methods.extend([
            {
                "id": "bayesian",
                "name": "Bayesian (GP)",
                "params": [
                    {"key": "n_calls", "label": "Number of Calls", "type": "int", "default": 150},
                    # YENİ EKLENDİ: Başlangıçtaki rastgele arama sayısını belirler.
                    {"key": "n_initial_points", "label": "Initial Random Points", "type": "int", "default": 10}
                ]
            },
            {
                "id": "genetic",
                "name": "Genetic Algorithm",
                "params": [
                    {"key": "max_num_iteration", "label": "Iterations", "type": "int", "default": 100},
                    {"key": "population_size", "label": "Population Size", "type": "int", "default": 20},
                    {"key": "mutation_probability", "label": "Mutation Probability", "type": "float", "default": 0.1},
                    # YENİ EKLENDİ: En iyi çözümlerin ne kadarının doğrudan sonraki nesle aktarılacağı.
                    {"key": "elit_ratio", "label": "Elitism Ratio", "type": "float", "default": 0.01}
                ]
            },
            {
                "id": "tpe",
                "name": "TPE (Optuna)",
                "params": [
                    {"key": "n_trials", "label": "Number of Trials", "type": "int", "default": 200},
                    # YENİ EKLENDİ: TPE'nin model kurmadan önce yapacağı rastgele deneme sayısı.
                    {"key": "n_startup_trials", "label": "Startup Trials (Random)", "type": "int", "default": 10}
                ]
            },
            {
                "id": "cmaes",
                "name": "CMA-ES (Optuna)",
                "params": [
                    {"key": "n_trials", "label": "Number of Trials", "type": "int", "default": 200}
                ]
            },
            {
                "id": "annealing",
                "name": "Simulated Annealing",
                "params": [
                    {"key": "maxiter", "label": "Max Iterations", "type": "int", "default": 1000},
                    # YENİ EKLENDİ: Algoritmanın başlangıçtaki keşif gücünü ayarlar.
                    {"key": "initial_temp", "label": "Initial Temperature", "type": "float", "default": 5230}
                ]
            }
        ])
    return {"methods": methods}

@app.get("/data/ohlcv")
def data_ohlcv(symbol: str, timeframe: str, start: str, end: str):

    df = load_ohlcv(symbol, timeframe, start, end)
    head = df.head(5).reset_index()
    tail = df.tail(5).reset_index()
    return {
        "symbol": symbol, "timeframe": timeframe, "rows": int(len(df)),
        "from": str(df.index[0]) if len(df) else None,
        "to": str(df.index[-1]) if len(df) else None,
        "head": head.to_dict(orient="records"),
        "tail": tail.to_dict(orient="records"),
    }
@app.post("/expr/validate")
def expr_validate(req: ExprValidateReq):
    try:
        # snapshot varsa (snapshot_id veya data_snapshot_id) ondan al, yoksa normal yükle
        sid = getattr(req, "snapshot_id", None) or getattr(req, "data_snapshot_id", None)
        if sid and sid in SNAPSHOT_STORE:
            df0 = SNAPSHOT_STORE[sid]["df"].copy()
        else:
            df0 = load_ohlcv(req.symbol, req.timeframe, req.start, req.end)
       


        df = compute_indicators(df0, timeframe=req.timeframe, **(req.indicators or {}))
        s = eval_expr(df, req.expr, req.params or {})
        n = int(len(df))

        # coverage hesabı (bool ise True oranı; işaret serisiyse !=0 oranı)
        ss = pd.Series(s)
        if ss.dropna().isin([True, False, 0, 1]).all() and ss.dtype != float:
            coverage = float(ss.fillna(False).astype(bool).mean())
        else:
            vals = pd.to_numeric(ss, errors="coerce")
            coverage = float((vals.fillna(0) != 0).mean())

        # tetik değişimi kaba sayacı (bilgi amaçlı)
        triggers = int((ss.astype(float).fillna(0).diff().abs() > 0).sum())

        return {
            "ok": True,
            "rows": n,
            "coverage": round(coverage, 4),
            "triggers": triggers,
            "sanitized": _sanitize_expr(req.expr),
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"expr_validate failed: {type(e).__name__}: {e}")


class SnapshotReq(BaseModel):
    symbol: str
    timeframe: str
    start: str
    end: str

from uuid import uuid4
from fastapi import HTTPException

@app.post("/data/snapshot")
def create_snapshot(req: SnapshotReq):
    try:
        df = load_ohlcv(req.symbol, req.timeframe, req.start, req.end)
        if df is None or len(df) == 0:
            raise HTTPException(status_code=404, detail="no data for given window")

        # Index garanti: datetime & sıralı
        if not isinstance(df.index, pd.DatetimeIndex):
            try:
                df.index = pd.to_datetime(df.index, utc=False)
            except Exception:
                raise HTTPException(status_code=400, detail="data index must be datetime-like")
        df = df.sort_index()

        # Snapshot ID
        try:
            sid = _make_snapshot_id()
        except NameError:
            sid = uuid4().hex

        # İsteğe bağlı RAM cache (reload’da uçabilir)
        SNAPSHOT_STORE[sid] = {
            "df": df.copy(),
            "meta": {
                "symbol": req.symbol,
                "timeframe": req.timeframe,
                "start": req.start,
                "end": req.end,
                "rows": int(len(df)),
            },
        }

        # Diske persist (parquet, gerekirse csv fallback)
        try:
            register_snapshot_df(sid, df)  # parquet kaydeder
        except Exception as pe:
            # Parquet yoksa CSV'ye düş
            path_csv = _snapshot_path(sid, "csv")
            try:
                df.to_csv(path_csv)
                register_snapshot_file(sid, path_csv)
            except Exception as ce:
                raise HTTPException(status_code=500, detail=f"snapshot persist failed (parquet:{pe}) (csv:{ce})")

        return {
            "snapshot_id": sid,
            "rows": int(len(df)),
            "start": req.start,
            "end": req.end,
            "timeframe": req.timeframe,
            "symbol": req.symbol,
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"snapshot failed: {type(e).__name__}: {e}")

# (opsiyonel) eski FE çağrıları için alias
@app.post("/data/fetch")
def data_fetch_alias(req: SnapshotReq):
    return create_snapshot(req)

@app.get("/data/snapshot/{snapshot_id}")
def get_snapshot(snapshot_id: str, preview: int = 500):
    try:
        if snapshot_id not in SNAPSHOT_STORE:
            raise HTTPException(status_code=404, detail="snapshot not found")
        df0 = SNAPSHOT_STORE[snapshot_id]["df"]
        m = SNAPSHOT_STORE[snapshot_id]["meta"]
        tail = df0.tail(preview).reset_index().rename(columns={"index":"time"})
        tail["time"] = tail["time"].astype(str)
        return {
            "snapshot_id": snapshot_id,
            "meta": m,
            "bars": tail[["time","open","high","low","close","volume"]].to_dict("records")
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"get_snapshot failed: {type(e).__name__}: {e}")
# ========= WFO (Walk-Forward Optimization) =========

# =========================
# Walk-Forward Optimization (WFO) Skeleton
# =========================
from typing import  Tuple
from pydantic import BaseModel

# --- Req modeli (alan adlarını senin dosyana göre uyarlayabilirsin)
class WFOReq(BaseModel):
    symbol: str
    timeframe: str
    start: Optional[str] = None
    end: Optional[str] = None

    expr: str                              # strateji ifadesi
    params: Optional[Dict] = None          # temel paramlar (varsayılanlar)
    grid: Optional[List[Dict]] = None      # grid listesi (her biri param dict)
    method: Optional[str] = "grid"         # "grid" | "random" | "bayesian" | "genetic" | "tpe" | "cmaes"
    method_params: Optional[Dict] = None   # yönteme özel ayarlar

    indicators: Optional[Dict] = None
    side: int = 1                          # long=1 / short=-1 / both=0
    respect_expr_sign: bool = True

    tp: float = 0.0
    sl: float = 0.0
    leverage: float = 1.0
    fee_pct: float = 0.0
    slippage_pct: float = 0.0
    maker_bps: Optional[float] = None
    taker_bps: Optional[float] = None
    slip_bps: Optional[float] = None

    # WFO bölmeleri
    train_len: int
    test_len: int
    step_len: Optional[int] = None
    purge_bars: int = 0

    objective: str = "profit"              # "profit" | "sharpe" | "winrate" | "pf" | "J"
    min_trades: int = 0


def _build_wfo_folds(nbars: int, train_len: int, test_len: int, step_len: Optional[int]) -> List[Dict]:
    """Kaydırmalı train/test blokları: [train_lo:train_hi) -> [test_lo:test_hi)"""
    if step_len is None or step_len <= 0:
        step_len = test_len
    out = []
    i = 0
    while True:
        train_lo = i
        train_hi = i + train_len
        test_lo  = train_hi
        test_hi  = train_hi + test_len
        if test_hi > nbars:  # test penceresi tamamlanamıyorsa bitir
            break
        out.append(dict(train_lo=train_lo, train_hi=train_hi, test_lo=test_lo, test_hi=test_hi))
        i += step_len
    return out


def _compute_objective(stats: dict, kind: str):
    """Tek metrik skoru (senin mevcut fonksiyonunun aynası)."""
    # profit/winRate/trades/sharpe/pf bekleniyor
    trades = float(stats.get("trades", 0) or 0)
    win = float(stats.get("winRate", stats.get("win_rate", 0)) or 0) / \
          (100.0 if stats.get("winRate", None) is not None else 1.0)
    profit = float(stats.get("profit", stats.get("profit_pct", 0)) or 0) / \
             (100.0 if stats.get("profit", None) is not None else 1.0)
    sharpe = float(stats.get("sharpe", 0) or 0)
    pf = float(stats.get("pf", stats.get("profitFactor", 0)) or 0)

    k = (kind or "J").lower()
    if k == "sharpe": return sharpe
    if k in ("pf", "profitfactor"): return pf
    if k in ("profit", "cagr", "ret"): return profit
    if k in ("winrate", "wr"): return win
    # J = N * P̄ * WR
    pbar = (profit / trades) if trades > 0 else 0.0
    return trades * pbar * win
# (bkz. dokündeki eşdeğer uygulama)  # :contentReference[oaicite:3]{index=3}


def _series_to_intent(raw: pd.Series, side: int, respect_expr_sign: bool) -> pd.Series:
    """Expr çıktısından {-1,0,1} intent; imzana uygun sade dönüştürücü."""
    if respect_expr_sign:
        s = np.sign(raw).astype(int)
    else:
        # eşik >0 giriş vb. gibi bir basitleştirme
        s = (raw > 0).astype(int)
    if side > 0:
        return (s > 0).astype(int)             # long only: {0,1}
    if side < 0:
        return (s < 0).astype(int) * -1        # short only: {0,-1}
    return s                                    # both: {-1,0,1}


def _eval_one(df_slice: pd.DataFrame, req: WFOReq, cand_params: dict):
    """
    Tek dilimde koş: indikatörleri üret → expr'ü çalıştır → intent → walkforward_signals → stats.
    Not: Senin akışınla aynı: compute_indicators → eval_expr → _series_to_intent → walkforward_signals → stats_from_signals_ordi
    """
    if df_slice is None or len(df_slice) == 0:
        return {"stats": {"profit": 0, "winRate": 0, "trades": 0}, "signals": []}

    dfi = compute_indicators(df_slice, timeframe=req.timeframe, **(req.indicators or {}))
    raw = eval_expr(dfi, req.expr, {**(req.params or {}), **(cand_params or {})})
    entries = _series_to_intent(raw, side=req.side, respect_expr_sign=req.respect_expr_sign)  # :contentReference[oaicite:4]{index=4}

    cfg = RunConfig(
        tp=float(req.tp or 0), sl=float(req.sl or 0), leverage=float(req.leverage or 1),
        fee_pct=float(req.fee_pct or 0), slippage_pct=float(req.slippage_pct or 0),
        maker_bps=req.maker_bps, taker_bps=req.taker_bps, slip_bps=req.slip_bps,
    )
    signals = walkforward_signals(dfi, entries, cfg)  # :contentReference[oaicite:5]{index=5}

    # stats fonksiyonun bazı sürümlerde (tp,sl,lev) ister
    try:
        stats = stats_from_signals_ordi(signals, cfg.tp, cfg.sl, cfg.leverage)
    except TypeError:
        stats = stats_from_signals_ordi(signals)      # :contentReference[oaicite:6]{index=6}
    return {"stats": stats, "signals": signals}


def _call_method_backend(method: str, fdf: pd.DataFrame, bounds_a: Dict, conf: Dict,
                         cols: List[str], params: Optional[Dict]) -> List[Tuple[float, dict, dict]]:
    """
    Varsa senin dahili optimizasyonlarını çağır: _optimize_random_search/_grid/_bayesian/_genetic/_optuna
    Hepsi aynı tipte sonuç döndürmeli: [(score, misc, payload_dict), ...]
    """
    method = (method or "grid").lower()
    # Backends global isimle tanımlıysa yakala
    backends = {
        "random": globals().get("_optimize_random_search"),
        "grid":   globals().get("_optimize_grid_search"),
        "bayesian": globals().get("_optimize_bayesian"),
        "genetic":  globals().get("_optimize_genetic"),
        "tpe":      globals().get("_optimize_optuna"),
        "cmaes":    globals().get("_optimize_optuna"),
    }
    fn = backends.get(method)
    if fn is None:
        # fallback: grid yoksa random
        fn = backends.get("grid") or backends.get("random")
        method = "grid" if backends.get("grid") else "random"

    if method in ("tpe", "cmaes"):
        # optuna sampler_type geçir
        return fn(fdf, bounds_a, conf, cols, params or {}, sampler_type=method)
    else:
        return fn(fdf, bounds_a, conf, cols, params or {})


@app.post("/optimize/wfo")
def optimize_wfo(req: WFOReq):
    """
    Walk-Forward iskeleti:
      - train diliminde en iyi param’ı, seçili optimizasyon yöntemiyle bul
      - aynı param’ı test diliminde çalıştır
      - fold bazlı özet ve genel metrikleri döndür
    """
    # --- 0) veri
    df = load_ohlcv(req.symbol, req.timeframe, req.start, req.end)
    if df is None or len(df) == 0:
        raise HTTPException(status_code=400, detail="EMPTY_DATA")

    nbars = len(df)
    folds = _build_wfo_folds(nbars, req.train_len, req.test_len, req.step_len)
    if not folds:
        raise HTTPException(status_code=400, detail="NOT_ENOUGH_BARS_FOR_WFO")

    # --- 1) grid/param havuzu (yoksa tek set)
    grid = list(req.grid or [])
    if not grid:
        grid = [dict(req.params or {})]

    out_folds = []
    agg_obj = []
    agg_profit = []
    agg_wr = []
    agg_trades = []

    for k, f in enumerate(folds, start=1):
        tr = df.iloc[f["train_lo"]: f["train_hi"]]
        te = df.iloc[f["test_lo"]:  f["test_hi"]]

        # purge
        if req.purge_bars > 0:
            tr = tr.iloc[: max(0, len(tr) - req.purge_bars)]

        # === 2) TRAIN: en iyi adayı seç ===
        # Seçenek A) Sadece grid: cand_params = arg max
        # Seçenek B) Senin _optimize_* backends: payload içinden param’ı çek
        best = None
        best_obj = -1e18

        # “Basit grid tarama” (her zaman var)
        for cand in grid:
            res_tr = _eval_one(tr, req, cand)
            obj_tr = _compute_objective(res_tr["stats"], req.objective)
            if (res_tr["stats"].get("trades", 0) or 0) < req.min_trades:
                continue
            if obj_tr > best_obj:
                best_obj = obj_tr
                best = {"params": cand, "train_stats": res_tr["stats"], "train_obj": obj_tr}

        # “Gelişmiş backend” (varsa) ile aynı anda bir “aday havuzu” daha topla
        # bounds/conf/cols hazırlığı basit tutuldu
        try:
            dfi_train = compute_indicators(tr, timeframe=req.timeframe, **(req.indicators or {}))
            cols = [c for c in dfi_train.columns if np.issubdtype(dfi_train[c].dtype, np.number)]
            bounds_a = {}    # kendi aralığın varsa doldur
            conf = {"objective": req.objective, "min_trades": req.min_trades}
            heap = _call_method_backend(req.method, dfi_train, bounds_a, conf, cols, req.method_params)
            # heap: [(score, misc, payload), ...] bekleniyor
            # payload içinde "params" varsa al
            for sc, _misc, payload in (heap or []):
                cand = payload.get("params") or {}
                res_tr = _eval_one(tr, req, cand)
                obj_tr = _compute_objective(res_tr["stats"], req.objective)
                if (res_tr["stats"].get("trades", 0) or 0) < req.min_trades:
                    continue
                if obj_tr > best_obj:
                    best_obj = obj_tr
                    best = {"params": cand, "train_stats": res_tr["stats"], "train_obj": obj_tr}
        except Exception:
            # backend yoksa/başarısızsa grid sonucu ile devam
            pass

        if best is None:
            out_folds.append({
                "fold": k,
                "train": f"{f['train_lo']}:{f['train_hi']}",
                "test":  f"{f['test_lo']}:{f['test_hi']}",
                "skipped": True,
                "reason": "NO_CANDIDATE_PASSED_MIN_TRADES"
            })
            continue

        # === 3) TEST: seçilen param ile değerlendir ===
        res_te = _eval_one(te, req, best["params"])
        obj_te = _compute_objective(res_te["stats"], req.objective)

        out_folds.append({
            "fold": k,
            "train": f"{f['train_lo']}:{f['train_hi']}",
            "test":  f"{f['test_lo']}:{f['test_hi']}",
            "params": best["params"],
            "train_stats": best["train_stats"],
            "train_obj": best["train_obj"],
            "test_stats": res_te["stats"],
            "test_obj": obj_te,
            "n_signals_test": int(res_te["stats"].get("trades", 0) or 0),
        })

        agg_obj.append(obj_te)
        agg_profit.append(float(res_te["stats"].get("profit", 0.0) or 0.0))
        agg_wr.append(float(res_te["stats"].get("winRate", 0.0) or 0.0))
        agg_trades.append(float(res_te["stats"].get("trades", 0.0) or 0.0))

    # --- 4) Özet
    summary = {
        "folds": len(out_folds),
        "objective": req.objective,
        "avg_objective": float(np.mean(agg_obj)) if agg_obj else 0.0,
        "avg_profit":   float(np.mean(agg_profit)) if agg_profit else 0.0,
        "avg_winRate":  float(np.mean(agg_wr)) if agg_wr else 0.0,
        "sum_trades":   int(np.sum(agg_trades)) if agg_trades else 0,
    }
    return {"summary": summary, "folds": out_folds}
@app.get("/indicators/catalog")
def indicators_catalog():
    groups = [
        # --- Core / Mevcut ---
        {"id":"MACD","name":"MACD","params":[
            {"key":"macd_fast_default","label":"MACD Fast","def":6},
            {"key":"macd_slow_default","label":"MACD Slow","def":18},
            {"key":"macd_signal_default","label":"MACD Signal","def":9},
        ]},
        {"id":"SMA","name":"Simple Moving Average","params":[
            {"key":"sma_period","label":"SMA Period","def":21},
        ]},
        {"id":"EMA","name":"Exponential Moving Average","params":[
            {"key":"ema_period","label":"EMA Period","def":21},
        ]},
        {"id":"RSI","name":"Relative Strength Index","params":[
            {"key":"rsi_period","label":"RSI Period","def":340},
        ]},
        {"id":"BOLL","name":"Bollinger Bands","params":[
            {"key":"bb_period","label":"BB Length","def":20},
            {"key":"bb_std","label":"BB StdDev (k)","def":2.0},
        ]},
        {"id":"ADX","name":"ADX","params":[
            {"key":"adx_period","label":"ADX Period","def":11},
        ]},
        {"id":"ChaikinVol","name":"Chaikin Volatility","params":[
            {"key":"chaikin_vol_span","label":"EMA Span","def":10},
            {"key":"chaikin_vol_change","label":"Change Period","def":10},
        ]},
        {"id":"Momentum","name":"Momentum","params":[
            {"key":"mom_period","label":"Period","def":10},
        ]},
        {"id":"ROC","name":"Rate of Change","params":[
            {"key":"roc_period","label":"Period","def":10},
        ]},
        {"id":"MFI","name":"Money Flow Index","params":[
            {"key":"mfi_period","label":"Period","def":14},
        ]},
        {"id":"DeM","name":"DeMarker","params":[
            {"key":"dem_period","label":"Period","def":14},
        ]},
        {"id":"StochRSI","name":"Stochastic RSI","params":[
            {"key":"stoch_rsi_rsi_period","label":"RSI Period","def":14},
            {"key":"stoch_rsi_length","label":"Stoch Length","def":14},
            {"key":"stoch_rsi_smooth_k","label":"Smooth K","def":3},
            {"key":"stoch_rsi_smooth_d","label":"Smooth D","def":3},
        ]},
        {"id":"WeightedStd","name":"Weighted Std","params":[
          {"key":"weighted_std_win","label":"Window","def":20}
        ]},

        
        {"id":"NDMA","name":"NDMA","params":[
          { "key": "ndma_window", "label": "Window", "def": 20 }
        ]},
        {"id":"AwesomeOsc","name":"Awesome Oscillator","params":[
            {"key":"ao_fast","label":"Fast Period","def":5},
            {"key":"ao_slow","label":"Slow Period","def":34},
        ]},
        {"id":"Ichimoku","name":"Ichimoku Cloud","params":[
            {"key":"ichimoku_tenkan","label":"Tenkan-sen","def":9},
            {"key":"ichimoku_kijun","label":"Kijun-sen","def":26},
            {"key":"ichimoku_senkou_b","label":"Senkou Span B","def":52},
        ]},
        {"id":"WilliamsR","name":"Williams %R","params":[
            {"key":"williams_r_period","label":"Period","def":14},
        ]},
        {"id":"CCI","name":"Commodity Channel Index","params":[
            {"key":"cci_period","label":"CCI Period","def":20},
        ]},
        {"id":"OBV","name":"On Balance Volume","params":[
            {"key":"obv_anchor","label":"OBV Anchor","def":1}
            ]},

        # --- Basit grup örnekleri (mevcut) ---
        {"id":"trend_group","name":"TEMA","params":[
            {"key":"tema_period","label":"TEMA Period","def":21},
        ]},
        {"id":"momentum_group","name":"Ultimate Oscillator","params":[
            {"key":"uo_fast","label":"UO Fast","def":7},
            {"key":"uo_mid","label":"UO Mid","def":14},
            {"key":"uo_slow","label":"UO Slow","def":28},
        ]},
        {"id":"volume_group","name":"Chaikin Money Flow","params":[
            {"key":"cmf_period","label":"CMF Period","def":20},
        ]},

        # =====================  Eklenenler (hepsi tekilleştirilmiş) =====================

        # Volatilite / Kanallar
        {"id":"ATR","name":"Average True Range","params":[
            {"key":"atr_period","label":"ATR Period","def":14},
        ]},
        {"id":"Keltner","name":"Keltner Channels","params":[
            {"key":"keltner_ema","label":"EMA Period","def":20},
            {"key":"keltner_atr","label":"ATR Period","def":10},
            {"key":"keltner_multiplier","label":"ATR Multiplier","def":2.0},
        ]},
        {"id":"Donchian","name":"Donchian Channels","params":[
            {"key":"donchian_period","label":"Period","def":20},
        ]},

        # Trend / Stop
        {"id":"Supertrend","name":"Supertrend","params":[
            {"key":"supertrend_period","label":"ATR Period","def":10},
            {"key":"supertrend_multiplier","label":"Multiplier","def":3.0},
        ]},
        {"id":"PSAR","name":"Parabolic SAR","params":[
            {"key":"psar_step","label":"Step (AF Start)","def":0.02},
            {"key":"psar_increment","label":"AF Increment","def":0.02},
            {"key":"psar_max","label":"AF Maximum","def":0.2},
        ]},
        {"id":"Aroon","name":"Aroon","params":[
            {"key":"aroon_period","label":"Aroon Period","def":25},
        ]},
        {"id":"Vortex","name":"Vortex Indicator","params":[
            {"key":"vortex_period","label":"VI Period","def":14},
        ]},
        {"id":"LinearReg","name":"Linear Regression","params":[
            {"key":"linreg_period","label":"LR Period","def":14},
        ]},
        {"id":"HMA","name":"Hull Moving Average","params":[
            {"key":"hma_period","label":"HMA Period","def":16},
        ]},
        {"id":"ZLEMA","name":"Zero Lag EMA","params":[
            {"key":"zlema_period","label":"ZLEMA Period","def":21},
        ]},
        {"id":"KAMA","name":"Kaufman Adaptive MA","params":[
            {"key":"kama_er_n","label":"ER Period","def":10},
            {"key":"kama_fast","label":"Fast SC","def":2},
            {"key":"kama_slow","label":"Slow SC","def":30},
        ]},

        # Hacim / Fiyat-Hacim
        {"id":"VWAP","name":"Volume Weighted Avg Price","params":[
            {"key":"vwap_period","label":"Period (optional)","def":20},
            {"key":"vwap_session","label":"Session Reset (0=off)","def":0},
        ]},
        {"id":"VWMA","name":"Volume Weighted Moving Average","params":[
            {"key":"vwma_period","label":"VWMA Period","def":20},
        ]},
        {"id":"AccumDist","name":"Accumulation/Distribution","params":[
           {"key":"accumdist_anchor","label":"ADL Anchor","def":1}
           ]},

        # Momentum / Osilatörler
        {"id":"Stoch","name":"Stochastic (Slow)","params":[
            {"key":"stoch_k","label":"%K Length","def":14},
            {"key":"stoch_d","label":"%D Smoothing","def":3},
            {"key":"stoch_smooth","label":"%K Smoothing","def":3},
        ]},
        {"id":"KDJ","name":"KDJ Stochastic","params":[
            {"key":"kdj_k_period","label":"K Period","def":9},
            {"key":"kdj_d_period","label":"D Period","def":3},
            {"key":"kdj_j_period","label":"J Period","def":3},
        ]},
        {"id":"GAPO","name":"GAPO Indicator","params":[
            {"key":"gapo_period","label":"GAPO Period","def":20},    
        ]},
        {"id":"DMI","name":"Directional Movement Index","params":[
            {"key":"dmi_period","label":"DI Period","def":14},
            {"key":"dmi_adx_period","label":"ADX Period","def":14},
        ]},
        {"id":"RVI","name":"Relative Vigor Index","params":[
            {"key":"rvi_period","label":"RVI Period","def":10},
        ]},
        {"id":"CMO","name":"Chande Momentum Oscillator","params":[
            {"key":"cmo_period","label":"CMO Period","def":14},
        ]},
        {"id":"Coppock","name":"Coppock Curve","params":[
            {"key":"coppock_wma","label":"WMA Length","def":10},
            {"key":"coppock_roc1","label":"ROC1","def":14},
            {"key":"coppock_roc2","label":"ROC2","def":11},
        ]},
        
        {"id":"Schaff","name":"Schaff Trend Cycle","params":[
            {"key":"schaff_cycle","label":"Cycle","def":10},
            {"key":"schaff_fast","label":"Fast MA","def":23},
            {"key":"schaff_slow","label":"Slow MA","def":50},
        ]},
        {"id":"TRIX","name":"TRIX","params":[
            {"key":"trix_n","label":"Period","def":15},
            {"key":"trix_signal","label":"Signal","def":9},
        ]},
        {"id":"PPO","name":"Percentage Price Oscillator","params":[
            {"key":"ppo_fast","label":"Fast EMA","def":12},
            {"key":"ppo_slow","label":"Slow EMA","def":26},
            {"key":"ppo_signal","label":"Signal","def":9},
        ]},
        {"id":"PVO","name":"Percentage Volume Oscillator","params":[
            {"key":"pvo_fast","label":"Fast EMA","def":12},
            {"key":"pvo_slow","label":"Slow EMA","def":26},
            {"key":"pvo_signal","label":"Signal","def":9},
        ]},
        {"id":"Fisher","name":"Fisher Transform","params":[
            {"key":"fisher_period","label":"Period","def":10},
        ]},
        {"id":"ElderRay","name":"Elder Ray Index","params":[
            {"key":"elder_ema","label":"EMA Period","def":13},
        ]},
        {"id":"DPO","name":"Detrended Price Oscillator","params":[
            {"key":"dpo_n","label":"Period","def":20},
        ]},
        {"id":"MMI","name":"Market Meanness Index","params":[
            {"key":"mmi_period","label":"Lookback Period","def":100},
        ]},
        {"id":"VPT","name":"Volume Price Trend","params":[
            {"key":"vpt_anchor","label":"VPT Anchor","def":1}
            ]},
        {"id":"TSQZ","name":"Squeeze Momentum","params":[
            {"key":"squeeze_kclength","label":"KC Length","def":20},
            {"key":"squeeze_kcmult","label":"KC Multiplier","def":1.5},
            {"key":"squeeze_bblength","label":"BB Length","def":20},
            {"key":"squeeze_bbmult","label":"BB Multiplier","def":2.0},
        ]},
        {
                "id": "PriceChangeMins",
                "name": "Price Change ",
                "params": [
                    {"key": "price_change_mins",  "label": "Lookback (min) ", "def": 30},   
           
                ]},

        # İstatistik/Türev
        {"id":"ZScore","name":"Z-Score","params":[
            {"key":"zscore_period","label":"Z-Score Period","def":20},
        ]},
        {"id":"StandardError","name":"Standard Error","params":[
            {"key":"stderr_period","label":"StdErr Period","def":21},
        ]},

        # Fiyat Aksiyonu / Pivots / Fib
        {"id":"PivotPoints","name":"Pivot Points","params":[
            {"key":"pivot_timeframe","label":"Pivot TF","def":"D"},
        ]},
        {"id":"FibRetracement","name":"Fibonacci Retracement","params":[
            {"key":"fib_high_bars","label":"High Lookback","def":20},
            {"key":"fib_low_bars","label":"Low Lookback","def":20},
        ]},

        # Fraktal
        {"id":"Fractals","name":"Bill Williams Fractals","params":[
            {"key":"fractal_n","label":"Window","def":2},
        ]},
        # --- Difference Set ---

        {
            "id": "RSI_Diff",
            "name": "RSI Difference (short - long)",
            "params": [
                {"key": "rsi_short", "label": "RSI Short", "def": 10},
                {"key": "rsi_long",  "label": "RSI Long",  "def": 60}
            ]
        },
        {
            "id": "StochKD_Diff",
            "name": "Stoch %K - %D Diff",
            "params": [
                {"key": "stoch_k",     "label": "%K Length",   "def": 14},
                {"key": "stoch_smooth",  "label": "%K Smoothing","def": 3},
                {"key": "stoch_d",     "label": "%D Smoothing","def": 3}
            ]
        },
        {
            "id": "PPO_Diff",
            "name": "PPO - Signal Diff",
            "params": [
                {"key": "ppo_fast",   "label": "Fast EMA", "def": 12},
                {"key": "ppo_slow",   "label": "Slow EMA", "def": 26},
                {"key": "ppo_signal", "label": "Signal",   "def": 9}
            ]
        },
        {
            "id": "TRIX_Diff",
            "name": "TRIX - Signal Diff",
            "params": [
                {"key": "trix_n",      "label": "TRIX Period", "def": 15},
                {"key": "trix_signal", "label": "Signal",      "def": 9}
            ]
        },
        {
            "id": "PriceVsSMA",
            "name": "Close - SMA Deviation",
            "params": [
                {"key": "pvs_sma_period", "label": "SMA Period", "def": 20}
            ]
        },
        {
            "id": "PriceVsVWAP",
            "name": "Close - VWAP Deviation",
            "params": [
                {"key": "pvs_vwap_period", "label": "VWAP Period", "def": 20}
            ]
        },
        {
            "id": "Supertrend_Dev",
            "name": "Close - Supertrend Deviation",
            "params": [
                {"key": "supertrend_period",     "label": "ATR Period", "def": 10},
                {"key": "supertrend_multiplier", "label": "Multiplier", "def": 3.0}
            ]
        },
        {
            "id": "Ichimoku_TK_Diff",
            "name": "Ichimoku Tenkan - Kijun Diff",
            "params": [
                {"key": "ichimoku_tenkan", "label": "Tenkan", "def": 9},
                {"key": "ichimoku_kijun",  "label": "Kijun",  "def": 26}
            ]
        },
        {
            "id": "Vortex_Diff",
            "name": "Vortex Diff (VI+ - VI-)",
            "params": [
                {"key": "vortex_period", "label": "VI Period", "def": 14}
            ]
        },

        
    ]

    return {"groups": groups}


   
# ---- optimize utils
def grid_values(minv, maxv, step):
    if step == 0: return [minv]
    n = max(1, int(round((maxv - minv) / step)) + 1)
    return [minv + i*step for i in range(n)]

def iter_param_space(opt: Dict[str, Any], limit: Optional[int]=None):
    if not opt:
        yield {}; return
    keys = list(opt.keys()); grids=[]
    for k in keys:
        o = opt[k]
        if "list" in o: grids.append(list(o["list"]))
        else: grids.append(grid_values(float(o["min"]), float(o["max"]), float(o["step"])))
    for i, vals in enumerate(itertools.product(*grids)):
        if limit is not None and i >= limit: break
        yield dict(zip(keys, vals))

def random_space(opt: Dict[str, Any], samples: int):
    if not opt:
        for _ in range(samples): yield {}; return
    for _ in range(samples):
        cand = {}
        for k, o in opt.items():
            if "list" in o:
                cand[k] = random.choice(list(o["list"]))
            else:
                lo, hi, st = float(o["min"]), float(o["max"]), float(o["step"])
                if st > 0:
                    n = max(0, int((hi - lo) / st))
                    cand[k] = lo + random.randint(0, n) * st
                else:
                    cand[k] = random.uniform(lo, hi)
        yield cand

def _camelize_stats_row(row: Dict[str, Any]) -> Dict[str, Any]:
    m = {"win_rate":"winRate","max_dd":"maxDD","profit_factor":"pf"}
    return {m.get(k,k): v for k,v in row.items()}
# --- In-memory snapshot store (dev/use) ---
SNAPSHOTS: Dict[str, pd.DataFrame] = {}
SNAPSHOT_SEQ = itertools.count(1)

@app.post("/data/snapshot")
def data_snapshot(req: DataSnapshotReq):
    df0 = load_ohlcv(req.symbol, req.timeframe, req.start, req.end)
    df = compute_indicators(df0, timeframe=req.timeframe, **(req.indicators or {}))
    sid = f"snap-{next(SNAPSHOT_SEQ)}"
    SNAPSHOTS[sid] = df
    head = df.head(5).reset_index()
    tail = df.tail(5).reset_index()
    return {
        "snapshot_id": sid,
        "rows": int(len(df)),
        "from": str(df.index[0]) if len(df) else None,
        "to": str(df.index[-1]) if len(df) else None,
        "head": head.to_dict(orient="records"),
        "tail": tail.to_dict(orient="records"),
    }

@app.get("/data/snapshot/{snapshot_id}")
def data_snapshot_get(snapshot_id: str):
    df = SNAPSHOTS.get(snapshot_id)
    if df is None:
        raise HTTPException(status_code=404, detail="snapshot not found")
    head = df.head(5).reset_index()
    tail = df.tail(5).reset_index()
    return {
        "snapshot_id": snapshot_id,
        "rows": int(len(df)),
        "from": str(df.index[0]) if len(df) else None,
        "to": str(df.index[-1]) if len(df) else None,
        "head": head.to_dict(orient="records"),
        "tail": tail.to_dict(orient="records"),
    }
CATALOG = [g for g in indicators_catalog()["groups"]]
ALLOWED = {p["key"] for g in CATALOG for p in g["params"]}

# ===== /backtest (scheme-aware) =====
from pydantic import BaseModel




def simulate_scheme_over_entries(
    df, symbol, entries, side, lev, sch, sgn_series=None,
    fee_pct: float = 0.0, slippage_pct: float = 0.0,
):
    """
    Mode-1: Entry = sinyal barının KAPANIŞI (close); aynı barda TP/SL kontrol edilir.
    Masraf: fee+slippage hem giriş hem çıkışta uygulanır => net_cost = 2 * (fee + slip).
    TP/SL bayrakları:
      - fixed/atr/bollinger: tetiklenen olaya göre (tp/sl) işaretlenir.
      - chandelier/trailing: TP kavramı yok; kârlı çıkış = tp_hit, zararlı çıkış = sl_hit.
    
    DÜZELTMELER:
      - Pozisyon açıkken yeni sinyaller ignore edilir
      - Aynı barda çelişkili sinyaller ignore edilir
      - Masraf hesaplaması düzeltildi
    """

    # ---------- helpers ----------
    def _atr_series(_df, n: int) -> pd.Series:
        h, l, c = _df["high"], _df["low"], _df["close"]
        tr = np.maximum.reduce([
            (h - l).to_numpy(),
            (h - c.shift(1)).abs().to_numpy(),
            (l - c.shift(1)).abs().to_numpy(),
        ])
        return pd.Series(tr, index=_df.index).rolling(int(n), min_periods=int(n)).mean()

    def _bb_levels_at(i: int, n: int, std_k: float, ma: str = "SMA"):
        """Sadece geçmişi kullanarak i'nci bar için BB mid/upper/lower (ddof=0)."""
        n = int(n); std_k = float(std_k)
        win = df["close"].iloc[max(0, i - n + 1): i + 1]
        if len(win) < n:
            return None, None, None
        if (ma or "SMA").upper() == "EMA":
            mid = win.ewm(span=n, adjust=False).mean().iloc[-1]
        else:
            mid = win.rolling(n).mean().iloc[-1]
        dev = win.rolling(n).std(ddof=0).iloc[-1]
        up  = mid + std_k * dev
        lo  = mid - std_k * dev
        return float(mid), float(up), float(lo)

    def _stamp(i: int):
        ts = df.index[i]
        try:    return ts.isoformat()
        except: return str(ts)

    # price precision (ccxt markets'ten)
    price_precision = get_price_precision(symbol)

    def _round_px(px: float, p: int) -> float:
        if p is None: return float(px)
        q = 10 ** int(p)
        return round(float(px) * q) / q

    # ---------- costs & setup ----------
    fee  = float(fee_pct or 0.0) / 100.0
    slip = float(slippage_pct or 0.0) / 100.0
    net_cost = 2.0 * (fee + slip)  # DÜZELTME: 2*(fee+slip)

    trades = []
    default_sgn = 1 if side > 0 else -1
    stop_first = bool(getattr(sch, "stop_first", True))

    in_pos   = False
    pos_sgn  = None
    entry_i  = None
    entry_ts = None
    entry_px = None
    tp = sl = None
    highest = lowest = None

    # ATR ön-hazırlık (ATR şeması için)
    atr_pre = _atr_series(df, int(getattr(sch, "atr_n", 14))) if getattr(sch, "type", None) == "atr" else None

    for i in range(len(df)):
        h = float(df["high"].iat[i]); l = float(df["low"].iat[i]); c = float(df["close"].iat[i])

        # ---------------- IN-POSITION: EXIT KONTROLÜ ----------------
        if in_pos:
            sgn = pos_sgn

            # seviyeleri güncelle
            if sch.type == "trailing_pct":
                frac = float(getattr(sch, "trail_pct", 0.01) or 0.01)
                if sgn > 0:
                    highest = max(highest, h)
                    sl = highest * (1 - frac)
                else:
                    lowest  = min(lowest,  l)
                    sl = lowest * (1 + frac)
                tp = None  # trailing'de TP yok

            elif sch.type == "bollinger":
                n   = int(getattr(sch, "n", 20) or 20)
                std = float(getattr(sch, "std", 2.0) or 2.0)
                ma  = getattr(sch, "ma", "SMA") or "SMA"
                mid, up, lo = _bb_levels_at(i, n, std, ma)
                if up is not None:
                    if sgn > 0:  # long
                        tp, sl = up, lo
                    else:        # short
                        tp, sl = lo, up

            elif sch.type == "chandelier":
                ch_n = int(getattr(sch, "n", 22) or 22)
                ch_k = float(getattr(sch, "factor", 3.0) or 3.0)
                atr_ch = _atr_series(df, ch_n)
                if not pd.isna(atr_ch.iat[i]):
                    if sgn > 0:
                        hh = df["high"].rolling(ch_n, min_periods=ch_n).max()
                        sl = float(hh.iat[i] - ch_k * atr_ch.iat[i])
                    else:
                        ll = df["low"].rolling(ch_n, min_periods=ch_n).min()
                        sl = float(ll.iat[i] + ch_k * atr_ch.iat[i])
                tp = None  # chandelier'da TP yok

            # tetik kontrolleri
            hit_tp = (tp is not None) and ((sgn > 0 and h >= tp) or (sgn < 0 and l <= tp))
            hit_sl = (sl is not None) and ((sgn > 0 and l <= sl) or (sgn < 0 and h >= sl))

            if hit_tp or hit_sl:
                if hit_tp and hit_sl:
                    exit_px = sl if stop_first else tp
                    reason  = "sl" if stop_first else "tp"
                elif hit_tp:
                    exit_px = tp; reason = "tp"
                else:
                    exit_px = sl; reason = "sl"

                # PnL (oran) + masraf
                raw = (exit_px - entry_px)/entry_px if sgn > 0 else (entry_px - exit_px)/entry_px
                pnl = raw * float(lev or 1.0) - net_cost

                # TP/SL bayraklarını exit tipine göre yaz,
                # trailing/chandelier için kâr/zarara göre görsel tick at.
                if sch.type in ("trailing_pct", "chandelier"):
                    tp_hit = pnl >= 0
                    sl_hit = pnl < 0
                else:
                    tp_hit = (reason == "tp")
                    sl_hit = (reason == "sl")

                tstamp = _stamp(i)
                trades.append({
                    "ts": tstamp, "time": tstamp,
                    "entry_ts": entry_ts, "exit_ts": tstamp,
                    "side": "long" if sgn > 0 else "short",
                    "entry": _round_px(entry_px, price_precision),
                    "exit":  _round_px(float(exit_px), price_precision),
                    "price_precision": int(price_precision),
                    "pnl": pnl,
                    "exit_reason": reason,
                    "tp_hit": bool(tp_hit),
                    "sl_hit": bool(sl_hit),
                    "entry_i": int(entry_i) if entry_i is not None else None,
                })

                # reset
                in_pos = False
                pos_sgn = None
                entry_i = None
                entry_ts = None
                entry_px = None
                tp = sl = None
                highest = lowest = None
                continue

        # ---------------- OUT-OF-POSITION: ENTRY KONTROLÜ ----------------
        # Pozisyon açıkken yeni sinyalleri ignore et
        if in_pos:
            continue
            
        # Sinyal var mı?
        if not bool(entries.iat[i]):
            continue

        # Sinyal yönünü belirle
        if sgn_series is not None:
            current_sgn = int(np.sign(sgn_series.iat[i]) or 0)
            if current_sgn == 0:
                continue  # Çelişkili sinyal veya sinyal yok
            sgn = current_sgn
        else:
            sgn = default_sgn

        # Side filtresi uygula
        if side > 0 and sgn <= 0:
            continue  # Long-only mode, ama short sinyal
        if side < 0 and sgn >= 0:
            continue  # Short-only mode, ama long sinyal

        # Pozisyon aç
        pos_sgn  = sgn
        entry_i  = i
        entry_ts = _stamp(i)
        entry_px = float(df["close"].iat[i])  # sinyal barı kapanışı

        # başlangıç seviyeleri
        tp = sl = None
        entry_valid = True  # Pozisyon açılabilir mi?
        
        if sch.type == "fixed":
            tp_pct = float(getattr(sch, "tp_pct", 0.0) or 0.0)
            sl_pct = float(getattr(sch, "sl_pct", 0.0) or 0.0)
            if sgn > 0:
                tp = entry_px * (1 + tp_pct); sl = entry_px * (1 - sl_pct)
            else:
                tp = entry_px * (1 - tp_pct); sl = entry_px * (1 + sl_pct)

        elif sch.type == "atr":
            if atr_pre is None or pd.isna(atr_pre.iat[i]):
                entry_valid = False
            else:
                a   = float(atr_pre.iat[i])
                mtp = float(getattr(sch, "m_tp", 0.0) or 0.0)
                ksl = float(getattr(sch, "k_sl", 0.0) or 0.0)
                if sgn > 0:
                    tp = entry_px + mtp * a; sl = entry_px - ksl * a
                else:
                    tp = entry_px - mtp * a; sl = entry_px + ksl * a

        elif sch.type == "bollinger":
            n   = int(getattr(sch, "n", 20) or 20)
            std = float(getattr(sch, "std", 2.0) or 2.0)
            ma  = getattr(sch, "ma", "SMA") or "SMA"
            mid, up, lo = _bb_levels_at(i, n, std, ma)
            if (up is None) or (lo is None):
                entry_valid = False
            else:
                if sgn > 0:
                    tp, sl = up, lo
                else:
                    tp, sl = lo, up

        elif sch.type == "trailing_pct":
            frac = float(getattr(sch, "trail_pct", 0.01) or 0.01)
            sl = entry_px * (1 - frac) if sgn > 0 else entry_px * (1 + frac)
            tp = None

        elif sch.type == "chandelier":
            ch_n = int(getattr(sch, "n", 22) or 22)
            ch_k = float(getattr(sch, "factor", 3.0) or 3.0)
            atr_ch = _atr_series(df, ch_n)
            if pd.isna(atr_ch.iat[i]):
                entry_valid = False
            else:
                if sgn > 0:
                    hh = df["high"].rolling(ch_n, min_periods=ch_n).max()
                    sl = float(hh.iat[i] - ch_k * atr_ch.iat[i])
                else:
                    ll = df["low"].rolling(ch_n, min_periods=ch_n).min()
                    sl = float(ll.iat[i] + ch_k * atr_ch.iat[i])
                tp = None

        # Pozisyonu aktifleştir (geçerli kurulum varsa)
        if entry_valid:
            in_pos  = True
            highest = lowest = entry_px
        else:
            # Geçersiz kurulum - pozisyon açılmaz
            pos_sgn = None
            entry_i = None
            entry_ts = None
            entry_px = None

    # Son barda açık pozisyonu kapat
    if in_pos and entry_px is not None:
        sgn = pos_sgn if pos_sgn is not None else default_sgn
        exit_px = float(df["close"].iat[-1])
        raw = (exit_px - entry_px)/entry_px if sgn > 0 else (entry_px - exit_px)/entry_px
        pnl = raw * float(lev or 1.0) - net_cost
        tstamp = _stamp(len(df) - 1)

        # trailing/chandelier için görsel tick kuralını koru
        if sch.type in ("trailing_pct", "chandelier"):
            tp_hit = pnl >= 0
            sl_hit = pnl < 0
        else:
            tp_hit = False
            sl_hit = False

        trades.append({
            "ts": tstamp, "time": tstamp,
            "entry_ts": entry_ts, "exit_ts": tstamp,
            "side": "long" if sgn > 0 else "short",
            "entry": _round_px(entry_px, price_precision),
            "exit":  _round_px(exit_px,  price_precision),
            "price_precision": int(price_precision),
            "pnl": pnl, "exit_reason": "force",
            "tp_hit": bool(tp_hit), "sl_hit": bool(sl_hit),
            "entry_i": int(entry_i) if entry_i is not None else None,
        })

    return trades


from fastapi import HTTPException
from fastapi import HTTPException

@app.post("/backtest/run_with_exit")
def backtest_run_with_exit(req: BacktestRunReqPlus):
    """
    Çakışmalı barları SKIP eden; girişleri 'işaret değişimi' kuralıyla belirleyen backtest.
    Merge içinde 'in_pos' tutulmaz; pozisyon yönetimi tamamen simulate_scheme_over_entries içindedir.
    """
    import pandas as pd
    import numpy as np

    # ---------- helpers ----------
    def _as_float(val, default=None):
        if val is None:
            return default
        if isinstance(val, str):
            val = val.replace(",", ".")
        try:
            return float(val)
        except Exception:
            return default

    def merge_signals_conflict_only(df, strat_intents, prefer="skip", priorities=None):
        """
        strat_intents: {name -> pd.Series of {-1,0,1}}
        ÇAKIŞMA çözümü:
          - Aynı barda hem long hem short varsa:
              prefer="skip"  -> 0
              prefer="long"  -> 1
              prefer="short" -> -1
          - Aksi halde o barın tek yönünü al.
        Dönüş:
          sgn: {-1,0,1} (her bar için hedef yön)
          entries: bool  (işaret değişimi ile tanımlanır)
        """
        idx = df.index
        intents = {k: v.reindex(idx).fillna(0).astype(int) for k, v in strat_intents.items()}

        # Öncelik sırası (küçük sayı üstün) sadece prefer != "skip" iken işe yarar
        priorities = priorities or {}
        order = sorted(intents.items(), key=lambda kv: priorities.get(kv[0], 1_000_000))

        sgn = np.zeros(len(idx), dtype=int)

        for i in range(len(idx)):
            votes = [int(series.iat[i]) for _, series in order if int(series.iat[i]) != 0]
            if not votes:
                sgn[i] = 0
                continue

            have_long  = any(v > 0 for v in votes)
            have_short = any(v < 0 for v in votes)

            if have_long and have_short:
                if prefer == "long":
                    sgn[i] = 1
                elif prefer == "short":
                    sgn[i] = -1
                else:  # "skip"
                    sgn[i] = 0
            else:
                sgn[i] = 1 if have_long else -1

        sgn_series = pd.Series(sgn, index=idx)

        # Giriş kuralı: işaret değişimi (0→±1 veya +1↔−1)
        prev = sgn_series.shift(1).fillna(0).astype(int)
        entries = (sgn_series != 0) & (sgn_series != prev)

        return sgn_series, entries

    try:
        # ---------- 0) Veri ----------
        sid = getattr(req, "data_snapshot_id", None)
        if sid and (rec := SNAPSHOT_STORE.get(sid)):
            df0 = rec["df"].copy()
        else:
            df0 = load_ohlcv(req.symbol, req.timeframe, req.start, req.end)
        if df0 is None or len(df0) < 2:
            raise HTTPException(status_code=400, detail="No data (or too short).")

        # ---------- 1) Exit şeması ----------
        sch_source = "exit_scheme"
        if getattr(req, "exit_scheme", None):
            sch = req.exit_scheme
        else:
            tp_v = _as_float(getattr(req, "tp", None), None)
            sl_v = _as_float(getattr(req, "sl", None), None)
            if tp_v is not None and sl_v is not None:
                sch = ExitSchemeEvt(type="fixed", tp_pct=tp_v, sl_pct=sl_v)
                sch_source = "tp_sl_body"
            else:
                sch = ExitSchemeEvt(type="fixed", tp_pct=0.01, sl_pct=0.02)
                sch_source = "default_1_2"

        # ---------- 2) Chandelier paramlarını indikatörlere yansıt ----------
        inds = dict(req.indicators or {})
        if getattr(sch, "type", None) == "chandelier":
            if getattr(sch, "n", None) is not None:
                inds["ch_n"] = int(sch.n)
            if getattr(sch, "factor", None) is not None:
                inds["ch_k"] = float(sch.factor)

        # ---------- 3) İndikatörler ----------
        df = compute_indicators(df0, timeframe=req.timeframe, **inds)

        # ---------- 4) Sinyaller: tek/çoklu strateji ----------
        exprs_obj = getattr(req, "expr", None)

        def _expr_to_intent(e):
            ent_signed = expr_to_entries(
                df, e, req.params or {}, side=req.side, respect_expr_sign=True
            )
            return pd.Series(np.sign(ent_signed).astype(int), index=df.index)

        if not exprs_obj:
            # ifade yoksa: sabit yön ve işaret değişimi yok (tek giriş = ilk bar)
            default_sgn = int(np.sign(getattr(req, "side", 1) or 1))
            sgn_series = pd.Series(default_sgn, index=df.index)
            # işaret değişimi kuralı gereği sadece ilk bar True olsun:
            entries = pd.Series(False, index=df.index)
            if len(entries) > 0:
                entries.iloc[0] = True
        else:
            if isinstance(exprs_obj, str):
                exprs = [exprs_obj]; names = ["S0"]
            elif isinstance(exprs_obj, (list, tuple)):
                exprs = list(exprs_obj); names = [f"S{i}" for i in range(len(exprs))]
            elif isinstance(exprs_obj, dict):
                names = list(exprs_obj.keys())
                exprs = [exprs_obj[k] for k in names]
            else:
                raise HTTPException(status_code=422, detail="expr must be str | list[str] | dict[str,str].")

            strat_intents = {nm: _expr_to_intent(e) for nm, e in zip(names, exprs)}

            # ÇAKIŞMA: aynı barda long+short → skip (sgn=0); in_pos burada tutulmaz.
            sgn_series, entries = merge_signals_conflict_only(
                df, strat_intents, prefer="skip", priorities=None
            )

        # ---------- 5) Simülasyon ----------
        trades = simulate_scheme_over_entries(
            df, req.symbol, entries, req.side, req.leverage, sch,
            sgn_series=sgn_series,
            fee_pct=float(getattr(req, "fee_pct", 0.0) or 0.0),
            slippage_pct=float(getattr(req, "slippage_pct", 0.0) or 0.0),
        )

        # ---------- 6) İstatistik + günlük kâr ----------
        wins = sum(float(t.get("pnl", 0.0)) > 0.0 for t in trades)
        pnl_sum = float(np.sum([float(t.get("pnl", 0.0)) for t in trades])) if trades else 0.0
        stats = {
            "trades": len(trades),
            "winrate": (wins / len(trades)) * 100.0 if trades else 0.0,
            "pnl": pnl_sum,
            "profit": pnl_sum,
        }

        daily_profits = []
        if trades:
            idx = pd.to_datetime([t.get("ts") or t.get("time") for t in trades])
            pnl_s = pd.Series([t.get("pnl", 0.0) for t in trades], index=idx).resample("1D").sum()
            daily_profits = [{"date": d.strftime("%Y-%m-%d"), "profit": float(v)} for d, v in pnl_s.items()]

        return {
            "stats": stats,
            "signals": trades,
            "daily_profits": daily_profits,
            "scheme_source": sch_source
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"run_with_exit failed: {type(e).__name__}: {e}")



class ExitScheme(BaseModel):
    type: str                        # "fixed" | "atr" | "chandelier"
    tp_pct: Optional[float] = None   # fixed
    sl_pct: Optional[float] = None   # fixed
    atr_n: Optional[int] = None      # atr
    k_sl: Optional[float] = None     # atr -> SL = k_sl * ATR
    m_tp: Optional[float] = None     # atr -> TP = m_tp * ATR
    n: Optional[int] = None          # chandelier (window) - compute_indicators zaten ch_* üretiyor
    factor: Optional[float] = None   # chandelier (atr factor) - burada zorunlu değil

class BacktestRequest(BaseModel):
    symbol: str
    timeframe: str
    start: str
    end: str
    expr: str
    side: int = 1
    params: Dict[str, Any] = {}
    leverage: float = 1.0
    exit_schemes: List[ExitScheme] = []
    compare_on_same_entries: bool = True

def stats_from_trades_basic(signals: List[Dict[str, Any]]) -> Dict[str, float]:
    if not signals:
        return {"profit": 0.0, "winRate": 0.0, "trades": 0, "wins": 0, "losses": 0, "sharpe": 0.0, "maxDD": 0.0, "pf": 0.0}
    
    ret = np.array([float(s.get("pnl",0.0)) for s in signals], dtype=float)
    wins = int((ret > 0).sum()); losses = int((ret <= 0).sum())
    trades = int(len(ret))
    
    # ### DÜZELTME: Bileşik getiri (compounded profit) hesaplaması ###
    # Her işlemin getirisi bir önceki sermayeye eklenir.
    eq = np.cumprod(1.0 + ret)
    profit_pct = (eq[-1] - 1.0) * 100.0 if len(eq) > 0 else 0.0

    # Equity curve ve Max Drawdown hesaplaması
    peak = np.maximum.accumulate(eq)
    dd = (eq / peak) - 1.0
    maxDD = float(dd.min() * 100.0)
    # ##################################################################

    std = float(ret.std(ddof=1)) if trades > 1 else 0.0
    mean = float(ret.mean()) if trades > 0 else 0.0
    sharpe = float((mean / (std + 1e-12)) * np.sqrt(max(trades, 1)))
    
    gains = float(ret[ret > 0].sum()); losses_abs = float(-ret[ret <= 0].sum())
    pf = float(gains / (losses_abs + 1e-12))
    winRate = float((wins / trades) * 100.0) if trades else 0.0
    
    return {"profit": profit_pct, "winRate": winRate, "trades": trades, "wins": wins, "losses": losses, "sharpe": sharpe, "maxDD": maxDD, "pf": pf}


def _optimize_optuna(fdf, bounds_a, conf, cols, params: Dict | None = None, sampler_type: str = "tpe") -> List[tuple]:
    if not LIBRARIES_INSTALLED:
        raise HTTPException(status_code=501, detail="Optuna optimization requires 'optuna'.")
    
    print(f"Running Optuna with {sampler_type.upper()} Sampler...")
    params = params or {}
    n_trials = int(params.get("n_trials", 200))
    n_startup_trials = int(params.get("n_startup_trials", 10))

    optuna.logging.set_verbosity(optuna.logging.WARNING)
    
    if sampler_type == "cmaes":
        sampler = optuna.samplers.CmaEsSampler()
    else: # default to tpe
        sampler = optuna.samplers.TPESampler(n_startup_trials=n_startup_trials)
        
    study = optuna.create_study(direction="maximize", sampler=sampler)

    def objective(trial):
        intervals_n = {}
        for c in cols:
            # Optuna'nın aralıkları (min, max) şeklinde önermesini sağlıyoruz
            val1 = trial.suggest_float(f"{c}_1", 0.0, 1.0)
            val2 = trial.suggest_float(f"{c}_2", 0.0, 1.0)
            intervals_n[c] = (min(val1, val2), max(val1, val2))
            
        mask, mask_pos = _eval_mask(fdf, intervals_n, bounds_a)
        m = _metrics(fdf, mask, mask_pos, conf)
        return _obj(m, conf)

    study.optimize(objective, n_trials=n_trials)
    
    # En iyi sonucu al ve formatla
    best_p = study.best_params
    intervals_n = {c: (min(best_p[f"{c}_1"], best_p[f"{c}_2"]), max(best_p[f"{c}_1"], best_p[f"{c}_2"])) for c in cols}
    mask, mask_pos = _eval_mask(fdf, intervals_n, bounds_a)
    metrics = _metrics(fdf, mask, mask_pos, conf)
    payload = {"intervals_n": intervals_n, "metrics": metrics, "rules": _intervals_to_rules(intervals_n, bounds_a)}
    
    # Optuna direkt en iyiyi verdiği için heap'e gerek yok, tek sonuçlu liste döndürüyoruz
    return [(study.best_value, 0, payload)]


# Önce OptimizeReq modelini güncelleyin
# Önce OptimizeReq modelini güncelleyin
class OptimizeReq(BaseModel):
    symbol: str
    timeframe: str
    start: str
    end: str
    side: int
    tp: float
    sl: float
    leverage: float
    fee_pct: float
    slippage_pct: float
    expr: str
    params: Dict[str, Any] = {}
    indicators: Dict[str, Any] = {}
    optimize: Dict[str, Dict[str, Any]] = {}
    method: str = "grid"
    limits: Dict[str, Any] = {}  # Keep for backward compatibility
    method_params: Optional[Dict[str, Any]] = None  # YENİ FIELD
    exit_scheme: Optional[ExitSchemeEvt] = None
    data_snapshot_id: Optional[str] = None

# Sonra optimize_core fonksiyonunu güncelleyin
@app.post("/optimize/core")
def optimize_core(req: OptimizeReq):
    t0 = time.time()
    try:
        sid = getattr(req, "data_snapshot_id", None)
        if not sid or sid not in SNAPSHOT_STORE:
            raise HTTPException(status_code=400, detail="data_snapshot_id gereklidir. Önce Setup sekmesinden veri indirin.")
        
        base_df = SNAPSHOT_STORE[sid]["df"].copy()
        optimize_space = req.optimize or {}
        method = (req.method or "grid").lower()
        
        # FIX: Güvenli erişim - method_params olabilir None olabilir
        method_params = getattr(req, 'method_params', None) or req.limits or {}
        
        print(f"Running optimization with method: {method}")
        print(f"Method params: {method_params}")

        memoization_cache = {}
        def evaluate_candidate(params_tuple):
            params = dict(zip(optimize_space.keys(), params_tuple))
            cache_key = tuple(sorted(params.items()))
            if cache_key in memoization_cache:
                return memoization_cache[cache_key]

            ind_over = {**(req.indicators or {}), **params}
            df = compute_indicators(base_df, timeframe=req.timeframe, **ind_over)
            
            ent_signed = expr_to_entries(df, req.expr, req.params or {}, side=req.side, respect_expr_sign=True)
            sgn_series = pd.Series(np.sign(ent_signed).astype(int), index=df.index)
            entries_mask = sgn_series != 0
            
            sch = req.exit_scheme or ExitSchemeEvt(type="fixed", tp_pct=req.tp, sl_pct=req.sl)
            trades = simulate_scheme_over_entries(
                df, req.symbol, entries_mask, req.side, req.leverage, sch,
                sgn_series=sgn_series, fee_pct=req.fee_pct, slippage_pct=req.slippage_pct
            )
            stats = stats_from_trades_basic(trades)
            
            objective_score = -stats.get("profit", -1e9)
            
            result = (objective_score, stats, trades, params)
            memoization_cache[cache_key] = result
            return result

        results = []
        best_result_obj = None

        if method in ["grid", "random"]:
            # Parametreleri method_params'tan oku
            if method == "grid":
                max_iter = int(method_params.get("max_iterations", 1000))
                space_iter = iter_param_space(optimize_space, limit=max_iter)
            else:  # random
                samples = int(method_params.get("samples", 1000))
                space_iter = random_space(optimize_space, samples=samples)
                
            for cand_params in space_iter:
                param_tuple = tuple(cand_params.get(k) for k in optimize_space.keys())
                _, stats, _, evaluated_params = evaluate_candidate(param_tuple)
                results.append({"params": evaluated_params, "stats": stats, **stats})
            
            if results:
                results.sort(key=lambda r: r.get("profit", -1e9), reverse=True)
                best_params_from_sort = results[0]['params']
                param_tuple_best = tuple(best_params_from_sort.get(k) for k in optimize_space.keys())
                _, best_stats, _, _ = evaluate_candidate(param_tuple_best)
                best_result_obj = {"params": best_params_from_sort, "stats": best_stats, **best_stats}
        
        else:
            # Önce tüm gerekli import'ları yap

            # Parameter space oluştur (artık Integer ve Real kullanılabilir)
            varbound, space_dims = [], []
            for k, v in optimize_space.items():
                low, high, step = v['min'], v['max'], v.get('step', 0)
                varbound.append([low, high])

                is_integer_space = (
                    float(low).is_integer() and
                    float(high).is_integer() and
                    (step == 0 or float(step).is_integer())
                )

                if is_integer_space:
                     space_dims.append(Integer(int(low), int(high), name=k))
                else:
                     space_dims.append(Real(low, high, name=k))
            
            def objective_func(p): 
                return evaluate_candidate(tuple(p))[0]

            best_params_tuple = None
            
            if method == "bayesian":
                print("Starting Bayesian Optimization...")
                n_calls = int(method_params.get("n_calls", 150))
                n_initial_points = int(method_params.get("n_initial_points", 10))
                
                res = gp_minimize(
                    func=objective_func, 
                    dimensions=space_dims, 
                    n_calls=n_calls, 
                    n_initial_points=n_initial_points,
                    random_state=42
                )
                best_params_tuple = tuple(res.x)
                print(f"Bayesian completed. Best score: {-res.fun}")
            
            elif method == "genetic":
                print("Starting Genetic Algorithm...")
                ga_params = {
                    'max_num_iteration': int(method_params.get("max_num_iteration", 100)),
                    'population_size': int(method_params.get("population_size", 20)),
                    'mutation_probability': float(method_params.get("mutation_probability", 0.1)),
                    'elit_ratio': float(method_params.get("elit_ratio", 0.01)),
                    'parents_portion': 0.3,
                    'crossover_probability': 0.5,
                    'crossover_type': 'uniform',
                    'max_iteration_without_improv': 10
                }
                
                model = ga(
                    function=objective_func, 
                    dimension=len(varbound), 
                    variable_type='real', 
                    variable_boundaries=np.array(varbound), 
                    algorithm_parameters=ga_params
                )
                model.run()
                best_params_tuple = tuple(model.best_variable)

            elif method in ["tpe", "cmaes"]:
                print(f"Starting Optuna {method.upper()}...")
                n_trials = int(method_params.get("n_trials", 200))
                n_startup_trials = int(method_params.get("n_startup_trials", 10))
                
                optuna.logging.set_verbosity(optuna.logging.WARNING)
                
                if method == "tpe":
                    sampler = optuna.samplers.TPESampler(n_startup_trials=n_startup_trials)
                else: # cmaes
                    sampler = optuna.samplers.CmaEsSampler()

                study = optuna.create_study(direction="minimize", sampler=sampler)
                
                def optuna_objective(trial):
                    p = []
                    for k in optimize_space.keys():
                        v = optimize_space[k]
                        step = v.get('step')
                        if float(v['min']).is_integer() and float(v['max']).is_integer() and step and float(step).is_integer():
                             p.append(trial.suggest_int(k, v['min'], v['max'], step=int(step)))
                        else:
                             p.append(trial.suggest_float(k, v['min'], v['max'], step=step))
                    return objective_func(tuple(p))

                study.optimize(optuna_objective, n_trials=n_trials)
                best_params_tuple = tuple(study.best_params.get(k) for k in optimize_space.keys())
            
            elif method == "annealing":
                print("Starting Simulated Annealing...")
                maxiter = int(method_params.get("maxiter", 1000))
                initial_temp = float(method_params.get("initial_temp", 5230))
                
                res = dual_annealing(
                    func=objective_func, 
                    bounds=varbound, 
                    maxiter=maxiter, 
                    initial_temp=initial_temp
                )
                best_params_tuple = tuple(res.x)

            if best_params_tuple:
                _, best_stats, _, best_params_dict = evaluate_candidate(best_params_tuple)
                best_result_obj = {"params": best_params_dict, "stats": best_stats, **best_stats}
                for _, stats, _, params in memoization_cache.values():
                    results.append({"params": params, "stats": stats, **stats})
                results.sort(key=lambda r: r.get("profit", -1e9), reverse=True)

        return {
            "best": best_result_obj,
            "top": results[:200],
            "elapsed_sec": round(time.time() - t0, 4),
            "evaluated": len(memoization_cache),
            "method": method
        }

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"optimize/core failed: {type(e).__name__}: {e}")# -----------------------------------------------------------------------------

from dataclasses import dataclass
import itertools
import heapq



# -----------------------------------------------------------------------------
# Pydantic Modelleri (Exit Scheme & Filter Suggest)
# -----------------------------------------------------------------------------



# Mevcut FilterSuggestReq modelini bulun ve method_params ekleyin
class FilterSuggestReq(BaseModel):
    symbol: str; timeframe: str; start: str; end: str
    side: int
    tp: float; sl: float; leverage: float; fee_pct: float; slippage_pct: float
    expr: str
    params: Dict[str, Any] = {}
    indicators: Dict[str, Any] = {}
    include: List[str] = []
    topk: int = 8
    samples: int = 10000
    min_cov: float = 0.10
    exit_scheme: Optional[ExitSchemeEvt] = None
    method: str = "random"
    method_params: Optional[Dict[str, Any]] = None # YENİ SATIR
# -----------------------------------------------------------------------------
# Filtreleme için Yardımcı Fonksiyonlar
# -----------------------------------------------------------------------------

@dataclass
class _FConf:
    tp: float; sl: float; min_cov: float; topk: int; samples: int

def _robust_bounds(df: pd.DataFrame) -> Dict[str, tuple]:
    b = {}
    for c in df.columns:
        if c in ["signal", "pnl"]: continue
        lo, hi = df[c].quantile(0.005), df[c].quantile(0.995)
        if not np.isfinite(lo) or not np.isfinite(hi) or lo == hi:
            lo, hi = float(df[c].min()), float(df[c].max())
            if lo == hi: hi = lo + 1e-6
        b[c] = (float(lo), float(hi))
    return b

def _norm_to_actual(lo_n, hi_n, lo_a, hi_a):
    lo = lo_a + (hi_a - lo_a) * lo_n
    hi = lo_a + (hi_a - lo_a) * hi_n
    return float(lo), float(hi)

def _eval_mask(df, intervals_n, bounds_a):
    mask_pos = df["signal"] != 0
    mask = mask_pos.copy()
    for c, (lo_n, hi_n) in intervals_n.items():
        lo_a, hi_a = bounds_a[c]
        lo_v, hi_v = _norm_to_actual(lo_n, hi_n, lo_a, hi_a)
        mask &= (df[c] >= lo_v) & (df[c] <= hi_v)
    return mask, mask_pos

def _intervals_to_rules(intervals_n, bounds_a):
    rules = []
    for c, (lo_n, hi_n) in intervals_n.items():
        if abs(lo_n - 0.0) < 1e-6 and abs(hi_n - 1.0) < 1e-6: continue
        lo_a, hi_a = bounds_a[c]
        lo_v, hi_v = _norm_to_actual(lo_n, hi_n, lo_a, hi_a)
        if abs(hi_n - 1.0) < 1e-6 and lo_n > 0.0:
            rules.append(f"(data['{c}'] >= {lo_v:.6f})")
        elif abs(lo_n - 0.0) < 1e-6 and hi_n < 1.0:
            rules.append(f"(data['{c}'] <= {hi_v:.6f})")
        else:
            rules.append(f"((data['{c}'] >= {lo_v:.6f}) & (data['{c}'] <= {hi_v:.6f}))")
    return rules

def _calculate_real_stats_from_trades(trades: list) -> dict:
    if not trades: return {"N": 0, "WR": 0.0, "Pbar": 0.0, "profit_sum": 0.0, "wins": 0, "losses": 0}
    pnl = np.array([float(t.get("pnl", 0.0)) for t in trades])
    n = len(pnl)
    if n == 0: return {"N": 0, "WR": 0.0, "Pbar": 0.0, "profit_sum": 0.0, "wins": 0, "losses": 0}
    wins = int((pnl > 0).sum())
    return {"N": n, "WR": (wins / n) * 100.0, "Pbar": float(pnl.mean()), "profit_sum": float(pnl.sum()), "wins": wins, "losses": n - wins}

def _metrics(df, mask, mask_pos, cfg:_FConf):
    sel = df.loc[mask]; n_total = int(mask_pos.sum())
    trade_rows = sel[sel["signal"] != 0]; n = len(trade_rows)
    if n == 0: return {"N":0, "WR":0.0, "profit_sum":0.0, "coverage":0.0, "wins":0, "losses":0, "synthetic_profit_sum": -1e9}
    real_pnl = trade_rows["pnl"].values; real_wins = int((real_pnl > 0).sum())
    signals = trade_rows["signal"].values.astype(int)
    synth_pnl = np.where(signals == 1, cfg.tp, -cfg.sl)
    return {"N": n, "WR": (real_wins / n) * 100.0 if n > 0 else 0.0, "profit_sum": float(real_pnl.sum()), "coverage": float(n / n_total) if n_total > 0 else 0.0, "wins": real_wins, "losses": n - real_wins, "synthetic_profit_sum": float(synth_pnl.sum())}

def _obj(metrics, cfg:_FConf):
    if metrics["coverage"] < cfg.min_cov: return -1e9
    return float(metrics["synthetic_profit_sum"])

# -----------------------------------------------------------------------------
# Optimizasyon Algoritmaları
# -----------------------------------------------------------------------------

def _optimize_random_search(fdf, bounds_a, conf, cols, params: Dict | None = None) -> List[tuple]:
    print("Running Random Search...")
    samples = int(params.get("samples", conf.samples) if params else conf.samples)
    best_heap: List[tuple] = []; seq = itertools.count()
    def push_best(J, payload):
        item = (float(J), next(seq), payload)
        if len(best_heap) < conf.topk: heapq.heappush(best_heap, item)
        elif J > best_heap[0][0]: heapq.heapreplace(best_heap, item)
    rng = np.random.default_rng(42)
    for _ in range(samples):
        intervals_n = {c: (float(max(0.0, m - w/2)), float(min(1.0, m + w/2))) for c in cols for w in [rng.uniform(0.05, 1.0)] for m in [rng.uniform(0.0 + w/2, 1.0 - w/2)]}
        mask, mask_pos = _eval_mask(fdf, intervals_n, bounds_a)
        m = _metrics(fdf, mask, mask_pos, conf)
        J = _obj(m, conf)
        if J > -1e9:
            if not best_heap or J > best_heap[0][0] or len(best_heap) < conf.topk:
                payload = {"intervals_n": intervals_n, "metrics": m, "rules": _intervals_to_rules(intervals_n, bounds_a)}
                push_best(J, payload)
    return best_heap


def _optimize_grid_search(fdf, bounds_a, conf, cols, params: Dict | None = None) -> List[tuple]:
    print("Running Grid Search...")
    params = params or {}
    # Parametrelerden "step_count" değerini al, yoksa varsayılan olarak 5 kullan
    step_count = int(params.get("step_count", 5))

    best_heap: List[tuple] = []; seq = itertools.count()
    def push_best(J, payload):
        item = (float(J), next(seq), payload)
        if len(best_heap) < conf.topk: heapq.heappush(best_heap, item)
        elif J > best_heap[0][0]: heapq.heapreplace(best_heap, item)
    
    param_ranges = {col: np.linspace(0.0, 1.0, step_count) for col in cols}
    keys = list(param_ranges.keys())
    
    range_combinations = [list(itertools.combinations(param_ranges[key], 2)) for key in keys]
    grid_iterator = itertools.product(*range_combinations)
    
    # Grid'deki kombinasyon sayısını hesaplayıp uyarı verelim (çok büyük olabilir)
    total_combinations = np.prod([len(rc) for rc in range_combinations])
    print(f"Grid search starting with {total_combinations} combinations. This may be very slow.")

    for combo in grid_iterator:
        intervals_n = dict(zip(keys, combo))
        mask, mask_pos = _eval_mask(fdf, intervals_n, bounds_a)
        m = _metrics(fdf, mask, mask_pos, conf)
        J = _obj(m, conf)
        if J > -1e9:
            payload = {"intervals_n": intervals_n, "metrics": m, "rules": _intervals_to_rules(intervals_n, bounds_a)}
            push_best(J, payload)
            
    return best_heap

def _optimize_bayesian(fdf, bounds_a, conf, cols, params: Dict | None = None) -> List[tuple]:
    if not LIBRARIES_INSTALLED: raise HTTPException(status_code=501, detail="Bayesian optimization requires 'scikit-optimize'.")
    print("Running Bayesian Optimization...")
    n_calls = int(params.get("n_calls", 150) if params else 150)
    space = [Real(0.0, 1.0, name=f"{c}_{s}") for c in cols for s in ["min", "max"]]
    def objective(p):
        intervals_n = {c: (min(p[2*i], p[2*i+1]), max(p[2*i], p[2*i+1])) for i, c in enumerate(cols)}
        mask, mask_pos = _eval_mask(fdf, intervals_n, bounds_a)
        m = _metrics(fdf, mask, mask_pos, conf)
        return -_obj(m, conf)
    res = gp_minimize(func=objective, dimensions=space, n_calls=n_calls, random_state=42)
    p, s = res.x, -res.fun
    intervals_n = {c: (min(p[2*i], p[2*i+1]), max(p[2*i], p[2*i+1])) for i, c in enumerate(cols)}
    mask, mask_pos = _eval_mask(fdf, intervals_n, bounds_a)
    metrics = _metrics(fdf, mask, mask_pos, conf)
    payload = {"intervals_n": intervals_n, "metrics": metrics, "rules": _intervals_to_rules(intervals_n, bounds_a)}
    return [(s, 0, payload)]

def _optimize_genetic(fdf, bounds_a, conf, cols, params: Dict | None = None) -> List[tuple]:
    if not LIBRARIES_INSTALLED: raise HTTPException(status_code=501, detail="Genetic algorithm requires 'geneticalgorithm'.")
    print("Running Genetic Algorithm...")
    params = params or {}
    algo_params = {'max_num_iteration': int(params.get("max_num_iteration", 100)), 'population_size': int(params.get("population_size", 20)), 'mutation_probability': float(params.get("mutation_probability", 0.1)), 'elit_ratio': 0.01, 'parents_portion': 0.3, 'crossover_probability': 0.5, 'crossover_type': 'uniform', 'max_iteration_without_improv': 10}
    def fitness(p):
        intervals_n = {c: (min(p[2*i], p[2*i+1]), max(p[2*i], p[2*i+1])) for i, c in enumerate(cols)}
        mask, mask_pos = _eval_mask(fdf, intervals_n, bounds_a)
        m = _metrics(fdf, mask, mask_pos, conf)
        return -_obj(m, conf)
    bounds = np.array([[0.0, 1.0]] * (2 * len(cols)))
    model = ga(function=fitness, dimension=2*len(cols), variable_type='real', variable_boundaries=bounds, algorithm_parameters=algo_params)
    model.run()
    p, s = model.best_variable, -model.best_function
    intervals_n = {c: (min(p[2*i], p[2*i+1]), max(p[2*i], p[2*i+1])) for i, c in enumerate(cols)}
    mask, mask_pos = _eval_mask(fdf, intervals_n, bounds_a)
    metrics = _metrics(fdf, mask, mask_pos, conf)
    payload = {"intervals_n": intervals_n, "metrics": metrics, "rules": _intervals_to_rules(intervals_n, bounds_a)}
    return [(s, 0, payload)]

# -----------------------------------------------------------------------------
# Ana Filtre Önerme Fonksiyonu (Orkestratör)
# -----------------------------------------------------------------------------

@app.post("/filters/suggest")
def filters_suggest(req: FilterSuggestReq):
    """
    Hard min_coverage uygulanır: min_cov altında hiçbir sonuç dönmez.
    Optimizer'dan gelen adaylar final simülasyonla doğrulanır ve coverage >= min_cov şartı aranır.
    """
    import numpy as np
    import pandas as pd
    from fastapi import HTTPException

    try:
        # ---------------- 1) Veri ----------------
        sid = getattr(req, "data_snapshot_id", None)
        if sid and sid in SNAPSHOT_STORE:
            df0 = SNAPSHOT_STORE[sid]["df"].copy()
        else:
            df0 = load_ohlcv(req.symbol, req.timeframe, req.start, req.end)

        # ---------------- 2) Exit şeması ----------------
        def _as_float(val, default=None):
            if val is None:
                return default
            if isinstance(val, str):
                val = val.replace(",", ".")
            try:
                return float(val)
            except Exception:
                return default

        if getattr(req, "exit_scheme", None):
            sch = req.exit_scheme
        else:
            tp_v = _as_float(getattr(req, "tp", None), None)
            sl_v = _as_float(getattr(req, "sl", None), None)
            if tp_v is not None and sl_v is not None:
                sch = ExitSchemeEvt(type="fixed", tp_pct=tp_v, sl_pct=sl_v)
            else:
                sch = ExitSchemeEvt(type="fixed", tp_pct=0.01, sl_pct=0.02)

        # Chandelier paramlarını indikatörlere yansıt
        inds = dict(req.indicators or {})
        if getattr(sch, "type", None) == "chandelier":
            if getattr(sch, "n", None) is not None:
                inds["ch_n"] = int(sch.n)
            if getattr(sch, "factor", None) is not None:
                inds["ch_k"] = float(sch.factor)

        # ---------------- 3) İndikatörler & filtresiz sim ----------------
        df = compute_indicators(df0, timeframe=req.timeframe, **inds)

        ent_signed_initial = expr_to_entries(
            df, req.expr, req.params or {}, side=req.side, respect_expr_sign=True
        )
        sgn_series_initial = pd.Series(np.sign(ent_signed_initial).astype(int), index=df.index)
        entries_mask_initial = sgn_series_initial != 0

        trades_initial = simulate_scheme_over_entries(
            df, req.symbol, entries_mask_initial, req.side, req.leverage, sch,
            sgn_series=sgn_series_initial,
            fee_pct=float(getattr(req, "fee_pct", 0.0) or 0.0),
            slippage_pct=float(getattr(req, "slippage_pct", 0.0) or 0.0),
        )

        # ---------------- 4) Optimizasyon veri hazırlığı ----------------
        pnl_series = pd.Series(0.0, index=df.index, dtype=float)
        pos_series = pd.Series(0, index=df.index, dtype=int)
        for t in trades_initial:
            ei = t.get("entry_i")
            pnl = float(t.get("pnl", 0.0))
            if ei is not None and 0 <= int(ei) < len(df):
                pnl_series.iat[int(ei)] = pnl
                pos_series.iat[int(ei)] = 1 if pnl > 0.0 else -1

        if (pos_series != 0).sum() == 0 and entries_mask_initial.sum() > 0:
            pos_series[entries_mask_initial] = int(np.sign(getattr(req, "side", 1)) or 1)

        if req.include:
            cols = [c for c in req.include if c in df.columns]
        else:
            defaults = ["NDMA", "NDMA1", "hist", "RSI_10", "RSI_diff3"]
            cols = [c for c in defaults if c in df.columns]
        if not cols:
            raise HTTPException(status_code=422, detail="No indicator columns found.")

        fdf = df[cols].copy()
        fdf["signal"] = pos_series.values
        fdf["pnl"] = pnl_series.values

        bounds_a = _robust_bounds(fdf)
        conf = _FConf(
            tp=req.tp, sl=req.sl,
            min_cov=float(req.min_cov),
            topk=int(getattr(req, "topk", 10) or 10),
            samples=int(getattr(req, "samples", 500) or 500),
        )

        baseline_mask = fdf["signal"] != 0
        baseline_metrics = _metrics(fdf, baseline_mask, baseline_mask, conf)
        baseline_intervals_n = {c: (0.0, 1.0) for c in cols}
        baseline_payload = {
            "intervals_n": baseline_intervals_n,
            "metrics": baseline_metrics,
            "rules": _intervals_to_rules(baseline_intervals_n, bounds_a),
        }

        # ---------------- 5) Optimizasyon seçimi ----------------
        method = (req.method or "random").lower()
        if method == "bayesian":
            best_heap = _optimize_bayesian(fdf, bounds_a, conf, cols, req.method_params)
        elif method == "genetic":
            best_heap = _optimize_genetic(fdf, bounds_a, conf, cols, req.method_params)
        elif method in ("tpe", "cmaes"):
            best_heap = _optimize_optuna(fdf, bounds_a, conf, cols, req.method_params, sampler_type=method)
        else:
            best_heap = _optimize_random_search(fdf, bounds_a, conf, cols, req.method_params)

        # ---------------- 6) Hard min_coverage + doğrulama ----------------
        def _to_actual(intervals_n):
            return {
                c: {"min": v[0], "max": v[1]}
                for c, (lo_n, hi_n) in (intervals_n or {}).items()
                for v in [_norm_to_actual(lo_n, hi_n, *bounds_a[c])]
            }

        best_sorted = sorted(best_heap, key=lambda x: x[0], reverse=True)
        candidate_payloads = [p for _, _, p in best_sorted]

        chosen = None

        for payload in candidate_payloads:
            final_rules = payload.get("rules", [])
            final_expr = f"({req.expr}) & ({' & '.join(final_rules)})" if final_rules else req.expr

            final_ent_signed = expr_to_entries(
                df, final_expr, req.params or {}, side=req.side, respect_expr_sign=True
            )
            final_sgn = pd.Series(np.sign(final_ent_signed).astype(int), index=df.index)
            final_entries_mask = final_sgn != 0

            final_trades = simulate_scheme_over_entries(
                df, req.symbol, final_entries_mask, req.side, req.leverage, sch,
                sgn_series=final_sgn,
                fee_pct=float(getattr(req, "fee_pct", 0.0) or 0.0),
                slippage_pct=float(getattr(req, "slippage_pct", 0.0) or 0.0),
            )

            cov = (len(final_trades) / max(1, len(trades_initial))) if trades_initial else 0.0
            if cov + 1e-12 < float(req.min_cov):
                continue

            chosen = payload
            m = _calculate_real_stats_from_trades(final_trades)
            chosen.setdefault("metrics", {}).update(m)
            chosen["metrics"]["coverage"] = cov
            break

        # Baseline da min_cov'ı sağlayamazsa boş dön
        if chosen is None:
            baseline_ent_signed = expr_to_entries(
                df, req.expr, req.params or {}, side=req.side, respect_expr_sign=True
            )
            baseline_sgn = pd.Series(np.sign(baseline_ent_signed).astype(int), index=df.index)
            baseline_entries_mask = baseline_sgn != 0

            baseline_trades = simulate_scheme_over_entries(
                df, req.symbol, baseline_entries_mask, req.side, req.leverage, sch,
                sgn_series=baseline_sgn,
                fee_pct=float(getattr(req, "fee_pct", 0.0) or 0.0),
                slippage_pct=float(getattr(req, "slippage_pct", 0.0) or 0.0),
            )
            cov = (len(baseline_trades) / max(1, len(trades_initial))) if trades_initial else 0.0
            if cov + 1e-12 >= float(req.min_cov):
                chosen = baseline_payload
                m = _calculate_real_stats_from_trades(baseline_trades)
                chosen.setdefault("metrics", {}).update(m)
                chosen["metrics"]["coverage"] = cov

        if chosen is None:
            return {
                "columns": cols,
                "bounds": {k: {"min": v[0], "max": v[1]} for k, v in bounds_a.items()},
                "min_coverage_setting": float(req.min_cov),
                "best": None,
                "top": [],
                "message": "No solution meets min_coverage constraint."
            }

        chosen["intervals"] = _to_actual(chosen.get("intervals_n"))
        chosen["coverage"] = chosen.get("metrics", {}).get("coverage", 0.0)

        # top listesini min_cov'ı geçenlerle sınırla (opsiyonel)
        filtered_top = [chosen]
        for payload in candidate_payloads:
            if payload is chosen:
                continue
            cov = payload.get("metrics", {}).get("coverage", None)
            if cov is not None and cov + 1e-12 >= float(req.min_cov):
                filtered_top.append(payload)

        return {
            "columns": cols,
            "bounds": {k: {"min": v[0], "max": v[1]} for k, v in bounds_a.items()},
            "min_coverage_setting": float(req.min_cov),
            "best": chosen,
            "top": filtered_top,
        }

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"filters_suggest failed: {type(e).__name__}: {e}")


# GP: Auto Strategy Generator (DEAP)
# === utils: hepsi aynı dosyada, generate_strategy_gp’nin ÜSTÜNE koyun ===

# === SAFE VECTOR PRIMITIVES (broadcast-friendly) ===
# --- SNAPSHOT LOADER (drop-in) ----------------------------------------------
# ---------------------------------------------------------------------------
# SNAPSHOT REGISTRY + LOADER (pandas tabanlı, esnek)
# ---------------------------------------------------------------------------
import os, re, glob
import pandas as pd

# İsteğe bağlı global önbellek
SNAPSHOT_CACHE = globals().get("SNAPSHOT_CACHE", {})

def register_snapshot_df(snapshot_id: str, df: pd.DataFrame) -> None:
    """Download Data sonrası çağır: DF'yi belleğe pin'ler."""
    if not isinstance(df, pd.DataFrame):
        raise TypeError("register_snapshot_df expects a pandas DataFrame")
    SNAPSHOT_CACHE[snapshot_id] = df

def register_snapshot_file(snapshot_id: str, path: str) -> None:
    """İstersen dosya konumunu da hatırla (örn. özel dizin)."""
    global SNAPSHOT_FILE_INDEX
    SNAPSHOT_FILE_INDEX = globals().get("SNAPSHOT_FILE_INDEX", {})
    SNAPSHOT_FILE_INDEX[snapshot_id] = path

def _tf_to_pandas_freq(tf: str) -> str:
    if not tf:
        return "1D"
    m = re.fullmatch(r"(\d+)\s*([mMhHdDwW])", str(tf))
    if not m:
        return tf if isinstance(tf, str) else "1D"
    n, u = int(m.group(1)), m.group(2).lower()
    return {"m": f"{n}min", "h": f"{n}H", "d": f"{n}D", "w": f"{n}W"}[u]

def _ensure_dt_index(df: pd.DataFrame) -> pd.DataFrame:
    if not isinstance(df.index, pd.DatetimeIndex):
        for col in ("time","timestamp","date","datetime","Date","Datetime"):
            if col in df.columns:
                df = df.set_index(pd.to_datetime(df[col], utc=True, errors="coerce")).drop(columns=[col])
                break
        else:
            df.index = pd.to_datetime(df.index, utc=True, errors="coerce")
    df = df[~df.index.isna()].sort_index()
    return df

def _resample_ohlc(df: pd.DataFrame, freq: str) -> pd.DataFrame:
    if not isinstance(df.index, pd.DatetimeIndex):
        df = _ensure_dt_index(df)
    agg = {}
    if "open"  in df: agg["open"]  = "first"
    if "high"  in df: agg["high"]  = "max"
    if "low"   in df: agg["low"]   = "min"
    if "close" in df: agg["close"] = "last"
    if "volume" in df: agg["volume"] = "sum"
    for c in df.columns:
        if c not in agg:
            agg[c] = "last"
    out = (
        df.resample(freq, label="right", closed="right")
          .agg(agg)
          .dropna(subset=[c for c in ("open","high","low","close") if c in df.columns])
    )
    return out

def _candidate_dirs():
    # Öncelik: explicit index
    d = []
    p_index = globals().get("SNAPSHOT_FILE_INDEX")
    if p_index:
        d.extend(list({os.path.dirname(p) for p in p_index.values() if isinstance(p, str)}))
    # Env veya settings
    for key in ("SNAPSHOT_DIR",):
        val = os.environ.get(key)
        if val: d.append(val)
    settings = globals().get("settings")
    if settings and getattr(settings, "SNAPSHOT_DIR", None):
        d.append(settings.SNAPSHOT_DIR)
    # Proje/snapshots ve current working dir
    d.append(os.path.join(os.getcwd(), "snapshots"))
    d.append(os.getcwd())
    # Tekilleştir, var olanları sırayla döndür
    out = []
    seen = set()
    for p in d:
        p = os.path.abspath(p)
        if p not in seen and os.path.isdir(p):
            out.append(p); seen.add(p)
    return out

def _find_snapshot_path(snapshot_id: str) -> str | None:
    # 1) Bellek index (explicit kayıt)
    p_index = globals().get("SNAPSHOT_FILE_INDEX", {})
    if snapshot_id in p_index and os.path.exists(p_index[snapshot_id]):
        return p_index[snapshot_id]

    # 2) Doğrudan dosya adı verilmiş olabilir
    if os.path.exists(snapshot_id) and os.path.isfile(snapshot_id):
        return os.path.abspath(snapshot_id)

    # 3) Tipik adlar: <id>.parquet | <id>.csv veya <id>*.* (fuzzy)
    for base in _candidate_dirs():
        exact_parq = os.path.join(base, f"{snapshot_id}.parquet")
        exact_csv  = os.path.join(base, f"{snapshot_id}.csv")
        if os.path.exists(exact_parq): return exact_parq
        if os.path.exists(exact_csv):  return exact_csv
        # fuzzy: id ile başlayan her şey
        matches = glob.glob(os.path.join(base, f"{snapshot_id}*"))
        for m in matches:
            if os.path.isfile(m) and (m.lower().endswith(".parquet") or m.lower().endswith(".csv")):
                return m
    return None

# ==== SNAPSHOT PERSISTENCE ====
import os, io, json, hashlib, threading

SNAPSHOT_DIR = os.environ.get("SNAPSHOT_DIR", os.path.abspath(os.path.join(os.path.dirname(__file__), "snapshots")))
os.makedirs(SNAPSHOT_DIR, exist_ok=True)

# Bellek içi (reload olduğunda silinir) + disk yolu haritası
_SNAPSHOT_REGISTRY = {}
_SNAPSHOT_LOCK = threading.Lock()

def _snapshot_path(snapshot_id: str, ext: str = "parquet") -> str:
    # C:\...\snapshots\<id>.parquet
    return os.path.join(SNAPSHOT_DIR, f"{snapshot_id}.{ext}")

def register_snapshot_df(snapshot_id: str, df: pd.DataFrame) -> str:
    """
    DF'yi diske kaydet + registry'ye yaz. Reload sonrası da bulunur.
    """
    if not isinstance(df, pd.DataFrame):
        raise TypeError("register_snapshot_df expects a pandas DataFrame")

    # OHLC kolonları varsa düzenle (opsiyonel ama sağlam olsun)
    must = ["open","high","low","close"]
    missing = [c for c in must if c not in df.columns]
    if missing:
        raise ValueError(f"DataFrame missing columns: {missing}")

    path = _snapshot_path(snapshot_id, "parquet")
    df.to_parquet(path, index=True)
    with _SNAPSHOT_LOCK:
        _SNAPSHOT_REGISTRY[snapshot_id] = path
    return path

def register_snapshot_file(snapshot_id: str, file_path: str) -> str:
    """
    Zaten kaydedilmiş dosyayı registry'ye bağla (örn. CSV / Parquet).
    """
    if not os.path.isfile(file_path):
        raise FileNotFoundError(file_path)
    with _SNAPSHOT_LOCK:
        _SNAPSHOT_REGISTRY[snapshot_id] = file_path
    return file_path

def load_snapshot_df(symbol: str, timeframe: str, snapshot_id: str, start=None, end=None) -> pd.DataFrame:
    """
    1) RAM registry
    2) SNAPSHOT_DIR/<id>.parquet
    3) SNAPSHOT_DIR/<id>.csv
    sırasıyla dener.
    """
    candidates = []
    with _SNAPSHOT_LOCK:
        p = _SNAPSHOT_REGISTRY.get(snapshot_id)
        if p:
            candidates.append(p)
    # Disk fallback’ları
    candidates.append(_snapshot_path(snapshot_id, "parquet"))
    candidates.append(_snapshot_path(snapshot_id, "csv"))

    for path in candidates:
        if os.path.isfile(path):
            # uzantıya göre oku
            if path.lower().endswith(".parquet"):
                df = pd.read_parquet(path)
            elif path.lower().endswith(".csv"):
                df = pd.read_csv(path, parse_dates=True, index_col=0)
            else:
                continue
            # İsteğe bağlı tarih filtresi
            if start is not None or end is not None:
                df = df.loc[start:end]
            return df

    searched = [SNAPSHOT_DIR]
    raise RuntimeError(
        f"Snapshot not found: {snapshot_id}\n"
        f"Searched dirs:\n  - " + "\n  - ".join(searched)
    )
from copy import deepcopy
# optimizer_api.py dosyanızdaki mevcut generate_strategy_gp fonksiyonunu bununla tamamen değiştirin

# optimizer_api.py dosyanızdaki mevcut generate_strategy_gp fonksiyonunu bununla tamamen değiştirin
# optimizer_api.py içindeki generate_strategy_gp fonksiyonunu bununla TAMAMEN değiştirin






@app.post("/optimize/generate")
def generate_strategy_gp(req: GPStrategyReq):
    """
    Typed GP (pandas):
      - Types: SeriesT (float series), MaskT (0/1 series)
      - Ops: +,-,*,/ -> Series; >,<,>=,<= -> Mask; &,| -> Mask
      - No numpy, no abs/neg/tanh, no ephemerals
      - Render: data['<column>']
      - At least one comparison required in tree
    """
    import math
    import copy
    import random
    import pandas as pd
    from deap import base as deap_base, creator, tools as deap_tools, gp

    # ---------- 0) DATA ----------
    sid = getattr(req, "data_snapshot_id", None)
    if not sid or sid not in SNAPSHOT_STORE:
        raise HTTPException(status_code=400, detail="data_snapshot_id is required. Call /data/snapshot first.")

    df: pd.DataFrame = SNAPSHOT_STORE[sid]["df"].copy()
    if df is None or len(df) < 100:
        raise HTTPException(status_code=400, detail="No data (or too short). Download data first.")

    # indikatörleri üret
    df = compute_indicators(df, timeframe=req.timeframe, **(req.ind_params or {}))

    # kullanılacak kolonlar
    if req.indicators_to_use:
        base_cols = [c for c in req.indicators_to_use if c in df.columns]
    else:
        white = ["close","RSI","EMA","SMA","MACD","hist","CCI","ADX","AO","OBV","MFI","BB_upper","BB_lower","BB_mid"]
        base_cols = [c for c in white if c in df.columns]
        if not base_cols:
            base_cols = [c for c in df.columns if pd.api.types.is_numeric_dtype(df[c])]

    # OHLCV'den open/high/low/volume çıkar; close kalsın
    drop = {"open","high","low","volume"}
    use_cols = []
    seen = set()
    for c in base_cols:
        if c in drop: 
            continue
        if c not in seen:
            seen.add(c)
            use_cols.append(c)
    if "close" in df.columns and "close" not in use_cols:
        use_cols.append("close")
    if not use_cols:
        raise HTTPException(status_code=422, detail="No usable numeric columns.")

    # temizlik
    for c in use_cols:
        s = df[c].replace([float("inf"), -float("inf")], float("nan"))
        df[c] = s.ffill().bfill().fillna(0.0)

    # ---------- 1) TYPES ----------
    class SeriesT: pass   # pd.Series (float)
    class MaskT:   pass   # pd.Series (0/1 float)

    # ---------- 2) CREATOR ----------
    if "FitnessMax" not in creator.__dict__:
        creator.create("FitnessMax", deap_base.Fitness, weights=(1.0,))
    if "Individual" not in creator.__dict__:
        creator.create("Individual", gp.PrimitiveTree, fitness=creator.FitnessMax)

    # ---------- 3) PRIMITIVE SET ----------
    # Çıktı tipi MaskT: (0/1) sinyal
    pset = gp.PrimitiveSetTyped("STRAT", [], MaskT)

    # Pandas broadcast helper (numpy yok)
    def _S(x) -> pd.Series:
        if isinstance(x, pd.Series):
            return x
        return pd.Series([x] * len(df), index=df.index, dtype=float)

    # Series×Series -> Series
    def _add(a, b): return _S(a) + _S(b)
    def _sub(a, b): return _S(a) - _S(b)
    def _mul(a, b): return _S(a) * _S(b)
    def _div(a, b):
        A, B = _S(a), _S(b)
        Bz = B.where(B != 0.0, other=pd.NA)
        return (A / Bz).fillna(0.0)

    # Series×Series -> Mask
    def _gt(a, b): return (_S(a) >  _S(b)).astype(float)
    def _lt(a, b): return (_S(a) <  _S(b)).astype(float)
    def _ge(a, b): return (_S(a) >= _S(b)).astype(float)
    def _le(a, b): return (_S(a) <= _S(b)).astype(float)

    # Mask×Mask -> Mask
    def _and(a, b):
        A, B = _S(a), _S(b)
        return ((A != 0) & (B != 0)).astype(float)
    def _or(a, b):
        A, B = _S(a), _S(b)
        return ((A != 0) | (B != 0)).astype(float)

    allowed = set(req.operators_to_use or ["+","-","*","/","<",">","<=",">=","&","|"])
    if not ({"<",">","<=",">="} & allowed):
        raise HTTPException(status_code=422, detail="At least one comparator (>, <, >=, <=) must be enabled.")

    if "+" in allowed:  pset.addPrimitive(_add, [SeriesT, SeriesT], SeriesT, name="_add")
    if "-" in allowed:  pset.addPrimitive(_sub, [SeriesT, SeriesT], SeriesT, name="_sub")
    if "*" in allowed:  pset.addPrimitive(_mul, [SeriesT, SeriesT], SeriesT, name="_mul")
    if "/" in allowed:  pset.addPrimitive(_div, [SeriesT, SeriesT], SeriesT, name="_div")
    if ">" in allowed:  pset.addPrimitive(_gt,  [SeriesT, SeriesT], MaskT,  name="_gt")
    if "<" in allowed:  pset.addPrimitive(_lt,  [SeriesT, SeriesT], MaskT,  name="_lt")
    if ">=" in allowed: pset.addPrimitive(_ge,  [SeriesT, SeriesT], MaskT,  name="_ge")
    if "<=" in allowed: pset.addPrimitive(_le,  [SeriesT, SeriesT], MaskT,  name="_le")
    if "&" in allowed:  pset.addPrimitive(_and, [MaskT,   MaskT],   MaskT,  name="_and")
    if "|" in allowed:  pset.addPrimitive(_or,  [MaskT,   MaskT],   MaskT,  name="_or")

    # ---------- 4) TERMINALS ----------
    # DEĞER = pd.Series (!!!), isim -> kolon adı haritası
    NAME_RENDER: dict[str, str] = {}
    for i, c in enumerate(use_cols):
        internal = f"T{i}"
        pset.addTerminal(df[c], SeriesT, name=internal)
        NAME_RENDER[internal] = c

    # Seed comparison terminal (MaskT) — gerçek 0/1 seri
    def _pick_two(cols):
        if "RSI" in cols and "EMA" in cols: return "RSI","EMA"
        if "EMA" in cols and "SMA" in cols: return "EMA","SMA"
        if "close" in cols and "RSI" in cols: return "close","RSI"
        return (cols[0], cols[1] if len(cols) > 1 else cols[0])

    a_col, b_col = _pick_two(use_cols)
    seed_series = (df[a_col] > df[b_col]).astype(float)
    seed_expr   = f"(data['{a_col}'] > data['{b_col}'])"
    pset.addTerminal(seed_series, MaskT, name="CMP0")

    # ---------- 5) TOOLBOX ----------
    toolbox = deap_base.Toolbox()
    toolbox.register("expr", gp.genHalfAndHalf, pset=pset, min_=2, max_=5)
    toolbox.register("individual", deap_tools.initIterate, creator.Individual, toolbox.expr)
    toolbox.register("population", deap_tools.initRepeat, list, toolbox.individual)
    toolbox.register("compile", gp.compile, pset=pset)
    toolbox.register("clone", copy.deepcopy)
    toolbox.register("select", deap_tools.selTournament, tournsize=int(getattr(req,"tournament_k",3)))
    toolbox.register("mate", gp.cxOnePoint)
    toolbox.register("expr_mut", gp.genFull, min_=1, max_=3)
    toolbox.register("mutate", gp.mutUniform, expr=toolbox.expr_mut, pset=pset)

    # ---------- 6) TREE -> EXPR (data['<kolon>']) ----------
    OP = {"_add":"+","_sub":"-","_mul":"*","_div":"/","_gt":">","_lt":"<","_ge":">=","_le":"<=","_and":"&","_or":"|"}

    def _tree_to_expr_str(individual):
        def rec(i):
            node = individual[i[0]]; i[0] += 1
            if isinstance(node, gp.Terminal):
                # T0/T1... -> gerçek kolon
                if node.name in NAME_RENDER:
                    col = NAME_RENDER[node.name]
                    return f"data['{col}']"
                # Seed mask
                if node.name == "CMP0":
                    return seed_expr
                # güvenli fallback
                return "0"
            # Primitive
            args = [rec(i) for _ in range(node.arity)]
            op = OP.get(node.name, node.name)
            if node.arity == 2:
                return f"({args[0]} {op} {args[1]})"
            return f"{op}({', '.join(args)})"
        try:
            return rec([0])
        except Exception:
            return "0"

    # ---------- 7) EVALUATION ----------
    side = req.side if getattr(req,"side",None) in (-1,0,1) else 1
    fee  = float(getattr(req,"fee_pct",0.0) or 0.0)
    slp  = float(getattr(req,"slippage_pct",0.0) or 0.0)
    lev  = float(getattr(req,"leverage",1.0) or 1.0)
    obj  = (getattr(req,"objective","profit") or "profit").lower().strip()
    pen  = float(getattr(req,"complexity_penalty",0.001) or 0.001)
    exit_scheme = req.exit_scheme or ExitSchemeEvt(type="fixed", tp_pct=0.015, sl_pct=0.020)

    CMP_NAMES = {"_gt","_lt","_ge","_le"}
    def _has_comparison(ind):
        return any(getattr(n, "name", "") in CMP_NAMES for n in ind if isinstance(n, gp.Primitive))

    def _mask_to_intent(mask: pd.Series, side_flag: int) -> pd.Series:
        m = mask.fillna(0).clip(0,1)
        if side_flag == 1:   return m.astype(int)        # long-only  (0/1)
        if side_flag == -1:  return (-m).astype(int)     # short-only (0/-1)
        return (m*2 - 1).astype(int)                     # both (-1/1)

    def _eval(ind):
        if not _has_comparison(ind):
            return (-1e9,), {}
        try:
            func = toolbox.compile(expr=ind)
            out  = func()  # -> pd.Series
            if not isinstance(out, pd.Series):
                return (-1e9,), {}
            mask = out.fillna(0).clip(0,1)
            intent = _mask_to_intent(mask, side)
            entry_mask = intent != 0
            if entry_mask.sum() == 0:
                return (-1e9,), {}

            trades = simulate_scheme_over_entries(
                df, req.symbol, entry_mask, side, lev, exit_scheme,
                sgn_series=intent, fee_pct=fee, slippage_pct=slp
            )
            stats = stats_from_trades_basic(trades)

            if obj == "sharpe":
                score = float(stats.get("sharpe", 0.0) or 0.0)
            elif obj == "winrate":
                score = float(stats.get("winRate", 0.0) or 0.0)
            elif obj == "pf":
                score = float(stats.get("pf", 0.0) or 0.0)
            else:
                score = float(stats.get("profit", 0.0) or 0.0)

            if not math.isfinite(score):
                score = -1e9

        except Exception:
            return (-1e9,), {}

        score -= pen * len(ind)
        return (score,), stats

    # ---------- 8) EVOLUTION ----------
    pop_size = int(getattr(req, "population_size", 80) or 80)
    ngen     = int(getattr(req, "generations", 30) or 30)
    cxpb     = float(getattr(req, "crossover_prob", 0.7) or 0.7)
    mutpb    = float(getattr(req, "mutation_prob", 0.2) or 0.2)

    pop = toolbox.population(n=pop_size)
    hof = deap_tools.HallOfFame(20)

    # initial eval
    for ind in pop:
        fit, _ = _eval(ind)
        ind.fitness.values = fit
    hof.update(pop)

    for _ in range(ngen):
        offspring = toolbox.select(pop, len(pop))
        offspring = list(map(toolbox.clone, offspring))

        for c1, c2 in zip(offspring[::2], offspring[1::2]):
            if random.random() < cxpb:
                toolbox.mate(c1, c2)
                if hasattr(c1.fitness, "values"): del c1.fitness.values
                if hasattr(c2.fitness, "values"): del c2.fitness.values

        for m in offspring:
            if random.random() < mutpb:
                toolbox.mutate(m)
                if hasattr(m.fitness, "values"): del m.fitness.values

        invalid = [ind for ind in offspring if not ind.fitness.valid]
        for ind in invalid:
            fit, _ = _eval(ind)
            ind.fitness.values = fit

        pop[:] = offspring
        hof.update(pop)

    # ---------- 9) RESULTS ----------
    results = []
    for ind in list(hof):
        (score,), stats = _eval(ind)
        expr = _tree_to_expr_str(individual=ind)
        results.append({
            "expr": expr,
            "score": float(score),
            "stats": stats,
            "size": int(len(ind))
        })
    results.sort(key=lambda x: x["score"], reverse=True)
    best = results[0] if results else None

    return {
        "best": best,
        "top": results[:10],
        "terminals": use_cols,
        "pop_size": pop_size,
        "generations": ngen,
        "objective": obj,
        "seed_comparison": seed_expr
    }





# Terminals (UI için hafif endpoint)
# =========================
@app.get("/optimize/terminals")
def list_gp_terminals(data_snapshot_id: str, timeframe: str) -> Dict[str, list]:
    sid = data_snapshot_id
    if not sid or sid not in SNAPSHOT_STORE:
        raise HTTPException(status_code=400, detail="data_snapshot_id gereklidir (Setup → Download Data).")

    df = SNAPSHOT_STORE[sid]["df"].copy()
    _BASE_FEATURES = dict(
        macd_fast_default=12, macd_slow_default=26, macd_signal_default=9,
        rsi_period=14, ema_period=20, sma_period=50,
        cci_period=20, adx_period=14, ao_fast=5, ao_slow=34,
        bb_period=20, bb_std=2.0, mfi_period=14,
    )
    df = compute_indicators(df, timeframe=timeframe, **_BASE_FEATURES)

    cols = [c for c in df.columns if np.issubdtype(df[c].dtype, np.number)]
    # sırayı koruyarak benzersiz
    seen = set()
    cols = [c for c in cols if not (c in seen or seen.add(c))]
    return {"terminals": cols}

from fastapi import WebSocket, WebSocketDisconnect

from fastapi import WebSocket, WebSocketDisconnect
import asyncio

@app.websocket("/ws/live")
async def ws_live(websocket: WebSocket):
    import pandas as pd
    import numpy as np

    await websocket.accept()
    try:
        # 1) İlk config: İstemci göndermiyorsa 2 sn bekle, sonra varsayılana düş
        cfg = None
        try:
            cfg = await asyncio.wait_for(websocket.receive_json(), timeout=2.0)
        except asyncio.TimeoutError:
            cfg = {}
        except Exception:
            cfg = {}

        symbol       = cfg.get("symbol", "ORDIUSDT")
        timeframe    = cfg.get("timeframe", "5m")
        days         = float(cfg.get("days", 2))
        tp_pct       = float(cfg.get("tp", 0.01))
        sl_pct       = float(cfg.get("sl", 0.01))
        leverage     = float(cfg.get("leverage", 3.0))
        fee_pct      = float(cfg.get("fee_pct", 0.1)) / 100.0
        slip_pct     = float(cfg.get("slippage_pct", 0.04)) / 100.0
        indicators   = cfg.get("indicators") or {}
        interval_sec = float(cfg.get("interval_sec", 3.0))

        # Tekli geriye uyumluluk
        strategies = cfg.get("strategies") or [{
            "id": "S1",
            "expr": cfg.get("expr", "data['close'] > data['close'].shift(1)"),
            "params": cfg.get("params") or {},
            "side": int(cfg.get("side", 1)),
            "respect_expr_sign": bool(cfg.get("respect_expr_sign", True)),
        }]

        # 2) İlk veri ve indikatörler
        now   = pd.Timestamp.utcnow()
        start = now - pd.Timedelta(days=days)
        df0   = load_ohlcv(symbol, timeframe, start.isoformat(), now.isoformat())
        if df0 is None or len(df0) == 0:
            await websocket.send_json({"type": "error", "message": "No data loaded."})
            return
        df    = compute_indicators(df0, timeframe=timeframe, **indicators)

        # 3) Entries üretici
        def make_entries(df_local, strat):
            return expr_to_entries(
                df_local,
                strat["expr"],
                strat.get("params") or {},
                side=int(strat.get("side", 1)),
                respect_expr_sign=bool(strat.get("respect_expr_sign", True))
            )

        entries_map = {s["id"]: make_entries(df, s) for s in strategies}

        # 4) Açık pozisyon snapshot (bar kapanışından itibaren)
        open_map = {}  # {sid: {side, entry, tp, sl, entry_time}}
        idx = df.index

        def snap_open(sid, e_series: pd.Series):
            close = df["close"].to_numpy()
            high  = df["high"].to_numpy()
            low   = df["low"].to_numpy()
            n = len(df)
            # son bar kapalı; geçmişte açık kalmış pozisyonu bul
            for i in range(n-2):  # en az bir bar sonrasını kontrol edeceğiz
                ent = int(e_series.iloc[i])
                if ent == 0:
                    continue
                side_s = int(np.sign(ent) * int([st for st in strategies if st["id"] == sid][0]["side"]))
                if side_s == 0:
                    continue
                entry = float(close[i]); rd = 4
                if side_s > 0:
                    tp_p = round(entry * (1 + tp_pct), rd)
                    sl_p = round(entry * (1 - sl_pct), rd)
                else:
                    tp_p = round(entry * (1 - tp_pct), rd)
                    sl_p = round(entry * (1 + sl_pct), rd)
                # kapanmış mı?
                closed = False
                for j in range(i+1, n-1):  # son kapalı bara kadar tara
                    hi = float(high[j]); lo = float(low[j])
                    if (side_s > 0 and (lo <= sl_p or hi >= tp_p)) or (side_s < 0 and (hi >= sl_p or lo <= tp_p)):
                        closed = True
                        break
                if not closed:
                    return dict(side=side_s, entry=entry, tp=tp_p, sl=sl_p, entry_time=str(idx[i]))
            return None

        events = []
        for sid, e in entries_map.items():
            snap = snap_open(sid, e)
            if snap:
                events.append({
                    "strategy_id": sid, "type": "OPEN_SNAPSHOT", "time": snap["entry_time"],
                    "side": snap["side"], "entry_price": snap["entry"], "tp": snap["tp"], "sl": snap["sl"]
                })
                open_map[sid] = {k: snap[k] for k in ("side", "entry", "tp", "sl", "entry_time")}

        # 5) İlk tick’i gönder
        last = df.iloc[-1]; ts = str(df.index[-1])
        await websocket.send_json({
            "type": "tick",
            "time": ts,
            "close": float(last["close"]),
            "high": float(last["high"]),
            "low": float(last["low"]),
            "price": {"time": ts, "close": float(last["close"]), "high": float(last["high"]), "low": float(last["low"])},
            "events": events
        })

        # 6) Döngü
        while True:
            try:
                now   = pd.Timestamp.utcnow()
                start = now - pd.Timedelta(days=days)
                df0   = load_ohlcv(symbol, timeframe, start.isoformat(), now.isoformat())
                df    = compute_indicators(df0, timeframe=timeframe, **indicators)
                idx   = df.index

                tick_events = []
                for s in strategies:
                    sid = s["id"]
                    e_series = make_entries(df, s)
                    entries_map[sid] = e_series

                    # açık yoksa yeni giriş?
                    if sid not in open_map:
                        i = len(df) - 2  # yeni bar onaylanana kadar bir önceki bar
                        if i >= 0 and int(e_series.iloc[i]) != 0:
                            side_s = int(np.sign(int(e_series.iloc[i])) * int(s.get("side", 1)))
                            if side_s != 0:
                                entry = float(df["close"].iloc[i]); rd = 4
                                if side_s > 0:
                                    tp_p = round(entry * (1 + tp_pct), rd); sl_p = round(entry * (1 - sl_pct), rd)
                                else:
                                    tp_p = round(entry * (1 - tp_pct), rd); sl_p = round(entry * (1 + sl_pct), rd)
                                open_map[sid] = {"side": side_s, "entry": entry, "tp": tp_p, "sl": sl_p, "entry_time": str(idx[i])}
                                tick_events.append({
                                    "strategy_id": sid, "type": "OPEN", "time": str(idx[i]),
                                    "side": side_s, "entry_price": entry, "tp": tp_p, "sl": sl_p
                                })
                    else:
                        # açık pozisyon: son bar içinde kapandı mı?
                        o = open_map[sid]
                        j = len(df) - 1
                        if j >= 0:
                            hi = float(df["high"].iloc[j]); lo = float(df["low"].iloc[j])
                            exit_reason = None; exit_price = None; tp_hit = False; sl_hit = False
                            if o["side"] > 0:
                                if lo <= o["sl"]:
                                    exit_reason = "sl"; exit_price = o["sl"]; sl_hit = True
                                elif hi >= o["tp"]:
                                    exit_reason = "tp"; exit_price = o["tp"]; tp_hit = True
                            else:
                                if hi >= o["sl"]:
                                    exit_reason = "sl"; exit_price = o["sl"]; sl_hit = True
                                elif lo <= o["tp"]:
                                    exit_reason = "tp"; exit_price = o["tp"]; tp_hit = True

                            if exit_reason:
                                entry_price = float(o["entry"])
                                raw_ret = (exit_price - entry_price) / entry_price if o["side"] > 0 else (entry_price - exit_price) / entry_price
                                pnl = (raw_ret * leverage) - (fee_pct + slip_pct)
                                tick_events.append({
                                    "strategy_id": sid, "type": exit_reason.upper(), "time": str(idx[j]),
                                    "side": o["side"], "entry_price": entry_price, "exit_price": float(exit_price),
                                    "tp_hit": tp_hit, "sl_hit": sl_hit, "pnl": float(pnl)
                                })
                                del open_map[sid]

                # fiyat
                last = df.iloc[-1]; ts = str(df.index[-1])
                await websocket.send_json({
                    "type": "tick",
                    "time": ts,
                    "close": float(last["close"]),
                    "high": float(last["high"]),
                    "low": float(last["low"]),
                    "price": {"time": ts, "close": float(last["close"]), "high": float(last["high"]), "low": float(last["low"])},
                    "events": tick_events
                })

            except WebSocketDisconnect:
                break
            except Exception as e:
                # Hata gönder ve döngüye devam et
                try:
                    await websocket.send_json({"type": "error", "message": f"{type(e).__name__}: {e}"})
                except Exception:
                    break

            await asyncio.sleep(interval_sec)

    finally:
        try:
            await websocket.close()
        except Exception:
            pass


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("optimizer_api:app", host="127.0.0.1", port=8000, reload=True)
