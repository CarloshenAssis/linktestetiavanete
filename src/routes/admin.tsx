import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { fetchMaterials, fetchVerse, fetchAvatarUrl, AVATAR_SETTING_KEY, Material, MaterialCategory } from "@/lib/materials";
import { compressPdf } from "@/lib/pdfCompress";
import avatarFallback from "@/assets/vanete-avatar.png";
import { Trash2, Upload, LogOut, FileText, ImageIcon, MessageSquare, Camera } from "lucide-react";

export const Route = createFileRoute("/admin")({
  ssr: false,
  head: () => ({ meta: [{ title: "Painel — Tia Vanete" }] }),
  component: Admin,
});

function Admin() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navigate({ to: "/auth" }); return; }
      const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", session.user.id);
      const admin = (roles ?? []).some((r) => r.role === "admin");
      setIsAdmin(admin);
      setReady(true);
    })();
  }, [navigate]);

  if (!ready) return <div className="py-20 text-center text-muted-foreground">Carregando...</div>;
  if (!isAdmin) return (
    <div className="py-20 text-center">
      <p className="text-muted-foreground">Sua conta não tem permissão de administrador.</p>
      <button onClick={async () => { await supabase.auth.signOut(); navigate({ to: "/auth" }); }} className="mt-4 px-4 py-2 rounded-full bg-primary text-primary-foreground">Sair</button>
    </div>
  );

  return <AdminPanel />;
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
  await supabase.storage.from("materials").remove([m.file_path]);
  const { error } = await supabase.from("materials").delete().eq("id", m.id);
  if (error) toast.error(error.message); else { toast.success("Excluído"); refresh(); }
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
      const { error: upErr } = await supabase.storage.from("materials").upload(path, f, {
        contentType: f.type, upsert: false, cacheControl: "31536000",
      });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("materials").getPublicUrl(path);
      const { error } = await supabase.from("site_settings").upsert({
        key: AVATAR_SETTING_KEY, value: pub.publicUrl, updated_at: new Date().toISOString(),
      });
      if (error) throw error;
      setUrl(pub.publicUrl);
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
    if (f.size > 209715200) { toast.error("Arquivo maior que 200MB"); return; }
    setFile(f);
  }

  function onPickCover(f: File | null) {
    if (!f) return setCover(null);
    if (!f.type.startsWith("image/")) { toast.error("A capa deve ser uma imagem"); return; }
    if (f.size > 10485760) { toast.error("Capa maior que 10MB"); return; }
    setCover(f);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return toast.error("Coloque um título");
    if (category !== "mensagens" && !file) return toast.error("Selecione um arquivo");
    setUploading(true);
    try {
      let path = "";
      let url = "";
      let mime = "text/plain";
      let size = 0;
      let name = "mensagem.txt";

      if (file) {
        let toUpload = file;
        if (category === "pdfs" && file.type === "application/pdf") {
          setCompressing(true);
          try {
            toUpload = await compressPdf(file);
          } finally {
            setCompressing(false);
          }
        }
        const ext = toUpload.name.split(".").pop() ?? "bin";
        path = `${category}/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage.from("materials").upload(path, toUpload, {
          contentType: toUpload.type, upsert: false, cacheControl: "31536000",
        });
        if (upErr) throw upErr;
        const { data: pub } = supabase.storage.from("materials").getPublicUrl(path);
        url = pub.publicUrl;
        mime = toUpload.type;
        size = toUpload.size;
        name = toUpload.name;
      } else {
        // pure text message: store description as a tiny txt
        path = `mensagens/${crypto.randomUUID()}.txt`;
        const blob = new Blob([description || title], { type: "text/plain" });
        const { error: upErr } = await supabase.storage.from("materials").upload(path, blob, {
          cacheControl: "31536000",
        });
        if (upErr) throw upErr;
        const { data: pub } = supabase.storage.from("materials").getPublicUrl(path);
        url = pub.publicUrl;
      }

      let coverUrl: string | null = null;
      if (category === "pdfs" && cover) {
        const cext = cover.name.split(".").pop() ?? "png";
        const coverPath = `pdfs/covers/${crypto.randomUUID()}.${cext}`;
        const { error: covErr } = await supabase.storage.from("materials").upload(coverPath, cover, {
          contentType: cover.type, upsert: false, cacheControl: "31536000",
        });
        if (covErr) throw covErr;
        const { data: covPub } = supabase.storage.from("materials").getPublicUrl(coverPath);
        coverUrl = covPub.publicUrl;
      }

      const { error } = await supabase.from("materials").insert({
        title, description: description || null, category,
        file_path: path, file_url: url, file_name: name, file_size: size, mime_type: mime,
        cover_url: coverUrl,
      });
      if (error) throw error;
      toast.success("Material publicado! 🌈");
      setTitle(""); setDescription(""); setFile(null); setCover(null);
      if (inputRef.current) inputRef.current.value = "";
      if (coverRef.current) coverRef.current.value = "";
      onUploaded();
    } catch (err) {
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
            <option value="mensagens">Mensagens</option>
            <option value="imagens">Imagens</option>
            <option value="pdfs">PDFs</option>
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
            <p className="text-xs text-muted-foreground mt-1">Imagens, PDFs ou textos. Até 200MB.</p>
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
