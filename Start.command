#!/bin/sh
cd "$(dirname "$0")" || exit 1
if [ ! -x .venv/bin/python ]; then
  echo 'Сначала выполните: python3 scripts/setup.py --llama'
  exit 1
fi
exec .venv/bin/python scripts/laptop.py "$@"
