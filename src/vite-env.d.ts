/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BLOCKS_API_URL: string;
  readonly VITE_BLOCKS_PROJECT_KEY: string;
  readonly VITE_BLOCKS_OIDC_CLIENT_ID: string;
  readonly VITE_BLOCKS_REDIRECT_URI: string;
  readonly VITE_BLOCKS_EXTRA_ARG?: string;
  readonly VITE_BLOCKS_HOSTED_LOGIN?: string;
  /** Comma-separated Blocks Localization modules the app loads. Default `common`. */
  readonly VITE_BLOCKS_I18N_MODULES?: string;
  /** `false` disables the live notification hub connection. */
  readonly VITE_BLOCKS_NOTIFIER_REALTIME?: string;
  /** Comma-separated hub method names to listen on. Default `ReceiveNotification`. */
  readonly VITE_BLOCKS_NOTIFY_METHODS?: string;
  /** Heartbeat (callback) monitor id this deployment pings. */
  readonly VITE_BLOCKS_HEARTBEAT_ID?: string;
  /** Seconds between automatic heartbeats; 0/empty = manual only. */
  readonly VITE_BLOCKS_HEARTBEAT_INTERVAL?: string;
  /** Gateway path of the Monitor service. Default `/monitor/v4`. */
  readonly VITE_BLOCKS_MONITOR_PATH?: string;
  readonly VITE_DEV_DOMAIN?: string;
  readonly VITE_DEV_PORT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Stamped in by vite.config.ts at build time — the same object served as /version.json. */
declare const __BUILD_INFO__: {
  version: string;
  mode: string;
  builtAt: string;
  commit: string;
  branch: string;
  buildId: string;
};
