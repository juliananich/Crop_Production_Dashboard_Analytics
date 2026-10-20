"""Clean crop_production.csv using the same steps as the notebook (sections 5-6)."""
import pandas as pd

RAW = "crop_production.csv"
CLEAN = "cleaned_crop_production.csv"


def clean(raw: pd.DataFrame) -> pd.DataFrame:
    df = raw.copy()
    df.columns = df.columns.str.strip().str.replace(" ", "_")
    for col in ["State_Name", "District_Name", "Season", "Crop"]:
        df[col] = df[col].astype("string").str.strip()
    df["Crop_Year"] = pd.to_numeric(df["Crop_Year"], errors="coerce").astype("Int64")
    df["Area"] = pd.to_numeric(df["Area"], errors="coerce")
    df["Production"] = pd.to_numeric(df["Production"], errors="coerce")
    return df.dropna(subset=["Production"]).reset_index(drop=True)


if __name__ == "__main__":
    raw = pd.read_csv(RAW)
    out = clean(raw)
    out.to_csv(CLEAN, index=False)
    print(f"raw rows: {len(raw)}  cleaned rows: {len(out)}  saved -> {CLEAN}")
