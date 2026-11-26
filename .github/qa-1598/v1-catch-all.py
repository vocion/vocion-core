"""TEMPORARY (#1598): rebuilds api/v1 as one route entry, to measure it.

Usage: v1-catch-all.py <packages/core/src/app>

Moves app/api/v1 to the private folder app/_v1routes/v1 (Next never routes a
folder that starts with "_"; same depth, so every relative import still
resolves) and writes app/api/v1/[...path]/route.ts, which imports every moved
route module. Turbopack then compiles all 114 handlers into one entry instead
of 114. It only answers 501: this measures the build, it is not a router.
"""

import os
import shutil
import sys


def main(app_dir):
    source = os.path.join(app_dir, "api", "v1")
    moved = os.path.join(app_dir, "_v1routes", "v1")
    os.makedirs(os.path.dirname(moved), exist_ok=True)
    shutil.move(source, moved)
    routes = []
    for root, _dirs, files in os.walk(moved):
        for name in files:
            if name in ("route.ts", "route.tsx"):
                routes.append(os.path.join(root, name))
    routes.sort()
    entry_dir = os.path.join(app_dir, "api", "v1", "[...path]")
    os.makedirs(entry_dir)
    lines = []
    for index, path in enumerate(routes):
        relative = os.path.relpath(path, entry_dir).rsplit(".", 1)[0]
        lines.append(f"import * as route{index} from '{relative}';")
    names = ", ".join(f"route{index}" for index in range(len(routes)))
    lines.append(f"const handlers: unknown[] = [{names}];")
    lines.append("export async function GET() { return new Response(String(handlers.length), { status: 501 }); }")
    lines.append("export async function POST() { return new Response(String(handlers.length), { status: 501 }); }")
    with open(os.path.join(entry_dir, "route.ts"), "w") as out:
        out.write("\n".join(lines) + "\n")
    print(f"{len(routes)} v1 routes behind one entry")


if __name__ == "__main__":
    main(sys.argv[1])
