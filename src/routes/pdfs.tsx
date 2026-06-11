import { createFileRoute } from "@tanstack/react-router";
import { MaterialGrid } from "@/components/MaterialGrid";

export const Route = createFileRoute("/pdfs")({
  head: () => ({ meta: [{ title: "PDFs — Tia Vanete Maffra" }, { name: "description", content: "Materiais em PDF para baixar — histórias bíblicas e atividades." }] }),
  component: () => <MaterialGrid category="pdfs" title="PDFs" emoji="📚" />,
});
