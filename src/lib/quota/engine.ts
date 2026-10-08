// Pure, rule-based quota intelligence engine (no ML). Shared by server functions and tests.

export type Risk = "NORMAL" | "UNDERUTILIZED" | "AT_RISK" | "CRITICAL" | "UNALLOCATED";

export interface Manager {
  id: number; manager_id: string; name: string; email: string; department: string; status: "active";
}
export interface Project {
  id: number; project_id: string; project_name: string; department: string; team: string; manager_id: number; status: "active";
}
export interface User {
  id: number;
  employee_id: string;
  name: string;
  email: string;
  department: string;
  team: string;
  manager_email: string;
  status: "active";
  project_id: number | null;
  manager_id: number | null;
}
export interface Admin { id: number; admin_id: string; name: string; email: string; status: "active" }
export interface Allocation {
  id: number; user_id: number; allocated_tokens: number;
  cycle_start: string; cycle_end: string; allocation_source: "initial" | "auto_reallocation" | "manager_approval";
}
export interface Consumption {
  id: number; user_id: number; consumption_date: string; tokens_consumed: number; model: string;
  input_tokens: number; output_tokens: number;
}
export interface Reallocation { id: number; from_user_id: number; to_user_id: number; tokens_transferred: number; reason: string; created_at: string }
export interface Alert { id: number; user_id: number | null; alert_type: string; message: string; recipient: string; created_at: string }
export interface AuditLog { id: number; action: string; user_id: number | null; details: string; created_at: string }
export interface ModelPricing { id: number; model: string; input_cost_per_1k: number; output_cost_per_1k: number }
export interface TokenRequest {
  id: number; request_id: string; user_id: number; project_id: number | null;
  requested_tokens: number; approved_tokens: number | null; reason: string; expected_usage: string;
  status: "PENDING" | "APPROVED" | "REJECTED"; rejection_reason: string | null;
  created_at: string; reviewed_at: string | null; reviewed_by: string | null;
}

export interface DB {
  users: User[]; admins: Admin[]; managers: Manager[]; projects: Project[];
  allocations: Allocation[]; consumption: Consumption[]; reallocations: Reallocation[];
  alerts: Alert[]; audit_logs: AuditLog[]; pricing: ModelPricing[]; requests: TokenRequest[];
  cycleDays: number; daysElapsed: number; cycleStart: string;
}

export interface Metrics {
  allocated: number; consumed: number; remaining: number; utilization: number;
  dailyUsage: number; projected: number; projectedUtilization: number;
  daysUntilExhaustion: number | null; risk: Risk; surplus: number; deficit: number;
}

export const MANAGERS: Omit<Manager, "id" | "status">[] = [
  { manager_id: "M001", name: "Nisha Patel", email: "nisha.patel@acme.example", department: "Enterprise Middleware" },
  { manager_id: "M002", name: "James Okonkwo", email: "james.okonkwo@acme.example", department: "IT & Technology" },
  { manager_id: "M003", name: "Sofia Alvarez", email: "sofia.alvarez@acme.example", department: "Infrastructure" },
  { manager_id: "M004", name: "Kenji Sato", email: "kenji.sato@acme.example", department: "Cybersecurity" },
  { manager_id: "M005", name: "Amara Diallo", email: "amara.diallo@acme.example", department: "Software Engineering" },
];

