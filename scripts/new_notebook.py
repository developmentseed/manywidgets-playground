#!/usr/bin/env python3
"""Scaffold a new playground notebook from templates/_starter.ipynb.

Usage:
    uv run scripts/new_notebook.py "My great idea"

Copies the starter template to notebooks/<slug>.ipynb, sets the notebook's H1 to
the given title, and stamps the `manywidgets-playground` kernelspec so it opens
against the right kernel locally and executes in CI.

Notebooks are named purely from their title — no numeric prefixes to coordinate
across branches. The sidebar is ordered alphabetically; curate the intended
reading order in index.md. (You can still hand-prefix a filename if you ever want
to pin its position — nothing here requires or generates one.)
"""

from __future__ import annotations

import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
TEMPLATE = ROOT / "templates" / "_starter.ipynb"
NOTEBOOKS = ROOT / "notebooks"
KERNEL = "manywidgets-playground"


def slugify(title: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
    return slug or "notebook"


def unique_path(slug: str) -> pathlib.Path:
    """notebooks/<slug>.ipynb, suffixing -2, -3, … if that name is taken."""
    candidate = NOTEBOOKS / f"{slug}.ipynb"
    n = 2
    while candidate.exists():
        candidate = NOTEBOOKS / f"{slug}-{n}.ipynb"
        n += 1
    return candidate


def main(argv: list[str]) -> int:
    if len(argv) != 1 or not argv[0].strip():
        print('usage: new_notebook.py "Notebook title"', file=sys.stderr)
        return 2
    title = argv[0].strip()

    if not TEMPLATE.is_file():
        print(f"error: template not found at {TEMPLATE}", file=sys.stderr)
        return 1

    NOTEBOOKS.mkdir(exist_ok=True)
    dest = unique_path(slugify(title))

    nb = json.loads(TEMPLATE.read_text())

    # Set the first markdown cell's H1 to the title.
    for cell in nb.get("cells", []):
        if cell.get("cell_type") == "markdown":
            cell["source"] = [f"# {title}\n"]
            break

    # Stamp the kernelspec so it opens/executes against the right kernel.
    nb.setdefault("metadata", {})["kernelspec"] = {
        "display_name": KERNEL,
        "language": "python",
        "name": KERNEL,
    }

    dest.write_text(json.dumps(nb, indent=1) + "\n")
    rel = dest.relative_to(ROOT)
    print(f"Created {rel}")
    print('Next:  just lab     (edit & run it)   or   just preview   (build the site)')
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
