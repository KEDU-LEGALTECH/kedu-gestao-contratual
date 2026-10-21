import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

export function ThemeToggle({ login = false }: { login?: boolean }) {
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === "dark");
  useEffect(() => {
    const preference = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => {
      let saved: string | null = null;
      try { saved = localStorage.getItem("kedu-theme"); } catch {}
      const next = saved === "dark" || (saved !== "light" && preference.matches);
      document.documentElement.dataset.theme = next ? "dark" : "light";
      setDark(next);
    };
    update(); preference.addEventListener("change", update);
    window.addEventListener("storage", update);
    return () => { preference.removeEventListener("change", update); window.removeEventListener("storage", update); };
  }, []);
  return <button className={"theme-toggle" + (login ? " login-theme" : "")} type="button" aria-label={dark ? "Ativar modo claro" : "Ativar modo noturno"} title={dark ? "Ativar modo claro" : "Ativar modo noturno"} aria-pressed={dark} onClick={() => {
    const next = !dark;
    document.documentElement.dataset.theme = next ? "dark" : "light";
    setDark(next);
    try { localStorage.setItem("kedu-theme", next ? "dark" : "light"); } catch {}
  }}>{dark ? <Sun size={18} /> : <Moon size={18} />}<span>{dark ? "Modo claro" : "Modo noturno"}</span></button>;
}
