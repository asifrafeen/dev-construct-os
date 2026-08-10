#!/usr/bin/env bash
# Preflight: confirm the account works and show the projects, tenant ids and app domains.
# Run this before blocks-configure-oidc.sh.
#
#   npm run blocks:preflight

cd "$(dirname "$0")/.."
. scripts/lib.sh

load_env
info "Logging in as $BLOCKS_USERNAME …"
blocks_login
ok "Logged in — account tenant $ACCOUNT_TENANT"

projects=$(curl -sS "$BLOCKS_API_URL/os/v4/Project/Gets?page=0&pageSize=100" \
  -H "x-blocks-key: $ACCOUNT_TENANT" -H "Authorization: Bearer $TOK")

echo
node -e '
  let groups;
  try { groups = JSON.parse(process.argv[1]); } catch { groups = []; }
  const rows = (Array.isArray(groups) ? groups : []).flatMap((g) => g.projects || []);
  if (!rows.length) {
    console.log("No projects found. Create one in the portal (https://os.seliseblocks.com) or via the API.");
    process.exit(0);
  }
  console.log("Projects\n");
  for (const p of rows) {
    const domains = (p.applications || []).map((a) => a.domain).filter(Boolean);
    console.log(`  ${p.name}`);
    console.log(`    environment : ${p.environment ?? "—"}`);
    console.log(`    tenantId    : ${p.tenantId}          <- VITE_BLOCKS_PROJECT_KEY`);
    console.log(`    domains     : ${domains.length ? domains.join(", ") : "—"}`);
    console.log("");
  }
' "$projects"

ok "Preflight complete."
