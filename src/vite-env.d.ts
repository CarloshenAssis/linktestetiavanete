/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FILES_WORKER_URL?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_SUPABASE_PROJECT_ID?: string;
}
