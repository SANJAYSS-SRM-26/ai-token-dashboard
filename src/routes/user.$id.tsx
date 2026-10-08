import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { queryOptions, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "@/lib/quota/api";
import { Bar, Panel, RiskBadge, Shell, Stat, fmt, k } from "@/components/quota/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const q = (id: string) => queryOptions({ queryKey: ["user", id], queryFn: () => api.userDashboard(id) });

export const Route = createFileRoute("/user/$id")({
  loader: async ({ context, params }) => {
    const d = await context.queryClient.ensureQueryData(q(params.id));
    if (!d) throw notFound();
  },
  head: ({ params }) => ({
    meta: [
      { title: `${params.id} — Tokenwise` },
      { name: "description", content: "Your AI token allocation, consumption forecast and risk status." },
    ],
  }),
  notFoundComponent: () => (
    <div className="p-10 text-center">Employee not found. <Link to="/" className="text-primary underline">Back</Link></div>
  ),
  component: UserPage,
});

function UserPage() {
  const { id } = Route.useParams();
  const { data } = useSuspenseQuery(q(id));
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [tokens, setTokens] = useState("100000");
  const [reason, setReason] = useState("");
  const [usage, setUsage] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  if (!data) return null;
  const { user, metrics: m, trend } = data;
  const zero = m.allocated === 0;
  const message =
    m.risk === "UNALLOCATED"
      ? "You have no token allocation. Request tokens from your manager to get started."
      : m.risk === "UNDERUTILIZED"
        ? `Your projected utilization is ${m.projectedUtilization.toFixed(0)}%. Your allocation is currently underutilized.`
        : m.risk === "NORMAL"
          ? `Your projected utilization is ${m.projectedUtilization.toFixed(0)}%. You're on track for this cycle.`
          : `Based on your current usage, your quota may be exhausted in ${Math.ceil(m.daysUntilExhaustion ?? 0)} days.`;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.requestTokens(id, { requested_tokens: Number(tokens), reason, expected_usage: usage });
      if (data.microsoftFormUrl) {
        const url = new URL(data.microsoftFormUrl);
        url.searchParams.set("employee_id", user.employee_id);
        url.searchParams.set("project", user.project_name ?? "");
        url.searchParams.set("requested_tokens", tokens);
        window.open(url.toString(), "_blank");
      }
      setOpen(false);
      setMsg("Request submitted. Your manager will review it.");
      await qc.invalidateQueries({ queryKey: ["user", id] });
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell who={`${user.employee_id} · ${user.name}`} role="User">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="font-mono text-xs text-muted-foreground">{user.employee_id} · {user.department} · {user.team}</div>
          <h1 className="text-3xl font-bold">{user.name}</h1>
        </div>
        <div className="flex items-center gap-2">
          <RiskBadge risk={m.risk} />
          {zero && <Button className="font-mono tracking-wide" onClick={() => setOpen(true)}>REQUEST TOKENS</Button>}
        </div>
      </div>
      <div className="rounded-lg border bg-accent p-4 text-sm text-accent-foreground">{message}</div>
      {msg && <div className="text-sm text-muted-foreground">{msg}</div>}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="My project" value={user.project_id ?? "—"} sub={user.project_name ?? "Unassigned"} />
        <Stat label="My quota" value={fmt(m.allocated)} />
        <Stat label="My token status" value={m.risk.replace("_", " ")} />
        <Stat label="Manager" value={user.manager_code ?? "—"} sub={user.manager_name ?? ""} />
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Allocated" value={fmt(m.allocated)} />
        <Stat label="Consumed" value={fmt(m.consumed)} />
        <Stat label="Remaining" value={fmt(m.remaining)} />
        <Stat label="Utilization" value={`${m.utilization.toFixed(1)}%`} sub={<Bar value={m.utilization} risk={m.risk} />} />
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Daily average" value={fmt(m.dailyUsage)} />
        <Stat label="Projected consumption" value={k(m.projected)} sub={`over ${data.cycleDays}-day cycle`} />
        <Stat label="Projected utilization" value={`${m.projectedUtilization.toFixed(0)}%`} />
        <Stat label="Days until exhaustion" value={m.daysUntilExhaustion === null ? "—" : m.daysUntilExhaustion.toFixed(1)} sub={`day ${data.daysElapsed} of ${data.cycleDays}`} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Panel title="Daily consumption trend">
            <div className="h-64">
              <ResponsiveContainer>
                <AreaChart data={trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="date" fontSize={11} stroke="var(--muted-foreground)" />
                  <YAxis fontSize={11} stroke="var(--muted-foreground)" tickFormatter={k} />
                  <Tooltip formatter={(v: number) => fmt(v)} />
                  <Area dataKey="tokens" stroke="var(--chart-1)" fill="var(--chart-1)" fillOpacity={0.2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Panel>
        </div>
        <Panel title="My alerts">
          {data.alerts.length === 0 ? <p className="text-sm text-muted-foreground">No alerts yet.</p> : (
            <ul className="space-y-3 text-sm">
              {data.alerts.map((a) => (
                <li key={a.id} className="border-l-2 border-primary pl-3">
                  <div className="font-mono text-[11px] text-muted-foreground">{a.alert_type}</div>{a.message}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
      {data.requests?.length > 0 && (
        <Panel title="My token requests">
          <ul className="space-y-2 text-sm">{data.requests.map((r) => (
            <li key={r.id} className="flex justify-between gap-4">
              <span><span className="font-mono">{r.request_id}</span> · {fmt(r.requested_tokens)} · {r.reason}</span>
              <span className="font-mono">{r.status}</span>
            </li>
          ))}</ul>
        </Panel>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Request tokens</DialogTitle></DialogHeader>
          <form className="space-y-3" onSubmit={submit}>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Employee ID</label>
              <Input value={user.employee_id} readOnly disabled className="font-mono bg-muted" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Project</label>
              <Input value={`${user.project_id ?? "—"} · ${user.project_name ?? "Unassigned"}`} readOnly disabled className="bg-muted" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Required Tokens</label>
              <Input required type="number" min={1} value={tokens} onChange={(e) => setTokens(e.target.value)} placeholder="Required tokens" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Reason</label>
              <Textarea required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for token allocation" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Expected Usage</label>
              <Textarea value={usage} onChange={(e) => setUsage(e.target.value)} placeholder="Expected usage pattern" />
            </div>
            <Button type="submit" disabled={busy} className="w-full font-mono">{busy ? "Submitting…" : "SUBMIT REQUEST"}</Button>
            {data.microsoftFormUrl && <p className="text-xs text-muted-foreground">Microsoft Form will also open: {data.microsoftFormUrl}</p>}
          </form>
        </DialogContent>
      </Dialog>
    </Shell>
  );
}
