"""ENTSO-E raw CSV to focused JSON files for the frontend."""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
RAW_CSV = ROOT / "data" / "entsoe_data_2024_2025.csv"
OUTPUT_DIR = ROOT / "docs" / "data" / "processed"

DISPLAY_TZ = "Europe/Berlin"

RAW_FOCUS_COUNTRIES = ["CH", "DE_LU", "FR", "IT_NORD", "AT"]

# Raw CSV code to frontend code.
COUNTRY_RENAME = {
    "CH": "CH",
    "DE_LU": "DE",
    "FR": "FR",
    "IT_NORD": "IT",
    "AT": "AT",
}

# CH first — it's the story's protagonist.
FOCUS_ORDER = ["CH", "DE", "FR", "IT", "AT"]

# Hydro sub-components and `_*_actual_aggregated_` alternates are ignored; hydro_total is the one populated column.
GENERATION_COLUMNS = [
    "solar",
    "wind_onshore",
    "wind_offshore",
    "nuclear",
    "hydro_total",
    "fossil_gas",
    "fossil_hard_coal",
    "fossil_brown_coal_lignite",
    "fossil_oil",
    "biomass",
    "other",
    "other_renewable",
    "geothermal",
]

RENEWABLE_COLUMNS = ["solar", "wind_onshore", "wind_offshore", "hydro_total"]

# Country sparsity reference (missing = always 0 for that country):
#   CH: fossil_*, biomass, wind_offshore
#   DE: nuclear
#   AT: nuclear, fossil_hard_coal, fossil_oil, biomass, wind_offshore
#   IT: wind_offshore
#   FR: all populated

# Sunny Sunday where CH hit -€145.12/MWh at 13:00 CET, deeper than DE.
SHOWCASE_DATE = "2024-05-12"
SHOWCASE_PEAK_HOUR = 13  # CET, CH's -145.12 trough.


def load_raw() -> pd.DataFrame:
    """Load raw CSV. The datetime column mixes CET/CEST offsets, so parse as UTC and convert."""
    if not RAW_CSV.exists():
        raise FileNotFoundError(f"raw dataset not found at {RAW_CSV}")
    df = pd.read_csv(RAW_CSV)
    df["datetime"] = pd.to_datetime(df["datetime"], utc=True).dt.tz_convert(DISPLAY_TZ)
    return df


def filter_focus(df: pd.DataFrame) -> pd.DataFrame:
    return df[df["country"].isin(RAW_FOCUS_COUNTRIES)].copy()


