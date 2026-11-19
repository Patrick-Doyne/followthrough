"""The sweep's figures, for the paper (PNG and SVG in research/sweep/results/), in the
order of the three levers.

    python research/sweep/report.py [--results research/sweep/results]

Speed
latency_matrix    27 engine variants (rows: all three engines, grouped by the
                  model changed) x 16 cadences (columns: the binary's flags).
                  Each cell is the configuration's rate-setting stage per frame,
                  max(phone encode, decode + measured pipeline), with the encode
                  and decode constants from grid.py stated in a stage table on
                  top. Diverging colour split at the 60 fps budget (16.7 ms);
                  real-time cells are also outlined, so the split never rests on
                  colour alone.
Accuracy
model_accuracy    The 27 models' mAP50-95 ranked within each type
                  (model_scores.json), the app's own model as a grey bar.
Fidelity
shots_detected,   One scatter per metric: every configuration a dot, time per
make_miss,        frame across, the metric up, the real-time band shaded; colour
shot_category,    and marker give the model changed; the category chart lists
distance_error    the range classes. Scored with score.py's scorer.
top_15_real_time  The 15 best real-time configurations on each metric, 2 x 2:
                  ranked by the metric, then shots found, then speed; distance
                  needs 3 of 5 found; those in all four lists are marked.
All three
final_top_10      Speed and accuracy as gates (real time; the changed model at
                  least its type's baseline mAP50-95), ranked by shots found,
                  make/miss, mAP gain, speed.

Reads runs.jsonl (enqueue.py collect) and the ground truth.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.colors import LinearSegmentedColormap, TwoSlopeNorm  # noqa: E402
from matplotlib.patches import Rectangle  # noqa: E402

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from score import score  # noqa: E402
from grid import BASELINE, CADENCES, DECODE_MS, ENCODE_MS, FRAME_BUDGET_MS, holds_real_time, rate_ms, variants  # noqa: E402

# Colours: the validated reference palette (dataviz skill, references/palette.md).
SURFACE = "#fcfcfb"
INK = "#0b0b0b"
INK_2 = "#52514e"
NEUTRAL = "#f0efec"  # diverging midpoint
BLUE = ["#cde2fb", "#86b6ef", "#3987e5", "#1c5cab", "#0d366b"]  # sequential blue 100..700
RED = ["#f6c9c4", "#ec8a85", "#e34948", "#b62f2f", "#7c1d1d"]
TYPE_LABEL = {"obj": "Object detection", "court": "Court keypoints", "player": "Shooter pose"}
FONT = "DejaVu Sans"

plt.rcParams.update({
    "font.family": FONT, "font.size": 8, "text.color": INK, "axes.labelcolor": INK,
    "xtick.color": INK_2, "ytick.color": INK_2, "axes.edgecolor": SURFACE, "figure.facecolor": SURFACE,
    "axes.facecolor": SURFACE, "savefig.facecolor": SURFACE,
})


def ordered_cadences():
    """Columns: detector every frame, then every other; within each, pose
    near release then every frame; within each, court every 1/5/10/20."""
    return sorted(CADENCES, key=lambda c: (c.detect_every, c.pose != "gate", c.court_every))


def ordered_variants():
    order = {"obj": 0, "court": 1, "player": 2}
    return sorted(variants(), key=lambda v: (order[v.type], "nmx".index(v.size), v.res))


def luminance(hex_colour: str) -> float:
    r, g, b = (int(hex_colour[i : i + 2], 16) / 255 for i in (1, 3, 5))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def to_hex(rgba) -> str:
    return "#" + "".join(f"{round(c * 255):02x}" for c in rgba[:3])


def frame_axes(ax, rows, cols) -> None:
    """The latency grid's furniture. Every row is a whole combination: all
    three engines, in model order, the one changed from the n-640 baseline in
    bold ink, the others muted; rows grouped by the model changed. The columns
    are headed by the batch binary's own flags and values, one tier per flag."""
    ax.set_xlim(0, len(cols))
    ax.set_ylim(len(rows), 0)
    ax.set_xticks([i + 0.5 for i in range(len(cols))])
    ax.set_xticklabels([str(c.court_every) for c in cols], fontsize=7)
    ax.xaxis.tick_top()
    ax.tick_params(length=0, pad=2)
    ax.set_yticks([i + 0.5 for i in range(len(rows))])
    ax.set_yticklabels([])
    engine_x = (-4.85, -3.25, -1.65)
    for i, v in enumerate(rows):
        for x, t in zip(engine_x, ("obj", "court", "player")):
            changed = v.type == t
            ax.text(x, i + 0.52, v.name if changed else BASELINE[t].name, ha="left", va="center",
                    fontsize=6.8, fontfamily="DejaVu Sans Mono", fontweight="bold" if changed else "normal",
                    color=INK if changed else INK_2, clip_on=False)
    ax.text(engine_x[0], -0.45, "Engines in the run", ha="left", va="center", fontsize=7,
            fontweight="bold", color=INK, clip_on=False)
    for spine in ax.spines.values():
        spine.set_visible(False)
    # Model groups: a label to the left and a surface gap between groups.
    for t, name in TYPE_LABEL.items():
        idx = [i for i, v in enumerate(rows) if v.type == t]
        if not idx:
            continue
        mid = (idx[0] + idx[-1] + 1) / 2
        ax.text(-5.3, mid, name, rotation=90, ha="center", va="center", fontsize=8.5, fontweight="bold",
                color=INK, clip_on=False)
        if idx[0] > 0:
            ax.axhline(idx[0], color=SURFACE, lw=7)
    flag_columns(ax, cols)