export const PROJECTS: { project_id: string; project_name: string; department: string; team: string; manager_id: string }[] = [
  { project_id: "P001", project_name: "Application Server Modernization", department: "Enterprise Middleware", team: "WebSphere Team", manager_id: "M001" },
  { project_id: "P002", project_name: "Enterprise Messaging Upgrade", department: "Enterprise Middleware", team: "Messaging Team", manager_id: "M001" },
  { project_id: "P003", project_name: "Secure File Transfer Migration", department: "Enterprise Middleware", team: "IBM Sterling Team", manager_id: "M001" },
  { project_id: "P004", project_name: "API Gateway Modernization", department: "Enterprise Middleware", team: "API Management Team", manager_id: "M002" },
  { project_id: "P005", project_name: "File Transfer as a Service", department: "Enterprise Middleware", team: "FTaaS Team", manager_id: "M002" },
  { project_id: "P006", project_name: "CI/CD Pipeline Automation", department: "IT & Technology", team: "DevOps Team", manager_id: "M002" },
  { project_id: "P007", project_name: "Linux Server Patching Automation", department: "Infrastructure", team: "Linux/UNIX Team", manager_id: "M003" },
  { project_id: "P008", project_name: "Server Lifecycle Management", department: "Infrastructure", team: "Server Management Team", manager_id: "M003" },
  { project_id: "P009", project_name: "Transaction Processing Platform", department: "Software Engineering", team: "Backend Team", manager_id: "M003" },
  { project_id: "P010", project_name: "Enterprise Identity Management", department: "Cybersecurity", team: "IAM Team", manager_id: "M004" },
  { project_id: "P011", project_name: "Real-Time Banking Data Pipeline", department: "Data & Analytics", team: "Data Engineering", manager_id: "M004" },
  { project_id: "P012", project_name: "Application Monitoring & Incident Management", department: "Operations", team: "Production Support", manager_id: "M004" },
  { project_id: "P013", project_name: "Cloud Infrastructure Migration", department: "IT & Technology", team: "Cloud Engineering", manager_id: "M005" },
  { project_id: "P014", project_name: "Security Monitoring Platform", department: "Cybersecurity", team: "Security Operations", manager_id: "M005" },
  { project_id: "P015", project_name: "Automated Testing Framework", department: "Software Engineering", team: "QA Team", manager_id: "M005" },
];

export const PRICING: Omit<ModelPricing, "id">[] = [
  { model: "github-copilot", input_cost_per_1k: 0.002, output_cost_per_1k: 0.008 },
];

export function riskFor(projectedUtilization: number): Risk {
  if (projectedUtilization < 50) return "UNDERUTILIZED";
  if (projectedUtilization <= 80) return "NORMAL";
  if (projectedUtilization <= 100) return "AT_RISK";
  return "CRITICAL";
}

export function computeMetrics(allocated: number, consumed: number, daysElapsed: number, cycleDays: number): Metrics {
  const dailyUsage = daysElapsed > 0 ? consumed / daysElapsed : 0;
  const projected = Math.round(dailyUsage * cycleDays);
  const remaining = allocated - consumed;
  if (allocated <= 0) {
    return {
      allocated, consumed, remaining, utilization: 0, dailyUsage, projected, projectedUtilization: 0,
      daysUntilExhaustion: null, risk: "UNALLOCATED", surplus: 0, deficit: 0,
    };
  }
  const utilization = (consumed / allocated) * 100;
  const projectedUtilization = (projected / allocated) * 100;
  const daysUntilExhaustion = dailyUsage > 0 ? Math.max(0, remaining / dailyUsage) : null;
  const risk = riskFor(projectedUtilization);
  return {
    allocated, consumed, remaining, utilization, dailyUsage, projected, projectedUtilization,
    daysUntilExhaustion, risk,
    surplus: risk === "UNDERUTILIZED" ? Math.max(0, allocated - projected) : 0,
    deficit: risk === "CRITICAL" ? Math.max(0, projected - allocated) : 0,
  };
}

export interface Transfer { from: number; to: number; tokens: number }

/**
 * Match donors (surplus) to recipients (deficit) under the safety rules:
 * never exceed recipient deficit, never take > 50% of donor's original allocation,
 * never reduce donor below its projected requirement, each surplus used once per run.
 */
