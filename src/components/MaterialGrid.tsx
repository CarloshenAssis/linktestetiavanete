import { useEffect, useState } from "react";
import { fetchMaterials, Material, MaterialCategory } from "@/lib/materials";
import { MaterialCard } from "./MaterialCard";

export function MaterialGrid({ category, title, emoji }: { category: MaterialCategory; title: string; emoji: string }) {
  const [items, setItems] = useState<Material[] | null>(null);
  useEffect(() => { fetchMaterials(category).then(setItems).catch(() => setItems([])); }, [category]);

  return (
    <section className="py-8">
      <h1 className="font-display text-3xl sm:text-4xl mb-6 flex items-center gap-2">
        <span>{emoji}</span> {title}
      </h1>
      {items === null ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[0,1,2,3,4,5].map((i) => <div key={i} className="cloud-card h-72 animate-pulse" />)}
        </div>
      ) : items.length === 0 ? (
        <div className="cloud-card p-10 text-center text-muted-foreground">Nenhum material publicado ainda. 🌈</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((m) => <MaterialCard key={m.id} material={m} />)}
        </div>
      )}
    </section>
  );
}
