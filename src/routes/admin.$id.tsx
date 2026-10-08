import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { queryOptions, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  Bar as RBar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { api } from "@/lib/quota/api";
import { Button } from "@/components/ui/button";
import { NavTabs, Panel, RiskBadge, Shell, Stat, fmt, k, td, th, usd } from "@/components/quota/ui";

const q = (id: string) => queryOptions({ queryKey: ["admin", id], queryFn: () => api.adminDashboard(id) });
const auditQ = () => queryOptions({ queryKey: ["audit-logs"], queryFn: () => api.auditLogs() });

export const Route = createFileRoute("/admin/$id")({
  loader: async ({ context, params }) => {
    const d = await context.queryClient.ensureQueryData(q(params.id));
    if (!d) throw notFound();
  },
  head: () => ({
    meta: [
      { title: "Admin — Tokenwise" },
      { name: "description", content: "Organization-wide users, managers, projects, allocations, consumption and AI cost." },
    ],
  }),
  notFoundComponent: () => (
    <div className="p-10 text-center">Admin not found. <Link to="/" className="text-primary underline">Back</Link></div>
  ),
  component: AdminPage,
});

const axis = { fontSize: 11, stroke: "var(--muted-foreground)" };
const TABS = [
  { id: "dashboard", label: "Dashboard" },
  { id: "users", label: "Users" },
  { id: "managers", label: "Managers" },
  { id: "projects", label: "Projects" },
  { id: "allocations", label: "Allocations" },
  { id: "consumption", label: "Consumption" },
  { id: "audit", label: "Audit Logs" },
];

function AdminPage() {
  const { id } = Route.useParams();
  const { data } = useSuspenseQuery(q(id));
  const [tab, setTab] = useState("dashboard");
  const audit = useQuery({ ...auditQ(), enabled: tab === "audit" });

  if (!data) return null;
  const c = data.cards;

  return (
    <Shell who={`${data.admin.admin_id} · ${data.admin.name}`} role="Admin" nav={<NavTabs items={TABS} value={tab} onChange={setTab} />}>
      {tab === "dashboard" && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="font-mono text-xs text-muted-foreground">Organization</div>
              <h1 className="text-3xl font-bold">Admin</h1>
            </div>
            <Button variant="outline" className="font-mono tracking-wide" onClick={() => setTab("audit")}>VIEW AUDIT LOGS</Button>
          </div>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Stat label="Users" value={c.users} />
            <Stat label="Managers" value={c.managers} />
            <Stat label="Projects" value={c.projects} />
            <Stat label="Departments" value={c.departments} />
            <Stat label="Allocated" value={k(c.allocated)} />
            <Stat label="Consumed" value={k(c.consumed)} />
            <Stat label="Remaining" value={k(c.remaining)} />
            <Stat label="Total AI cost" value={usd(c.totalCost)} />
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

            <Panel title="Department → Estimated AI Cost">
              <div className="h-60"><ResponsiveContainer>
                <BarChart data={data.deptCost}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="department" {...axis} /><YAxis {...axis} tickFormatter={(v) => `$${v}`} />
                  <Tooltip formatter={(v: number) => usd(v)} />
                  <RBar dataKey="cost" name="Estimated Cost" fill="var(--chart-2)" />
                </BarChart>
              </ResponsiveContainer></div>
            </Panel>
          </div>

          <Panel title="Department-wise cost">
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead><tr className="border-b">{["Department", "Tokens Consumed", "Estimated Cost"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
              <tbody>{data.deptCost?.map((d) => (
                <tr key={d.department} className="border-b last:border-0">
                  <td className={td}>{d.department}</td>
                  <td className={td}>{fmt(d.tokens)}</td>
                  <td className={`${td} font-medium`}>{usd(d.cost)}</td>
                </tr>
              ))}</tbody>
            </table></div>
          </Panel>
        </>
      )}

      {tab === "users" && (
        <Panel title={`Users (${data.users.length})`}>
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="border-b">{["Employee","Name","Project","Department","Team","Manager","Allocated","Consumed","Risk"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
            <tbody>{data.users.map((r) => (
              <tr key={r.id} className="border-b last:border-0">
                <td className={`${td} font-mono`}>{r.employee_id}</td>
                <td className={td}>{r.name}</td>
                <td className={td}>{r.project_name ?? "—"}</td>
                <td className={td}>{r.department}</td>
                <td className={td}>{r.team}</td>
                <td className={`${td} font-mono`}>{r.manager_code ?? "—"}</td>
                <td className={td}>{fmt(r.m.allocated)}</td>
                <td className={td}>{fmt(r.m.consumed)}</td>
                <td className={td}><RiskBadge risk={r.m.risk} /></td>
              </tr>
            ))}</tbody>
          </table></div>
        </Panel>
      )}

      {tab === "managers" && (
        <Panel title={`Managers (${data.managers.length})`}>
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="border-b">{["ID","Name","Department","Projects","Employees","Allocated","Consumed"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
            <tbody>{data.managers.map((m) => (
              <tr key={m.id} className="border-b last:border-0">
                <td className={`${td} font-mono`}>{m.manager_id}</td>
                <td className={td}>{m.name}</td>
                <td className={td}>{m.department}</td>
                <td className={td}>{m.project_count} · {m.projects.join(", ")}</td>
                <td className={td}>{m.employee_count}</td>
                <td className={td}>{fmt(m.allocated)}</td>
                <td className={td}>{fmt(m.consumed)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </Panel>
      )}

      {tab === "projects" && (
        <Panel title={`Projects (${data.projects.length})`}>
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="border-b">{["ID","Project","Department","Team","Manager","Employees","Allocated","Consumed","Status"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
            <tbody>{data.projects.map((p) => (
              <tr key={p.id} className="border-b last:border-0">
                <td className={`${td} font-mono`}>{p.project_id}</td>
                <td className={td}>{p.project_name}</td>
                <td className={td}>{p.department}</td>
                <td className={td}>{p.team}</td>
                <td className={td}><span className="font-mono">{p.manager_code}</span> {p.manager_name}</td>
                <td className={td}>{p.employee_count}</td>
                <td className={td}>{fmt(p.allocated)}</td>
                <td className={td}>{fmt(p.consumed)}</td>
                <td className={td}>{p.status}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </Panel>
      )}

      {tab === "allocations" && (
        <Panel title="Allocations">
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="border-b">{["Employee","Tokens","Cycle start","Cycle end","Source"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
            <tbody>{data.allocations.map((a) => (
              <tr key={a.id} className="border-b last:border-0">
                <td className={`${td} font-mono`}>{a.employee_id} {a.employee_name}</td>
                <td className={td}>{fmt(a.allocated_tokens)}</td>
                <td className={td}>{a.cycle_start}</td>
                <td className={td}>{a.cycle_end}</td>
                <td className={`${td} font-mono`}>{a.allocation_source}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </Panel>
      )}

      {tab === "consumption" && (
        <Panel title="Consumption">
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="border-b">{["Date","Employee","Project","Model","Input","Output","Total","Est. cost"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
            <tbody>{data.consumption.map((c) => (
              <tr key={c.id} className="border-b last:border-0">
                <td className={td}>{c.consumption_date}</td>
                <td className={`${td} font-mono`}>{c.employee_id}</td>
                <td className={td}>{c.project_name ?? "—"}</td>
                <td className={`${td} font-mono`}>{c.model}</td>
                <td className={td}>{fmt(c.input_tokens)}</td>
                <td className={td}>{fmt(c.output_tokens)}</td>
                <td className={td}>{fmt(c.total_tokens)}</td>
                <td className={td}>{usd(c.estimated_cost)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </Panel>
      )}

      {tab === "audit" && (
        <Panel title="Audit logs">
          {!audit.data?.length ? <p className="text-sm text-muted-foreground">Empty. Manager quota runs and token approvals write here.</p> : (
            <ul className="space-y-2 text-sm">{audit.data.map((a) => (
              <li key={a.id} className="border-l-2 border-primary pl-3">
                <div className="font-mono text-[11px] text-muted-foreground">{a.created_at} · {a.action}</div>
                {a.details}
              </li>
            ))}</ul>
          )}
        </Panel>
      )}
    </Shell>
  );
}
