import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  fetchMaterials,
  fetchVerse,
  fetchAvatarUrl,
  AVATAR_SETTING_KEY,
  MATERIAL_CATEGORY_LABELS,
  Material,
  MaterialCategory,
} from "@/lib/materials";
import { compressPdf } from "@/lib/pdfCompress";
import {
  checkStorageSpace,
  deleteFromR2,
  fetchStorageUsage,
  FILE_TOO_LARGE_MESSAGE,
  formatBytes,
  MAX_UPLOAD_BYTES,
  onStorageUsageChange,
  r2KeyFromPublicUrl,
  uploadToR2,
  type StorageUsage,
} from "@/lib/files";
import {
  driveAuthUrl,
  DRIVE_NEEDS_REAUTH,
  DRIVE_NOT_CONNECTED,
  fetchDriveStatus,
  runDriveBackup,
  type DriveStatus,
} from "@/lib/drive";
import { AdminOnly } from "@/components/AdminOnly";
import avatarFallback from "@/assets/vanete-avatar.png";
import { Trash2, Upload, LogOut, FileText, ImageIcon, MessageSquare, Camera } from "lucide-react";

export const Route = createFileRoute("/admin")({
  ssr: false,
  head: () => ({ meta: [{ title: "Painel — Tia Vanete" }] }),
  component: Admin,
});

function Admin() {
  return (
    <AdminOnly>
      <AdminPanel />
    </AdminOnly>
  );
}

function StorageCard() {
  const [usage, setUsage] = useState<StorageUsage | null>();
  useEffect(() => {
    let controller: AbortController;
    function refresh(fresh = false) {
      controller?.abort();
      controller = new AbortController();
      const { signal } = controller;
      void fetchStorageUsage(signal, fresh).then(
        (result) => {
          if (!signal.aborted) setUsage(result);
        },
        () => {
          if (!signal.aborted) setUsage(null);
        },
      );
    }
    const unsubscribe = onStorageUsageChange(() => refresh(true));
    refresh();
    return () => {
      unsubscribe();
      controller.abort();
    };
  }, []);

  const percent = usage ? Math.min(100, (usage.usedBytes / usage.limitBytes) * 100) : 0;
  const color =
    percent > 90 ? "accent-red-700" : percent >= 70 ? "accent-amber-600" : "accent-green-700";
  return (
    <section className="cloud-card space-y-3 p-5 text-xl" aria-labelledby="storage-heading">
      <h2 id="storage-heading" className="font-display text-2xl">
        Espaço do site
      </h2>
      {usage ? (
        <>
          <p className="font-semibold">
            {formatBytes(usage.usedBytes, "MB")} de {formatBytes(usage.limitBytes, "MB")} usados
          </p>
          <progress
            aria-label="Espaço do site usado"
            className={`block h-6 w-full overflow-hidden rounded-full ${color}`}
            value={percent}
            max={100}
          />
          <p role="status">Ainda cabem {formatBytes(usage.freeBytes, "MB")}</p>
        </>
      ) : (
        <p role="status">
          {usage === null ? "Não foi possível ver o espaço agora." : "Vendo o espaço do site..."}
        </p>
      )}
    </section>
  );
}

