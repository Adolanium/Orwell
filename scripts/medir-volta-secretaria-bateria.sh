#!/bin/sh
# The desktop return battery: one version, 1, 5 and 15 minutes minimized, one run at a time.
#   sh scripts/medir-volta-secretaria-bateria.sh <label> <apps/client/out of a build> --saida <results folder> [--perfil]
set -u
ROTULO="$1"; OUT="$2"; shift 2
cd "$(dirname "$0")/.."
for par in "1 3" "5 2" "15 1"; do
  set -- $par "$@"
  MIN=$1; VOLTAS=$2; shift 2
  node --max-old-space-size=8192 scripts/medir-volta-secretaria.mjs --rotulo "$ROTULO-${MIN}min" --out "$OUT" --minutos "$MIN" --voltas "$VOLTAS" "$@"
  # Nothing to kill here: each run closes the Electron it launched. Never a global pkill,
  # other work on this machine runs its own browsers.
done