def flag_columns(ax, cols) -> None:
    """Column header as the binary's flags: one tier per flag, its name on the left."""
    mono = "DejaVu Sans Mono"
    tiers = (
        ("--detect-every", -2.6, lambda c: c.detect_every,
         {1: "1  (every frame)", 2: "2  (every other frame, ball coasts)"}),
        ("--pose-every-frame", -1.5, lambda c: c.pose,
         {"gate": "off  (pose near release)", "every": "on  (pose every frame)"}),
    )
    for flag, y, key, labels in tiers:
        ax.text(-0.3, y, flag, ha="right", va="center", fontsize=7.5, fontweight="bold", fontfamily=mono)
        start = 0
        for j in range(1, len(cols) + 1):
            if j == len(cols) or key(cols[j]) != key(cols[start]):
                ax.text((start + j) / 2, y, labels[key(cols[start])], ha="center", va="center", fontsize=7,
                        color=INK if flag == "--detect-every" else INK_2)
                # A bracket under each span so its extent reads without colour.
                ax.plot([start + 0.12, j - 0.12], [y + 0.42, y + 0.42], color=INK_2, lw=0.7, clip_on=False)
                if start > 0:
                    ax.axvline(start, color=SURFACE, lw=4 if flag == "--detect-every" else 2)
                start = j
    ax.text(-0.3, -0.45, "--court-every", ha="right", va="center", fontsize=7.5, fontweight="bold",
            fontfamily=mono)


def stage_table(fig, top: float, pipe: tuple[float, float], rate: tuple[float, float]) -> None:
    """The per-frame path at 4K, as in the progress report: constants stated,
    the pipeline measured, and how they combine into the value each cell shows."""
    x_stage, x_ms, x_how = 0.05, 0.335, 0.475
    line = 0.0158
    rows = [
        ("Phone H.264 encode", f"{ENCODE_MS:.1f}", "constant",
         "iPhone hardware encoder. Expected from published figures, not measured. Runs on the phone."),
        ("Backend H.264 decode", f"{DECODE_MS:.2f}", "constant",
         "NVDEC, incl. conversion to BGR. Measured on the A10G (g5.xlarge), research/sweep/decode benchmark."),
        ("Detection pipeline", f"{pipe[0]:.1f}–{pipe[1]:.1f}", "measured",
         "All three models, state machine, JSON. Each run's mean on the A10G."),
        ("Backend total", f"{rate[0]:.1f}–{rate[1]:.1f}", "",
         "Decode + pipeline, one after the other on the GPU machine."),
        ("Rate-setting stage", f"{rate[0]:.1f}–{rate[1]:.1f}", "in each cell",
         "The larger of phone encode and backend total (they run in parallel). Here always the backend."),
        ("Frame budget, 60 fps", f"{FRAME_BUDGET_MS:.2f}", "",
         "A configuration holds real time when its rate-setting stage is within it."),
    ]
    y = top
    for x, text, ha in ((x_stage, "Stage", "left"), (x_ms + 0.045, "ms per frame, 4K", "right"), (x_how, "Source", "left")):
        fig.text(x, y, text, ha=ha, va="center", fontsize=7.5, fontweight="bold", color=INK_2)
    fig.add_artist(plt.Line2D([x_stage, 0.97], [y - line * 0.55] * 2, color=INK_2, lw=0.6, transform=fig.transFigure))
    for k, (stage, ms, kind, how) in enumerate(rows):
        y = top - line * (k + 1.15)
        key = stage == "Rate-setting stage"
        weight = "bold" if key else "normal"
        fig.text(x_stage, y, stage, va="center", fontsize=8, fontweight=weight, color=INK)
        fig.text(x_ms + 0.045, y, ms, ha="right", va="center", fontsize=8, fontweight=weight, color=INK,
                 fontfamily="DejaVu Sans Mono")
        fig.text(x_ms + 0.055, y, kind, va="center", fontsize=7, color=INK_2, style="italic")
        fig.text(x_how, y, how, va="center", fontsize=7.5, color=INK_2)
        if stage == "Backend total":
            fig.add_artist(plt.Line2D([x_stage, 0.97], [y - line * 0.5] * 2, color=NEUTRAL, lw=0.8,
                                      transform=fig.transFigure))


