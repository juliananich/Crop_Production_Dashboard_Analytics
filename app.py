"""India Crop Production - descriptive analytics dashboard.  Run: streamlit run app.py"""
import numpy as np
import pandas as pd
import plotly.express as px
import streamlit as st
from scipy import stats

from clean import CLEAN, RAW, clean

st.set_page_config(page_title="India Crop Production", page_icon="🌾", layout="wide")

PALETTE = px.colors.qualitative.Safe


# ---------------------------------------------------------------- data
@st.cache_data
def load_raw() -> pd.DataFrame:
    return pd.read_csv(RAW)


@st.cache_data
def load_clean() -> pd.DataFrame:
    try:
        df = pd.read_csv(CLEAN)
    except FileNotFoundError:
        df = clean(load_raw())
    for col in ["State_Name", "District_Name", "Season", "Crop"]:
        df[col] = df[col].astype(str).str.strip()
    df["Yield"] = np.where(df["Area"] > 0, df["Production"] / df["Area"], np.nan)
    return df


def fmt(n: float) -> str:
    n = float(n)
    for unit, div in [("T", 1e12), ("B", 1e9), ("M", 1e6), ("K", 1e3)]:
        if abs(n) >= div:
            return f"{n / div:,.2f}{unit}"
    return f"{n:,.2f}"


def interpret(how: str, insight: str = ""):
    """Static 'how to read' text plus a sentence computed from the current filters."""
    text = f"**How to read:** {how}"
    if insight:
        text += f"\n\n**Insight (current filters):** {insight}"
    st.info(text, icon="💡")


def empty_guard(df: pd.DataFrame):
    if df.empty:
        st.warning("No records match the current filters. Widen the filters in the sidebar.")
        st.stop()


raw = load_raw()
data = load_clean()

# ---------------------------------------------------------------- sidebar filters
st.sidebar.title("🌾 Filters")
dataset = st.sidebar.radio("Dataset", ["Cleaned", "Raw"], horizontal=True,
                           help="Raw keeps the 3,730 rows with missing Production (they drop out of Production totals).")
base = data if dataset == "Cleaned" else raw.assign(
    Yield=np.where(raw["Area"] > 0, raw["Production"] / raw["Area"], np.nan))

y_min, y_max = int(base["Crop_Year"].min()), int(base["Crop_Year"].max())
years = st.sidebar.slider("Crop year", y_min, y_max, (y_min, y_max))
states = st.sidebar.multiselect("State", sorted(base["State_Name"].unique()))
dist_pool = base[base["State_Name"].isin(states)] if states else base
districts = st.sidebar.multiselect("District", sorted(dist_pool["District_Name"].unique()))
seasons = st.sidebar.multiselect("Season", sorted(base["Season"].unique()))
crops = st.sidebar.multiselect("Crop", sorted(base["Crop"].unique()))
top_n = st.sidebar.slider("Top-N items", 5, 30, 10)
excl_coconut = st.sidebar.checkbox("Exclude Coconut", help="Coconut is recorded in nuts (not tonnes) and dominates every total.")
log_scale = st.sidebar.checkbox("Log scale (distributions / scatter)", value=True)

f = base[base["Crop_Year"].between(*years)]
if states:
    f = f[f["State_Name"].isin(states)]
if districts:
    f = f[f["District_Name"].isin(districts)]
if seasons:
    f = f[f["Season"].isin(seasons)]
if crops:
    f = f[f["Crop"].isin(crops)]
if excl_coconut:
    f = f[f["Crop"] != "Coconut"]

st.sidebar.caption(f"{len(f):,} of {len(base):,} records selected")

st.title("India Crop Production — Descriptive Analytics Dashboard")
st.caption("Source: Ministry of Agriculture & Farmers Welfare (via Kaggle) · 1997–2015 · "
           "Production units differ by crop (e.g. coconut in nuts) — treat cross-crop totals with care.")
empty_guard(f)
fp = f.dropna(subset=["Production"])  # rows usable for Production aggregates
empty_guard(fp)

