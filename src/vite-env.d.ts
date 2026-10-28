interface ImportMetaEnv {
  readonly VITE_EVE_CLIENT_ID?: string;
  readonly VITE_EVE_CALLBACK_URL?: string;
  readonly VITE_EVE_TOKEN_URL?: string;
  readonly VITE_GOATCOUNTER_CODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
