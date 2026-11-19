import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { AdminOnly } from "@/components/AdminOnly";
import {
  createDriveFolder,
  createDriveUpload,
  DRIVE_NOT_CONNECTED,
  ExpiredDriveUpload,
  fetchDriveFolders,
  fetchDriveStatus,
  uploadFileToDrive,
  type DriveFolder,
} from "@/lib/drive";
import { formatBytes } from "@/lib/files";

export const Route = createFileRoute("/enviar-drive")({
  ssr: false,
  head: () => ({ meta: [{ title: "Enviar para o Drive — Tia Vanete" }] }),
  component: SendToDrive,
});

function SendToDrive() {
  return (
    <AdminOnly>
      <DrivePage />
    </AdminOnly>
  );
}

interface SelectedFile {
  id: string;
  file: File;
  progress: number;
  uploadUrl?: string;
  error?: string;
}

type Folders = Awaited<ReturnType<typeof fetchDriveFolders>>;
type FolderState =
  { status: "loading" | "disconnected" | "error" } | { status: "ready"; data: Folders };

const BUTTON =
  "inline-flex min-h-12 items-center justify-center rounded-full bg-sky-800 px-6 py-3 text-lg font-semibold text-white hover:bg-sky-900 disabled:opacity-60";
const FIELD =
  "min-h-14 w-full rounded-xl border border-slate-500 bg-white px-4 py-3 text-xl text-slate-950";
const UPLOAD_ERROR = "Não foi possível guardar este arquivo. Confira a internet e tente de novo.";

