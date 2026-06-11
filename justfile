# manywidgets-playground tasks. Run `just` to see this list.

default:
    @just --list

# One-command setup: venv + register the Jupyter kernel
setup:
    uv sync
    uv run python -m ipykernel install --user \
        --name manywidgets-playground --display-name "manywidgets-playground"

lab:
    uv run jupyter lab

# Scaffold a new notebook:  just new "my idea"
new title:
    uv run scripts/new_notebook.py "{{title}}"

# Pre-execute every notebook so widget state is captured for static export
execute:
    uv run jupyter nbconvert --to notebook --execute --inplace notebooks/*.ipynb

# Build the static, kernel-free site (executes first for fresh widget state)
build: execute
    uv run myst build --html

# Serve over HTTP (NOT file://) so widgets can dynamic-import their JS
serve:
    uv run python -m http.server -d _build/html 9876

# Full local preview at http://localhost:9876
preview: build serve

clean:
    rm -rf _build