def latency_matrix(runs: dict, out: Path) -> None:
    rows, cols = ordered_variants(), ordered_cadences()
    pipes = [[((runs.get(f"{v.name}__{c.name}") or {}).get("latency_ms") or {}).get("mean") for c in cols]
             for v in rows]
    measured = [x for r in pipes for x in r if x is not None]
    if not measured:
        print("no latency results yet")
        return
    rates = [rate_ms(x) for x in measured]
    vmin, vmax = min(rates + [FRAME_BUDGET_MS - 1]), max(rates + [FRAME_BUDGET_MS + 1])
    cmap = LinearSegmentedColormap.from_list("budget", BLUE[::-1] + [NEUTRAL] + RED)
    norm = TwoSlopeNorm(vmin=vmin, vcenter=FRAME_BUDGET_MS, vmax=vmax)

    fig, ax = plt.subplots(figsize=(12.0, 11.0))
    fig.subplots_adjust(left=0.29, right=0.97, top=0.695, bottom=0.06)
    passed = 0
    for i, v in enumerate(rows):
        for j, c in enumerate(cols):
            pipe = pipes[i][j]
            if pipe is None:
                ax.add_patch(Rectangle((j, i), 1, 1, facecolor=SURFACE, edgecolor=NEUTRAL, hatch="////", lw=0))
                continue
            value = rate_ms(pipe)
            colour = to_hex(cmap(norm(value)))
            ax.add_patch(Rectangle((j + 0.04, i + 0.06), 0.92, 0.88, facecolor=colour, lw=0))
            real_time = holds_real_time(pipe)
            passed += real_time
            if real_time:
                ax.add_patch(Rectangle((j + 0.04, i + 0.06), 0.92, 0.88, facecolor="none", edgecolor=INK, lw=0.9))
            ax.text(j + 0.5, i + 0.52, f"{value:.1f}", ha="center", va="center", fontsize=6.3,
                    color=INK if luminance(colour) > 0.5 else SURFACE, fontfamily="DejaVu Sans Mono")
    frame_axes(ax, rows, cols)
    total = len(rows) * len(cols)
    fig.text(0.05, 0.972, "Which configurations keep up with 60 fps?", fontsize=13, fontweight="bold")
    fig.text(0.05, 0.951,
             "Each cell is one whole configuration: the row's three engines (the changed one in bold, the other two at "
             "their n-640 baseline) under the column's flags,", fontsize=8.5, color=INK_2)
    fig.text(0.05, 0.935,
             f"showing its rate-setting stage in ms per frame. burkelake8, 4K at 60 fps; pipeline measured on an "
             f"EC2 g5.xlarge (NVIDIA A10G). Outlined: {passed} of {total} hold real time.",
             fontsize=8.5, color=INK_2)
    stage_table(fig, 0.905, (min(measured), max(measured)), (min(rates), max(rates)))
    # Legend: the colour ramp with the budget marked, drawn as swatches.
    lax = fig.add_axes([0.05, 0.012, 0.92, 0.026])
    lax.set_xlim(0, 1)
    lax.set_ylim(0, 1)
    lax.axis("off")
    steps = 40
    x0, width = 0.55, 0.40
    for k in range(steps):
        value = vmin + (vmax - vmin) * (k + 0.5) / steps
        lax.add_patch(Rectangle((x0 + width * k / steps, 0.35), width / steps, 0.4,
                                facecolor=to_hex(cmap(norm(value))), lw=0))
    bx = x0 + width * (FRAME_BUDGET_MS - vmin) / (vmax - vmin)
    lax.plot([bx, bx], [0.2, 0.9], color=INK, lw=1.2)
    lax.text(bx, 0.98, f"{FRAME_BUDGET_MS:.2f} ms budget", ha="center", va="bottom", fontsize=7, color=INK)
    lax.text(x0, 0.1, f"{vmin:.0f} ms", ha="left", va="center", fontsize=7, color=INK_2)
    lax.text(x0 + width, 0.1, f"{vmax:.0f} ms", ha="right", va="center", fontsize=7, color=INK_2)
    lax.add_patch(Rectangle((0.0, 0.33), 0.018, 0.44, facecolor=BLUE[2], edgecolor=INK, lw=0.9))
    lax.text(0.024, 0.55, "Real time at 60 fps (outlined)", va="center", fontsize=7.5, color=INK)
    lax.add_patch(Rectangle((0.24, 0.33), 0.018, 0.44, facecolor=RED[2], lw=0))
    lax.text(0.264, 0.55, "Too slow for 60 fps", va="center", fontsize=7.5, color=INK)
    for ext in ("png", "svg"):
        fig.savefig(out / f"latency_matrix.{ext}", dpi=220)
    plt.close(fig)
    print(f"latency_matrix: {passed}/{total} real time -> {out}/latency_matrix.png, .svg")


# The pipeline's shot classes and their distance ranges, with the app's labels
# (follow-through-pro-19/src/lib/shot-insights.ts; thresholds from
# get_shot_designation in cpp/follow-through-batch.cpp).
SHOT_CLASSES = [
    ("LAY_UP", "Layup", "under 5 ft"),
    ("CLS_RNG", "Close range", "5–10 ft"),
    ("MID_RNG", "Midrange", "10–19.9 ft"),
    ("HS_3PT", "HS three", "19.9–22 ft"),
    ("NCAA_3PT", "NCAA three", "22–23 ft"),
    ("NBA_3PT", "NBA three", "23 ft and out"),
]

