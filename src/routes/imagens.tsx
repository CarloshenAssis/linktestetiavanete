import { createFileRoute } from "@tanstack/react-router";
import { MaterialGrid } from "@/components/MaterialGrid";

export const Route = createFileRoute("/imagens")({
  head: () => ({ meta: [{ title: "Imagens — Tia Vanete Maffra" }, { name: "description", content: "Galeria de imagens infantis cristãs da Tia Vanete." }] }),
  component: () => <MaterialGrid category="imagens" title="Imagens" emoji="🖼️" />,
});