tabs = st.tabs(["Overview", "Trends", "Crops", "Geography", "Seasons", "Area vs Production",
                "Distributions", "Statistics", "Data Quality", "Data Explorer"])

# ---------------------------------------------------------------- Overview
with tabs[0]:
    total_prod, total_area = fp["Production"].sum(), fp["Area"].sum()
    c = st.columns(6)
    c[0].metric("Total production", fmt(total_prod))
    c[1].metric("Total area (ha)", fmt(total_area))
    c[2].metric("Avg yield (prod/ha)", f"{fp['Yield'].median():,.2f}", help="Median record-level yield")
    c[3].metric("Records", f"{len(f):,}")
    c[4].metric("States / Districts / Crops", f"{f.State_Name.nunique()} / {f.District_Name.nunique()} / {f.Crop.nunique()}")
    c[5].metric("Years", f"{f.Crop_Year.min()}–{f.Crop_Year.max()}")

    top_crop = fp.groupby("Crop")["Production"].sum().nlargest(1)
    top_state = fp.groupby("State_Name")["Production"].sum().nlargest(1)
    top_season = fp.groupby("Season")["Production"].sum().nlargest(1)
    interpret("KPI cards summarise whatever the sidebar filters select; yield is the median of Production ÷ Area per record, "
              "which resists the extreme values that distort a plain average.",
              f"**{top_crop.index[0]}** is the largest crop ({top_crop.iloc[0] / total_prod:.1%} of production), "
              f"**{top_state.index[0]}** the largest state ({top_state.iloc[0] / total_prod:.1%}) and "
              f"**{top_season.index[0]}** the largest season ({top_season.iloc[0] / total_prod:.1%}).")
    if not excl_coconut and "Coconut" in fp["Crop"].values:
        st.warning("Coconut is included. Its volume (counted in nuts) dwarfs other crops; tick **Exclude Coconut** "
                   "in the sidebar for a fairer comparison.")

# ---------------------------------------------------------------- Trends
with tabs[1]:
    yr = fp.groupby("Crop_Year").agg(Production=("Production", "sum"), Area=("Area", "sum")).reset_index()
    yr["Yield"] = yr["Production"] / yr["Area"]
    yr["YoY %"] = yr["Production"].pct_change() * 100
    fig = px.line(yr, x="Crop_Year", y="Production", markers=True, title="Total production by year")
    st.plotly_chart(fig, width="stretch")
    peak, low = yr.loc[yr.Production.idxmax()], yr.loc[yr.Production.idxmin()]
    n = len(yr)
    slope = stats.linregress(yr.Crop_Year, yr.Production).slope if n > 2 else 0
    cagr = ((yr.Production.iloc[-1] / yr.Production.iloc[0]) ** (1 / (n - 1)) - 1) if n > 1 and yr.Production.iloc[0] > 0 else np.nan
    interpret("Each point is the sum of Production for that year. Rising lines mean growth; sharp dips often reflect incomplete "
              "reporting for that year rather than a real collapse.",
              f"Peak in **{int(peak.Crop_Year)}** ({fmt(peak.Production)}), lowest in **{int(low.Crop_Year)}** ({fmt(low.Production)}). "
              f"Linear trend is {'upward' if slope > 0 else 'downward'}"
              + (f"; compound annual growth first→last year ≈ {cagr:.1%}." if not np.isnan(cagr) else "."))
    c1, c2 = st.columns(2)
    with c1:
        st.plotly_chart(px.bar(yr.dropna(), x="Crop_Year", y="YoY %", title="Year-over-year change (%)",
                               color=yr.dropna()["YoY %"] > 0, color_discrete_sequence=["#c0392b", "#27ae60"])
                        .update_layout(showlegend=False), width="stretch")
        interpret("Green bars are growth years, red bars are declines versus the previous year.",
                  f"Largest swing: {yr.loc[yr['YoY %'].abs().idxmax(), 'Crop_Year']:.0f} "
                  f"({yr['YoY %'].loc[yr['YoY %'].abs().idxmax()]:+.1f}%)." if n > 1 else "")
    with c2:
        st.plotly_chart(px.line(yr, x="Crop_Year", y="Yield", markers=True, title="Overall yield (production per hectare)"),
                        width="stretch")
        interpret("Yield = total Production ÷ total Area. Rising yield with flat area suggests productivity gains.",
                  f"Yield moved from {yr.Yield.iloc[0]:,.2f} to {yr.Yield.iloc[-1]:,.2f} over the selected years.")
    st.plotly_chart(px.line(yr, x="Crop_Year", y="Area", markers=True, title="Total cultivated area (ha) by year"),
                    width="stretch")
    interpret("Compare with the production line: if area grows less than production, output growth comes from yield, not expansion.")