export function planReallocations(
  donors: { userId: number; allocated: number; projected: number }[],
  recipients: { userId: number; deficit: number }[],
): { transfers: Transfer[]; unmet: { userId: number; deficit: number }[] } {
  const pool = donors
    .map((d) => ({ userId: d.userId, available: Math.max(0, Math.min(d.allocated - d.projected, Math.floor(d.allocated * 0.5))) }))
    .filter((d) => d.available > 0)
    .sort((a, b) => b.available - a.available);
  const transfers: Transfer[] = [];
  const unmet: { userId: number; deficit: number }[] = [];
  for (const r of [...recipients].sort((a, b) => b.deficit - a.deficit)) {
    let need = r.deficit;
    for (const d of pool) {
      if (need <= 0) break;
      if (d.available <= 0) continue;
      const amt = Math.min(need, d.available);
      d.available -= amt;
      need -= amt;
      transfers.push({ from: d.userId, to: r.userId, tokens: amt });
    }
    if (need > 0) unmet.push({ userId: r.userId, deficit: need });
  }
  return { transfers, unmet };
}

export function rowCost(c: Pick<Consumption, "model" | "input_tokens" | "output_tokens">, pricing: ModelPricing[]) {
  const p = pricing.find((x) => x.model === c.model);
  const inp = p?.input_cost_per_1k ?? 0.003;
  const out = p?.output_cost_per_1k ?? 0.01;
  return ((c.input_tokens || 0) / 1000) * inp + ((c.output_tokens || 0) / 1000) * out;
}

// ---------------- Seed ----------------
function rng(seed: number) {
  return () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
}
const FIRST = ["Aarav","Priya","Liam","Mei","Noah","Sofia","Ravi","Elena","Kenji","Amara","Lucas","Zara","Omar","Ines","Tariq","Hana","Diego","Leila","Ivan","Nora","Arjun","Maya","Felix","Yara","Theo"];
const LAST = ["Shah","Nakamura","Okafor","Rossi","Kim","Silva","Novak","Haddad","Iyer","Larsen"];
const MODELS = ["github-copilot"];
const ALLOC = 100_000;
const ZERO_USERS: { employee_id: string; name: string; project_id: string }[] = [
  { employee_id: "U0051", name: "Jordan Blake", project_id: "P001" },
  { employee_id: "U0052", name: "Samira Khan", project_id: "P006" },
  { employee_id: "U0053", name: "Wei Chen", project_id: "P008" },
  { employee_id: "U0054", name: "Luca Bianchi", project_id: "P011" },
  { employee_id: "U0055", name: "Aisha Rahman", project_id: "P015" },
];