function DriveStatusCard() {
  const [status, setStatus] = useState<DriveStatus | null>();
  const [running, setRunning] = useState(false);

  useEffect(() => {
    let active = true;
    let request = 0;
    function refresh() {
      const current = ++request;
      void fetchDriveStatus().then(
        (result) => {
          if (active && current === request) setStatus(result);
        },
        () => {
          if (active && current === request) setStatus(null);
        },
      );
    }
    window.addEventListener("focus", refresh);
    refresh();
    return () => {
      active = false;
      window.removeEventListener("focus", refresh);
    };
  }, []);

  async function backupNow() {
    setRunning(true);
    try {
      const lastBackup = await runDriveBackup();
      setStatus((previous) => previous && { ...previous, lastBackup });
    } catch (error) {
      toast.error((error as Error).message);
      void fetchDriveStatus().then(setStatus, () => {});
    } finally {
      setRunning(false);
    }
  }

  const last = status?.lastBackup;
  const buttonClass =
    "inline-flex w-fit items-center justify-center rounded-full bg-sky-800 px-5 py-3 text-lg font-semibold text-white hover:bg-sky-900 disabled:opacity-60";
  return (
    <section
      className="cloud-card flex flex-col items-start gap-3 p-5 text-lg"
      aria-labelledby="drive-heading"
    >
      <h2 id="drive-heading" className="font-display text-2xl">
        Cópia no Google Drive
      </h2>
      {status?.connected ? (
        <>
          <p>Google Drive ligado.</p>
          {last ? (
            <div role="status">
              <p>
                Último backup em{" "}
                {new Intl.DateTimeFormat("pt-BR", {
                  dateStyle: "short",
                  timeStyle: "short",
                  timeZone: "America/Sao_Paulo",
                }).format(new Date(last.at))}
                .
              </p>
              <p>
                Arquivos copiados: {last.copied}. Com falha: {last.failed}. Faltam: {last.remaining}
                .
              </p>
            </div>
          ) : (
            <p>A primeira cópia ainda está por fazer.</p>
          )}
          <button type="button" onClick={backupNow} disabled={running} className={buttonClass}>
            {running ? "Fazendo backup..." : "Fazer backup agora"}
          </button>
        </>
      ) : (
        <p role="status">
          {status === undefined
            ? "Vendo a ligação com o Google Drive..."
            : status === null
              ? "Não foi possível ver o Google Drive agora."
              : status.needsReauth
                ? DRIVE_NEEDS_REAUTH
                : DRIVE_NOT_CONNECTED}
        </p>
      )}
      {status?.configured && !status.connected && (
        <a href={driveAuthUrl()} target="_blank" rel="noreferrer" className={buttonClass}>
          Ligar o Google Drive
        </a>
      )}
      <Link to="/enviar-drive" className={buttonClass}>
        📁 Guardar arquivos no meu Google Drive
      </Link>
    </section>
  );
}

