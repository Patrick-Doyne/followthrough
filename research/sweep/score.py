"""Telemetry fidelity of every real-time run against burkelake8's ground truth.

    python research/sweep/score.py [--results research/sweep/results] [--truth research/sweep/ground_truth/burkelake8.json]

Reads runs.jsonl (enqueue.py collect) and writes scores.csv beside it. Only
runs that held real time at 60 fps are scored; the rest are disqualified.
Real time is judged on the rate-setting stage, max(phone encode, decode +
pipeline), with the encode and decode constants in grid.py.

    shots       predicted shot events matched one-to-one to ground-truth shots
                whose result frame is within the tolerance; F1 of the match
                (precision = matched / predicted, recall = matched / actual)
    make_miss   right calls against the ground truth: of the recorded makes and
                misses, how many a configuration found and called the same way
                (a recorded shot it did not find counts as wrong), reported as
                makes right / recorded makes and misses right / recorded misses
    category    share of matched shots (with a ground-truth range class) whose
                shot_designation equals it; no designation counts as wrong
    distance    mean absolute error, in feet, of shot_distance against the taped
                distance, over matched shots that have both

The ground truth's distance and range class are the reference configuration's
output (see the file's source field), not tape measurements.
"""

from __future__ import annotations

import argparse
import csv
import json
import statistics
from pathlib import Path

HERE = Path(__file__).resolve().parent


def match(predicted: list[dict], truth: list[dict], tolerance: int) -> list[tuple[dict, dict]]:
    """One-to-one by nearest result frame within the tolerance."""
    pairs = sorted(
        ((abs(p["frame_id"] - t["result_frame"]), i, j) for i, p in enumerate(predicted) for j, t in enumerate(truth)),
    )
    used_p, used_t, out = set(), set(), []
    for gap, i, j in pairs:
        if gap > tolerance or i in used_p or j in used_t:
            continue
        used_p.add(i)
        used_t.add(j)
        out.append((predicted[i], truth[j]))
    return out


def score(run: dict, gt: dict) -> dict:
    truth = gt["shots"]
    predicted = run["shots"]
    pairs = match(predicted, truth, gt["match_tolerance_frames"])
    m = len(pairs)
    f1 = 2 * m / (len(predicted) + len(truth)) if predicted or truth else 1.0

    makes_right = sum(p["result"] == t["result"] == "make" for p, t in pairs)
    misses_right = sum(p["result"] == t["result"] == "miss" for p, t in pairs)
    truth_makes = sum(t["result"] == "make" for t in truth)
    make_miss = (makes_right + misses_right) / len(truth) if truth else None

    with_class = [(p, t) for p, t in pairs if t.get("range_class")]
    category = (
        sum(p.get("shot_designation") == t["range_class"] for p, t in with_class) / len(with_class)
        if with_class else None
    )

    with_tape = [(p, t) for p, t in pairs if t.get("taped_distance_ft") is not None]
    errors = [abs(p["shot_distance"] - t["taped_distance_ft"]) for p, t in with_tape if p.get("shot_distance") is not None]
    distance_mae = statistics.fmean(errors) if errors else None

    return {
        "shots_actual": len(truth),
        "shots_predicted": len(predicted),
        "shots_matched": m,
        "shots_f1": round(f1, 4),
        "make_miss_acc": None if make_miss is None else round(make_miss, 4),
        "makes_right": makes_right,
        "makes_recorded": truth_makes,
        "misses_right": misses_right,
        "misses_recorded": len(truth) - truth_makes,
        "category_acc": None if category is None else round(category, 4),
        "category_scored": len(with_class),
        "distance_mae_ft": None if distance_mae is None else round(distance_mae, 3),
        "distance_scored": len(errors),
        "distance_missing": len(with_tape) - len(errors),
    }


FIELDS = [
    "run_id", "variant", "changed_type", "cadence", "rate_ms", "mean_ms", "p95_ms",
    "shots_actual", "shots_predicted", "shots_matched", "shots_f1", "make_miss_acc", "makes_right", "makes_recorded", "misses_right", "misses_recorded",
    "category_acc", "category_scored", "distance_mae_ft", "distance_scored", "distance_missing",
]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--results", type=Path, default=HERE / "results")
    parser.add_argument("--truth", type=Path, default=HERE / "ground_truth" / "burkelake8.json")
    args = parser.parse_args()
    gt = json.loads(args.truth.read_text())
    runs = [json.loads(line) for line in (args.results / "runs.jsonl").open()]
    eligible = [r for r in runs if r["real_time_60fps"]]
    rows = []
    for r in eligible:
        rows.append({
            "run_id": r["run_id"], "variant": r["variant"], "changed_type": r["changed_type"],
            "cadence": r["cadence"]["name"], "rate_ms": r["per_frame_ms"]["rate"], "mean_ms": r["latency_ms"]["mean"], "p95_ms": r["latency_ms"]["p95"],
            **score(r, gt),
        })
    with open(args.results / "scores.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        w.writerows(rows)
    have_class = sum(1 for s in gt["shots"] if s.get("range_class"))
    have_tape = sum(1 for s in gt["shots"] if s.get("taped_distance_ft") is not None)
    print(f"{len(runs)} runs, {len(eligible)} real time at 60 fps and scored -> {args.results / 'scores.csv'}")
    print(f"ground truth: {len(gt['shots'])} shots, {have_class} with a range class, {have_tape} with a ground-truth distance")


if __name__ == "__main__":
    main()
