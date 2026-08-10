#!/usr/bin/env bash
# Shared helpers for the Blocks admin scripts.
#
# These run OUTSIDE the browser, as an account admin. They use .env.blocks
# (BLOCKS_API_URL / BLOCKS_USERNAME / BLOCKS_PASSWORD) — never the app's .env, and never
# a VITE_ variable. The impersonated project token they mint stays here; it must not
# reach the frontend.

set -euo pipefail

RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[0;33m'; DIM=$'\033[2m'; NC=$'\033[0m'

die()  { echo "${RED}✗ $*${NC}" >&2; exit 1; }
ok()   { echo "${GREEN}✓ $*${NC}"; }
warn() { echo "${YELLOW}! $*${NC}"; }
info() { echo "${DIM}$*${NC}"; }

# Read a value out of a JSON document on stdin. `jq` isn't assumed; node always exists here.
# Usage: echo "$json" | jget '.access_token'   /   jget 'd.projects[0].tenantId'
jget() {
  node -e '
    let raw = "";
    process.stdin.on("data", (c) => (raw += c));
    process.stdin.on("end", () => {
      let d;
      try { d = JSON.parse(raw); } catch { process.stdout.write(""); return; }
      const expr = process.argv[1].replace(/^\./, "");
      try {
        const fn = new Function("d", `return d${expr.startsWith("[") ? "" : "."}${expr};`);
        const v = fn(d);
        process.stdout.write(v === undefined || v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));
      } catch { process.stdout.write(""); }
    });
  ' "$1"
}

TEMPLATE="  BLOCKS_API_URL=https://api.seliseblocks.com
  BLOCKS_USERNAME=<your Blocks login email>
  BLOCKS_PASSWORD=<your password>"

# Parse .env.blocks rather than sourcing it. Files written on Windows arrive as CRLF, and a
# trailing \r silently corrupts every URL built from BLOCKS_API_URL. Also tolerates a UTF-8
# BOM and `KEY = value` spacing, both of which plain `.` would mis-handle.
load_env() {
  local file="${1:-.env.blocks}"
  [ -f "$file" ] || die "$file not found. Create it with just these three lines:

$TEMPLATE

It is git-ignored — this is NOT a copy of .env. Write it yourself; don't paste the
password into a chat."

  local parsed
  parsed=$(node -e '
    const fs = require("fs");
    const want = new Set(["BLOCKS_API_URL", "BLOCKS_USERNAME", "BLOCKS_PASSWORD"]);
    const text = fs.readFileSync(process.argv[1], "utf8").replace(/^﻿/, "");
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      if (!want.has(key)) continue;
      let val = line.slice(eq + 1).trim().replace(/\r$/, "");
      if ((val.startsWith("\"") && val.endsWith("\"")) || (val.startsWith("'"'"'") && val.endsWith("'"'"'"))) {
        val = val.slice(1, -1);
      }
      if (!val) continue;
      // Base64 so passwords with quotes, $, or backticks survive the shell round-trip.
      // Tab-separated: base64 padding is "=", so "=" cannot be the field delimiter —
      // `read` would strip a single trailing "=" and corrupt the value.
      process.stdout.write(`${key}\t${Buffer.from(val, "utf8").toString("base64")}\n`);
    }
  ' "$file")

  local key b64
  while IFS=$'\t' read -r key b64; do
    [ -n "$key" ] || continue
    printf -v "$key" '%s' "$(printf '%s' "$b64" | base64 -d)"
    export "${key?}"
  done <<< "$parsed"

  local missing=()
  [ -n "${BLOCKS_API_URL:-}" ]  || missing+=("BLOCKS_API_URL")
  [ -n "${BLOCKS_USERNAME:-}" ] || missing+=("BLOCKS_USERNAME")
  [ -n "${BLOCKS_PASSWORD:-}" ] || missing+=("BLOCKS_PASSWORD")

  if [ ${#missing[@]} -gt 0 ]; then
    die "$file is missing: ${missing[*]}

It needs exactly these three lines and nothing else:

$TEMPLATE

If you copied .env into it, replace the contents — the VITE_* values belong in .env
and are not credentials."
  fi
}

# Step 1 of get-into-project: log in and derive the account (root) tenant id.
# Exports TOK, RT, ACCOUNT_TENANT.
blocks_login() {
  # auth-login is the ONLY Blocks call that omits x-blocks-key.
  local login
  login=$(curl -sS -X POST "$BLOCKS_API_URL/iam/v4/auth-login" \
    -H "Content-Type: application/json" \
    --data-raw "$(node -e 'process.stdout.write(JSON.stringify({username:process.argv[1],password:process.argv[2]}))' "$BLOCKS_USERNAME" "$BLOCKS_PASSWORD")")

  TOK=$(printf '%s' "$login" | jget '.access_token')
  RT=$(printf '%s' "$login" | jget '.refresh_token')
  # auth-login answers 200 with an all-null token envelope for every failure mode — wrong
  # password, unknown user, unactivated account — so the response carries no diagnostic.
  [ -n "$TOK" ] || die "Login rejected for $BLOCKS_USERNAME.

The API returns this same null response for a wrong password, an unknown user, and an
account that lives on a different Blocks platform, so it can't tell you which it is.
Confirm the credentials by signing in at https://os.seliseblocks.com in a browser:

  - Sign-in works there  -> re-check BLOCKS_PASSWORD in .env.blocks for typos/whitespace.
  - Sign-in fails there  -> reset the password, or the account is on the older
                            cloud.seliseblocks.com (v1) platform, which this API rejects.

Response: $(printf '%s' "$login" | head -c 200)"

  # ACCOUNT_TENANT is the tenant_id claim inside the access token.
  ACCOUNT_TENANT=$(node -e '
    const p = process.argv[1].split(".")[1];
    const j = JSON.parse(Buffer.from(p.replace(/-/g,"+").replace(/_/g,"/"), "base64").toString());
    process.stdout.write(j.tenant_id || "");
  ' "$TOK")
  [ -n "$ACCOUNT_TENANT" ] || die "Could not read tenant_id from the login token."
  export TOK RT ACCOUNT_TENANT
}

# Step 3: impersonate into a project. Exports PTOK.
blocks_impersonate() {
  local ptenant="$1"
  # Fixed constant used ONLY for the impersonate request — not per-project, don't compute it.
  local client_id="57214b67-aa9c-4307-92ab-a25e35180fac"

  local res
  res=$(curl -sS -X POST "$BLOCKS_API_URL/iam/v4/auth/impersonate" \
    -H "x-blocks-key: $ACCOUNT_TENANT" -H "Authorization: Bearer $TOK" \
    -H "Content-Type: application/json" \
    --data "$(node -e 'process.stdout.write(JSON.stringify({targeted_tenant_id:process.argv[1],refresh_token:process.argv[2],client_id:process.argv[3]}))' "$ptenant" "$RT" "$client_id")")

  PTOK=$(printf '%s' "$res" | jget '.access_token')
  [ -n "$PTOK" ] || die "Impersonation failed for $ptenant.
Response: $(printf '%s' "$res" | head -c 300)
Note: the refresh_token is single-use — re-run this script to mint a fresh one."
  export PTOK
}