export function seed(): DB {
  const r = rng(42);
  const cycleDays = 30, daysElapsed = 15;
  const cycleStart = "2026-10-01";
  const date = (d: number) => new Date(Date.parse(cycleStart) + d * 86400000).toISOString().slice(0, 10);
  const bands: [number, number][] = [
    ...Array(25).fill([55, 78]), ...Array(10).fill([20, 45]), ...Array(10).fill([83, 98]), ...Array(5).fill([115, 160]),
  ];
  const order = bands.map((b, i) => ({ b, k: r(), i })).sort((a, b) => a.k - b.k).map((x) => x.b);
  const db: DB = {
    users: [], admins: [], managers: [], projects: [], allocations: [], consumption: [],
    reallocations: [], alerts: [], audit_logs: [], pricing: [], requests: [],
    cycleDays, daysElapsed, cycleStart,
  };
  MANAGERS.forEach((m, i) => db.managers.push({ id: i + 1, ...m, status: "active" }));
  const mgrByCode = new Map(db.managers.map((m) => [m.manager_id, m]));
  PROJECTS.forEach((p, i) => db.projects.push({
    id: i + 1, project_id: p.project_id, project_name: p.project_name, department: p.department,
    team: p.team, manager_id: mgrByCode.get(p.manager_id)!.id, status: "active",
  }));
  PRICING.forEach((p, i) => db.pricing.push({ id: i + 1, ...p }));

  let cid = 1;
  order.forEach(([lo, hi], i) => {
    const id = i + 1;
    const project = db.projects[i % db.projects.length]!;
    const mgr = db.managers.find((m) => m.id === project.manager_id)!;
    const name = `${FIRST[i % FIRST.length]} ${LAST[(i * 7) % LAST.length]}`;
    db.users.push({
      id, employee_id: `U${String(id).padStart(4, "0")}`, name,
      email: `${name.toLowerCase().replace(" ", ".")}@acme.example`,
      department: project.department, team: project.team, manager_email: mgr.email, status: "active",
      project_id: project.id, manager_id: mgr.id,
    });
    db.allocations.push({ id, user_id: id, allocated_tokens: ALLOC, cycle_start: cycleStart, cycle_end: date(cycleDays - 1), allocation_source: "initial" });
    const targetDaily = ((lo + r() * (hi - lo)) / 100) * ALLOC / cycleDays;
    for (let d = 0; d < daysElapsed; d++) {
      const total = Math.round(targetDaily * (0.85 + r() * 0.3));
      const input_tokens = Math.round(total * 0.4);
      db.consumption.push({
        id: cid++, user_id: id, consumption_date: date(d), tokens_consumed: total,
        model: MODELS[Math.floor(r() * MODELS.length)]!, input_tokens, output_tokens: total - input_tokens,
      });
    }
  });
  ZERO_USERS.forEach((z, i) => {
    const id = 51 + i;
    const project = db.projects.find((p) => p.project_id === z.project_id)!;
    const mgr = db.managers.find((m) => m.id === project.manager_id)!;
    db.users.push({
      id, employee_id: z.employee_id, name: z.name,
      email: `${z.name.toLowerCase().replace(" ", ".")}@acme.example`,
      department: project.department, team: project.team, manager_email: mgr.email, status: "active",
      project_id: project.id, manager_id: mgr.id,
    });
    db.allocations.push({ id: nextId(db.allocations), user_id: id, allocated_tokens: 0, cycle_start: cycleStart, cycle_end: date(cycleDays - 1), allocation_source: "initial" });
    if (z.employee_id === "U0054" || z.employee_id === "U0055") {
      for (let d = 0; d < 3; d++) {
        const total = 20 + Math.round(r() * 50);
        const input_tokens = Math.round(total * 0.4);
        db.consumption.push({
          id: cid++, user_id: id, consumption_date: date(d), tokens_consumed: total,
          model: MODELS[Math.floor(r() * MODELS.length)]!, input_tokens, output_tokens: total - input_tokens,
        });
      }
    }
  });
  db.requests.push({
    id: 1, request_id: "TR-0001", user_id: 51, project_id: db.users.find((u) => u.employee_id === "U0051")!.project_id,
    requested_tokens: 100000, approved_tokens: null,
    reason: "New joiner onboarding — need Copilot/GPT quota for Application Server Modernization.",
    expected_usage: "Daily code assist and design reviews, ~4k tokens/day.",
    status: "PENDING", rejection_reason: null, created_at: `${cycleStart}T09:00:00.000Z`, reviewed_at: null, reviewed_by: null,
  });
  ["Grace Hopper", "Alan Turing", "Ada Lovelace"].forEach((n, i) =>
    db.admins.push({ id: i + 1, admin_id: `A${String(i + 1).padStart(4, "0")}`, name: n, email: `${n.split(" ")[0]!.toLowerCase()}@acme.example`, status: "active" }));
  return db;
}

export function nextId(arr: { id: number }[]) {
  return (arr.length ? Math.max(...arr.map((x) => x.id)) : 0) + 1;
}

export function allocatedFor(db: DB, userId: number) {
  return db.allocations.filter((a) => a.user_id === userId).reduce((s, a) => s + a.allocated_tokens, 0);
}
export function consumedFor(db: DB, userId: number) {
  return db.consumption.filter((c) => c.user_id === userId).reduce((s, a) => s + a.tokens_consumed, 0);
}
export function metricsFor(db: DB, userId: number) {
  return computeMetrics(allocatedFor(db, userId), consumedFor(db, userId), db.daysElapsed, db.cycleDays);
}

