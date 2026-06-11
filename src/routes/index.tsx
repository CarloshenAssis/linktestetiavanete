import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import avatar from "@/assets/vanete-avatar.png";
import { MaterialCarousel } from "@/components/MaterialCarousel";
import { fetchVerse, fetchAvatarUrl } from "@/lib/materials";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Tia Vanete Maffra — Educadora Cristã Infantil" },
      { name: "description", content: "Mensagens, imagens e materiais para crianças. 36 anos ensinando a Palavra de Deus na Igreja Ministério de Perus — Araras/SP." },
    ],
  }),
  component: Home,
});

function Home() {
  const [verse, setVerse] = useState<string>("");
  const [avatarUrl, setAvatarUrl] = useState<string>(avatar);

  useEffect(() => {
    fetchVerse().then(setVerse);
    fetchAvatarUrl().then((url) => { if (url) setAvatarUrl(url); });
  }, []);

  return (
    <div>
      {/* Hero */}
      <section className="pt-8 pb-4 sm:py-12">
        <div className="grid sm:grid-cols-[auto_1fr] gap-6 items-center">
          <div className="mx-auto sm:mx-0">
            <div className="relative">
              <div className="absolute inset-0 rounded-full bg-gradient-to-br from-sky to-pink blur-2xl opacity-60 scale-110" />
              <img
                src={avatarUrl}
                alt="Ilustração da Tia Vanete Maffra"
                width={1024}
                height={1024}
                className="relative h-44 w-44 sm:h-56 sm:w-56 rounded-full object-cover bg-white ring-4 ring-white soft-shadow"
              />
            </div>
          </div>
          <div className="text-center sm:text-left">
            <p className="text-sm font-medium text-primary-foreground/70 mb-2">✨ 36 anos ensinando a Palavra ✨</p>
            <h1 className="font-display text-4xl sm:text-5xl leading-tight">
              Tia Vanete <span className="text-primary-foreground/90">Maffra</span>
            </h1>
            <p className="mt-2 text-muted-foreground text-sm">
              Igreja Ministério de Perus — Araras/SP
            </p>
            <blockquote className="mt-5 cloud-card p-4 sm:p-5 text-base sm:text-lg font-display">
              <p>"Ensina a criança no caminho em que deve andar"</p>
              <footer className="mt-1 text-sm text-muted-foreground font-sans">— Provérbios 22:6</footer>
            </blockquote>
          </div>
        </div>
      </section>

      {/* Versículo do dia */}
      {verse && (
        <section className="my-6">
          <div className="cloud-card p-5 sm:p-6 bg-gradient-to-br from-sky/60 to-pink/40 border-0">
            <div className="flex items-center gap-2 mb-2">
              <span className="inline-block px-3 py-1 rounded-full bg-white text-xs font-semibold">🌟 Versículo do dia</span>
            </div>
            <p className="font-display text-lg sm:text-xl leading-snug">{verse}</p>
          </div>
        </section>
      )}

      {/* Carrosséis */}
      <MaterialCarousel category="mensagens" title="Mensagens" emoji="💌" to="/mensagens" />
      <MaterialCarousel category="imagens" title="Imagens" emoji="🖼️" to="/imagens" />
      <MaterialCarousel category="pdfs" title="PDFs" emoji="📚" to="/pdfs" />
    </div>
  );
}
