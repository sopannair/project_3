#!/usr/bin/env python3
"""
Create a small, web-friendly aggregate for D3.

Input:
  data/raw/Real_Estate_Sales_2001-2023_GL.csv

Output:
  data/derived/town_year_agg.csv
"""

import pandas as pd
from pathlib import Path

RAW = Path("data/raw/Real_Estate_Sales_2001-2023_GL.csv")
OUT = Path("data/derived/town_year_agg.csv")
OUT.parent.mkdir(parents=True, exist_ok=True)

# Columns we need (case-sensitive to your file; adjust if different)
USECOLS = [
    "Serial Number", "List Year", "Date Recorded", "Town",
    "Sale Amount", "Sales Ratio", "Property Type"
]

# Helper to parse a chunk and return a tidy DataFrame
def tidy_chunk(df):
    # Keep only the columns we care about (in case read_csv pulled extras)
    df = df[USECOLS].copy()

    # Parse numerics
    df["Sale Amount"] = pd.to_numeric(df["Sale Amount"], errors="coerce")
    df["Sales Ratio"] = pd.to_numeric(df["Sales Ratio"], errors="coerce")

    # Year: prefer Date Recorded; fallback to List Year
    date_year = pd.to_datetime(df["Date Recorded"], errors="coerce").dt.year
    list_year = pd.to_numeric(df["List Year"], errors="coerce").astype("Int64")
    df["Year"] = date_year.fillna(list_year)

    # Clean strings
    df["Town"] = df["Town"].astype(str).str.strip().str.title()
    df["Property Type"] = df["Property Type"].astype(str).str.strip()

    # Drop rows missing essentials
    df = df.dropna(subset=["Town", "Year", "Sale Amount"])

    # Group by Town × Year × PropertyType
    g = (df
         .groupby(["Town", "Year", "Property Type"], dropna=False)
         .agg(NumSales=("Sale Amount", "count"),
              MedianSale=("Sale Amount", "median"),
              AvgSalesRatio=("Sales Ratio", "mean"))
         .reset_index()
         .rename(columns={"Property Type": "PropertyType"}))

    return g

# Read in chunks and aggregate incrementally
CHUNK = 250_000  # tune if needed
partials = []

for chunk in pd.read_csv(
    RAW, usecols=USECOLS, chunksize=CHUNK, low_memory=False
):
    partials.append(tidy_chunk(chunk))

# Combine partial aggregates and re-aggregate to finalize
agg = (pd.concat(partials, ignore_index=True)
         .groupby(["Town", "Year", "PropertyType"], as_index=False)
         .agg(NumSales=("NumSales", "sum"),
              MedianSale=("MedianSale", "median"),   # median of medians ≈ robust
              AvgSalesRatio=("AvgSalesRatio", "mean")))

# Sort for stable diffs and nicer reading
agg = agg.sort_values(["Town", "Year", "PropertyType"], kind="mergesort")

# Save
agg.to_csv(OUT, index=False)
print(f"Wrote {OUT} with shape {agg.shape}")
