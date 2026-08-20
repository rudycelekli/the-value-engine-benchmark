#!/usr/bin/env bash
set -euo pipefail
fail=0
# 1) No real secrets in tracked files.
if git grep -nE 'sk-[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----' -- . ':!*.example' ':!scripts/secret-guard.sh'; then
  echo "SECRET-GUARD: possible secret above"; fail=1; fi
# 2) No tracked .env except .env.example.
if git ls-files | grep -E '(^|/)\.env$'; then echo "SECRET-GUARD: tracked .env"; fail=1; fi
# 3) No tracked file >50MB.
while IFS= read -r f; do
  sz=$(wc -c <"$f"); if [ "$sz" -gt 52428800 ]; then echo "SECRET-GUARD: >50MB: $f"; fail=1; fi
done < <(git ls-files)
# 4) No 'datamate' anywhere.
if git grep -ni 'datamate' -- . ':!scripts/secret-guard.sh'; then echo "SECRET-GUARD: datamate reference"; fail=1; fi
exit $fail
