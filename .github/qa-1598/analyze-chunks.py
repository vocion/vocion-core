"""TEMPORARY (#1598): which packages fill the server build, by chunk bytes.

Usage: analyze-chunks.py <.next/server directory>

Turbopack names each server chunk after the path of the modules in it
(node_modules_<package>_..., packages_core_src_<folder>_...), so summing chunk
bytes by that prefix shows roughly which dependencies and source folders the
build compiled the most of. It is a proxy: a chunk that mixes packages is
counted under the first one in its name.
"""

import collections
import os
import sys


def group_of(file_name):
    name = file_name.split("/")[-1]
    if name.startswith("node_modules_"):
        parts = name[len("node_modules_"):].split("_")
        if parts[0].startswith("@") and len(parts) > 1:
            return f"npm {parts[0]}/{parts[1]}"
        return f"npm {parts[0]}"
    if name.startswith("packages_core_src_"):
        parts = name[len("packages_core_src_"):].split("_")
        return f"src {parts[0]}/{parts[1] if len(parts) > 1 else ''}"
    if name.startswith("[root-of-the-server]"):
        return "[root-of-the-server]"
    return "other " + name.split("_")[0][:30]


def main(server_dir):
    sizes = collections.Counter()
    counts = collections.Counter()
    total = 0
    for root, _dirs, files in os.walk(server_dir):
        for file_name in files:
            if not file_name.endswith(".js"):
                continue
            path = os.path.join(root, file_name)
            size = os.path.getsize(path)
            total += size
            if "/chunks/" in path:
                group = group_of(file_name)
                sizes[group] += size
                counts[group] += 1
    print(f"server JS {total / 1048576:.0f} MB in all; chunks by group (MB, files):")
    for group, size in sizes.most_common(40):
        print(f"{size / 1048576:8.1f} {counts[group]:6d}  {group}")


if __name__ == "__main__":
    main(sys.argv[1])