# ---------------------------------------------------------------- Crops
with tabs[2]:
    cp = fp.groupby("Crop")["Production"].sum().sort_values(ascending=False)
    st.plotly_chart(px.bar(cp.head(top_n).reset_index(), x="Crop", y="Production", title=f"Top {top_n} crops by total production",
                           color="Crop", color_discrete_sequence=PALETTE).update_layout(showlegend=False),
                    width="stretch")
    share = cp / cp.sum()
    interpret("Bars rank crops by summed Production. Different crops use different units, so rank reflects recorded volume, not value.",
              f"Top crop **{cp.index[0]}** holds {share.iloc[0]:.1%}; the top {min(3, len(cp))} together hold {share.head(3).sum():.1%}.")
    pareto = cp.head(top_n).reset_index()
    pareto["Cumulative %"] = cp.cumsum().head(top_n).values / cp.sum() * 100
    st.plotly_chart(px.line(pareto, x="Crop", y="Cumulative %", markers=True, title="Pareto: cumulative share of production"),
                    width="stretch")
    interpret("A steep early rise means output is concentrated in a few crops.",
              f"Top {top_n} crops account for {pareto['Cumulative %'].iloc[-1]:.1f}% of production.")
    c1, c2 = st.columns(2)
    with c1:
        tm = cp.head(30).reset_index()
        st.plotly_chart(px.treemap(tm, path=["Crop"], values="Production", title="Crop share (top 30)"),
                        width="stretch")
        interpret("Rectangle area is proportional to a crop's share of production.")
    with c2:
        ya = fp[fp["Area"] > 0].groupby("Crop").agg(P=("Production", "sum"), A=("Area", "sum"))
        ya = ya[ya.A > 0].assign(Yield=lambda d: d.P / d.A).sort_values("Yield", ascending=False).head(top_n).reset_index()
        st.plotly_chart(px.bar(ya, x="Crop", y="Yield", title=f"Top {top_n} crops by yield (production/ha)"),
                        width="stretch")
        interpret("Yield shows land efficiency; it can rank very differently from total production.",
                  f"Highest yield: **{ya.Crop.iloc[0]}** at {ya.Yield.iloc[0]:,.2f} per hectare.")

