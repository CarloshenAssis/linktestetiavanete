import { supabase } from "@/integrations/supabase/client";

export type MaterialCategory = "mensagens" | "imagens" | "pdfs";

export interface Material {
  id: string;
  title: string;
  category: MaterialCategory;
  description: string | null;
  file_path: string;
  file_url: string;
  file_name: string | null;
  file_size: number | null;
  mime_type: string | null;
  cover_url: string | null;
  likes_count: number;
  created_at: string;
}

export const AVATAR_SETTING_KEY = "avatar_url";

export async function fetchAvatarUrl(): Promise<string | null> {
  const { data } = await supabase
    .from("site_settings")
    .select("value")
    .eq("key", AVATAR_SETTING_KEY)
    .maybeSingle();
  return data?.value ?? null;
}

export async function fetchMaterials(category?: MaterialCategory, limit?: number) {
  let q = supabase.from("materials").select("*").order("created_at", { ascending: false });
  if (category) q = q.eq("category", category);
  if (limit) q = q.limit(limit);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Material[];
}

export async function fetchVerse(): Promise<string> {
  const { data } = await supabase.from("site_settings").select("value").eq("key", "verse_of_day").maybeSingle();
  return data?.value ?? "";
}

export function shareWhatsApp(title: string, url: string) {
  const text = encodeURIComponent(`${title}\n${url}`);
  window.open(`https://wa.me/?text=${text}`, "_blank");
}
export function shareFacebook(url: string) {
  window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`, "_blank");
}
