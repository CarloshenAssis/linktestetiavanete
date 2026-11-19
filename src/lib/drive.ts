import { accessToken, filesWorkerUrl } from "@/lib/files";

export const DRIVE_NOT_CONNECTED = "O Google Drive ainda não está ligado. Peça ao Carlos.";
export const DRIVE_NEEDS_REAUTH = "Peça ao Carlos para ligar o Drive de novo.";

export interface BackupSummary {
  at: string;
  copied: number;
  failed: number;
  remaining: number;
}

export interface DriveStatus {
  configured: boolean;
  connected: boolean;
  email: string | null;
  needsReauth: boolean;
  lastBackup: BackupSummary | null;
  health?: {
    status: "ok" | "warning" | "error";
    problem: string | null;
    message: string | null;
    action: string | null;
    actionUrl: string | null;
    lastSuccessAt: string | null;
    emailConfigured: boolean;
    lastAlertAt: string | null;
  };
}

export interface DriveFolder {
  id: string;
  name: string;
  webViewLink: string;
}

export class DriveRequestError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function driveRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const token = await accessToken();
  const response = await fetch(new URL(path, filesWorkerUrl()), {
    ...options,
    cache: "no-store",
    headers: { Authorization: `Bearer ${token}`, ...options?.headers },
  }).catch(() => {
    throw new Error(
      "Não foi possível usar o Google Drive agora. Confira a internet e tente de novo.",
    );
  });
  if (response.ok) return response.json();
  const detail = (await response.json().catch(() => null)) as {
    error?: string;
    message?: string;
  } | null;
  if (response.status === 401) throw new Error("Sua sessão venceu. Entre de novo no painel.");
  if (response.status === 403) throw new Error("Sua conta não tem permissão para usar o Drive.");
  throw new DriveRequestError(
    detail?.error ?? "",
    detail?.message ?? "Não foi possível usar o Google Drive agora. Tente de novo.",
  );
}

export function driveAuthUrl() {
  return new URL("/google/auth-start", filesWorkerUrl()).href;
}

export async function fetchDriveStatus(): Promise<DriveStatus> {
  try {
    return await driveRequest("/google/status");
  } catch (error) {
    if (error instanceof DriveRequestError && error.code === "google_not_configured") {
      return {
        configured: false,
        connected: false,
        email: null,
        needsReauth: false,
        lastBackup: null,
      };
    }
    throw error;
  }
}

export function runDriveBackup() {
  return driveRequest<BackupSummary>("/backup/run", { method: "POST" });
}

export function fetchDriveFolders() {
  return driveRequest<{ root: DriveFolder; folders: DriveFolder[] }>("/drive/folders");
}

function postJson(body: object): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export function createDriveFolder(name: string) {
  return driveRequest<DriveFolder>("/drive/folders", postJson({ name }));
}

export function createDriveUpload(folderId: string, file: File) {
  return driveRequest<{ uploadUrl: string }>(
    "/drive/upload-session",
    postJson({
      folderId,
      name: file.name,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
    }),
  );
}

const CHUNK_SIZE = 8 * 1024 ** 2;
const MAX_RETRIES = 3;

export class ExpiredDriveUpload extends Error {
  constructor(
    message = "O envio foi interrompido. Toque em Tentar de novo para recomeçar este arquivo.",
  ) {
    super(message);
  }
}

type ChunkResponse = { done: true } | { done: false; offset: number } | { retry: true };

function putDriveChunk(
  url: string,
  body: Blob | null,
  range: string | undefined,
  progress?: (bytes: number) => void,
): Promise<ChunkResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.timeout = 120_000;
    if (range) xhr.setRequestHeader("Content-Range", range);
    if (progress) xhr.upload.onprogress = (event) => progress(event.loaded);
    xhr.onerror = xhr.ontimeout = () => resolve({ retry: true });
    xhr.onload = () => {
      if (xhr.status === 200 || xhr.status === 201) {
        resolve({ done: true });
      } else if (xhr.status === 308) {
        const end = /^bytes=0-(\d+)$/i.exec(xhr.getResponseHeader("Range") ?? "")?.[1];
        resolve({ done: false, offset: end === undefined ? 0 : Number(end) + 1 });
      } else if (xhr.status === 429 || xhr.status >= 500) {
        resolve({ retry: true });
      } else if (xhr.status === 404 || xhr.status === 410) {
        reject(new ExpiredDriveUpload());
      } else if (xhr.status === 403) {
        reject(
          new ExpiredDriveUpload(
            "O Drive recusou o envio. Confira se ainda há espaço no Google Drive.",
          ),
        );
      } else if (xhr.status >= 400 && xhr.status < 500) {
        reject(new ExpiredDriveUpload());
      } else {
        reject(new Error("O Google Drive não conseguiu guardar este arquivo. Tente de novo."));
      }
    };
    xhr.send(body);
  });
}

export async function uploadFileToDrive(
  uploadUrl: string,
  file: File,
  onProgress: (percent: number) => void,
  resume = false,
) {
  let offset = 0;
  let retries = 0;
  let probe = resume;
  for (;;) {
    const end = Math.min(offset + CHUNK_SIZE, file.size);
    const result = probe
      ? await putDriveChunk(uploadUrl, null, `bytes */${file.size}`)
      : await putDriveChunk(
          uploadUrl,
          file.slice(offset, end, file.type || "application/octet-stream"),
          file.size ? `bytes ${offset}-${end - 1}/${file.size}` : undefined,
          (bytes) =>
            onProgress(
              file.size ? Math.min(99, Math.floor(((offset + bytes) / file.size) * 100)) : 0,
            ),
        );

    if (!("retry" in result)) {
      if (result.done) {
        onProgress(100);
        return;
      }
      if (result.offset >= 0 && result.offset < file.size && (probe || result.offset > offset)) {
        if (result.offset > offset) retries = 0;
        offset = result.offset;
        onProgress(Math.floor((offset / file.size) * 100));
        probe = false;
        continue;
      }
      if (probe && file.size === 0) {
        probe = false;
        continue;
      }
    }

    if (++retries > MAX_RETRIES) {
      throw new Error("O envio foi interrompido. Confira a internet e tente de novo.");
    }
    await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** (retries - 1)));
    probe = true;
  }
}