# ---------------------------------------------------------------- Geography
with tabs[3]:
    sp = fp.groupby("State_Name")["Production"].sum().sort_values(ascending=False)
    st.plotly_chart(px.bar(sp.head(top_n).reset_index(), x="State_Name", y="Production", title=f"Top {top_n} states by production",
                           color="State_Name", color_discrete_sequence=PALETTE).update_layout(showlegend=False),
                    width="stretch")
    interpret("Bars rank states by summed Production across selected years, crops and seasons.",
              f"**{sp.index[0]}** leads with {sp.iloc[0] / sp.sum():.1%}; the top {min(3, len(sp))} states hold {sp.head(3).sum() / sp.sum():.1%}.")
    top_states = sp.head(top_n).index
    heat = fp[fp.State_Name.isin(top_states)].pivot_table(index="State_Name", columns="Crop_Year", values="Production", aggfunc="sum")
    st.plotly_chart(px.imshow(np.log10(heat.replace(0, np.nan)), aspect="auto", color_continuous_scale="YlGn",
                              title="State × year production (log10 colour scale)"), width="stretch")
    interpret("Darker cells = higher production (log scale so small states stay visible). Blank cells mean no data for that year.")
    dp = fp.groupby(["State_Name", "District_Name"])["Production"].sum().reset_index().sort_values("Production", ascending=False)
    st.plotly_chart(px.bar(dp.head(top_n), x="District_Name", y="Production", color="State_Name",
                           title=f"Top {top_n} districts by production"), width="stretch")
    interpret("Districts show where within a state output is concentrated; use the State filter to drill in.",
              f"Top district: **{dp.District_Name.iloc[0]}** ({dp.State_Name.iloc[0]}).")
    cv = (fp.groupby(["State_Name", "Crop_Year"])["Production"].sum().groupby("State_Name")
          .agg(lambda s: s.std() / s.mean() if len(s) > 2 and s.mean() > 0 else np.nan).dropna().sort_values())
    if len(cv):
        st.plotly_chart(px.bar(cv.head(top_n).reset_index(name="CV"), x="State_Name", y="CV",
                               title=f"Most stable {top_n} states (lowest coefficient of variation of yearly production)"),
                        width="stretch")
        interpret("CV = standard deviation ÷ mean of yearly production. Lower means steadier output year to year.",
                  f"Most stable: **{cv.index[0]}** (CV {cv.iloc[0]:.2f}); least stable: **{cv.index[-1]}** (CV {cv.iloc[-1]:.2f}).")

# ---------------------------------------------------------------- Seasons
with tabs[4]:
    se = fp.groupby("Season")["Production"].sum().sort_values(ascending=False).reset_index()
    c1, c2 = st.columns(2)
    with c1:
        st.plotly_chart(px.bar(se, x="Season", y="Production", color="Season", color_discrete_sequence=PALETTE,
                               title="Production by season").update_layout(showlegend=False), width="stretch")
    with c2:
        st.plotly_chart(px.pie(se, names="Season", values="Production", hole=0.45, title="Season share",
                               color_discrete_sequence=PALETTE), width="stretch")
    interpret("Seasons are Kharif (monsoon), Rabi (winter), Summer, Autumn, Winter and Whole Year (perennial crops such as coconut/sugarcane).",
              f"**{se.Season.iloc[0]}** contributes {se.Production.iloc[0] / se.Production.sum():.1%}. "
              "A large 'Whole Year' share usually reflects perennial crops, especially coconut.")
    sy = fp.groupby(["Crop_Year", "Season"])["Production"].sum().reset_index()
    st.plotly_chart(px.area(sy, x="Crop_Year", y="Production", color="Season", color_discrete_sequence=PALETTE,
                            title="Season mix over time"), width="stretch")
    interpret("Stacked areas show how each season's contribution changes across years.")
    ss = fp[fp.State_Name.isin(sp.head(top_n).index)].groupby(["State_Name", "Season"])["Production"].sum().reset_index()
    st.plotly_chart(px.bar(ss, x="State_Name", y="Production", color="Season", barmode="relative", color_discrete_sequence=PALETTE,
                           title="Season mix by top states"), width="stretch")
    interpret("Reveals which seasons drive each state's output.")

