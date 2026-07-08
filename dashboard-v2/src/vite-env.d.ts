/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_API_BASE: string;
  readonly VITE_API_KEY: string;
  readonly VITE_LUA_AGENT_ID?: string;
}
interface ImportMeta { readonly env: ImportMetaEnv; }
