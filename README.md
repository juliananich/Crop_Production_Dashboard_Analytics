# Crop Production Dashboard Analytics

An interactive descriptive-analytics dashboard on India's crop production (1997–2015), built for agriculture planners and students. Explore yields, production, and area sown across **states, seasons, crops, and years** with instant, in-browser filtering.

**Live demo:** https://juliananich.github.io/Crop_Production_Dashboard_Analytics/

## What's inside

| File | Purpose |
|---|---|
| `index.html`, `styles.css`, `app.js` | Static dashboard (Harvest Ledger) — no build step, runs 100% in the browser |
| `data.js` | Pre-processed dataset (~246k records) embedded as a JS module for the static site |
| `model.js`, `model_results.json` | Aggregation / model helpers used by the dashboard |
| `plotly.min.js` | Vendored Plotly charting library (works offline) |
| `app.py`, `clean.py` | Alternative **Streamlit** version of the same dashboard |
| `crop_production.csv` | Raw source data (Kaggle) |
| `cleaned_crop_production.csv` | Cleaned data produced by `clean.py` (same steps as the notebook) |
| `Group9_1_..._FINAL.ipynb` | Full descriptive-analytics notebook (cleaning, EDA, statistics) |
| `Dashboard_Video_Script.pdf`, `Dataset_and_Dashboard_Guide.pdf` | Presentation script and user guide |

## Run it locally

**Static dashboard** (recommended — instant load):

```bash
python -m http.server 8000
# then open http://localhost:8000
```

**Streamlit version:**

```bash
pip install streamlit pandas numpy plotly scipy
streamlit run app.py
```

## Data source

Ministry of Agriculture & Farmers Welfare, Government of India (via Kaggle — *AravindPCoder*).
Units differ by crop — coconut is recorded in nuts, so cross-crop totals describe recorded volume, not weight or value.

## Deploying

The static site is hosted with **GitHub Pages** from the `main` branch (root).

- Enabling: repo **Settings → Pages → Deploy from a branch → `main` / root**.
- Every push to `main` republishes automatically in ~1–2 minutes.
- `.nojekyll` is included so GitHub serves the files as-is without a Jekyll build.
