#!/bin/sh
# Smoke test for `docker compose up`: the API answers as a seeded user, and the mock serves the contract.
set -eu

wait_for() {
  for _ in $(seq 1 60); do
    curl -fs -o /dev/null "$@" && return 0
    sleep 2
  done
  echo "Timed out waiting for $*" >&2
  docker compose logs >&2
  exit 1
}

wait_for http://localhost:3000/health
TOKEN=$(docker compose exec -T api node dist/scripts/token.js anna)
wait_for -H "Authorization: Bearer $TOKEN" http://localhost:3000/v1/companies/01900000-0000-7000-8000-0000000000c1/card-overview
wait_for -H "Authorization: Bearer any" http://localhost:4010/v1/me/companies
echo "docker compose stack OK"
