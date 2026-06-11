# manywidgets playground

[![Deploy playground to Pages](https://github.com/developmentseed/manywidgets-playground/actions/workflows/deploy.yml/badge.svg)](https://github.com/developmentseed/manywidgets-playground/actions/workflows/deploy.yml)

Author [manywidgets](https://github.com/developmentseed/manywidgets) notebooks
locally in Jupyter, then publish them as a **static, kernel-free interactive
site** on GitHub Pages. Sliders drag, layers toggle, and maps fly — with no
kernel running — thanks to the
[`myst-anywidget-static-export`](https://github.com/developmentseed/myst-anywidget-static-export)
plugin.

## Quickstart

You need [`uv`](https://docs.astral.sh/uv/) and
[`just`](https://github.com/casey/just). The git install of `manywidgets` builds
its widget JS at install time, so you also need **Node** (22+) on your PATH.

```bash
uv tool install rust-just            # if you don't have `just`
git clone https://github.com/developmentseed/manywidgets-playground
cd manywidgets-playground
just setup                           # uv sync + register the Jupyter kernel
just lab                             # open Jupyter Lab and play
```

Run `just` with no arguments to see every task.

To publish: push to `main` (one-time: **Settings → Pages → Source = GitHub
Actions**). See [Deploying](#deploying).

## Project layout

```
notebooks/        # the product: your notebooks, auto-discovered onto the site
templates/        # _starter.ipynb — scaffolding source (underscore keeps it off the site)
scripts/          # new_notebook.py — the `just new` scaffolder
index.md          # landing page + curated gallery
myst.yml          # MyST config (no toc → auto-discovery)
justfile          # task commands
pyproject.toml    # uv-managed app (not a wheel)
.github/workflows/deploy.yml
```

## Creating a notebook

```bash
just new "my idea"
```

That copies the starter template to `notebooks/my-idea.ipynb` with the right
title and kernelspec. Any `.ipynb` you drop in `notebooks/` appears on the site
automatically — there's **no `toc` to edit**.

**Naming & order:** name notebooks whatever you like; there's no required numeric
prefix to coordinate across branches. The sidebar lists them alphabetically, and
the intended reading order is curated by hand in `index.md`. (If you ever want to
pin a notebook's position you can still prefix its filename — nothing requires or
generates one.)

## Local preview

```bash
just preview        # execute notebooks → myst build --html → serve on :9876
```

Then open <http://localhost:9876>.

> **`file://` gotcha:** widgets load their JS via dynamic `import()`, which
> browsers block on `file://` origins. Always view the built site over HTTP
> (`just serve`), never by opening the HTML file directly.

## Secrets

Secrets are available only during **build-time Python execution** — use them to
*fetch data*, never to populate a serialized widget trait (it would be baked into
the public page).

```bash
cp .env.example .env     # fill in values; .env is gitignored
```

In a notebook, the same code path works locally and in CI:

```python
import os
from dotenv import load_dotenv
load_dotenv()                       # reads .env locally; no-op in CI
token = os.environ.get("EXAMPLE_API_TOKEN")
if not token:
    print("⚠ EXAMPLE_API_TOKEN not set — see .env.example")
```

In CI, add the value under **Settings → Secrets and variables → Actions**; the
deploy workflow maps it into the pre-execute step's environment.

## Deploying

Push to `main`. The workflow syncs deps, registers a kernel, **pre-executes every
notebook** (so widget state is captured), builds with `BASE_URL` set to the repo
name, and publishes to Pages.

- One-time: **Settings → Pages → Source = GitHub Actions.**
- `BASE_URL` must equal the repo name (`/manywidgets-playground`) for project
  Pages to resolve assets — it's already set in `deploy.yml`.

## Agent skills

manywidgets ships a Claude Code skill inside the pinned dependency. Install it on
demand (don't vendor it — `.claude/` is gitignored so it always tracks the locked
library):

```bash
uv run manywidgets install-skill      # → ./.claude/skills/manywidgets/
```

Two optional project-skill ideas you can add under `.claude/skills/` if you want
them (kept out by default to stay lean):

- **scaffold-dashboard** — generate a notebook (via `just new`) wiring a `Chart`
  + control `Column` + `Stat` row with `jsdlink`.
- **make-static-safe** — audit a notebook for static-export footguns (flag
  `on_click`/`observe`, suggest `jslink`/`Binder`, remind to pre-execute).

## Troubleshooting

- **Blank widgets on the site** — you forgot to pre-execute (`just execute`, or
  just use `just build`/`just preview` which execute first), or you put the code
  in a plain Markdown ```python fence instead of an executed `.ipynb`. MyST does
  not execute Markdown into widget outputs.
- **Widgets don't load when I open the HTML** — you're on `file://`. Use
  `just serve` and open `http://localhost:9876`.
- **A button/handler does nothing on the static site** — Python `on_click` /
  `observe` callbacks need a live kernel and are inert statically. Use
  `jslink` / `jsdlink` / `Binder` instead; those survive export.
- **Kernel not found / wrong kernel** — re-run `just setup` to re-register the
  `manywidgets-playground` kernel.

## Links

- [manywidgets](https://github.com/developmentseed/manywidgets)
- [myst-anywidget-static-export](https://github.com/developmentseed/myst-anywidget-static-export)
- [MyST Markdown](https://mystmd.org)
- [lonboard](https://developmentseed.org/lonboard/)
