import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import avatar from "@/assets/vanete-avatar.png";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "Área restrita — Tia Vanete" }] }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/admin" });
    });
  }, [navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email, password,
          options: { emailRedirectTo: `${window.location.origin}/admin` },
        });
        if (error) throw error;
        toast.success("Conta criada! Você já pode entrar.");
        setMode("login");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("Bem-vinda, Tia Vanete! 💕");
        navigate({ to: "/admin" });
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="py-10 max-w-md mx-auto">
      <div className="cloud-card p-6 sm:p-8">
        <div className="text-center mb-6">
          <img src={avatar} alt="" className="h-20 w-20 rounded-full mx-auto bg-white ring-2 ring-primary" />
          <h1 className="font-display text-2xl mt-3">Área restrita</h1>
          <p className="text-sm text-muted-foreground">Acesso ao painel da Tia Vanete</p>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="text-sm font-medium block mb-1">E-mail</label>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-3 rounded-2xl border border-input bg-background" />
          </div>
          <div>
            <label className="text-sm font-medium block mb-1">Senha</label>
            <input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 rounded-2xl border border-input bg-background" />
          </div>
          <button disabled={loading} className="w-full py-3 rounded-2xl bg-primary text-primary-foreground font-medium soft-shadow disabled:opacity-50">
            {loading ? "Aguarde..." : mode === "login" ? "Entrar" : "Criar conta"}
          </button>
        </form>
        <button onClick={() => setMode(mode === "login" ? "signup" : "login")} className="mt-4 w-full text-sm text-muted-foreground hover:text-foreground">
          {mode === "login" ? "Primeiro acesso? Criar conta" : "Já tem conta? Entrar"}
        </button>
      </div>
    </section>
  );
}
