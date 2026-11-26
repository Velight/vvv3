#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
if [ ! -f .env ]; then
  echo 'Создайте .env из .env.example и настройте ключи доступа.' >&2
  exit 1
fi
set -a
. ./.env
set +a
exec python -m uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8000 --workers 1
