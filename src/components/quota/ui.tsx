import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { Risk } from "@/lib/quota/engine";
import { cn } from "@/lib/utils";

export const fmt = (n: number) => Math.round(n).toLocaleString();
export const k = (n: number) => (Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : `${(n / 1e3).toFixed(1)}K`);
export const usd = (n: number) => n.toLocaleString(undefined, { style: "currency", currency: "USD" });

const riskStyle: Record<Risk, string> = {
  NORMAL: "bg-risk-normal/15 text-risk-normal border-risk-normal/40",
  AT_RISK: "bg-risk-atrisk/15 text-risk-atrisk border-risk-atrisk/40",
  CRITICAL: "bg-risk-critical/15 text-risk-critical border-risk-critical/40",
  UNDERUTILIZED: "bg-risk-under/15 text-risk-under border-risk-under/40",
  UNALLOCATED: "bg-muted text-muted-foreground border-border",
};
const barStyle: Record<Risk, string> = {
  NORMAL: "bg-risk-normal", AT_RISK: "bg-risk-atrisk", CRITICAL: "bg-risk-critical", UNDERUTILIZED: "bg-risk-under",
  UNALLOCATED: "bg-muted-foreground",
};

export function RiskBadge({ risk }: { risk: Risk }) {
  return <span className={cn("inline-flex rounded border px-2 py-0.5 font-mono text-[11px] font-medium", riskStyle[risk])}>{risk.replace("_", " ")}</span>;
}

export function Bar({ value, risk }: { value: number; risk: Risk }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
      <div className={cn("h-full rounded-full", barStyle[risk])} style={{ width: `${Math.min(100, value)}%` }} />
    </div>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

export function Panel({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-lg border bg-card">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Shell({ who, role, nav, children }: { who: string; role?: string; nav?: ReactNode; children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <span className="grid h-7 w-7 place-items-center rounded bg-primary font-mono text-xs text-primary-foreground font-bold">TW</span>
            Tokenwise
            {role && <span className="rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{role}</span>}
          </Link>
          <div className="flex items-center gap-4 text-sm">
            <span className="font-mono text-muted-foreground">{who}</span>
            <Link to="/" className="text-primary hover:underline">Sign out</Link>
          </div>
        </div>
        {nav && <div className="mx-auto max-w-7xl overflow-x-auto px-4 pb-2">{nav}</div>}
      </header>
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6">{children}</main>
    </div>
  );
}

export function NavTabs({ items, value, onChange }: { items: { id: string; label: string }[]; value: string; onChange: (id: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onChange(item.id)}
          className={cn(
            "rounded-md px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide",
            value === item.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export const th = "px-3 py-2 text-left font-mono text-[11px] font-medium uppercase tracking-wider text-muted-foreground";
export const td = "px-3 py-2 tabular-nums";
