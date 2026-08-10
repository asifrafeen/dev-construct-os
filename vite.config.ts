import { defineConfig, loadEnv } from 'vite';
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

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const https = devHttps();
  const domain = env.VITE_DEV_DOMAIN ?? 'localhost';
  const port = Number(env.VITE_DEV_PORT ?? 5173);
  const origin = `${https ? 'https' : 'http'}://${https ? domain : 'localhost'}:${port}`;

  return {
    plugins: [react(), ...(https ? [announceOrigin(origin)] : [])],
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