def rename_countries(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["country"] = df["country"].map(COUNTRY_RENAME)
    return df


def fill_missing_generation(df: pd.DataFrame) -> pd.DataFrame:
    """Fill missing generation with 0 — a missing column means the source genuinely doesn't exist there (e.g. no gas in CH), not unknown data."""
    df = df.copy()
    for col in GENERATION_COLUMNS:
        if col in df.columns:
            df[col] = df[col].fillna(0.0)
    return df


def forward_fill_prices(df: pd.DataFrame) -> pd.DataFrame:
    """Forward-fill the single missing price hour per country."""
    df = df.copy().sort_values(["country", "datetime"])
    df["price"] = df.groupby("country", sort=False)["price"].ffill()
    return df


def add_renewable_share(df: pd.DataFrame) -> pd.DataFrame:
    """renewable_share in [0, 1]; NaN when total generation is 0."""
    import numpy as np

    df = df.copy()
    numerator = sum(df[c] for c in RENEWABLE_COLUMNS if c in df.columns)
    denominator = sum(df[c] for c in GENERATION_COLUMNS if c in df.columns)
    share = numerator / denominator.where(denominator > 0, np.nan)
    df["renewable_share"] = share
    return df


def standard_prep() -> pd.DataFrame:
    df = load_raw()
    df = filter_focus(df)
    df = rename_countries(df)
    df = fill_missing_generation(df)
    df = forward_fill_prices(df)
    df = add_renewable_share(df)
    return df


def save_json(obj: object, filename: str, *, minified: bool = True) -> Path:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUTPUT_DIR / filename
    with path.open("w") as f:
        if minified:
            json.dump(obj, f, separators=(",", ":"), default=_json_default)
        else:
            json.dump(obj, f, indent=2, default=_json_default)
    size_kb = path.stat().st_size / 1024
    print(f"  wrote {path.relative_to(ROOT)}  ({size_kb:.1f} KB)")
    return path


def _json_default(value: object) -> object:
    """Fallback for pandas/numpy types json can't serialise."""
    if isinstance(value, pd.Timestamp):
        return value.isoformat()
    if hasattr(value, "item"):
        return value.item()
    raise TypeError(f"unserializable type: {type(value).__name__}")


@dataclass
class Target:
    name: str
    description: str
    builder: Callable[[pd.DataFrame], None]


def _not_implemented(name: str) -> Callable[[pd.DataFrame], None]:
    def stub(_df: pd.DataFrame) -> None:
        raise NotImplementedError(
            f"builder for target '{name}' is not implemented yet"
        )
    return stub


def build_showcase_day(df: pd.DataFrame) -> None:
    """24 hourly rows per country for the showcase date. Country-major so each array joins directly to an SVG path."""
    target_date = pd.Timestamp(SHOWCASE_DATE).date()
    day = df[df["datetime"].dt.date == target_date].copy()
    if day.empty:
        raise RuntimeError(f"no rows found for {SHOWCASE_DATE}")
    day["hour"] = day["datetime"].dt.hour

    countries: dict[str, list[dict[str, object]]] = {}
    for code in FOCUS_ORDER:
        rows = day[day["country"] == code].sort_values("hour")
        if len(rows) != 24:
            raise RuntimeError(
                f"{code}: expected 24 hours on {SHOWCASE_DATE}, got {len(rows)}"
            )
        hourly: list[dict[str, object]] = []
        for _, r in rows.iterrows():
            wind = float(r["wind_onshore"]) + float(r["wind_offshore"])
            share = r["renewable_share"]
            hourly.append({
                "hour": int(r["hour"]),
                "price": round(float(r["price"]), 2),
                "solar": int(round(float(r["solar"]))),
                "wind": int(round(wind)),
                "hydro": int(round(float(r["hydro_total"]))),
                "nuclear": int(round(float(r["nuclear"]))),
                "gas": int(round(float(r["fossil_gas"]))),
                "renewable_share": (
                    None if pd.isna(share) else round(float(share), 3)
                ),
            })
        countries[code] = hourly

    payload = {
        "date": SHOWCASE_DATE,
        "timezone": DISPLAY_TZ,
        "peak_hour": SHOWCASE_PEAK_HOUR,
        "countries": countries,
    }
    save_json(payload, "showcase_day.json")

    # CH's -145.12 at hour 13 is the headline fact the opening animation is built on — fail loudly if it drifts.
    ch_peak = countries["CH"][SHOWCASE_PEAK_HOUR]["price"]
    if abs(ch_peak - (-145.12)) > 0.5:
        raise RuntimeError(
            f"CH peak price at hour {SHOWCASE_PEAK_HOUR} is {ch_peak}, "
            f"expected -145.12"
        )
    print(f"  peak moment: CH={ch_peak} EUR/MWh at hour {SHOWCASE_PEAK_HOUR} CET")


def build_calendar_heatmap(df: pd.DataFrame) -> None:
    """CH and DE hourly prices nested by day. Day arrays vary in length on DST days (23 or 25 hours); format handles it without special casing."""
    countries = ["CH", "DE"]
    sub = df[df["country"].isin(countries)].copy()
    sub = sub.sort_values(["country", "datetime"])
    sub["date"] = sub["datetime"].dt.date
    sub["hour"] = sub["datetime"].dt.hour

    # Hours aren't assumed contiguous — on spring-forward the 02:00 slot is legitimately absent.
    binned: dict[tuple[str, object], list[float]] = {}
    for (country, date), group in sub.groupby(["country", "date"], sort=False):
        prices = [
            round(float(p), 2)
            for _, p in sorted(
                zip(group["hour"], group["price"]),
                key=lambda t: t[0],
            )
        ]
        binned[(country, date)] = prices

    dates = sorted(sub["date"].unique())
    days: list[dict[str, object]] = []
    for date in dates:
        record: dict[str, object] = {
            "date": date.isoformat(),
            "dow": date.weekday(),  # 0=Mon .. 6=Sun
        }
        for country in countries:
            record[country] = binned.get((country, date), [])
        days.append(record)

    payload = {
        "start_date": dates[0].isoformat(),
        "end_date": dates[-1].isoformat(),
        "timezone": DISPLAY_TZ,
        "countries": countries,
        "days": days,
    }
    save_json(payload, "calendar_heatmap.json")

    # Targets come from the exploration pass.
    total_hours = {c: sum(len(d[c]) for d in days) for c in countries}
    neg_hours = {
        c: sum(1 for d in days for price in d[c] if price < 0)
        for c in countries
    }
    expected_neg = {"CH": 529, "DE": 846}
    for c in countries:
        if neg_hours[c] != expected_neg[c]:
            raise RuntimeError(
                f"{c}: expected {expected_neg[c]} negative hours, got {neg_hours[c]}"
            )

    irregular = [(d["date"], len(d["CH"])) for d in days if len(d["CH"]) != 24]
    print(
        f"  days: {len(days)}  "
        f"hours: CH={total_hours['CH']} DE={total_hours['DE']}  "
        f"neg: CH={neg_hours['CH']} DE={neg_hours['DE']}"
    )
    if irregular:
        print("  irregular days (DST or dataset-edge truncation):")
        for date, n in irregular:
            print(f"    {date}: {n} hours")


def build_daily_profiles(df: pd.DataFrame) -> None:
    """Mean hourly price per (country, month) plus per-country annual average. Drives the duck-curve animation and small multiples."""
    work = df.copy()
    work["year"] = work["datetime"].dt.year
    work["month"] = work["datetime"].dt.month
    work["hour"] = work["datetime"].dt.hour
    work["month_key"] = work["datetime"].dt.strftime("%Y-%m")

    # Sorted so the frontend iterates chronologically, not via JS key insertion order.
    months = sorted(work["month_key"].unique())

    countries: dict[str, dict[str, object]] = {}
    for code in FOCUS_ORDER:
        country_df = work[work["country"] == code]

        monthly_means = (
            country_df.groupby(["month_key", "hour"], sort=False)["price"]
            .mean()
            .reset_index()
        )
        monthly: dict[str, list[float]] = {}
        for month_key in months:
            month_rows = monthly_means[monthly_means["month_key"] == month_key]
            by_hour = {int(r["hour"]): round(float(r["price"]), 2) for _, r in month_rows.iterrows()}
            # Fixed-length 24 vector; missing hours (rare) are None so charts can interpolate.
            profile = [by_hour.get(h) for h in range(24)]
            if any(p is None for p in profile):
                raise RuntimeError(
                    f"{code} {month_key}: missing hours in monthly profile"
                )
            monthly[month_key] = profile  # type: ignore[assignment]

        # Ghost overlay for Step 7 and the explorer sidebar.
        annual_series = country_df.groupby("hour")["price"].mean()
        annual = [round(float(annual_series[h]), 2) for h in range(24)]

        countries[code] = {
            "annual_average": annual,
            "monthly": monthly,
        }

    payload = {
        "timezone": DISPLAY_TZ,
        "months": months,
        "countries": countries,
    }
    save_json(payload, "daily_profiles.json")

    if len(months) != 18:
        raise RuntimeError(f"expected 18 months (Jan 2024 – Jun 2025), got {len(months)}")
    for code in FOCUS_ORDER:
        entry = countries[code]
        if len(entry["monthly"]) != 18:  # type: ignore[arg-type]
            raise RuntimeError(f"{code}: expected 18 monthly profiles")
        if len(entry["annual_average"]) != 24:  # type: ignore[arg-type]
            raise RuntimeError(f"{code}: expected 24 annual-average points")

    # DE should show a midday dip; if not, the groupby is broken.
    de_annual = countries["DE"]["annual_average"]
    midday_min = min(de_annual[9:16])  # type: ignore[index]
    evening_max = max(de_annual[17:22])  # type: ignore[index]
    if midday_min >= evening_max:
        raise RuntimeError(
            "DE annual profile has no duck shape — check groupby logic "
            f"(midday min={midday_min}, evening max={evening_max})"
        )

    # FR (nuclear baseload) should be flatter than DE.
    de_spread = max(de_annual) - min(de_annual)  # type: ignore[arg-type]
    fr_spread = max(countries["FR"]["annual_average"]) - min(countries["FR"]["annual_average"])  # type: ignore[arg-type]
    print(
        f"  months: {len(months)}  "
        f"countries: {list(countries.keys())}"
    )
    print(
        f"  DE annual spread: {de_spread:.1f} EUR/MWh  "
        f"FR annual spread: {fr_spread:.1f} EUR/MWh  "
        f"(duck vs baseload)"
    )


def build_explorer_hourly(df: pd.DataFrame) -> None:
    """Full-range hourly prices + renewable share, date-major. M2 prototype still uses showcase_day.json; this is for future expansion."""
    work = df.copy()
    work["date"] = work["datetime"].dt.strftime("%Y-%m-%d")
    work["hour"] = work["datetime"].dt.hour

    dates = sorted(work["date"].unique())
    days = []
    for date in dates:
        day_df = work[work["date"] == date]
        record: dict[str, object] = {"date": date}
        for code in FOCUS_ORDER:
            cdf = day_df[day_df["country"] == code].sort_values("hour")
            prices = [round(float(r["price"]), 2) for _, r in cdf.iterrows()]
            ren = [round(float(r["renewable_share"]), 3) if not pd.isna(r["renewable_share"]) else 0 for _, r in cdf.iterrows()]
            record[code] = {
                "prices": prices,
                "renewable": ren,
            }
        days.append(record)

    payload = {
        "start_date": dates[0],
        "end_date": dates[-1],
        "timezone": DISPLAY_TZ,
        "countries": FOCUS_ORDER,
        "days": days,
    }
    save_json(payload, "explorer_hourly.json")

    assert len(days) > 500, f"expected 500+ days, got {len(days)}"
    sample = days[0]
    for code in FOCUS_ORDER:
        assert len(sample[code]["prices"]) >= 23, f"{code} day 0 has <23 hours"
    print(f"  days: {len(days)}  countries: {FOCUS_ORDER}")


def build_generation_stacks(df: pd.DataFrame) -> None:
    """Full-range hourly {solar, wind, hydro, nuclear, gas} per country. M2 still uses showcase_day.json; this is for future expansion."""
    # Raw columns collapsed into the 5 frontend buckets. Coal lumps into gas.
    GEN_MAP = {
        "solar": "solar",
        "wind_onshore": "wind",
        "wind_offshore": "wind",
        "hydro_total": "hydro",
        "nuclear": "nuclear",
        "fossil_gas": "gas",
        "fossil_hard_coal": "gas",
        "fossil_brown_coal_lignite": "gas",
    }

    work = df.copy()
    work["date"] = work["datetime"].dt.strftime("%Y-%m-%d")
    work["hour"] = work["datetime"].dt.hour

    for target_col in ["solar", "wind", "hydro", "nuclear", "gas"]:
        source_cols = [k for k, v in GEN_MAP.items() if v == target_col and k in work.columns]
        if source_cols:
            work[f"gen_{target_col}"] = sum(work[c].fillna(0) for c in source_cols)
        else:
            work[f"gen_{target_col}"] = 0.0

    dates = sorted(work["date"].unique())
    days = []
    for date in dates:
        day_df = work[work["date"] == date]
        record: dict[str, object] = {"date": date}
        for code in FOCUS_ORDER:
            cdf = day_df[day_df["country"] == code].sort_values("hour")
            record[code] = {
                "solar": [int(r[f"gen_solar"]) for _, r in cdf.iterrows()],
                "wind": [int(r[f"gen_wind"]) for _, r in cdf.iterrows()],
                "hydro": [int(r[f"gen_hydro"]) for _, r in cdf.iterrows()],
                "nuclear": [int(r[f"gen_nuclear"]) for _, r in cdf.iterrows()],
                "gas": [int(r[f"gen_gas"]) for _, r in cdf.iterrows()],
            }
        days.append(record)

    payload = {
        "start_date": dates[0],
        "end_date": dates[-1],
        "timezone": DISPLAY_TZ,
        "countries": FOCUS_ORDER,
        "days": days,
    }
    save_json(payload, "generation_stacks.json")

    assert len(days) > 500, f"expected 500+ days, got {len(days)}"
    # DE solar at showcase peak should be >40 GW.
    showcase = next(d for d in days if d["date"] == SHOWCASE_DATE)
    de_solar_13 = showcase["DE"]["solar"][13]
    assert de_solar_13 > 40000, f"DE solar at showcase peak should be >40k, got {de_solar_13}"
    print(f"  days: {len(days)}  DE solar at peak: {de_solar_13} MW")


TARGETS: dict[str, Target] = {
    "showcase_day": Target(
        name="showcase_day",
        description="Hourly prices + generation for 2024-05-12 across 5 countries (Steps 1-3).",
        builder=build_showcase_day,
    ),
    "calendar_heatmap": Target(
        name="calendar_heatmap",
        description="Hourly prices for DE and CH, full date range (Step 4).",
        builder=build_calendar_heatmap,
    ),
    "daily_profiles": Target(
        name="daily_profiles",
        description="Average hourly price profile per country per month (Step 6).",
        builder=build_daily_profiles,
    ),
    "explorer_hourly": Target(
        name="explorer_hourly",
        description="Hourly prices + renewable share for 5 countries, full range (Explorer).",
        builder=build_explorer_hourly,
    ),
    "generation_stacks": Target(
        name="generation_stacks",
        description="Hourly generation mix per country, full range (Step 5 + Explorer).",
        builder=build_generation_stacks,
    ),
    "summary_stats": Target(
        name="summary_stats",
        description="Global stats the frontend shows before data arrives (counts, extremes).",
        builder=_not_implemented("summary_stats"),
    ),
}


def build(names: list[str]) -> None:
    print(f"Loading and preparing raw data from {RAW_CSV.relative_to(ROOT)}")
    df = standard_prep()
    print(f"  rows after focus filter: {len(df):,}")
    print(f"  countries: {sorted(df['country'].unique())}")

    failures: list[tuple[str, Exception]] = []
    for name in names:
        target = TARGETS[name]
        print()
        print(f"Building target: {name} — {target.description}")
        try:
            target.builder(df)
        except NotImplementedError as exc:
            print(f"  skipped: {exc}")
        except Exception as exc:  # noqa: BLE001
            failures.append((name, exc))
            print(f"  FAILED: {exc}")

    if failures:
        print()
        print(f"{len(failures)} target(s) failed:")
        for name, exc in failures:
            print(f"  - {name}: {exc}")
        sys.exit(1)


def _parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build preprocessed JSON artefacts for the frontend.",
    )
    parser.add_argument(
        "targets",
        nargs="*",
        help="Target name(s) to build. Empty means build every target.",
    )
    parser.add_argument(
        "--list",
        action="store_true",
        help="List available targets and exit.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> None:
    args = _parse_args(argv or sys.argv[1:])

    if args.list:
        print("Available targets:")
        for target in TARGETS.values():
            print(f"  {target.name:20s}  {target.description}")
        return

    if args.targets:
        unknown = [t for t in args.targets if t not in TARGETS]
        if unknown:
            print(f"unknown target(s): {unknown}", file=sys.stderr)
            print(f"available: {list(TARGETS.keys())}", file=sys.stderr)
            sys.exit(2)
        names = args.targets
    else:
        names = list(TARGETS.keys())

    build(names)


if __name__ == "__main__":
    main()
