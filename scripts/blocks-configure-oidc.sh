#!/usr/bin/env bash
# Ensure the project has an active blocks-oidc identity provider, then print the clientId
# to paste into VITE_BLOCKS_OIDC_CLIENT_ID.
#
#   npm run blocks:configure-oidc
#
# Decision tree (from the blocks-iam-sso-oidc-configuration skill):
#   provider exists? → done.  else client exists? → build provider from it.  else → create both.

cd "$(dirname "$0")/.."
. scripts/lib.sh

# Read the app's own config so the script and the frontend can't drift apart.
[ -f .env ] && { set -a; . ./.env; set +a; }
PTENANT="${VITE_BLOCKS_PROJECT_KEY:?VITE_BLOCKS_PROJECT_KEY missing from .env}"

# Every origin the app is served from needs its own registered redirect URI: the
# production domain and the local HTTPS dev origin (which includes the port).
REDIRECT_URIS_JSON=$(node -e '
  const uris = new Set();
  for (const v of process.argv.slice(1)) if (v) uris.add(v);
  process.stdout.write(JSON.stringify([...uris]));
' "${VITE_BLOCKS_REDIRECT_URI:-}" "https://dfqfhj.slsblx.com/login/callback" "https://dfqfhj.slsblx.com:5173/login/callback")

load_env
info "Logging in …"
blocks_login
ok "Account tenant $ACCOUNT_TENANT"

[ "$PTENANT" = "$ACCOUNT_TENANT" ] && die "Project key equals the account tenant — that's the root tenant, not a project."

info "Impersonating into project $PTENANT …"
blocks_impersonate "$PTENANT"
ok "Got a project-scoped token (stays here — never ships to the browser)"

# Configuration calls: x-blocks-key is the ROOT tenant; the project is selected by
# the impersonated token + projectKey in the body. Do not swap these.
hdr=(-H "x-blocks-key: $ACCOUNT_TENANT" -H "Authorization: Bearer $PTOK")

echo
info "Step 1 — looking for an existing blocks-oidc identity provider …"
providers=$(curl -sS "$BLOCKS_API_URL/iam/v4/auth/identity-providers" "${hdr[@]}")

existing=$(node -e '
  let d; try { d = JSON.parse(process.argv[1]); } catch { d = {}; }
  const list = d.data || d.identityProviders || [];
  // The default blocks-idp entry has providerType "oidc" and does NOT count.
  const p = list.find((x) => x.providerType === "blocks-oidc" && x.isActive !== false);
  process.stdout.write(p ? JSON.stringify(p) : "");
' "$providers")

if [ -n "$existing" ]; then
  CLIENT_ID=$(printf '%s' "$existing" | jget '.clientId')
  ok "blocks-oidc provider already configured."
  echo
  echo "  VITE_BLOCKS_OIDC_CLIENT_ID=$CLIENT_ID"
  echo
  info "Registered redirect URIs: $(printf '%s' "$existing" | jget '.redirectUris')"
  info "If your callback URL isn't in that list, add it in the portal or recreate the client."
  exit 0
fi

info "Step 2 — looking for a reusable OIDC client …"
clients=$(curl -sS "$BLOCKS_API_URL/iam/v4/oidc-clients" "${hdr[@]}")
client=$(node -e '
  let d; try { d = JSON.parse(process.argv[1]); } catch { d = {}; }
  const list = d.oIDCClientCredentials || [];
  const want = JSON.parse(process.argv[2]);
  const p = list.find((c) => (c.redirectUris || []).some((u) => want.includes(u)));
  process.stdout.write(p ? JSON.stringify(p) : "");
' "$clients" "$REDIRECT_URIS_JSON")

if [ -z "$client" ]; then
  info "Step 3 — creating an OIDC client for redirect URIs $REDIRECT_URIS_JSON …"
  body=$(node -e '
    process.stdout.write(JSON.stringify({
      audience: "",
      redirectUris: JSON.parse(process.argv[1]),
      scope: "openid",
      isAutoRedirect: true,
      isActive: true,
      requirePkce: true,
      allowedResponseTypes: ["code"],
      allowedServiceAccessResources: [
        "blocks-iam","blocks-monitor","blocks-data","blocks-utilities",
        "blocks-agent","blocks-os","blocks-localization","blocks-release"
      ],
      itemId: "",
      projectKey: process.argv[2],
      clientBrandColor: "#15969B",
      clientDisplayName: "Construct OS"
    }));
  ' "$REDIRECT_URIS_JSON" "$PTENANT")

  created=$(curl -sS -X POST "$BLOCKS_API_URL/iam/v4/oidc-clients" "${hdr[@]}" \
    -H "Content-Type: application/json" --data-raw "$body")
  client="$created"
  ok "OIDC client created."
else
  ok "Reusing an existing OIDC client."
fi

CLIENT_ID=$(printf '%s' "$client" | jget '.clientId')
CLIENT_SECRET=$(printf '%s' "$client" | jget '.clientSecret')
[ -n "$CLIENT_ID" ] || die "No clientId in the OIDC client response:
$(printf '%s' "$client" | head -c 400)"

echo
info "Step 4 — verifying the tenant's OIDC discovery document …"
WELL_KNOWN="https://iam.seliseblocks.com/$PTENANT/.well-known/openid-configuration"
curl -sS "$WELL_KNOWN" -H "x-blocks-key: $ACCOUNT_TENANT" | grep -q issuer \
  || die "Discovery document not reachable at $WELL_KNOWN"
ok "Discovery document resolves."

info "Creating the blocks-oidc identity provider …"
provider_body=$(node -e '
  process.stdout.write(JSON.stringify({
    displayName: "Sign in with SSO",
    providerType: "blocks-oidc",
    provider: "construct-os-sso",
    clientId: process.argv[1],
    clientSecret: process.argv[2],
    audience: "",
    wellKnownUrl: process.argv[3],
    tokenEndpointAuthMethod: "client_secret_basic",
    scope: "openid",
    redirectUris: JSON.parse(process.argv[4]),
    isActive: true,
    // The client carries requirePkce: true; the runtime initiate still issues a challenge.
    requirePkce: false,
    initialRoles: ["user"],
    initialPermissions: []
  }));
' "$CLIENT_ID" "$CLIENT_SECRET" "$WELL_KNOWN" "$REDIRECT_URIS_JSON")

curl -sS -X POST "$BLOCKS_API_URL/iam/v4/auth/identity-providers" "${hdr[@]}" \
  -H "Content-Type: application/json" --data-raw "$provider_body" > /dev/null
ok "Identity provider created."

echo
info "Smoke-testing the runtime entry point …"
initiate=$(curl -sS "$BLOCKS_API_URL/iam/v4/idp/initiate?x-blocks-key=$PTENANT&clientId=$CLIENT_ID&redirectUri=$(node -e 'process.stdout.write(encodeURIComponent(JSON.parse(process.argv[1])[0]))' "$REDIRECT_URIS_JSON")" \
  -H "x-blocks-key: $PTENANT")
if printf '%s' "$initiate" | grep -q redirect_uri; then
  ok "idp/initiate returns an authorize URL — SSO is live."
else
  warn "idp/initiate did not return a redirect_uri: $(printf '%s' "$initiate" | head -c 200)"
fi

echo
echo "Add this to .env:"
echo
echo "  VITE_BLOCKS_OIDC_CLIENT_ID=$CLIENT_ID"
echo