# ---------------------------------------------------------------- Area vs Production
with tabs[5]:
    ap = f[["Area", "Production", "Season", "Crop", "State_Name"]].dropna()
    ap_pos = ap[(ap.Area > 0) & (ap.Production > 0)] if log_scale else ap
    sample = ap_pos.sample(min(15000, len(ap_pos)), random_state=42) if len(ap_pos) else ap_pos
    color_by = st.selectbox("Colour points by", ["Season", "Crop", "State_Name"])
    if len(sample) > 2:
        st.plotly_chart(px.scatter(sample, x="Area", y="Production", color=color_by, opacity=0.5,
                                   log_x=log_scale, log_y=log_scale, hover_data=["Crop", "State_Name"],
                                   title="Area vs Production (sample of up to 15,000 records)"),
                        width="stretch")
        pear = ap["Area"].corr(ap["Production"], method="pearson")
        spear = ap["Area"].corr(ap["Production"], method="spearman")
        strength = lambda r: "very weak" if abs(r) < .2 else "weak" if abs(r) < .4 else "moderate" if abs(r) < .6 else "strong" if abs(r) < .8 else "very strong"
        c1, c2 = st.columns(2)
        c1.metric("Pearson r", f"{pear:.3f}")
        c2.metric("Spearman ρ", f"{spear:.3f}")
        interpret("Each dot is one crop-district-season-year record. Pearson measures linear association and is distorted by extreme values; "
                  "Spearman uses ranks and is robust to outliers and skew.",
                  f"Pearson is {strength(pear)} ({pear:.2f}) while Spearman is {strength(spear)} ({spear:.2f}). "
                  + ("The gap shows outliers (e.g. coconut) mask a real rank-order relationship: larger area generally means larger production."
                     if spear - pear > .3 else "Both measures broadly agree."))
        corr = f[["Crop_Year", "Area", "Production"]].dropna().corr()
        st.plotly_chart(px.imshow(corr, text_auto=".2f", color_continuous_scale="RdBu_r", zmin=-1, zmax=1,
                                  title="Correlation matrix (Pearson)"), width="stretch")
        interpret("Values near +1/-1 are strong relationships; near 0 means none. Crop_Year is expected to be unrelated to the others.",
                  f"Area–Production {corr.loc['Area', 'Production']:.2f}; Year–Production {corr.loc['Crop_Year', 'Production']:.2f}.")
    else:
        st.warning("Not enough records for a scatter plot with the current filters.")

# ---------------------------------------------------------------- Distributions
with tabs[6]:
    var = st.radio("Variable", ["Production", "Area", "Yield"], horizontal=True)
    s = f[var].dropna()
    s = s[s > 0] if log_scale else s
    if len(s) > 3:
        st.plotly_chart(px.histogram(s, nbins=60, log_x=log_scale, title=f"Distribution of {var}"
                                     + (" (log x-axis, zeros removed)" if log_scale else "")).update_layout(showlegend=False),
                        width="stretch")
        sk, ku = stats.skew(s), stats.kurtosis(s)
        interpret("Histogram bars count records in each value range. On the log axis a bell shape means the data are roughly log-normal.",
                  f"Skewness {sk:.1f} ({'strongly right-skewed' if sk > 1 else 'roughly symmetric'}), excess kurtosis {ku:.1f} "
                  f"({'heavy tails/many extreme values' if ku > 3 else 'light tails'}). Median {s.median():,.1f} vs mean {s.mean():,.1f}: "
                  + ("the mean is pulled far above the median by a few huge records." if s.mean() > 1.5 * s.median() else "mean and median are close."))
        st.plotly_chart(px.box(s, log_y=log_scale, points=False, title=f"Box plot of {var}"), width="stretch")
        q1, q3 = s.quantile(.25), s.quantile(.75)
        iqr = q3 - q1
        out = ((s < q1 - 1.5 * iqr) | (s > q3 + 1.5 * iqr)).sum()
        interpret("The box spans Q1–Q3 (middle 50%), the line is the median, whiskers reach 1.5×IQR; points beyond are outliers.",
                  f"{out:,} outliers ({out / len(s):.1%} of records) by the IQR rule. In crop data many are genuine large districts, not errors.")
    else:
        st.warning("Not enough data for this variable.")

