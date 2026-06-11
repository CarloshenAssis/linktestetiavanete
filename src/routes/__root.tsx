import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { SiteHeader, SiteFooter } from "@/components/SiteHeader";
import { CloudBackdrop } from "@/components/CloudBackdrop";
import { Toaster } from "sonner";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-md text-center cloud-card p-8">
        <h1 className="text-6xl font-display">404</h1>
        <p className="mt-2 text-muted-foreground">Página não encontrada.</p>
        <Link to="/" className="mt-4 inline-block px-5 py-2 rounded-full bg-primary text-primary-foreground font-medium">
          Voltar ao início
        </Link>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => { reportLovableError(error, { boundary: "tanstack_root_error_component" }); }, [error]);
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-md text-center cloud-card p-8">
        <h1 className="text-xl font-display">Ops! Algo deu errado</h1>
        <p className="mt-2 text-sm text-muted-foreground">Tente novamente em instantes.</p>
        <div className="mt-4 flex justify-center gap-2">
          <button onClick={() => { router.invalidate(); reset(); }} className="px-4 py-2 rounded-full bg-primary text-primary-foreground">Tentar novamente</button>
          <a href="/" className="px-4 py-2 rounded-full border">Início</a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Tia Vanete Maffra — Educadora Cristã Infantil" },
      { name: "description", content: "36 anos ensinando a Palavra de Deus às crianças. Mensagens, imagens e materiais da Tia Vanete Maffra — Igreja Ministério de Perus, Araras/SP." },
      { property: "og:title", content: "Tia Vanete Maffra — Educadora Cristã Infantil" },
      { property: "og:description", content: "36 anos ensinando a Palavra de Deus às crianças. Mensagens, imagens e materiais da Tia Vanete Maffra — Igreja Ministério de Perus, Araras/SP." },
      { property: "og:type", content: "website" },
      { name: "twitter:title", content: "Tia Vanete Maffra — Educadora Cristã Infantil" },
      { name: "twitter:description", content: "36 anos ensinando a Palavra de Deus às crianças. Mensagens, imagens e materiais da Tia Vanete Maffra — Igreja Ministério de Perus, Araras/SP." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/f3d9785b-98ed-4709-8a64-04b7e4665918/id-preview-10bbef1a--762e6262-80ca-4175-8ca3-0ed7e7813139.lovable.app-1781180536593.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/f3d9785b-98ed-4709-8a64-04b7e4665918/id-preview-10bbef1a--762e6262-80ca-4175-8ca3-0ed7e7813139.lovable.app-1781180536593.png" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Fredoka:wght@400;500;600;700&family=Nunito:wght@400;500;600;700&display=swap" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <head><HeadContent /></head>
      <body>{children}<Scripts /></body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <CloudBackdrop />
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-4">
        <Outlet />
      </main>
      <SiteFooter />
      <Toaster position="top-center" richColors />
    </QueryClientProvider>
  );
}
