# manywidgets playground

[![Deploy playground to Pages](https://github.com/developmentseed/manywidgets-playground/actions/workflows/deploy.yml/badge.svg)](https://github.com/developmentseed/manywidgets-playground/actions/workflows/deploy.yml)

Author [manywidgets](https://developmentseed.org/manywidgets) notebooks
in Jupyter and publish them as a static, kernel-free interactive site at
<https://developmentseed.org/manywidgets-playground>.

## Add a notebook

1. **Add your notebook** — drop any `.ipynb` into `notebooks/`. It's
   auto-discovered onto the site; there's no `toc` to edit. (Optional scaffold:
   `just new "my idea"` copies the starter template with the right title and
   kernelspec.)
2. **Execute it** — `just execute` runs every notebook so widget state is
   captured, then **commit the executed `.ipynb`**. CI does not execute
   notebooks; it renders the committed outputs, so the widget state must be
   baked in before you push.
3. **Preview locally** — `just preview` builds and serves at
   <http://localhost:9876>. Always view over HTTP, never by opening the HTML
   file directly (`file://` blocks the widgets' dynamic `import()`).
4. **Publish** — open a PR with the executed notebook; once it merges to `main`,
   GitHub Actions builds the committed outputs and publishes to
   <https://developmentseed.org/manywidgets-playground>.

**First time?** You need [`uv`](https://docs.astral.sh/uv/) (see their docs to
install), plus [`just`](https://github.com/casey/just) and **Node 22+** on your
PATH (the git install of `manywidgets` builds its widget JS at install time):

```bash
uv tool install rust-just            # installs `just` if you don't have it
git clone https://github.com/developmentseed/manywidgets-playground
cd manywidgets-playground
just setup                           # uv sync + register the Jupyter kernel
```

Then `just lab` opens Jupyter Lab to author interactively, and `just` with no
arguments lists every task.

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

**Naming & order:** name notebooks whatever you like — no numeric prefix
required. The sidebar lists them alphabetically; the intended reading order is
curated by hand in `index.md`. Prefix a filename only if you want to pin its
position.

## Python dependencies

Your notebooks can import any Python packages they need. Since CI never executes
— it only renders the committed, pre-executed outputs — those packages are needed
only on **your machine** to run `just execute`, not by this project or CI.

So install whatever a notebook needs locally, but **commit only the executed
`.ipynb`, not the dependency**. For example, the Montandon notebooks need
`pystac_client`:

```bash
uv add pystac_client                  # install locally so you can run the notebook
just execute                          # bake widget state into the .ipynb
git restore pyproject.toml uv.lock    # drop the dep — keep only the executed notebook
```

This keeps `pyproject.toml` to the shared, cross-notebook dependencies so
`uv sync` and CI stay lean. Only add a dependency there if every contributor
genuinely needs it.

## Secrets

Secrets are used only locally while you execute notebooks (`just execute`) — use
them to *fetch data*, never to populate a serialized widget trait (it would be
baked into the public page). CI never executes, so it never needs them.

```bash
cp .env.example .env     # fill in values; .env is gitignored
```

In a notebook:

```python
import os
from dotenv import load_dotenv
load_dotenv()                       # reads .env
token = os.environ.get("EXAMPLE_API_TOKEN")
if not token:
    print("⚠ EXAMPLE_API_TOKEN not set — see .env.example")
```

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

- **Blank widgets on the site** — you forgot to pre-execute and commit
  (`just execute`; neither `build` nor `preview` executes), or you put the code
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

- [manywidgets](https://developmentseed.org/manywidgets)
- [myst-anywidget-static-export](https://github.com/developmentseed/myst-anywidget-static-export)
- [MyST Markdown](https://mystmd.org)
- [lonboard](https://developmentseed.org/lonboard/)
