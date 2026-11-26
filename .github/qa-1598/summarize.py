"""TEMPORARY (#1598): turns sample.py's samples into peak figures.

Usage: summarize.py <label> <baseline.txt> <samples.txt> <build.log>

The build log lines carry the epoch second they were printed at, so each peak
can be placed next to the last line the build printed before it.
"""

import json
import re
import statistics
import sys

COMPILE_DONE = re.compile(r"Compiled successfully|Compiled with warnings")


def read_samples(path):
    rows = []
    with open(path) as handle:
        for line in handle:
            parts = line.split()
            if len(parts) != 7:
                continue
            rows.append({
                "epoch": int(parts[0]), "used": int(parts[1]), "anon": int(parts[2]),
                "swap": int(parts[3]), "top_anon": int(parts[4]), "top_name": parts[5],
                "top_cg_peak": int(parts[6]),
            })
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


def last_line_before(log, epoch):
    candidates = [text for stamp, text in log if stamp <= epoch + 0.5 and text.strip()]
    return candidates[-1][:160] if candidates else ""


def anon_with_swap(row):
    return row["anon"] + row["swap"]


def used_with_swap(row):
    return row["used"] + row["swap"]


def top_anon(row):
    return row["top_anon"]


def main(label, baseline_path, samples_path, log_path):
    baseline = read_samples(baseline_path)
    samples = read_samples(samples_path)
    log = read_log(log_path)
    base_anon = statistics.median(anon_with_swap(row) for row in baseline)
    base_used = statistics.median(used_with_swap(row) for row in baseline)
    compile_done = next((stamp for stamp, text in log if COMPILE_DONE.search(text)), None)
    peak_anon = max(samples, key=anon_with_swap)
    peak_top = max(samples, key=top_anon)
    result = {
        "label": label,
        "build_anon_mb": round(anon_with_swap(peak_anon) - base_anon),
        "build_used_mb": round(max(used_with_swap(row) for row in samples) - base_used),
        "top_process_mb": peak_top["top_anon"],
        "top_process_name": peak_top["top_name"],
        "top_cgroup_peak_mb": max(row["top_cg_peak"] for row in samples),
        "swap_peak_mb": max(row["swap"] for row in samples),
        "peak_during": last_line_before(log, peak_anon["epoch"]),
        "build_seconds": round(log[-1][0] - log[0][0]) if log else 0,
        "compiled_after_seconds": round(compile_done - log[0][0]) if compile_done and log else None,
    }
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main(*sys.argv[1:5])
