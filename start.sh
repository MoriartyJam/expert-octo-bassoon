#!/bin/sh
set -eu

exec gunicorn \
  --bind "0.0.0.0:${PORT:-8000}" \
  --workers "${WEB_CONCURRENCY:-1}" \
  --threads "${GUNICORN_THREADS:-4}" \
  --timeout "${GUNICORN_TIMEOUT:-180}" \
  --graceful-timeout 30 \
  --access-logfile - \
  --error-logfile - \
  wsgi:app
