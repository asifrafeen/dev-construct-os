import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';

const CERT_DIR = '.cert';

/**
 * Blocks SSO stores the session in a Secure, domain-scoped cookie, so the dev server has to
 * serve the real project domain over HTTPS — `http://localhost` never gets the cookie.
 * `npm run cert` generates .cert/dev-{key,cert}.pem; without it we fall back to plain
 * localhost so the app still boots for UI work.
 */
function devHttps() {
  const key = path.join(CERT_DIR, 'dev-key.pem');
  const cert = path.join(CERT_DIR, 'dev-cert.pem');
  if (!fs.existsSync(key) || !fs.existsSync(cert)) return undefined;
  return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
}

/** Tell the developer which origin actually works for SSO — Vite only prints the bind address. */
function announceOrigin(url: string) {
  return {
    name: 'announce-sso-origin',
    configureServer() {
      setTimeout(() => {
        // eslint-disable-next-line no-console
        console.log(`\n  [36m[1mSSO origin[22m: ${url}[39m`);
        // eslint-disable-next-line no-console
        console.log(
          `  [2m(requires a hosts entry pointing that domain at 127.0.0.1)[22m\n`,
        );
      }, 50);
    },
  };
}

/**
 * HEAD's commit, read straight from `.git` rather than by running git — no binary looked
 * up on PATH, and none needed. Handles a detached HEAD, loose and packed refs, and a
 * worktree (`.git` file → gitdir, refs in its commondir). Empty when there is no repo.
 */
function gitHead(): string {
  try {
    let gitDir = '.git';
    if (fs.statSync(gitDir).isFile()) {
      const pointer = fs.readFileSync(gitDir, 'utf8').trim();
      gitDir = path.resolve(pointer.startsWith('gitdir:') ? pointer.slice('gitdir:'.length).trim() : pointer);
    }
    const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
    if (!head.startsWith('ref:')) return head;
    const ref = head.slice('ref:'.length).trim();

    const commonFile = path.join(gitDir, 'commondir');
    const commonDir = fs.existsSync(commonFile)
      ? path.resolve(gitDir, fs.readFileSync(commonFile, 'utf8').trim())
      : gitDir;
    for (const dir of [gitDir, commonDir]) {
      const loose = path.join(dir, ref);
      if (fs.existsSync(loose)) return fs.readFileSync(loose, 'utf8').trim();
    }
    const packed = path.join(commonDir, 'packed-refs');
    if (!fs.existsSync(packed)) return '';
    const line = fs
      .readFileSync(packed, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.endsWith(` ${ref}`));
    return line ? line.slice(0, line.indexOf(' ')) : '';
  } catch {
    return '';
  }
}

/**
 * What this bundle is, for the Build page and for Release/Monitor testing.
 *
 * The commit comes from whichever variable the build environment provides — a CI
 * pipeline usually sets one of these — and only falls back to the local repo. Inside
 * the Docker build `.git` is excluded, so that fallback quietly yields nothing.
 */
function buildInfo(mode: string, env: Record<string, string>) {
  const pick = (...names: string[]) => names.map((n) => env[n]).find(Boolean) ?? '';
  const commit =
    pick('VITE_GIT_SHA', 'GIT_COMMIT', 'GIT_SHA', 'COMMIT_SHA', 'SOURCE_COMMIT', 'GITHUB_SHA', 'BUILD_SOURCEVERSION') ||
    gitHead();
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')) as { version?: string };
  return {
    version: pkg.version ?? '0.0.0',
    mode,
    builtAt: new Date().toISOString(),
    commit,
    branch: pick('VITE_GIT_BRANCH', 'GIT_BRANCH', 'BRANCH_NAME', 'GITHUB_REF_NAME'),
    buildId: pick('VITE_BUILD_ID', 'BUILD_ID', 'BUILD_NUMBER', 'BUILD_BUILDID', 'GITHUB_RUN_ID'),
  };
}

/** Emits /version.json next to index.html — a static, cache-free target for an uptime check. */
function emitVersion(info: ReturnType<typeof buildInfo>): Plugin {
  return {
    name: 'emit-version-json',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify(info, null, 2),
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const https = devHttps();
  const domain = env.VITE_DEV_DOMAIN ?? 'localhost';
  const port = Number(env.VITE_DEV_PORT ?? 5173);
  const origin = `${https ? 'https' : 'http'}://${https ? domain : 'localhost'}:${port}`;
  const info = buildInfo(mode, { ...env, ...(process.env as Record<string, string>) });

  return {
    plugins: [react(), emitVersion(info), ...(https ? [announceOrigin(origin)] : [])],
    define: { __BUILD_INFO__: JSON.stringify(info) },
    build: {
      rollupOptions: {
        output: {
          // Vendor code changes far less often than the app, so it caches across deploys.
          manualChunks: {
            react: ['react', 'react-dom', 'react-router-dom'],
            query: ['@tanstack/react-query'],
            signalr: ['@microsoft/signalr'],
            icons: ['lucide-react'],
          },
        },
      },
    },
    resolve: {
      alias: { '@': path.resolve(__dirname, 'src') },
    },
    server: {
      // Bind to every interface rather than the domain itself: the domain resolves to the
      // deployed app's public IP, which this machine can't bind to. The hosts entry is what
      // steers the *browser* here.
      host: true,
      port,
      // The port is baked into the registered redirectUri — never let Vite drift off it.
      strictPort: true,
      https,
      allowedHosts: [domain, 'localhost'],
    },
    preview: { port, strictPort: true },
  };
});