# Categorical hues for the model changed (validated reference palette, slots
# 1-3), each with its own marker so identity never rests on colour alone.
GROUP_STYLE = {
    "obj": ("#2a78d6", "o", "Object detection changed"),
    "court": ("#eb6834", "s", "Court keypoints changed"),
    "player": ("#1baf7a", "^", "Shooter pose changed"),
}


def metric_charts(runs: dict, gt: dict, out: Path) -> None:
    """One scatter per fidelity metric: every configuration as a dot, speed
    (the rate-setting stage, ms per frame) across, the metric up. The band
    left of the 16.7 ms budget is real time; colour and marker give the model
    that was changed. Discrete scores are jittered vertically so stacked
    configurations stay visible."""
    import random

    n_truth = len(gt["shots"])
    scored = [(r, score(r, gt)) for r in runs.values()]
    rate = lambda r: r["per_frame_ms"]["rate"]
    combos = sorted({(s["makes_right"], s["misses_right"]) for _, s in scored}, key=lambda c: (c[0] + c[1], c[1]))
    combo_y = {c: k for k, c in enumerate(combos)}
    charts = [
        ("shots_detected", "Finding more shots costs speed",
         f"Shots found out of the {n_truth} recorded, against time per frame. Each dot is one configuration.",
         lambda s: s["shots_matched"], [(k, f"{k} of {n_truth}") for k in range(0, n_truth + 1)], "Shots found", False),
        ("make_miss", "The recorded misses are what fast configurations lose",
         "Makes called right of the 3 recorded and misses of the 2 recorded, against time per frame. A shot not "
         "found counts as wrong.",
         lambda s: combo_y[(s["makes_right"], s["misses_right"])],
         [(k, f"{m}/3 makes \u00b7 {x}/2 misses") for (m, x), k in combo_y.items()], "Calls right", False),
        ("shot_category", "Range classes are right almost everywhere",
         "Share of the shots found that land in the right range class, against time per frame.",
         lambda s: None if s["category_acc"] is None else s["category_acc"] * 100,
         [(v, f"{v}%") for v in (50, 75, 100)], "Range class right", False),
        ("distance_error", "Distance error is not what speed costs",
         "Mean error in feet over the shots found, against time per frame. Lower is better.",
         lambda s: s["distance_mae_ft"], None, "Distance error (ft)", True),
    ]
    xmax = max(rate(r) for r, _ in scored) + 2
    for name, title, sub, value, ticks, ylabel, continuous in charts:
        rng = random.Random(7)  # fixed jitter, so reruns draw the same picture
        fig, ax = plt.subplots(figsize=(12, 6.8))
        fig.subplots_adjust(left=0.17, right=0.97, top=0.80, bottom=0.19 if name == "shot_category" else 0.17)
        pts = [(r, s, value(s)) for r, s in scored if value(s) is not None]
        ys = [v for _, _, v in pts]
        ylo, yhi = (min(ys), max(ys)) if continuous else (min(t for t, _ in ticks), max(t for t, _ in ticks))
        pad = (yhi - ylo) * 0.08 if continuous else (0.6 if name != "shot_category" else 8)
        ax.axvspan(0, FRAME_BUDGET_MS, color=BLUE[0], alpha=0.55, lw=0, zorder=0)
        ax.axvline(FRAME_BUDGET_MS, color=INK, lw=1.0, zorder=1)
        # Above the plot, so no dot ever covers it.
        ax.text(FRAME_BUDGET_MS, 1.012, f"\u2190 real time at 60 fps (\u2264 {FRAME_BUDGET_MS:.1f} ms)",
                transform=ax.get_xaxis_transform(), ha="right", va="bottom", fontsize=8.5, color=INK,
                fontweight="bold")
        jitter = 0 if continuous else (0.22 if name != "shot_category" else 3.5)
        for t in ("obj", "court", "player"):
            colour, marker, label = GROUP_STYLE[t]
            xs = [rate(r) for r, _, _ in pts if r["changed_type"] == t]
            yv = [v + rng.uniform(-jitter, jitter) for r, _, v in pts if r["changed_type"] == t]
            ax.scatter(xs, yv, s=30, c=colour, marker=marker, edgecolors=SURFACE, linewidths=0.7, label=label,
                       zorder=3, alpha=0.95)
        ax.set_xlim(10, xmax)
        ax.set_ylim(ylo - pad, yhi + pad)
        if ticks:
            ax.set_yticks([t for t, _ in ticks])
            ax.set_yticklabels([l for _, l in ticks], fontsize=8.5)
            for t, _ in ticks:
                ax.axhline(t, color=NEUTRAL, lw=0.8, zorder=0.5)
        else:
            ax.grid(axis="y", color=NEUTRAL, lw=0.8, zorder=0.5)
            ax.tick_params(axis="y", labelsize=8.5)
        ax.set_xlabel("Time per frame, ms (rate-setting stage: decode + pipeline, 4K, A10G)", fontsize=9,
                      color=INK_2)
        ax.set_ylabel(ylabel, fontsize=9, color=INK_2)
        ax.tick_params(axis="x", labelsize=8.5, colors=INK_2)
        ax.tick_params(axis="y", colors=INK_2, length=0)
        for side in ("top", "right", "left"):
            ax.spines[side].set_visible(False)
        ax.spines["bottom"].set_color(INK_2)
        ax.set_axisbelow(True)
        n_rt = sum(r["real_time_60fps"] for r, _, _ in pts)
        fig.text(0.05, 0.945, title, fontsize=14, fontweight="bold", color=INK)
        fig.text(0.05, 0.910, sub, fontsize=9, color=INK_2)
        if not continuous:
            fig.text(0.05, 0.884, "Dots are spread a little around each score so stacked configurations stay "
                                  "visible.", fontsize=9, color=INK_2)
        fig.text(0.05, 0.884 if continuous else 0.858,
                 f"{len(pts)} configurations, {n_rt} of them real time. Scored against burkelake8's 5 recorded shots"
                 + ("; range class and distance against the reference configuration's output (not tape)."
                    if name in ("shot_category", "distance_error") else "."),
                 fontsize=9, color=INK_2)
        leg = ax.legend(loc="upper center", bbox_to_anchor=(0.45, -0.12), ncol=3, frameon=False, fontsize=8.5,
                        handletextpad=0.4, columnspacing=1.6)
        if name == "shot_category":
            # The range classes and their distances, as the app labels them.
            cls = "   ".join(f"{label} {rng}" for _, label, rng in SHOT_CLASSES)
            fig.text(0.05, 0.02, f"Range classes (distance from the rim at release):  {cls}", fontsize=8.5,
                     color=INK_2)
        for text in leg.get_texts():
            text.set_color(INK)
        for ext in ("png", "svg"):
            fig.savefig(out / f"{name}.{ext}", dpi=200)
        plt.close(fig)
        print(f"{name}: {len(pts)} configurations -> {out}/{name}.png, .svg")


