#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
export PYINSTALLER_CONFIG_DIR="$PWD/build/pyinstaller-cache"
.venv/bin/python -m PyInstaller --noconfirm --clean --onedir --name rezumator-pdf \
  --distpath stage/runtime --workpath build/pdf --specpath build \
  --add-data "$PWD/assets/fonts:fonts" ../local/pdf-tool.py
rm -rf stage/runtime/pdf
mv stage/runtime/rezumator-pdf stage/runtime/pdf
.venv/bin/python scripts/copy-licenses.py
