import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { queryOptions, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  Bar as RBar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { api } from "@/lib/quota/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NavTabs, Panel, RiskBadge, Shell, Stat, fmt, k, td, th } from "@/components/quota/ui";

const q = (id: string) => queryOptions({ queryKey: ["manager", id], queryFn: () => api.managerDashboard(id) });

export const Route = createFileRoute("/manager/$id")({
  loader: async ({ context, params }) => {
    const d = await context.queryClient.ensureQueryData(q(params.id));
    if (!d) throw notFound();
  },
  head: () => ({
    meta: [
      { title: "Manager — Tokenwise" },
      { name: "description", content: "Manager view of assigned projects, employees, quota intelligence and token requests." },
    ],
  }),
  notFoundComponent: () => (
    <div className="p-10 text-center">Manager not found. <Link to="/" className="text-primary underline">Back</Link></div>
  ),
  component: ManagerPage,
});

const axis = { fontSize: 11, stroke: "var(--muted-foreground)" };
const TABS = [
  { id: "dashboard", label: "Dashboard" },
  { id: "projects", label: "Projects" },
  { id: "employees", label: "Employees" },
  { id: "requests", label: "Token Requests" },
  { id: "risks", label: "Risk Users" },
  { id: "under", label: "Underutilized" },
  { id: "reallocations", label: "Reallocations" },
  { id: "intelligence", label: "Run Quota Intelligence" },
];

function ManagerPage() {
  const { id } = Route.useParams();
  const { data } = useSuspenseQuery(q(id));
  const qc = useQueryClient();
  const [tab, setTab] = useState("dashboard");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const [approved, setApproved] = useState<Record<string, string>>({});
  const [rejectReason, setRejectReason] = useState<Record<string, string>>({});
  if (!data) return null;
  const c = data.cards;

  const run = async () => {
    setBusy(true);
    try {
      const r = await api.analyze(id);
      await qc.invalidateQueries();
      setResult(
        `Analyzed ${r.analyzed} users · ${r.transfers} automatic transfers · ${fmt(r.tokensMoved)} tokens redistributed` +
          (r.unmet ? ` · Insufficient surplus quota available for ${r.unmet} user(s).` : ""),
      );
    } finally {
      setBusy(false);
    }
  };

  const decide = async (requestId: string, action: "approve" | "reject") => {
    try {
      if (action === "approve") {
        const n = Number(approved[requestId] || 0);
        await api.approveRequest(requestId, id, n);
      } else {
        await api.rejectRequest(requestId, id, rejectReason[requestId] || "");
      }
      await qc.invalidateQueries();
    } catch (e) {
      setResult(e instanceof Error ? e.message : "Request failed");
    }
  };

  return (
    <Shell who={`${data.manager.manager_id} · ${data.manager.name}`} role="Manager" nav={<NavTabs items={TABS} value={tab} onChange={setTab} />}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="font-mono text-xs text-muted-foreground">{data.manager.department}</div>
          <h1 className="text-3xl font-bold">My projects</h1>
        </div>
        <Button onClick={run} disabled={busy} className="font-mono tracking-wide">{busy ? "Analyzing…" : "RUN QUOTA INTELLIGENCE"}</Button>
      </div>
      {result && <div className="rounded-lg border bg-accent p-3 text-sm text-accent-foreground">{result}</div>}

      {tab === "dashboard" && (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
            <Stat label="My projects" value={c.projects} />
            <Stat label="Total employees" value={c.employees} />
            <Stat label="Allocated tokens" value={k(c.allocated)} />
            <Stat label="Consumed tokens" value={k(c.consumed)} />
            <Stat label="Utilization" value={`${(c.allocated > 0 ? (c.consumed / c.allocated) * 100 : 0).toFixed(1)}%`} />
            <Stat label="Remaining tokens" value={k(c.remaining)} />
            <Stat label="At-risk users" value={<span className="text-risk-critical">{c.atRisk}</span>} />
            <Stat label="Underutilized users" value={<span className="text-risk-under">{c.under}</span>} />
            <Stat label="Pending token requests" value={c.pendingRequests} />
            <Stat label="Reallocations" value={c.reallocations} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Token consumption trend">
              <div className="h-60"><ResponsiveContainer>
                <LineChart data={data.trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="date" {...axis} /><YAxis {...axis} tickFormatter={k} />
                  <Tooltip formatter={(v: number) => fmt(v)} />
                  <Line dataKey="tokens" stroke="var(--chart-1)" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer></div>
            </Panel>
            <Panel title="Allocation vs consumption by project">
              <div className="h-60"><ResponsiveContainer>
                <BarChart data={data.byProject}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="name" {...axis} hide /><YAxis {...axis} tickFormatter={k} />
                  <Tooltip formatter={(v: number) => fmt(v)} /><Legend />
                  <RBar dataKey="allocated" fill="var(--chart-3)" /><RBar dataKey="consumed" fill="var(--chart-2)" />
                </BarChart>
              </ResponsiveContainer></div>
            </Panel>
          </div>
          <RiskTable rows={data.risks} />
          <UnderTable rows={data.under} />
          <ReallocPanel rows={data.reallocations} />
        </>
      )}

      {tab === "projects" && (
        <div className="space-y-4">
          <Panel title="My projects (Click a project to view its employees)">
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead><tr className="border-b">{["Project", "Employee Count", "Allocated", "Consumed", "Remaining", "Utilization"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
              <tbody>{data.projects.map((p) => {
                const isSelected = selectedProjectId === p.project_id;
                const rem = p.remaining ?? (p.allocated - p.consumed);
                const util = p.utilization ?? (p.allocated > 0 ? (p.consumed / p.allocated) * 100 : 0);
                return (
                  <tr
                    key={p.id}
                    onClick={() => setSelectedProjectId(isSelected ? null : p.project_id)}
                    className={`border-b last:border-0 cursor-pointer transition-colors hover:bg-muted/50 ${isSelected ? "bg-muted font-medium" : ""}`}
                  >
                    <td className={td}>
                      <span className="font-mono text-xs font-semibold mr-2">{p.project_id}</span>
                      {p.project_name}
                    </td>
                    <td className={td}>{p.employee_count}</td>
                    <td className={td}>{fmt(p.allocated)}</td>
                    <td className={td}>{fmt(p.consumed)}</td>
                    <td className={td}>{fmt(rem)}</td>
                    <td className={td}>{util.toFixed(1)}%</td>
                  </tr>
                );
              })}</tbody>
            </table></div>
          </Panel>

          {(() => {
            const projectEmployees = selectedProjectId
              ? data.employees.filter((e) => e.project_id === selectedProjectId)
              : data.employees;
            const selectedProj = data.projects.find((p) => p.project_id === selectedProjectId);
            return (
              <Panel
                title={
                  selectedProj
                    ? `Employees in ${selectedProj.project_name} (${projectEmployees.length})`
                    : `Employees across all projects (${projectEmployees.length}) — click any project row above to filter`
                }
              >
                <div className="overflow-x-auto"><table className="w-full text-sm">
                  <thead><tr className="border-b">{["Employee", "Project", "Allocated", "Consumed", "Remaining", "Utilization", "Projected Usage", "Risk"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
                  <tbody>{projectEmployees.map((r) => (
                    <tr key={r.id} className="border-b last:border-0">
                      <td className={td}><span className="font-mono">{r.employee_id}</span> {r.name}</td>
                      <td className={td}>{r.project_name ?? "—"}</td>
                      <td className={td}>{fmt(r.m.allocated)}</td>
                      <td className={td}>{fmt(r.m.consumed)}</td>
                      <td className={td}>{fmt(r.m.remaining)}</td>
                      <td className={td}>{r.m.utilization.toFixed(1)}%</td>
                      <td className={td}>{fmt(r.m.projected)}</td>
                      <td className={td}><RiskBadge risk={r.m.risk} /></td>
                    </tr>
                  ))}</tbody>
                </table></div>
              </Panel>
            );
          })()}
        </div>
      )}

      {tab === "employees" && (
        <Panel title="My employees">
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="border-b">{["Employee","Name","Project","Allocated","Consumed","Utilization","Remaining","Risk"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
            <tbody>{data.employees.map((r) => (
              <tr key={r.id} className="border-b last:border-0">
                <td className={`${td} font-mono`}>{r.employee_id}</td>
                <td className={td}>{r.name}</td>
                <td className={td}>{r.project_name ?? "—"}</td>
                <td className={td}>{fmt(r.m.allocated)}</td>
                <td className={td}>{fmt(r.m.consumed)}</td>
                <td className={`${td} font-medium`}>{r.m.utilization.toFixed(1)}%</td>
                <td className={td}>{fmt(r.m.remaining)}</td>
                <td className={td}><RiskBadge risk={r.m.risk} /></td>
              </tr>
            ))}</tbody>
          </table></div>
        </Panel>
      )}

      {tab === "requests" && (
        <Panel title="Token requests">
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="border-b">{["Request ID","Employee","Project","Requested","Reason","Date","Status","Action"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
            <tbody>{data.requests.map((r) => (
              <tr key={r.id} className="border-b last:border-0 align-top">
                <td className={`${td} font-mono`}>{r.request_id}</td>
                <td className={td}><span className="font-mono">{r.employee_id}</span> {r.employee_name}</td>
                <td className={td}>{r.project_name}</td>
                <td className={td}>{fmt(r.requested_tokens)}</td>
                <td className={`${td} max-w-xs whitespace-normal`}>{r.reason}</td>
                <td className={td}>{String(r.created_at).slice(0, 10)}</td>
                <td className={`${td} font-mono`}>{r.status}</td>
                <td className={td}>
                  {r.status === "PENDING" ? (
                    <div className="space-y-2 min-w-[200px]">
                      <div className="text-xs text-muted-foreground font-mono">Requested: {fmt(r.requested_tokens)}</div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground whitespace-nowrap">Approved Tokens:</span>
                        <Input
                          placeholder="Approved tokens"
                          className="h-8 w-32 font-mono"
                          value={approved[r.request_id] ?? String(r.requested_tokens)}
                          onChange={(e) => setApproved((s) => ({ ...s, [r.request_id]: e.target.value }))}
                        />
                      </div>
                      <Input
                        placeholder="Reject reason (if rejecting)"
                        className="h-8 w-full text-xs"
                        value={rejectReason[r.request_id] ?? ""}
                        onChange={(e) => setRejectReason((s) => ({ ...s, [r.request_id]: e.target.value }))}
                      />
                      <div className="flex gap-2 pt-1">
                        <Button size="sm" className="font-mono" onClick={() => decide(r.request_id, "approve")}>APPROVE</Button>
                        <Button size="sm" variant="outline" className="font-mono" onClick={() => decide(r.request_id, "reject")}>REJECT</Button>
                      </div>
                    </div>
                  ) : r.status === "APPROVED" ? (
                    <span className="font-mono text-xs font-semibold text-green-600">APPROVED (+{fmt(r.approved_tokens ?? 0)})</span>
                  ) : (
                    <span className="font-mono text-xs text-destructive">REJECTED {r.rejection_reason ? `(${r.rejection_reason})` : ""}</span>
                  )}
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        </Panel>
      )}

      {tab === "risks" && <RiskTable rows={data.risks} />}
      {tab === "under" && <UnderTable rows={data.under} />}
      {tab === "reallocations" && <ReallocPanel rows={data.reallocations} />}

      {tab === "intelligence" && (
        <Panel title="Quota Intelligence & Automatic Reallocation">
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Run automated quota intelligence for your assigned projects and employees. The engine forecasts cycle-end quota exhaustion based on consumption rates, identifies underutilized surplus pools, and automatically plans transfers to prevent critical depletion.
            </p>
            <div>
              <Button onClick={run} disabled={busy} className="font-mono tracking-wide">
                {busy ? "Analyzing…" : "RUN QUOTA INTELLIGENCE NOW"}
              </Button>
            </div>
            {result && <div className="rounded-lg border bg-accent p-3 text-sm text-accent-foreground">{result}</div>}
            <div className="pt-2">
              <ReallocPanel rows={data.reallocations} />
            </div>
          </div>
        </Panel>
      )}
    </Shell>
  );
}

function RiskTable({ rows }: { rows: { id: number; employee_id: string; name: string; department: string; team: string; m: { allocated: number; consumed: number; utilization: number; projected: number; projectedUtilization: number; risk: "NORMAL" | "UNDERUTILIZED" | "AT_RISK" | "CRITICAL" | "UNALLOCATED"; deficit: number } }[] }) {
  return (
    <Panel title={`At-risk users (${rows.length})`}>
      <div className="overflow-x-auto"><table className="w-full text-sm">
        <thead><tr className="border-b">{["Employee","Department","Team","Allocated","Consumed","Utilization","Projected","Proj. util.","Risk","Recommended +"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.id} className="border-b last:border-0">
            <td className={td}><span className="font-mono">{r.employee_id}</span> {r.name}</td>
            <td className={td}>{r.department}</td><td className={td}>{r.team}</td>
            <td className={td}>{fmt(r.m.allocated)}</td><td className={td}>{fmt(r.m.consumed)}</td>
            <td className={`${td} font-medium`}>{r.m.utilization.toFixed(1)}%</td>
            <td className={td}>{fmt(r.m.projected)}</td><td className={td}>{r.m.projectedUtilization.toFixed(0)}%</td>
            <td className={td}><RiskBadge risk={r.m.risk} /></td>
            <td className={td}>{r.m.deficit ? fmt(r.m.deficit) : "—"}</td>
          </tr>
        ))}</tbody>
      </table></div>
    </Panel>
  );
}

function UnderTable({ rows }: { rows: { id: number; employee_id: string; name: string; department: string; team: string; m: { allocated: number; consumed: number; utilization: number; projected: number; surplus: number } }[] }) {
  return (
    <Panel title={`Underutilized users (${rows.length})`}>
      <div className="overflow-x-auto"><table className="w-full text-sm">
        <thead><tr className="border-b">{["Employee","Department","Team","Allocated","Consumed","Utilization","Projected","Expected surplus"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.id} className="border-b last:border-0">
            <td className={td}><span className="font-mono">{r.employee_id}</span> {r.name}</td>
            <td className={td}>{r.department}</td><td className={td}>{r.team}</td>
            <td className={td}>{fmt(r.m.allocated)}</td><td className={td}>{fmt(r.m.consumed)}</td>
            <td className={`${td} font-medium`}>{r.m.utilization.toFixed(1)}%</td>
            <td className={td}>{fmt(r.m.projected)}</td><td className={`${td} text-risk-under`}>{fmt(r.m.surplus)}</td>
          </tr>
        ))}</tbody>
      </table></div>
    </Panel>
  );
}

function ReallocPanel({ rows }: { rows: { id: number; from?: string | undefined; to?: string | undefined; tokens_transferred: number }[] }) {
  return (
    <Panel title="Automatic reallocations">
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">None yet — run quota intelligence.</p> : (
        <ul className="space-y-2 text-sm">{rows.map((r) => (
          <li key={r.id} className="flex justify-between font-mono"><span>{r.from} → {r.to}</span><span className="text-primary">{fmt(r.tokens_transferred)}</span></li>
        ))}</ul>
      )}
    </Panel>
  );
}
