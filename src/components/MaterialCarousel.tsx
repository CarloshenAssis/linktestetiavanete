import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { fetchMaterials, Material, MaterialCategory } from "@/lib/materials";
import { MaterialCard } from "./MaterialCard";
import useEmblaCarousel from "embla-carousel-react";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface Props {
  category: MaterialCategory;
  title: string;
  emoji: string;
  to: string;
}

export function MaterialCarousel({ category, title, emoji, to }: Props) {
  const [materials, setMaterials] = useState<Material[] | null>(null);
  const [emblaRef, embla] = useEmblaCarousel({ align: "start", loop: false });

  useEffect(() => {
    fetchMaterials(category, 6).then(setMaterials).catch(() => setMaterials([]));
  }, [category]);

  return (
    <section className="py-10">
      <div className="flex items-end justify-between mb-5 px-1">
        <h2 className="font-display text-2xl sm:text-3xl flex items-center gap-2">
          <span>{emoji}</span> {title}
        </h2>
        <Link to={to} className="text-sm font-medium px-4 py-2 rounded-full bg-pink/40 hover:bg-pink/60 transition">
          Ver mais →
        </Link>
      </div>

      {materials === null ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="cloud-card h-72 animate-pulse" />
          ))}
        </div>
      ) : materials.length === 0 ? (
        <div className="cloud-card p-8 text-center text-muted-foreground">
          Nenhum material publicado ainda. Em breve! 🌈
        </div>
      ) : (
        <div className="relative">
          <div ref={emblaRef} className="overflow-hidden">
            <div className="flex gap-4">
              {materials.map((m) => (
                <div key={m.id} className="flex-[0_0_85%] sm:flex-[0_0_48%] lg:flex-[0_0_32%] min-w-0">
                  <MaterialCard material={m} />
                </div>
              ))}
            </div>
          </div>
          <button
            onClick={() => embla?.scrollPrev()}
            className="hidden sm:flex absolute -left-3 top-1/2 -translate-y-1/2 h-10 w-10 items-center justify-center rounded-full bg-white shadow-md hover:bg-primary/20"
          >
            <ChevronLeft />
          </button>
          <button
            onClick={() => embla?.scrollNext()}
            className="hidden sm:flex absolute -right-3 top-1/2 -translate-y-1/2 h-10 w-10 items-center justify-center rounded-full bg-white shadow-md hover:bg-primary/20"
          >
            <ChevronRight />
          </button>
        </div>
      )}
    </section>
  );
}
