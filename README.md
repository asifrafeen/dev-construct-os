# Construct OS

A SELISE Blocks **Construct**-stack application — React 19 + TypeScript + Vite + Tailwind +
TanStack Query + Zustand — wired to the Blocks **v4** platform APIs.

| | |
|---|---|
| Project key | `Df7d5eb420c234ab7a77605205c020b1a` |
| App domain | `https://dfqfhj.slsblx.com` |
| API base | `https://blocksapi.slsblx.com` |

> **Why not the `blocks-construct-react` boilerplate?** Every branch of it still calls the
> v1 IAM routes (`/idp/v1/Authentication/Token`, `/idp/v1/Iam/*`). Those are gone on this
> project — `/idp/v1/…` returns `Not_Found: Application_Not_Found`, while `/iam/v4/…`
> answers. This app is built on the same stack against the v4 contracts.

## Getting started

```bash
npm install
```

### 1. Create the OIDC client

The sign-in page offers three ways in — an in-app email/password form, the Google and
Microsoft buttons, and **Continue with SELISE Blocks** (the Blocks-hosted login page).
Only that last one needs an OIDC client id; if you set `VITE_BLOCKS_HOSTED_LOGIN=false`
you can skip this whole step. Creating a client is an admin operation, so it needs your
Blocks account credentials in a **separate, git-ignored** file:

```bash
# .env.blocks  — write this yourself; never commit it
BLOCKS_API_URL=https://api.seliseblocks.com
BLOCKS_USERNAME=<your Blocks login email>
BLOCKS_PASSWORD=<your password>
```

```bash
npm run blocks:preflight        # confirms the account and lists projects + domains
npm run blocks:configure-oidc   # ensures a blocks-oidc provider, prints the clientId
```

Paste the printed value into `.env`:

```bash
VITE_BLOCKS_OIDC_CLIENT_ID=<clientId>
```

The impersonated project token these scripts mint never leaves the shell. Nothing secret
belongs in a `VITE_`-prefixed variable — those ship in the browser bundle.

### 2. Local HTTPS

Blocks stores the SSO session in a `Secure`, domain-scoped cookie. `http://localhost` never
receives it, so local dev has to serve the **real project domain** over HTTPS:

```bash
npm run cert    # writes .cert/dev-{key,cert}.pem for dfqfhj.slsblx.com
```

Then, as Administrator:

```
# C:\Windows\System32\drivers\etc\hosts
127.0.0.1  dfqfhj.slsblx.com

# optional — removes the browser warning
certutil -addstore -f Root .cert\dev-cert.pem
```

```bash
npm run dev     # https://dfqfhj.slsblx.com:5173
```

Without `.cert/`, the dev server falls back to plain `http://localhost:5173` — fine for UI
work, but SSO login will not complete there.

### 3. Sign in

Open `https://dfqfhj.slsblx.com:5173` and use whichever route you like — the password form,
Google/Microsoft, or **SELISE Blocks**. All three land you on the dashboard.

## How auth works

Three sign-in routes, one outcome. Each ends with IAM setting the *same* HttpOnly session
cookie, so everything downstream (`/iam/me`, the 401 refresh-and-retry, logout) is identical
no matter how you signed in. They are not alternatives to choose between — they are all on.

```
password   →  POST /iam/v4/auth/login                          → session cookie
social     →  GET  /iam/v4/auth/social/initiate   → provider
           →  POST /iam/v4/auth/social/callback   (on /callback)        → session cookie
hosted     →  GET  /iam/v4/idp/initiate      (fetch, not a navigation — returns an authorize URL)
           →  redirect to iam.seliseblocks.com
           →  GET  /iam/v4/idp/callback      (on /login/callback)       → session cookie

then       →  GET  /iam/v4/iam/me            (the auth-state source of truth)
```

The two callbacks are separate routes and separate registered redirect URIs, so the flows
never collide. `VITE_BLOCKS_HOSTED_LOGIN=false` drops the hosted button and its two config
requirements (`VITE_BLOCKS_OIDC_CLIENT_ID`, `VITE_BLOCKS_REDIRECT_URI`); the embedded flows
derive their redirect from the live origin instead.

Which providers appear under "or continue with" comes from `GET /iam/v4/auth/login-options`
— a provider missing there is switched off on the project, not in this app.

Three rules the whole client layer is built on:

1. **The browser holds no token.** The session is an HttpOnly cookie, so every call goes out
   with `credentials: "include"` and the auth store carries nothing secret.
2. **`x-blocks-key` rides on every request** — the public project key.
3. **The API host must be same-site with the app domain**, or the cookie is never stored.
   `dfqfhj.slsblx.com` → `blocksapi.slsblx.com`. Using `api.seliseblocks.com` here would
   make every authenticated call 401 with no obvious cause.

A 401 triggers one session refresh (`POST /iam/v4/oidc/token`, form-encoded) and one retry;
a second 401 means genuinely signed out and routes to `/login`.

## Layout

```
src/
  lib/
    env.ts             Client-safe config + same-site sanity checks
    blocks-client.ts   The one fetch wrapper: x-blocks-key, cookies, 401 refresh-and-retry
  state/auth-store.ts  De-duplicated refreshSession(); holds no token
  features/
    auth/              SSO initiate/callback, logout, activate, route guard
    users/             /iam/me, user list, roles & permissions
    orgs/              /organizations/my + persisted active-org selection
    data/              GraphQL gateway client + makeCrud factory (see its README)
    files/             Pre-signed-URL upload pipeline
  pages/               login, callback, activate, dashboard, users, data, storage, profile
  layout/app-shell.tsx Sidebar, header, org switcher, sign-out
```

## Routes

| Path | Auth | Purpose |
|---|---|---|
| `/login` | public | Password form + social buttons + hosted-Blocks button |
| `/callback` | public | Finalizes embedded social login |
| `/login/callback` | public | Finalizes hosted login — must match the registered `redirectUri` |
| `/activate` | public | Invite-and-activate only; not part of normal login |
| `/` | required | Dashboard — session, roles, permissions |
| `/users` | required | Project users |
| `/data` | required | Gateway console for running GraphQL against your schemas |
| `/storage` | required | Pre-signed-URL file upload |
| `/profile` | required | Edit your own profile |

## Deploying

`npm run build` emits `dist/`. It's a SPA with client-side routing, so the host must rewrite
unknown paths to `index.html` — otherwise `/login/callback` 404s and login breaks.
`staticwebapp.config.json` covers Azure Static Web Apps; nginx equivalent:

```nginx
location / { try_files $uri $uri/ /index.html; }
```

Production uses `.env` as-is (`VITE_BLOCKS_REDIRECT_URI=https://dfqfhj.slsblx.com/login/callback`),
which the OIDC client registers alongside the `:5173` dev origin.

## Known advisory

`npm audit` reports a high-severity advisory on `react-router` (GHSA-qwww-vcr4-c8h2). It
affects **RSC mode** — server actions in the React Router framework runtime. This app uses
`createBrowserRouter` in SPA mode with no server actions, so the vulnerable path isn't
reachable. There is no patched 7.x release yet; the dependency is pinned to the latest 7.x
so every other fix is present.