export function runQuotaAnalysis(db: DB, userIds?: number[]) {
  const now = new Date().toISOString();
  const alert = (user_id: number | null, alert_type: string, recipient: string, message: string) =>
    db.alerts.push({ id: nextId(db.alerts), user_id, alert_type, recipient, message, created_at: now });
  const audit = (action: string, user_id: number | null, details: string) =>
    db.audit_logs.push({ id: nextId(db.audit_logs), action, user_id, details, created_at: now });

  const scope = userIds ? new Set(userIds) : null;
  const all = db.users
    .filter((u) => !scope || scope.has(u.id))
    .map((u) => ({ u, m: metricsFor(db, u.id) }));
  const eligible = all.filter((x) => x.m.allocated > 0);
  const donors = eligible.filter((x) => x.m.risk === "UNDERUTILIZED");
  const recipients = eligible.filter((x) => x.m.risk === "CRITICAL");
  const plan = planReallocations(
    donors.map((x) => ({ userId: x.u.id, allocated: x.m.allocated, projected: x.m.projected })),
    recipients.map((x) => ({ userId: x.u.id, deficit: x.m.deficit })),
  );
  const byId = new Map(db.users.map((u) => [u.id, u]));
  for (const t of plan.transfers) {
    const from = byId.get(t.from)!, to = byId.get(t.to)!;
    const base = { cycle_start: db.cycleStart, cycle_end: db.allocations[0]!.cycle_end, allocation_source: "auto_reallocation" as const };
    db.allocations.push({ id: nextId(db.allocations), user_id: from.id, allocated_tokens: -t.tokens, ...base });
    db.allocations.push({ id: nextId(db.allocations), user_id: to.id, allocated_tokens: t.tokens, ...base });
    db.reallocations.push({ id: nextId(db.reallocations), from_user_id: from.id, to_user_id: to.id, tokens_transferred: t.tokens, reason: "Projected quota exhaustion", created_at: now });
    audit("AUTO_REALLOCATION", to.id, `${t.tokens.toLocaleString()} tokens moved from ${from.employee_id} to ${to.employee_id}`);
    alert(to.id, "QUOTA_INCREASED", to.email, `Your projected usage exceeded your quota. ${t.tokens.toLocaleString()} tokens were automatically added to your allocation.`);
    alert(to.id, "MANAGER_REALLOCATION", to.manager_email, `User ${to.employee_id} is projected to exceed their quota. ${t.tokens.toLocaleString()} tokens were automatically reallocated from underutilized user ${from.employee_id}.`);
    alert(from.id, "QUOTA_REDUCED", from.email, `${t.tokens.toLocaleString()} unused tokens from your allocation were redistributed. Your projected needs are still fully covered.`);
  }
  for (const u of plan.unmet) {
    const user = byId.get(u.userId)!;
    audit("INSUFFICIENT_SURPLUS", user.id, `Unmet deficit of ${u.deficit.toLocaleString()} tokens`);
    alert(user.id, "INSUFFICIENT_SURPLUS", user.manager_email, `Insufficient surplus quota available. User ${user.employee_id} still needs ${u.deficit.toLocaleString()} tokens.`);
  }
  for (const { u, m } of eligible) {
    if (m.risk === "AT_RISK") {
      alert(u.id, "AT_RISK_WARNING", u.email, "Your AI token usage is higher than expected. Based on your current usage, your quota may be exhausted before the allocation cycle ends.");
      alert(u.id, "AT_RISK_WARNING", u.manager_email, `User ${u.employee_id} is projected to use ${m.projectedUtilization.toFixed(0)}% of their allocation.`);
    }
    if (m.risk === "UNDERUTILIZED") {
      alert(u.id, "UNDERUTILIZATION", u.manager_email, `User ${u.employee_id} is projected to use only ${m.projectedUtilization.toFixed(0)}% of their allocation. ${m.surplus.toLocaleString()} tokens are identified as potential surplus.`);
    }
  }
  const moved = plan.transfers.reduce((s, t) => s + t.tokens, 0);
  audit("QUOTA_ANALYSIS_RUN", null, `Analyzed ${eligible.length} users, ${plan.transfers.length} transfers, ${moved.toLocaleString()} tokens moved`);
  return { analyzed: eligible.length, transfers: plan.transfers.length, tokensMoved: moved, unmet: plan.unmet.length };
}