# ---------------------------------------------------------------- Statistics
with tabs[7]:
    cols = ["Area", "Production"]
    d = f[cols].dropna()
    desc = pd.DataFrame({
        "Mean": d.mean(), "Median": d.median(), "Mode": [d[c].mode().iloc[0] for c in cols],
        "Std Dev": d.std(), "Variance": d.var(), "Min": d.min(), "Max": d.max(), "Range": d.max() - d.min(),
        "Q1": d.quantile(.25), "Q3": d.quantile(.75), "IQR": d.quantile(.75) - d.quantile(.25),
        "P90": d.quantile(.9), "P99": d.quantile(.99), "Skewness": d.skew(), "Kurtosis": d.kurt(),
    })
    st.dataframe(desc.T.style.format("{:,.2f}"), width="stretch")
    interpret("Central tendency (mean, median, mode), spread (std, range, IQR) and shape (skewness, kurtosis) of the selected records.",
              f"Production mean ({fmt(desc.loc['Production', 'Mean'])}) is far above its median ({fmt(desc.loc['Production', 'Median'])}), "
              "so a typical record is small while a few giants inflate totals — prefer the median when describing a 'typical' record.")
    st.subheader("Frequency tables")
    c1, c2 = st.columns(2)
    for col, holder in zip(["Crop", "State_Name"], [c1, c2]):
        holder.dataframe(f[col].value_counts().head(top_n).rename_axis(col).reset_index(name="Records"),
                         width="stretch", hide_index=True)
    interpret("Record counts show how often each crop/state appears, i.e. data coverage rather than production volume.")

# ---------------------------------------------------------------- Data Quality
with tabs[8]:
    c = st.columns(4)
    c[0].metric("Raw rows", f"{len(raw):,}")
    c[1].metric("Cleaned rows", f"{len(data):,}", delta=f"-{len(raw) - len(data):,}")
    c[2].metric("Duplicate rows (raw)", f"{raw.duplicated().sum():,}")
    c[3].metric("Zero Production (cleaned)", f"{(data.Production == 0).sum():,}")
    miss = pd.DataFrame({"Missing": raw.isnull().sum(), "%": (raw.isnull().mean() * 100).round(2)})
    st.dataframe(miss, width="stretch")
    interpret("Cleaning removed records with missing Production (they cannot contribute to production totals); names were trimmed and types fixed.",
              f"{len(raw) - len(data):,} rows removed ({(len(raw) - len(data)) / len(raw):.2%}). Only Production had missing values.")
    chk = pd.DataFrame({
        "Check": ["Negative Area", "Negative Production", "Zero Area", "Zero Production"],
        "Raw": [(raw.Area < 0).sum(), (raw.Production < 0).sum(), (raw.Area == 0).sum(), (raw.Production == 0).sum()],
        "Cleaned": [(data.Area < 0).sum(), (data.Production < 0).sum(), (data.Area == 0).sum(), (data.Production == 0).sum()],
    })
    st.dataframe(chk, hide_index=True, width="stretch")
    out_rows = []
    for col in ["Area", "Production"]:
        q1, q3 = data[col].quantile(.25), data[col].quantile(.75)
        i = q3 - q1
        out_rows.append({"Variable": col, "Lower fence": q1 - 1.5 * i, "Upper fence": q3 + 1.5 * i,
                         "Outliers": int(((data[col] < q1 - 1.5 * i) | (data[col] > q3 + 1.5 * i)).sum())})
    st.dataframe(pd.DataFrame(out_rows), hide_index=True, width="stretch")
    interpret("IQR outlier fences flag unusually large values. They are retained because large districts and perennial crops are legitimate.",
              "Zero-Production records are kept as valid observations (e.g. failed or unreported harvest) — mention this assumption when reporting.")

# ---------------------------------------------------------------- Data Explorer
with tabs[9]:
    view = st.radio("Show", ["Filtered (current dataset)", "Raw (full)", "Cleaned (full)"], horizontal=True)
    table = {"Filtered (current dataset)": f, "Raw (full)": raw, "Cleaned (full)": data}[view]
    term = st.text_input("Search text in any column")
    if term:
        mask = table.astype(str).apply(lambda col: col.str.contains(term, case=False, na=False)).any(axis=1)
        table = table[mask]
    st.caption(f"{len(table):,} rows")
    st.dataframe(table.head(5000), width="stretch")
    if len(table) > 5000:
        st.caption("Preview limited to 5,000 rows; the download contains all rows.")
    st.download_button("Download CSV", table.to_csv(index=False).encode("utf-8"), "crop_production_view.csv", "text/csv")
    interpret("Use this tab to inspect or export the exact records behind every chart.")
