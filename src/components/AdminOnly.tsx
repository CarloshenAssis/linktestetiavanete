import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export function AdminOnly({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [access, setAccess] = useState<"loading" | "admin" | "denied">("loading");

  useEffect(() => {
    let active = true;
    async function checkAccess() {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!active) return;
      if (!session) {
        await navigate({ to: "/auth", replace: true });
        return;
      }
      const { data: roles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", session.user.id);
      if (active) setAccess(roles?.some((role) => role.role === "admin") ? "admin" : "denied");
    }

    void checkAccess().catch(() => {
      if (active) setAccess("denied");
    });
    return () => {
      active = false;
    };
  }, [navigate]);

  if (access === "loading") {
    return (
      <p className="py-20 text-center text-lg" role="status">
        Carregando...
      </p>
    );
  }
  if (access === "denied") {
    return (
      <div className="py-20 text-center text-lg">
        <p>Sua conta não tem permissão de administrador.</p>
        <button
          onClick={async () => {
            await supabase.auth.signOut();
            await navigate({ to: "/auth", replace: true });
          }}
          className="mt-4 rounded-full bg-sky-800 px-6 py-3 font-semibold text-white hover:bg-sky-900"
        >
          Sair
        </button>
      </div>
    );
  }
  return children;
}