function DrivePage() {
  const [folderState, setFolderState] = useState<FolderState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    async function loadFolders() {
      try {
        const connection = await fetchDriveStatus();
        if (!active) return;
        if (!connection.connected) {
          setFolderState({ status: "disconnected" });
          return;
        }
        const data = await fetchDriveFolders();
        if (active) setFolderState({ status: "ready", data });
      } catch (error) {
        if (!active) return;
        const code = (error as { code?: string }).code;
        setFolderState({
          status:
            code === "google_not_configured" ||
            code === "google_not_connected" ||
            code === "google_needs_reauth"
              ? "disconnected"
              : "error",
        });
      }
    }

    void loadFolders();
    return () => {
      active = false;
    };
  }, [attempt]);

  return (
    <section className="mx-auto max-w-3xl space-y-6 py-8 text-lg text-slate-950">
      <Link
        to="/admin"
        className="inline-flex min-h-12 items-center rounded-full px-4 py-2 font-semibold text-sky-900 underline"
      >
        ← Voltar ao painel
      </Link>
      <h1 className="font-display text-3xl sm:text-4xl">Enviar para o Drive</h1>
      {folderState.status === "ready" ? (
        <DriveForm data={folderState.data} />
      ) : (
        <div className="cloud-card space-y-4 p-6 text-xl">
          <p role="status">
            {folderState.status === "loading"
              ? "Buscando suas pastas..."
              : folderState.status === "disconnected"
                ? DRIVE_NOT_CONNECTED
                : "Não foi possível buscar suas pastas agora."}
          </p>
          {folderState.status === "error" && (
            <button
              type="button"
              className={BUTTON}
              onClick={() => {
                setFolderState({ status: "loading" });
                setAttempt((previous) => previous + 1);
              }}
            >
              Tentar de novo
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function DriveForm({ data }: { data: Folders }) {
  const [folders, setFolders] = useState([data.root, ...data.folders]);
  const [folderId, setFolderId] = useState("");
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [folderError, setFolderError] = useState("");
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const [started, setStarted] = useState(false);
  const [sending, setSending] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const result = useRef<HTMLDivElement>(null);

  const folder = folders.find((item) => item.id === folderId);
  const hasErrors = files.some((item) => item.error);
  const done = started && files.length > 0 && files.every((item) => item.progress === 100);

  useEffect(() => {
    if (!sending && (done || hasErrors)) result.current?.focus();
  }, [sending, done, hasErrors]);

  function onFolderCreated(newFolder: DriveFolder) {
    setFolders((previous) => [...previous, newFolder]);
    setFolderId(newFolder.id);
    setName("");
    setShowNewFolder(false);
  }

  async function submitFolder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) {
      setFolderError("Escreva o nome da pasta.");
      return;
    }
    setCreating(true);
    setFolderError("");
    try {
      onFolderCreated(await createDriveFolder(name.trim()));
    } catch (error) {
      setFolderError(
        error instanceof Error ? error.message : "Não foi possível criar a pasta. Tente de novo.",
      );
    } finally {
      setCreating(false);
    }
  }

  function chooseFiles(picked: FileList | null) {
    if (!picked) return;
    const selected = Array.from(picked, (file) => ({
      id: crypto.randomUUID(),
      file,
      progress: 0,
    }));
    setFiles((previous) => [...previous, ...selected]);
  }

  function updateFile(id: string, update: Partial<SelectedFile>) {
    setFiles((previous) =>
      previous.map((item) => (item.id === id ? { ...item, ...update } : item)),
    );
  }

  async function sendFiles() {
    if (!folder || !files.length || sending) return;
    setStarted(true);
    setSending(true);
    try {
      for (const item of files) {
        if (item.progress === 100) continue;
        updateFile(item.id, { error: undefined });
        try {
          const uploadUrl =
            item.uploadUrl ?? (await createDriveUpload(folder.id, item.file)).uploadUrl;
          updateFile(item.id, { uploadUrl });
          await uploadFileToDrive(
            uploadUrl,
            item.file,
            (progress) => updateFile(item.id, { progress }),
            Boolean(item.uploadUrl),
          );
        } catch (error) {
          updateFile(item.id, {
            error:
              error instanceof Error && error.name !== "TypeError" ? error.message : UPLOAD_ERROR,
            ...(error instanceof ExpiredDriveUpload && { progress: 0, uploadUrl: undefined }),
          });
        }
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <section className="cloud-card space-y-4 p-5 sm:p-6">
        <label htmlFor="drive-folder" className="block font-display text-2xl">
          Escolha a pasta
        </label>
        <select
          id="drive-folder"
          className={FIELD}
          value={folderId}
          disabled={started || creating}
          onChange={(event) => setFolderId(event.target.value)}
        >
          <option value="" disabled>
            Selecione uma pasta
          </option>
          {folders.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        {!started &&
          (showNewFolder ? (
            <form onSubmit={submitFolder} className="space-y-3">
              <label htmlFor="new-drive-folder" className="block text-xl font-semibold">
                Nome da pasta nova
              </label>
              <input
                id="new-drive-folder"
                className={FIELD}
                maxLength={120}
                value={name}
                disabled={creating}
                onChange={(event) => setName(event.target.value)}
              />
              {folderError && <p role="alert">{folderError}</p>}
              <div className="flex flex-wrap gap-3">
                <button type="submit" className={BUTTON} disabled={creating}>
                  {creating ? "Criando pasta..." : "Criar pasta"}
                </button>
                <button
                  type="button"
                  className="min-h-12 px-4 font-semibold text-sky-900 underline"
                  disabled={creating}
                  onClick={() => {
                    setShowNewFolder(false);
                    setFolderError("");
                  }}
                >
                  Cancelar
                </button>
              </div>
            </form>
          ) : (
            <button type="button" className={BUTTON} onClick={() => setShowNewFolder(true)}>
              ➕ Criar pasta nova
            </button>
          ))}
      </section>

      {folder && (
        <section className="cloud-card space-y-4 p-5 sm:p-6">
          <h2 className="font-display text-2xl">Escolha os arquivos</h2>
          {!started && (
            <>
              <button
                type="button"
                className={`w-full rounded-2xl border-2 border-dashed border-sky-700 px-5 py-8 text-xl font-semibold text-sky-950 hover:bg-sky-100 ${dragging ? "bg-sky-100" : "bg-sky-50"}`}
                onClick={() => input.current?.click()}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  chooseFiles(event.dataTransfer.files);
                }}
              >
                Toque aqui para escolher ou arraste seus arquivos
              </button>
              <input
                ref={input}
                type="file"
                className="hidden"
                multiple
                onChange={(event) => {
                  chooseFiles(event.target.files);
                  event.target.value = "";
                }}
              />
            </>
          )}
          {files.length > 0 && (
            <ul className="divide-y divide-slate-300">
              {files.map(({ id, file, progress, error }) => (
                <li key={id} className="space-y-2 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="break-all font-semibold">{file.name}</p>
                      <p>{formatBytes(file.size)}</p>
                    </div>
                    {!started && (
                      <button
                        type="button"
                        aria-label={`Remover ${file.name}`}
                        className="h-12 w-12 shrink-0 rounded-full border border-slate-500 text-3xl hover:bg-slate-100"
                        onClick={() =>
                          setFiles((previous) => previous.filter((item) => item.id !== id))
                        }
                      >
                        ×
                      </button>
                    )}
                  </div>
                  {started && (
                    <div className="flex items-center gap-3">
                      <progress
                        className="h-5 min-w-0 flex-1 accent-sky-800"
                        aria-label={`Envio de ${file.name}`}
                        value={progress}
                        max={100}
                      />
                      <span className="tabular-nums">{progress}%</span>
                    </div>
                  )}
                  {error && <p className="text-red-800">{error}</p>}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {folder && files.length > 0 && !done && (
        <div ref={result} tabIndex={-1} className="space-y-3">
          {hasErrors && !sending && (
            <p role="alert" className="text-xl text-red-800">
              Alguns arquivos ainda precisam ser enviados.
            </p>
          )}
          <button
            type="button"
            className={`${BUTTON} w-full py-4 text-2xl`}
            disabled={sending || creating}
            onClick={sendFiles}
          >
            {sending ? "Enviando..." : hasErrors ? "Tentar de novo" : "Enviar"}
          </button>
        </div>
      )}

      {done && folder && (
        <div
          ref={result}
          tabIndex={-1}
          className="space-y-4 rounded-2xl border border-green-700 bg-green-50 p-5 text-xl text-green-950"
        >
          <p role="status" className="font-semibold">
            {files.length === 1
              ? "Pronto! 1 arquivo foi guardado"
              : `Pronto! ${files.length} arquivos foram guardados`}
            {" na pasta “"}
            {folder.name}
            {"” do seu Google Drive."}
          </p>
          <a href={folder.webViewLink} target="_blank" rel="noreferrer" className={BUTTON}>
            Abrir no Google Drive
          </a>
        </div>
      )}
      {started && !sending && (
        <button
          type="button"
          className="min-h-12 rounded-full px-4 font-semibold text-sky-900 underline"
          onClick={() => {
            setFiles([]);
            setStarted(false);
          }}
        >
          Escolher outros arquivos
        </button>
      )}
    </>
  );
}
