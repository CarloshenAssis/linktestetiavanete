import { Link } from "@tanstack/react-router";
import { Heart } from "lucide-react";
import avatar from "@/assets/vanete-avatar.png";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 backdrop-blur-md bg-background/75 border-b border-border/60">
      <div className="mx-auto max-w-6xl px-4 h-16 flex items-center justify-between gap-3">
        <Link to="/" className="flex items-center gap-2 group">
          <img src={avatar} alt="" className="h-10 w-10 rounded-full ring-2 ring-primary/60 bg-white" />
          <span className="font-display text-base sm:text-lg leading-tight">
            <span className="block">Tia Vanete</span>
            <span className="block text-xs text-muted-foreground -mt-0.5">Maffra</span>
          </span>
        </Link>
        <nav className="flex items-center gap-1 sm:gap-2 text-sm">
          <NavLink to="/mensagens">Mensagens</NavLink>
          <NavLink to="/imagens">Imagens</NavLink>
          <NavLink to="/pdfs">PDFs</NavLink>
        </nav>
      </div>
    </header>
  );
}

function NavLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      className="px-3 py-2 rounded-full hover:bg-primary/20 transition-colors font-medium"
      activeProps={{ className: "px-3 py-2 rounded-full bg-primary/30 font-semibold" }}
    >
      {children}
    </Link>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-border/60 bg-card/60 backdrop-blur">
      <div className="mx-auto max-w-6xl px-4 py-10 text-center">
        <p className="font-display text-lg mb-4">Vamos conversar?</p>
        <div className="flex flex-wrap justify-center gap-3">
          <a
            href="https://wa.me/5519994899088"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 px-5 py-3 rounded-full bg-[#25D366] text-white font-medium soft-shadow hover:scale-105 transition"
          >
            <WhatsAppIcon /> WhatsApp
          </a>
          <a
            href="https://instagram.com/vanetemaffra"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 px-5 py-3 rounded-full text-white font-medium soft-shadow hover:scale-105 transition"
            style={{ background: "linear-gradient(135deg,#f58529,#dd2a7b,#8134af)" }}
          >
            <InstagramIcon /> Instagram
          </a>
          <a
            href="https://facebook.com/"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 px-5 py-3 rounded-full bg-[#1877F2] text-white font-medium soft-shadow hover:scale-105 transition"
          >
            <FacebookIcon /> Facebook
          </a>
        </div>
        <p className="mt-6 text-xs text-muted-foreground flex items-center justify-center gap-1">
          Feito com <Heart className="h-3 w-3 fill-pink text-pink" /> para a obra do Senhor
        </p>
        <p className="text-xs text-muted-foreground mt-1">Igreja Ministério de Perus — Araras/SP</p>
        <Link to="/auth" className="text-[10px] text-muted-foreground/60 hover:text-muted-foreground mt-3 inline-block">
          Área restrita
        </Link>
      </div>
    </footer>
  );
}

function WhatsAppIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M17.5 14.4c-.3-.1-1.7-.8-2-.9-.3-.1-.5-.2-.7.2s-.8.9-1 1.1c-.2.2-.4.2-.7.1-.3-.1-1.2-.5-2.4-1.5-.9-.8-1.5-1.8-1.6-2.1-.2-.3 0-.5.1-.6l.5-.6c.1-.2.2-.3.3-.5 0-.2 0-.4 0-.5L8.9 7c-.2-.5-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.1.2 2.1 3.3 5.2 4.6 2.6 1 3.1.8 3.7.8.5-.1 1.7-.7 2-1.4.2-.6.2-1.2.2-1.3-.1-.1-.3-.2-.6-.4zM12 2a10 10 0 0 0-8.6 15l-1.3 4.7 4.8-1.3A10 10 0 1 0 12 2z"/></svg>;
}
function InstagramIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor"/></svg>;
}
function FacebookIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M13 22v-8h3l1-4h-4V7.5c0-1.1.4-2 2-2h2V2h-3c-3 0-5 1.8-5 5v3H6v4h3v8h4z"/></svg>;
}
