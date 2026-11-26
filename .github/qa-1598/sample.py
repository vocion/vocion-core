"""TEMPORARY (#1598): samples memory once a second while the image builds.

Usage: sample.py <out.txt> [seconds]

One line per sample, every figure in MB:
  epoch host_used host_anon swap_used top_anon top_name top_cg_peak
host_used    MemTotal - MemAvailable
host_anon    AnonPages (anonymous memory, no page cache)
swap_used    SwapTotal - SwapFree
top_anon     the largest RssAnon + VmSwap of any one process
top_name     that process's name, from /proc/<pid>/status
top_cg_peak  memory.peak of that process's cgroup (includes page cache)
"""

import os
import sys
import time


def read_meminfo():
    values = {}
    with open("/proc/meminfo") as handle:
        for line in handle:
            key, _, rest = line.partition(":")
            values[key] = int(rest.split()[0])
    return values


def read_process(pid):
    name, anon, swap = "", 0, 0
    try:
        with open(f"/proc/{pid}/status") as handle:
            for line in handle:
                if line.startswith("Name:"):
                    name = line.split()[1]
                elif line.startswith("RssAnon:"):
                    anon = int(line.split()[1])
                elif line.startswith("VmSwap:"):
                    swap = int(line.split()[1])
    except OSError:
        return None
    return name, anon + swap


def cgroup_peak_mb(pid):
    try:
        with open(f"/proc/{pid}/cgroup") as handle:
            path = handle.readline().strip().split(":", 2)[2]
        with open(f"/sys/fs/cgroup{path}/memory.peak") as handle:
            return int(handle.read()) // 1048576
    except (OSError, IndexError, ValueError):
        return 0


def sample_once():
    info = read_meminfo()
    top_pid, top_name, top_kb = None, "-", 0
    for entry in os.listdir("/proc"):
        if not entry.isdigit():
            continue
        found = read_process(entry)
        if found and found[1] > top_kb:
            top_pid, top_name, top_kb = entry, found[0], found[1]
    return [
        int(time.time()),
        (info["MemTotal"] - info["MemAvailable"]) // 1024,
        info["AnonPages"] // 1024,
        (info["SwapTotal"] - info["SwapFree"]) // 1024,
        top_kb // 1024,
        top_name.replace(" ", "_") or "-",
        cgroup_peak_mb(top_pid) if top_pid else 0,
    ]


def main(out_path, seconds):
    deadline = time.time() + seconds if seconds else None
    with open(out_path, "a") as out:
        while deadline is None or time.time() < deadline:
            out.write(" ".join(str(value) for value in sample_once()) + "\n")
            out.flush()
            time.sleep(1)


if __name__ == "__main__":
    main(sys.argv[1], float(sys.argv[2]) if len(sys.argv) > 2 else 0)