function AdminPanel() {
  const navigate = useNavigate();
  const [verse, setVerse] = useState("");
  const [materials, setMaterials] = useState<Material[]>([]);

  async function refresh() {
    setVerse(await fetchVerse());
    setMaterials(await fetchMaterials());
  }
  useEffect(() => { refresh(); }, []);

  async function saveVerse() {
    const { error } = await supabase.from("site_settings").upsert({ key: "verse_of_day", value: verse, updated_at: new Date().toISOString() });
    if (error) toast.error(error.message); else toast.success("Versículo atualizado!");
  }

  async function logout() {
    await supabase.auth.signOut();
    navigate({ to: "/" });
  }

  return (
    <section className="py-8 space-y-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl">Painel da Tia Vanete</h1>
          <p className="text-sm text-muted-foreground">Gerencie seus materiais e versículo do dia</p>
        </div>
        <button onClick={logout} className="inline-flex items-center gap-2 px-4 py-2 rounded-full border hover:bg-muted">
          <LogOut className="h-4 w-4" /> Sair
        </button>
      </header>

      <StorageCard />
      <DriveStatusCard />
      <ProfilePhotoCard />

      <div className="cloud-card p-5">
        <h2 className="font-display text-xl mb-3">🌟 Versículo do dia</h2>
        <textarea value={verse} onChange={(e) => setVerse(e.target.value)} rows={3}
          className="w-full px-4 py-3 rounded-2xl border border-input bg-background" />
        <button onClick={saveVerse} className="mt-3 px-5 py-2 rounded-full bg-primary text-primary-foreground font-medium">Salvar</button>
      </div>

      <UploadCard onUploaded={refresh} />

      <div className="cloud-card p-5">
        <h2 className="font-display text-xl mb-3">📦 Materiais publicados ({materials.length})</h2>
        {materials.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nenhum material ainda.</p>
        ) : (
          <ul className="divide-y divide-border">
            {materials.map((m) => (
              <li key={m.id} className="py-3 flex items-center gap-3">
                <CategoryIcon c={m.category} />
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{m.title}</p>
                  <p className="text-xs text-muted-foreground capitalize">{m.category} · {m.likes_count} ♥</p>
                </div>
                <button onClick={() => deleteMaterial(m, refresh)} className="p-2 rounded-full hover:bg-destructive/10 text-destructive">
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function CategoryIcon({ c }: { c: MaterialCategory }) {
  const cls = "h-9 w-9 p-2 rounded-xl bg-primary/30";
  if (c === "pdfs") return <FileText className={cls} />;
  if (c === "imagens") return <ImageIcon className={cls} />;
  return <MessageSquare className={cls} />;
}

async function deleteMaterial(m: Material, refresh: () => void) {
  if (!confirm(`Excluir "${m.title}"?`)) return;
  try {
    const fileKey = r2KeyFromPublicUrl(m.file_path) ?? m.file_path;
    await deleteFromR2(fileKey);
    const coverKey = r2KeyFromPublicUrl(m.cover_url);
    if (coverKey && coverKey !== fileKey) await deleteFromR2(coverKey);
    const { error } = await supabase.from("materials").delete().eq("id", m.id);
    if (error) toast.error(error.message); else { toast.success("Excluído"); refresh(); }
  } catch (err) {
    toast.error((err as Error).message);
  }
}

function ProfilePhotoCard() {
  const [url, setUrl] = useState<string>(avatarFallback);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchAvatarUrl().then((u) => { if (u) setUrl(u); });
  }, []);

  async function onPick(f: File | null) {
    if (!f) return;
    if (!f.type.startsWith("image/")) { toast.error("Selecione uma imagem"); return; }
    if (f.size > 10485760) { toast.error("Imagem maior que 10MB"); return; }
    setUploading(true);
    try {
      const ext = f.name.split(".").pop() ?? "png";
      const path = `avatars/${crypto.randomUUID()}.${ext}`;
      const stored = await uploadToR2(path, f, f.type || "image/png");
      const previousUrl = await fetchAvatarUrl();
      const { error } = await supabase.from("site_settings").upsert({
        key: AVATAR_SETTING_KEY, value: stored.url, updated_at: new Date().toISOString(),
      });
      if (error) {
        await deleteFromR2(stored.path).catch(() => {});
        throw error;
      }
      const previous = r2KeyFromPublicUrl(previousUrl);
      if (previous && previous !== stored.path) await deleteFromR2(previous).catch(() => {});
      setUrl(stored.url);
      toast.success("Foto de perfil atualizada! 📸");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="cloud-card p-5">
      <h2 className="font-display text-xl mb-3">📸 Foto de perfil</h2>
      <div className="flex items-center gap-5">
        <img src={url} alt="Foto de perfil atual" className="h-24 w-24 rounded-full object-cover ring-4 ring-white soft-shadow bg-white" />
        <div>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-2 px-5 py-2 rounded-full bg-primary text-primary-foreground font-medium soft-shadow disabled:opacity-50"
          >
            <Camera className="h-4 w-4" /> {uploading ? "Enviando..." : "Trocar foto"}
          </button>
          <p className="text-xs text-muted-foreground mt-2">Imagem quadrada fica melhor. Até 10MB.</p>
        </div>
        <input ref={inputRef} type="file" accept="image/*" className="hidden"
          onChange={(e) => onPick(e.target.files?.[0] ?? null)} />
      </div>
    </div>
  );
}

function UploadCard({ onUploaded }: { onUploaded: () => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<MaterialCategory>("mensagens");
  const [file, setFile] = useState<File | null>(null);
  const [cover, setCover] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [compressing, setCompressing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const coverRef = useRef<HTMLInputElement>(null);

  function onPick(f: File | null) {
    if (!f) return setFile(null);
    if (f.size > MAX_UPLOAD_BYTES) {
      toast.error(FILE_TOO_LARGE_MESSAGE);
      return;
    }
    setFile(f);
  }

  function onPickCover(f: File | null) {
    if (!f) return setCover(null);
    if (!f.type.startsWith("image/")) {
      toast.error("A capa deve ser uma imagem");
      return;
    }
    if (f.size > 10485760) {
      toast.error("Capa maior que 10MB");
      return;
    }
    setCover(f);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return toast.error("Coloque um título");
    if (category !== "mensagens" && !file) return toast.error("Selecione um arquivo");
    setUploading(true);
    const uploadedPaths: string[] = [];
    let published = false;
    try {
      let toUpload = file;
      if (toUpload?.type === "application/pdf" && category === "pdfs") {
        setCompressing(true);
        try {
          toUpload = await compressPdf(toUpload);
        } finally {
          setCompressing(false);
        }
      }
      if (toUpload && toUpload.size > MAX_UPLOAD_BYTES) {
        toast.error(FILE_TOO_LARGE_MESSAGE);
        return;
      }
      const body = toUpload ?? new Blob([description || title], { type: "text/plain" });
      const pdfCover = category === "pdfs" ? cover : null;
      if (pdfCover) await checkStorageSpace(body.size + pdfCover.size);
      const ext = toUpload ? (toUpload.name.split(".").pop() ?? "bin") : "txt";
      const mime = body.type || "application/octet-stream";
      const stored = await uploadToR2(`${category}/${crypto.randomUUID()}.${ext}`, body, mime);
      uploadedPaths.push(stored.path);

      let coverUrl: string | null = null;
      if (pdfCover) {
        const cext = pdfCover.name.split(".").pop() ?? "png";
        const coverPath = `pdfs/covers/${crypto.randomUUID()}.${cext}`;
        const stored = await uploadToR2(coverPath, pdfCover, pdfCover.type || "image/png");
        uploadedPaths.push(stored.path);
        coverUrl = stored.url;
      }

      const { error } = await supabase.from("materials").insert({
        title,
        description: description || null,
        category,
        file_path: stored.path,
        file_url: stored.url,
        file_name: toUpload?.name ?? "mensagem.txt",
        file_size: stored.size,
        mime_type: mime,
        cover_url: coverUrl,
      });
      if (error) throw error;
      published = true;
      toast.success("Material publicado! 🌈");
      setTitle("");
      setDescription("");
      setFile(null);
      setCover(null);
      if (inputRef.current) inputRef.current.value = "";
      if (coverRef.current) coverRef.current.value = "";
      onUploaded();
    } catch (err) {
      if (!published) {
        await Promise.all(uploadedPaths.map((p) => deleteFromR2(p).catch(() => {})));
      }
      toast.error((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <form onSubmit={submit} className="cloud-card p-5 space-y-4">
      <h2 className="font-display text-xl">➕ Adicionar material</h2>
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="text-sm font-medium block mb-1">Título</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} required
            className="w-full px-4 py-3 rounded-2xl border border-input bg-background" />
        </div>
        <div>
          <label className="text-sm font-medium block mb-1">Categoria</label>
          <select value={category} onChange={(e) => setCategory(e.target.value as MaterialCategory)}
            className="w-full px-4 py-3 rounded-2xl border border-input bg-background">
            <option value="mensagens">{MATERIAL_CATEGORY_LABELS.mensagens}</option>
            <option value="imagens">{MATERIAL_CATEGORY_LABELS.imagens}</option>
            <option value="pdfs">{MATERIAL_CATEGORY_LABELS.pdfs}</option>
          </select>
        </div>
      </div>
      <div>
        <label className="text-sm font-medium block mb-1">
          {category === "mensagens" ? "Texto da mensagem (opcional se enviar arquivo)" : "Descrição (opcional)"}
        </label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3}
          className="w-full px-4 py-3 rounded-2xl border border-input bg-background" />
      </div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); onPick(e.dataTransfer.files?.[0] ?? null); }}
        onClick={() => inputRef.current?.click()}
        className={`cursor-pointer rounded-2xl border-2 border-dashed p-6 text-center transition ${dragging ? "border-primary bg-primary/10" : "border-border hover:border-primary/60 hover:bg-muted"}`}
      >
        <Upload className="h-8 w-8 mx-auto mb-2 text-primary" />
        {file ? (
          <p className="text-sm font-medium">{file.name} <span className="text-muted-foreground">({(file.size/1024/1024).toFixed(1)} MB)</span></p>
        ) : (
          <>
            <p className="font-medium">Arraste o arquivo aqui ou clique para selecionar</p>
            <p className="text-xs text-muted-foreground mt-1">Imagens, PDFs ou textos. Até 95 MB.</p>
          </>
        )}
        <input ref={inputRef} type="file" className="hidden"
          accept={category === "imagens" ? "image/*" : category === "pdfs" ? "application/pdf" : "*"}
          onChange={(e) => onPick(e.target.files?.[0] ?? null)} />
      </div>
      {category === "pdfs" && (
        <div>
          <label className="text-sm font-medium block mb-1">Capa do PDF (opcional)</label>
          <div
            onClick={() => coverRef.current?.click()}
            className="cursor-pointer rounded-2xl border-2 border-dashed border-border hover:border-primary/60 hover:bg-muted p-4 flex items-center gap-4 transition"
          >
            {cover ? (
              <img src={URL.createObjectURL(cover)} alt="Prévia da capa" className="h-16 w-16 rounded-xl object-cover ring-2 ring-white soft-shadow" />
            ) : (
              <ImageIcon className="h-12 w-12 p-2 rounded-xl bg-primary/30 text-primary" />
            )}
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{cover ? cover.name : "Escolher imagem de capa"}</p>
              <p className="text-xs text-muted-foreground">Aparece no card do PDF. Até 10MB.</p>
            </div>
          </div>
          <input ref={coverRef} type="file" accept="image/*" className="hidden"
            onChange={(e) => onPickCover(e.target.files?.[0] ?? null)} />
        </div>
      )}
      <button disabled={uploading} className="px-6 py-3 rounded-full bg-primary text-primary-foreground font-medium soft-shadow disabled:opacity-50">
        {compressing ? "Comprimindo PDF..." : uploading ? "Enviando..." : "Publicar"}
      </button>
    </form>
  );
}
