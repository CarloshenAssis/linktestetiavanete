import { supabase } from "@/integrations/supabase/client";

/** Public Worker that uploads and deletes objects in the R2 bucket. Override with VITE_FILES_WORKER_URL. */
const DEFAULT_FILES_WORKER_URL = "https://tiavanete-files.carloshen.workers.dev";

const R2_PUBLIC_HOST = "pub-e9be11aeab4a431e8dc85a854ae160fe.r2.dev";

/**
 * Workers free plan rejects request bodies over 100 MB.
 * 95 MiB stays under that cap (decimal or binary).
 */
export const MAX_UPLOAD_BYTES = 95 * 1024 * 1024;

export const FILE_TOO_LARGE_MESSAGE = "Arquivo maior que 95 MB. O envio aceita no máximo 95 MB.";

export interface StoredFile {
  path: string;
  url: string;
  size: number;
}

export function filesWorkerUrl(): string {
  const fromEnv = import.meta.env.VITE_FILES_WORKER_URL?.trim();
  return (fromEnv || DEFAULT_FILES_WORKER_URL).replace(/\/$/, "");
}

/** Object key for an R2 public URL, or null when the URL is not on this bucket. */
export function r2KeyFromPublicUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== R2_PUBLIC_HOST) return null;
    const key = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
    return key || null;
  } catch {
    return null;
  }
}

async function accessToken(): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) {
    throw new Error("Sessão expirada. Entre novamente para alterar os arquivos.");
  }
  return token;
}

async function workerError(res: Response): Promise<Error> {
  let detail = "";
  try {
    const body = (await res.json()) as { error?: unknown; message?: unknown };
    if (typeof body.error === "string") detail = body.error;
    else if (typeof body.message === "string") detail = body.message;
  } catch {
    detail = "";
  }
  if (detail) console.error("[arquivos]", res.status, detail);

  if (res.status === 401) return new Error("Sessão inválida ou expirada. Entre novamente.");
  if (res.status === 403) return new Error("Apenas administradores podem alterar os arquivos.");
  if (res.status === 413) return new Error(FILE_TOO_LARGE_MESSAGE);
  if (res.status === 400) return new Error("Caminho do arquivo inválido.");
  return new Error("Não foi possível concluir a operação no armazenamento. Tente de novo.");
}

/** PUT the raw file body. The Worker returns the public R2 URL. */
export async function uploadToR2(
  path: string,
  body: Blob,
  contentType: string,
): Promise<StoredFile> {
  if (body.size > MAX_UPLOAD_BYTES) throw new Error(FILE_TOO_LARGE_MESSAGE);

  const token = await accessToken();
  const endpoint = new URL("/upload", filesWorkerUrl());
  endpoint.searchParams.set("path", path);

  const res = await fetch(endpoint, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": contentType || "application/octet-stream",
    },
    body,
  });
  if (!res.ok) throw await workerError(res);

  const data = (await res.json()) as Partial<StoredFile>;
  if (!data.path || !data.url) {
    throw new Error("Resposta inesperada do armazenamento.");
  }
  return {
    path: data.path,
    url: data.url,
    size: typeof data.size === "number" ? data.size : body.size,
  };
}

/** DELETE one object. A missing object is treated as already gone. */
export async function deleteFromR2(path: string): Promise<void> {
  const token = await accessToken();
  const endpoint = new URL("/object", filesWorkerUrl());
  endpoint.searchParams.set("path", path);

  const res = await fetch(endpoint, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) return;
  if (!res.ok) throw await workerError(res);
}
