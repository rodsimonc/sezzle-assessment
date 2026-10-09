/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the calculator API. Defaults to `/api/v1`, which Vite and the Go server proxy. */
  readonly VITE_API_BASE_URL?: string;
}
