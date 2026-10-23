#!/usr/bin/env bash
# pnpm inserts a "--" before arguments passed to a script. EAS treats that as
# the end of its flags, so drop one leading separator before publishing.
set -euo pipefail

channel="$1"
environment="$2"
shift 2

if [[ "${1:-}" == "--" ]]; then
  shift
fi

cd "$(dirname "$0")/.."
exec pnpm exec eas update --channel "$channel" --environment "$environment" "$@"
