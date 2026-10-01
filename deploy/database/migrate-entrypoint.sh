#!/bin/sh
set -eu

cd /app
exec bun run scripts/init-db.ts
