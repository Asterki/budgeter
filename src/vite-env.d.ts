/// <reference types="vite/client" />

declare const __APP_VERSION__: string;
declare const __APP_MODE__: string;
declare const __BUILD_TIME__: string;
declare const __VAPID_PUBLIC_KEY__: string;

interface ImportMetaEnv {
  readonly VITE_VAPID_PUBLIC_KEY?: string;
  readonly VITE_APP_NAME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