def config_label(run: dict) -> tuple[list[tuple[str, bool]], str]:
    """A run as its three engines (changed one flagged) and its flags."""
    engines = [(run["engines"][t], run["changed_type"] == t) for t in ("obj", "court", "player")]
    c = run["cadence"]
    flags = (f"--detect-every {c['detect_every']}   --court-every {c['court_every']}   "
             f"--pose-every-frame {'on' if c['pose'] == 'every' else 'off'}")
    return engines, flags


TOP_N = 15


def top_real_time(runs: dict, gt: dict, out: Path) -> None:
    """The TOP_N best real-time configurations on each metric, 2 x 2.

    Only configurations that hold 60 fps are ranked. Each panel ranks by its
    metric, then by shots found, then by speed (the rate-setting stage).
    Distance needs at least 3 of the 5 shots found, so an error averaged over
    one or two shots cannot top it."""
    n_truth = len(gt["shots"])
    scored = [(r, score(r, gt)) for r in runs.values() if r["real_time_60fps"]]
    rate = lambda r: r["per_frame_ms"]["rate"]
    min_found = 3
    panels = [
        ("Shots detected", "shots found out of the 5 recorded",
         sorted(scored, key=lambda x: (-x[1]["shots_matched"], rate(x[0]))),
         lambda s: (s["shots_matched"] / n_truth, f"{s['shots_matched']}/{n_truth}")),
        ("Make / miss", "makes right of the 3 recorded \u00b7 misses right of the 2 recorded; a shot not found is wrong",
         sorted(scored, key=lambda x: (-x[1]["make_miss_acc"], -x[1]["shots_matched"], rate(x[0]))),
         lambda s: (s["make_miss_acc"], f"{s['makes_right']}/{s['makes_recorded']} \u00b7 "
                                        f"{s['misses_right']}/{s['misses_recorded']}")),
        ("Shot category", "range classes right out of the shots found",
         sorted([x for x in scored if x[1]["category_acc"] is not None],
                key=lambda x: (-x[1]["category_acc"], -x[1]["shots_matched"], rate(x[0]))),
         lambda s: (s["category_acc"], f"{round(s['category_acc'] * s['shots_matched'])}/{s['shots_matched']}")),
        ("Distance error", f"mean error in feet over the shots found, shorter is better; only configurations that "
                           f"found at least {min_found} of {n_truth}",
         sorted([x for x in scored if x[1]["distance_mae_ft"] is not None and x[1]["shots_matched"] >= min_found],
                key=lambda x: (x[1]["distance_mae_ft"], -x[1]["shots_matched"], rate(x[0]))),
         None),
    ]
    # Heights in inches, so the header keeps its size whatever TOP_N is.
    height = 2 * (TOP_N * 0.42 + 1.6) + 2.2
    fig, axes = plt.subplots(2, 2, figsize=(17, height))
    fig.subplots_adjust(left=0.03, right=0.985, top=1 - 2.2 / height, bottom=0.4 / height, wspace=0.08,
                        hspace=1.6 / (TOP_N * 0.42 + 1.6))
    # Configurations that make every panel's list: marked in each.
    in_all = set.intersection(*({r["run_id"] for r, _ in ranked[:TOP_N]} for _, _, ranked, _ in panels))
    for ax, (title, how, ranked, value) in zip(axes.flat, panels):
        best = ranked[:TOP_N]
        ax.set_xlim(0, 1)
        ax.set_ylim(TOP_N + 0.2, -1.3)
        ax.axis("off")
        shown = f" ({len(best)} qualify)" if len(best) < TOP_N else ""
        ax.text(0, -1.25, title + shown, fontsize=12, fontweight="bold", color=INK, va="bottom")
        ax.text(0, -0.65, how, fontsize=8, color=INK_2, va="bottom")
        for x, head, ha in ((0.035, "Engines", "left"), (0.60, "Score", "left"), (0.995, "ms / frame", "right")):
            ax.text(x, -0.12, head, fontsize=7.5, fontweight="bold", color=INK_2, ha=ha, va="bottom")
        if value is None:
            top_err = max(s["distance_mae_ft"] for _, s in best) or 1.0
        for k, (r, s) in enumerate(best):
            y = k + 0.42
            engines, flags = config_label(r)
            marked = r["run_id"] in in_all
            if marked:
                ax.add_patch(Rectangle((-0.03, k - 0.06), 1.03, 0.96, facecolor=BLUE[0], lw=0, zorder=0, clip_on=False))
                ax.text(-0.006, y, "\u25c6", fontsize=7, color=INK, ha="right", va="center", clip_on=False)
            ax.text(0.0, y, f"{k + 1}", fontsize=8.5, color=INK if marked else INK_2, ha="left", va="center",
                    fontweight="bold" if marked else "normal")
            for e, (engine, changed) in enumerate(engines):
                ax.text(0.035 + e * 0.145, y - 0.17, engine, fontsize=7.6, fontfamily="DejaVu Sans Mono",
                        fontweight="bold" if changed else "normal", color=INK if changed else INK_2, va="center")
            ax.text(0.035, y + 0.2, flags, fontsize=6.6, fontfamily="DejaVu Sans Mono", color=INK_2, va="center")
            if value is None:
                frac, text = s["distance_mae_ft"] / top_err, f"{s['distance_mae_ft']:.2f} ft"
            else:
                frac, text = value(s)
            x0, width = 0.60, 0.22
            ax.add_patch(Rectangle((x0, y - 0.24), max(0.004, width * frac), 0.48, facecolor=BLUE[2], lw=0))
            ax.text(x0 + width + 0.012, y, text, fontsize=8, fontfamily="DejaVu Sans Mono", color=INK, va="center")
            ax.text(0.995, y, f"{rate(r):.1f}", fontsize=8, fontfamily="DejaVu Sans Mono", ha="right", va="center",
                    color=INK)
            if k < len(best) - 1:
                ax.plot([0, 1], [k + 0.92, k + 0.92], color=NEUTRAL, lw=0.6)
    fig.text(0.03, 1 - 0.45 / height, f"The {TOP_N} best real-time configurations on each metric",
             fontsize=15, fontweight="bold")
    fig.text(0.03, 1 - 0.8 / height,
             f"Only the {len(scored)} configurations that hold 60 fps (rate-setting stage \u2264 "
             f"{FRAME_BUDGET_MS:.1f} ms, decode + pipeline) are ranked: by the metric, then by shots found, then by "
             f"speed. Bold engine: the one changed from the n-640 baseline; the line under it gives the flags.",
             fontsize=9, color=INK_2)
    fig.text(0.03, 1 - 1.05 / height,
             "Scored against burkelake8's 5 recorded shots; distance and range class against the reference "
             "configuration's output (not tape).", fontsize=9, color=INK_2)
    fig.patches.append(Rectangle((0.03, 1 - 1.42 / height), 0.012, 0.22 / height, facecolor=BLUE[0], lw=0,
                                 transform=fig.transFigure, figure=fig))
    fig.text(0.036, 1 - 1.31 / height, "\u25c6", fontsize=8, color=INK, ha="center", va="center")
    fig.text(0.047, 1 - 1.31 / height,
             f"In all four lists: {len(in_all)} configurations rank in the top {TOP_N} on every metric, shaded and "
             f"marked wherever they appear.", fontsize=9, color=INK, va="center", fontweight="bold")
    for ext in ("png", "svg"):
        fig.savefig(out / f"top_{TOP_N}_real_time.{ext}", dpi=170)
    plt.close(fig)
    print(f"top_{TOP_N}_real_time: {len(scored)} real-time configurations -> {out}/top_{TOP_N}_real_time.png, .svg")


