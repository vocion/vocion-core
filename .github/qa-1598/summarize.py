"""TEMPORARY (#1598): turns sample.sh's samples into peak figures.

Usage: summarize.py <label> <baseline.txt> <samples.txt> <build.log>

The build log lines carry the epoch second they were printed at, so each peak
can be placed in the build: before or after Turbopack's compile finished, and
next to the last line the build printed before it.
"""

import json
import re
import statistics
import sys

COLUMNS = ["epoch", "host_used", "host_anon", "swap_used", "nb_max", "nb_sum", "nb_count", "node_rss", "cg_peak", "cg_anon"]
COMPILE_DONE = re.compile(r"Compiled successfully|Compiled with warnings|Compiled in ")


def read_samples(path):
    rows = []
    with open(path) as handle:
        for line in handle:
            parts = line.split()
            if len(parts) == len(COLUMNS):
                rows.append(dict(zip(COLUMNS, map(int, parts))))
    return rows


def read_log(path):
    lines = []
    with open(path, errors="replace") as handle:
        for line in handle:
            stamp, _, text = line.partition(" ")
            try:
                lines.append((float(stamp), text.rstrip()))
            except ValueError:
                continue
    return lines


def peak(rows, key, extra=None):
    if not rows:
        return {"value": 0, "epoch": 0}
    best = max(rows, key=lambda row: row[key] + (row[extra] if extra else 0))
    return {"value": best[key] + (best[extra] if extra else 0), "epoch": best["epoch"]}


def last_line_before(log, epoch):
    candidates = [text for stamp, text in log if stamp <= epoch + 0.5 and text.strip()]
    return candidates[-1][:160] if candidates else ""


def main(label, baseline_path, samples_path, log_path):
    baseline = read_samples(baseline_path)
    samples = read_samples(samples_path)
    log = read_log(log_path)
    base_used = statistics.median(row["host_used"] + row["swap_used"] for row in baseline)
    base_anon = statistics.median(row["host_anon"] + row["swap_used"] for row in baseline)

    compile_done = next((stamp for stamp, text in log if COMPILE_DONE.search(text)), None)
    compile_rows = [row for row in samples if compile_done is None or row["epoch"] <= compile_done]
    after_rows = [row for row in samples if compile_done is not None and row["epoch"] > compile_done]

    used = peak(samples, "host_used", "swap_used")
    anon = peak(samples, "host_anon", "swap_used")
    nb = peak(samples, "nb_max")
    result = {
        "label": label,
        "build_used_mb": round(used["value"] - base_used),
        "build_anon_mb": round(anon["value"] - base_anon),
        "next_build_anon_mb": nb["value"],
        "next_build_anon_compile_mb": peak(compile_rows, "nb_max")["value"],
        "next_build_anon_after_compile_mb": peak(after_rows, "nb_max")["value"],
        "cgroup_peak_mb": max((row["cg_peak"] for row in samples), default=0),
        "cgroup_anon_mb": max((row["cg_anon"] for row in samples), default=0),
        "swap_peak_mb": max((row["swap_used"] for row in samples), default=0),
        "baseline_used_mb": round(base_used),
        "peak_used_during": last_line_before(log, used["epoch"]),
        "peak_next_build_during": last_line_before(log, nb["epoch"]),
        "build_seconds": round(log[-1][0] - log[0][0]) if log else 0,
        "compile_seconds": round(compile_done - log[0][0]) if compile_done and log else None,
    }
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main(*sys.argv[1:5])
