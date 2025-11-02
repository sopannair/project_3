#!/usr/bin/env python3
"""
Create small, web-friendly aggregates for D3 visualization.

Input:
  data/raw/Real_Estate_Sales_2001-2023_GL.csv

Outputs:
  data/derived/town_year_agg.csv           (all property types)
  data/derived/town_year_residential.csv   (only residential & subtypes)
"""

import pandas as pd
from pathlib import Path

RAW = Path("data/raw/Real_Estate_Sales_2001-2023_GL.csv")
OUT_ALL = Path("data/derived/town_year_agg.csv")
OUT_RES = Path("data/derived/town_year_residential.csv")
OUT_ALL.parent.mkdir(parents=True, exist_ok=True)

USECOLS = [
    "Serial Number", "List Year", "Date Recorded", "Town",
    "Sale Amount", "Sales Ratio", "Property Type", "Residential Type"  # 👈 add this
]


# --- Define helper functions ---
def tidy_chunk(df):
    df = df[USECOLS].copy()
    # numerics
    df["Sale Amount"] = pd.to_numeric(df["Sale Amount"], errors="coerce")
    df["Sales Ratio"] = pd.to_numeric(df["Sales Ratio"], errors="coerce")
    # year
    date_year = pd.to_datetime(df["Date Recorded"], errors="coerce").dt.year
    list_year = pd.to_numeric(df["List Year"], errors="coerce").astype("Int64")
    df["Year"] = date_year.fillna(list_year)

    # strings
    df["Town"] = df["Town"].astype(str).str.strip().str.title()
    df["Property Type"] = df["Property Type"].astype(str).str.strip()
    df["Residential Type"] = df["Residential Type"].astype(str).str.strip()

    df = df.dropna(subset=["Town", "Year", "Sale Amount"])

    # aggregate by Town × Year × Property Type × Residential Type
    g = (
        df.groupby(["Town", "Year", "Property Type", "Residential Type"], dropna=False)
          .agg(
              NumSales=("Sale Amount", "count"),
              MedianSale=("Sale Amount", "median"),
              AvgSalesRatio=("Sales Ratio", "mean"),
          )
          .reset_index()
    )
    return g

# --- Process the large CSV in chunks ---
CHUNK = 250_000
partials = []

for chunk in pd.read_csv(RAW, usecols=USECOLS, chunksize=CHUNK, low_memory=False):
    partials.append(tidy_chunk(chunk))

agg = (
    pd.concat(partials, ignore_index=True)
      .groupby(["Town", "Year", "Property Type", "Residential Type"], as_index=False)
      .agg(
          NumSales=("NumSales", "sum"),
          MedianSale=("MedianSale", "median"),
          AvgSalesRatio=("AvgSalesRatio", "mean"),
      )
      .sort_values(["Town", "Year", "Property Type", "Residential Type"])
)


# --- Export: All property types ---
agg.to_csv(OUT_ALL, index=False)

# --- Residential-only files ---
RES_TYPES = [
    "Residential", "Single Family", "Two Family", "Three Family",
    "Four Family", "Condo", "Apartments", "Apartment", "Townhouse",
    "Co-op", "Condominium"
]
agg_res = agg[agg["Property Type"].str.strip().isin(RES_TYPES)].copy()

# NEW: export a residential-by-residential-type file
OUT_RES_BYTYPE = Path("data/derived/town_year_residential_bytype.csv")
agg_res["Residential Type"] = agg_res["Residential Type"].replace({"": "Unspecified"}).fillna("Unspecified")
agg_res.to_csv(OUT_RES_BYTYPE, index=False)
print(f"Wrote {OUT_RES_BYTYPE} with shape {agg_res.shape}")

# Keep your previous residential-only export if you want:
OUT_RES = Path("data/derived/town_year_residential.csv")
agg_res_simple = agg_res.drop(columns=["Residential Type"])
agg_res_simple.to_csv(OUT_RES, index=False)
print(f"Wrote {OUT_RES} with shape {agg_res_simple.shape}")