def model_accuracy(out: Path) -> None:
    """The accuracy lever on its own: the 27 models ranked by mAP50-95 within
    their type (each type is scored on its own validation set, pose on COCO),
    with the app's own model as a grey bar. No configurations, speed or
    shots: just the models (research/sweep/model_scores.json)."""
    data = json.loads((HERE / "model_scores.json").read_text())
    scores, app = data["scores"], data["app_models"]
    panels = [
        ("obj", "Object detection", "box mAP50-95, detection val set (250 images)"),
        ("court", "Court keypoints", "keypoint mAP50-95, court val set (103 images)"),
        ("player", "Shooter pose", "keypoint mAP50-95, COCO val2017 (stock models, not trained here)"),
    ]
    fig, axes = plt.subplots(1, 3, figsize=(17, 6.6))
    fig.subplots_adjust(left=0.095, right=0.985, top=0.76, bottom=0.12, wspace=0.42)
    for ax, (t, title, how) in zip(axes, panels):
        # The app's own model ranks among the 27 as a grey bar; for pose it is
        # player-n-640 itself, so that bar is labelled rather than repeated.
        rows = {n: scores[n] for n in scores if n.startswith(t + "-")}
        app_label = "app's model"
        if t == "player":
            rows = {(f"{n}\n(app's model)" if n == "player-n-640" else n): v for n, v in rows.items()}
        else:
            rows[app_label] = app[t]["map50_95"]
        names = sorted(rows, key=lambda n: -rows[n])
        ys = range(len(names))
        colour = GROUP_STYLE[t][0]
        is_app = ["app's model" in n for n in names]
        ax.barh(list(ys), [rows[n] for n in names], height=0.62, zorder=2,
                color=["#b4b2ac" if a else colour for a in is_app])
        for y, n in zip(ys, names):
            ax.text(rows[n] + 0.012, y, f"{rows[n]:.3f}", va="center", ha="left", fontsize=8.5,
                    fontfamily="DejaVu Sans Mono", color=INK, zorder=4)
        ax.set_yticks(list(ys))
        ax.set_yticklabels(names, fontsize=8.5, fontfamily="DejaVu Sans Mono")
        for lab, a in zip(ax.get_yticklabels(), is_app):
            if a:
                lab.set_fontweight("bold")
        ax.invert_yaxis()
        ax.set_xlim(0, 1.0)
        ax.set_xticks([0, 0.25, 0.5, 0.75, 1.0])
        ax.tick_params(axis="x", labelsize=8, colors=INK_2)
        ax.tick_params(axis="y", length=0, colors=INK)
        ax.grid(axis="x", color=NEUTRAL, lw=0.8, zorder=0)
        for side in ("top", "right", "left"):
            ax.spines[side].set_visible(False)
        ax.spines["bottom"].set_color(INK_2)
        ax.set_ylim(9.5, -0.6)  # ten rows in every panel, so bars match in height
        ax.set_title(title, loc="left", fontsize=12, fontweight="bold", color=INK, pad=22)
        ax.text(0, 1.035, how, transform=ax.transAxes, fontsize=8, color=INK_2, va="bottom")
    fig.text(0.02, 0.94, "How accurate is each model?", fontsize=15, fontweight="bold", color=INK)
    fig.text(0.02, 0.895,
             "mAP50-95 of each of the 27 engines (trained models at their saved best epoch; stock pose models as released), ranked within its type. The three types are "
             "scored on different validation sets, so values compare only within a panel.", fontsize=9, color=INK_2)
    fig.text(0.02, 0.862,
             "Grey bar: the model the app runs today, for comparison. The pose models are Ultralytics' stock release; "
             "the app's pose model is player-n-640.", fontsize=9, color=INK_2)
    fig.text(0.02, 0.03,
             "Same recipe for every model of a type (obj 75 epochs; court 150 epochs, MuSGD, patience 25; seed 0). "
             "court-m-1280 stopped early at epoch 115 under that patience.", fontsize=8, color=INK_2)
    for ext in ("png", "svg"):
        fig.savefig(out / f"model_accuracy.{ext}", dpi=200)
    plt.close(fig)
    print(f"model_accuracy -> {out}/model_accuracy.png, .svg")


