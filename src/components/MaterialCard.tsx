import { useState } from "react";
import { Heart, MessageCircle, Share2, Download, FileText } from "lucide-react";
import { Material, shareWhatsApp, shareFacebook } from "@/lib/materials";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function MaterialCard({ material }: { material: Material }) {
  const [likes, setLikes] = useState(material.likes_count);
  const [liked, setLiked] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [showShare, setShowShare] = useState(false);

  const url = material.signed_url ?? material.file_url;

  async function handleLike() {
    if (liked) return;
    setLiked(true);
    setLikes((n) => n + 1);
    const { data, error } = await supabase.rpc("like_material", { _material_id: material.id });
    if (error) {
      setLiked(false);
      setLikes((n) => n - 1);
      toast.error("Não foi possível curtir agora");
    } else if (typeof data === "number") setLikes(data);
  }

  return (
    <div className="cloud-card overflow-hidden flex flex-col">
      <div className="aspect-[4/3] bg-gradient-to-br from-sky to-pink relative overflow-hidden">
        {material.category === "imagens" && (
          <img src={url} alt={material.title} loading="lazy" className="w-full h-full object-cover" />
        )}
        {material.category === "pdfs" && (
          material.cover_url ? (
            <img src={material.cover_url} alt={material.title} loading="lazy" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-primary-foreground">
              <FileText className="h-16 w-16 text-white/90" strokeWidth={1.5} />
              <span className="text-xs font-medium text-white/90 px-3 truncate max-w-full">{material.file_name}</span>
            </div>
          )
        )}
        {material.category === "mensagens" && (
          <div className="w-full h-full flex items-center justify-center p-4 text-center">
            <p className="font-display text-lg text-foreground/90 line-clamp-4">"{material.description ?? material.title}"</p>
          </div>
        )}
      </div>
      <div className="p-4 flex-1 flex flex-col">
        <h3 className="font-display text-lg mb-1">{material.title}</h3>
        {material.description && material.category !== "mensagens" && (
          <p className="text-sm text-muted-foreground line-clamp-2 mb-2">{material.description}</p>
        )}
        <div className="mt-auto pt-3 flex items-center gap-1 flex-wrap">
          <button
            onClick={handleLike}
            className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-sm transition ${liked ? "bg-pink/40" : "hover:bg-pink/20"}`}
          >
            <Heart className={`h-4 w-4 ${liked ? "fill-destructive text-destructive" : ""}`} />
            {likes}
          </button>
          <button
            onClick={() => setShowComments((s) => !s)}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-sm hover:bg-primary/20 transition"
          >
            <MessageCircle className="h-4 w-4" /> Comentar
          </button>
          <button
            onClick={() => setShowShare((s) => !s)}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-sm hover:bg-accent transition"
          >
            <Share2 className="h-4 w-4" /> Compartilhar
          </button>
          {material.category === "pdfs" && (
            <a
              href={url}
              download={material.file_name ?? undefined}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-sm bg-primary/80 text-primary-foreground hover:bg-primary transition"
            >
              <Download className="h-4 w-4" /> Baixar
            </a>
          )}
        </div>
        {showShare && (
          <div className="mt-2 flex gap-2 text-xs">
            <button onClick={() => shareWhatsApp(material.title, url)} className="flex-1 px-3 py-2 rounded-lg bg-[#25D366] text-white">WhatsApp</button>
            <button onClick={() => shareFacebook(url)} className="flex-1 px-3 py-2 rounded-lg bg-[#1877F2] text-white">Facebook</button>
          </div>
        )}
        {showComments && <Comments materialId={material.id} />}
      </div>
    </div>
  );
}

function Comments({ materialId }: { materialId: string }) {
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [list, setList] = useState<{ id: string; author_name: string; content: string; created_at: string | null }[]>([]);
  const [loaded, setLoaded] = useState(false);

  async function load() {
    const { data } = await supabase
      .from("comments")
      .select("id,author_name,content,created_at")
      .eq("material_id", materialId)
      .order("created_at", { ascending: false });
    setList(data ?? []);
    setLoaded(true);
  }
  if (!loaded) load();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !content.trim()) return;
    const { error } = await supabase.from("comments").insert({ material_id: materialId, author_name: name, content });
    if (error) toast.error("Erro ao comentar");
    else {
      setContent("");
      toast.success("Comentário enviado!");
      load();
    }
  }

  return (
    <div className="mt-3 border-t pt-3 space-y-3">
      <form onSubmit={submit} className="space-y-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Seu nome"
          className="w-full px-3 py-2 rounded-xl border border-input bg-background text-sm"
          maxLength={80}
        />
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Escreva um comentário..."
          className="w-full px-3 py-2 rounded-xl border border-input bg-background text-sm"
          rows={2}
          maxLength={1000}
        />
        <button className="px-4 py-2 rounded-full bg-primary text-primary-foreground text-sm font-medium">Enviar</button>
      </form>
      <div className="space-y-2 max-h-48 overflow-y-auto">
        {list.map((c) => (
          <div key={c.id} className="text-sm bg-muted/60 rounded-xl px-3 py-2">
            <span className="font-semibold text-primary-foreground/80 text-foreground">{c.author_name}:</span>{" "}
            <span className="text-foreground/90">{c.content}</span>
          </div>
        ))}
        {list.length === 0 && <p className="text-xs text-muted-foreground">Seja o primeiro a comentar 💕</p>}
      </div>
    </div>
  );
}
