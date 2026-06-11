import { createFileRoute } from "@tanstack/react-router";
import { MaterialGrid } from "@/components/MaterialGrid";

export const Route = createFileRoute("/mensagens")({
  head: () => ({ meta: [{ title: "Mensagens — Tia Vanete Maffra" }, { name: "description", content: "Mensagens edificantes para crianças por Tia Vanete Maffra." }] }),
  component: () => <MaterialGrid category="mensagens" title="Mensagens" emoji="💌" />,
});