def final_ranking(runs: dict, gt: dict, out: Path, top_n: int = 10) -> list[tuple[dict, dict]]:
    """The levers in their order, for the final table:
        1. speed     a gate: only configurations that hold 60 fps
        2. accuracy  a gate: the changed model is at least as accurate (mAP50-95)
                     as its type's n-640 baseline (a gain, because the types are
                     scored on different val sets)
        3. fidelity  ranks what passes: shots found, then make/miss against the
                     recorded shots
       then the mAP gain and speed as tie-breaks. Returns the ranked list."""
    scores = json.loads((HERE / "model_scores.json").read_text())["scores"]
    n_truth = len(gt["shots"])
    rate = lambda r: r["per_frame_ms"]["rate"]
    gain = lambda r: scores[r["variant"]] - scores[f"{r['changed_type']}-n-640"]
    real = [r for r in runs.values() if r["real_time_60fps"]]
    ranked = sorted(((r, score(r, gt)) for r in real if gain(r) >= 0),
                    key=lambda x: (-x[1]["shots_matched"], -x[1]["make_miss_acc"], -gain(x[0]), rate(x[0])))
    best = ranked[:top_n]
    height = top_n * 0.5 + 2.9
    fig, ax = plt.subplots(figsize=(17, height))
    fig.subplots_adjust(left=0.03, right=0.985, top=1 - 2.0 / height, bottom=0.3 / height)
    ax.set_xlim(0, 1)
    ax.set_ylim(top_n + 0.1, -0.7)
    ax.axis("off")
    cols = [(0.035, "Engines and flags", "left"), (0.47, "1 \u00b7 Speed, ms", "right"),
            (0.50, "2 \u00b7 Accuracy, mAP50-95 (gain)", "left"), (0.735, "3 \u00b7 Shots", "left"),
            (0.84, "3 \u00b7 Make / miss", "left")]
    for x, head, ha in cols:
        ax.text(x, -0.25, head, fontsize=8.5, fontweight="bold", color=INK_2, ha=ha, va="bottom")
    for k, (r, s) in enumerate(best):
        y = k + 0.42
        engines, flags = config_label(r)
        ax.text(0.0, y, f"{k + 1}", fontsize=10, color=INK, ha="left", va="center", fontweight="bold")
        for e, (engine, changed) in enumerate(engines):
            ax.text(0.035 + e * 0.115, y - 0.17, engine, fontsize=8.5, fontfamily="DejaVu Sans Mono",
                    fontweight="bold" if changed else "normal", color=INK if changed else INK_2, va="center")
        ax.text(0.035, y + 0.2, flags, fontsize=7.4, fontfamily="DejaVu Sans Mono", color=INK_2, va="center")
        ax.text(0.47, y, f"{rate(r):.1f}", fontsize=9.5, fontfamily="DejaVu Sans Mono", ha="right", va="center",
                color=INK)
        m, g = scores[r["variant"]], gain(r)
        ax.add_patch(Rectangle((0.50, y - 0.2), 0.11 * m, 0.4, facecolor=GROUP_STYLE[r["changed_type"]][0], lw=0))
        ax.text(0.618, y, f"{m:.3f} (+{g:.3f})", fontsize=9, fontfamily="DejaVu Sans Mono", va="center", color=INK)
        ax.add_patch(Rectangle((0.735, y - 0.2), 0.06 * s["shots_matched"] / n_truth, 0.4, facecolor=BLUE[2], lw=0))
        ax.text(0.80, y, f"{s['shots_matched']}/{n_truth}", fontsize=9, fontfamily="DejaVu Sans Mono", va="center",
                color=INK)
        ax.text(0.84, y, f"{s['makes_right']}/{s['makes_recorded']} makes \u00b7 {s['misses_right']}/"
                         f"{s['misses_recorded']} misses", fontsize=9, fontfamily="DejaVu Sans Mono", va="center",
                color=INK)
        if k < len(best) - 1:
            ax.plot([0, 1], [k + 0.92, k + 0.92], color=NEUTRAL, lw=0.6)
    fig.text(0.03, 1 - 0.5 / height, f"The {top_n} best configurations by the three levers, in order",
             fontsize=15, fontweight="bold")
    fig.text(0.03, 1 - 0.78 / height,
             f"1 \u00b7 Speed is a gate: the {len(real)} configurations that hold 60 fps (rate-setting stage "
             f"\u2264 {FRAME_BUDGET_MS:.1f} ms).  2 \u00b7 Accuracy is a gate: the changed model's mAP50-95 is at "
             f"least its type's n-640 baseline ({len(ranked)} pass both).\n3 \u00b7 Fidelity ranks them: shots "
             f"found, then make/miss against the recorded shots; then the mAP gain, then speed.", fontsize=9,
             color=INK_2, va="top", linespacing=1.6)
    fig.text(0.03, 1 - 1.42 / height,
             "Accuracy is a gain because each model type is scored on its own validation set. Bar colour: the model "
             "changed (blue detection, orange court keypoints, green shooter pose); bold engine: the one changed.",
             fontsize=9, color=INK_2)
    for ext in ("png", "svg"):
        fig.savefig(out / f"final_top_{top_n}.{ext}", dpi=200)
    plt.close(fig)
    print(f"final_top_{top_n}: from {len(ranked)} of {len(real)} real-time configurations -> {out}/final_top_{top_n}.png, .svg")
    return ranked


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--results", type=Path, default=HERE / "results")
    parser.add_argument("--truth", type=Path, default=HERE / "ground_truth" / "burkelake8.json")
    args = parser.parse_args()
    runs = {}
    for line in (args.results / "runs.jsonl").open():
        r = json.loads(line)
        runs[r["run_id"]] = r
    latency_matrix(runs, args.results)
    gt = json.loads(args.truth.read_text())
    metric_charts(runs, gt, args.results)
    top_real_time(runs, gt, args.results)
    model_accuracy(args.results)
    final_ranking(runs, gt, args.results)


if __name__ == "__main__":
    main()
