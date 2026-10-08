import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getDB, resetDB } from "./store.server";
import { metricsFor, nextId, rowCost, runQuotaAnalysis, type DB, type TokenRequest, type User } from "./engine";

const idSchema = z.object({ id: z.string().trim().toUpperCase().max(10) });
const formUrl = () => (typeof process !== "undefined" ? process.env["MICROSOFT_FORM_URL"] || process.env["VITE_MICROSOFT_FORM_URL"] || "" : "") || "";

function enrichUser(db: DB, u: User) {
  const p = db.projects.find((x) => x.id === u.project_id);
  const m = db.managers.find((x) => x.id === u.manager_id);
  return {
    id: u.id, employee_id: u.employee_id, name: u.name, email: u.email,
    department: u.department, team: u.team, manager_email: u.manager_email, status: u.status,
    project_id: p?.project_id ?? null, project_name: p?.project_name ?? null,
    manager_code: m?.manager_id ?? null, manager_name: m?.name ?? null,
  };
}

function requestDict(db: DB, r: TokenRequest) {
  const u = db.users.find((x) => x.id === r.user_id);
  const p = db.projects.find((x) => x.id === r.project_id);
  return {
    ...r,
    employee_id: u?.employee_id ?? null,
    employee_name: u?.name ?? null,
    project_code: p?.project_id ?? null,
    project_name: p?.project_name ?? null,
    department: p?.department ?? u?.department ?? null,
    team: p?.team ?? u?.team ?? null,
  };
}

function rowsFor(db: DB, users: User[]) {
  return users.map((u) => ({ ...enrichUser(db, u), m: metricsFor(db, u.id) }));
}

function group(rows: ReturnType<typeof rowsFor>, key: "department" | "project_name" | "team") {
  const map = new Map<string, { name: string; allocated: number; consumed: number }>();
  for (const r of rows) {
    const name = (r[key] as string | null) || "Unassigned";
    const g = map.get(name) ?? { name, allocated: 0, consumed: 0 };
    g.allocated += r.m.allocated; g.consumed += r.m.consumed; map.set(name, g);
  }
  return [...map.values()];
}

function trend(db: DB, userIds?: Set<number>) {
  const map = new Map<string, number>();
  for (const c of db.consumption) {
    if (userIds && !userIds.has(c.user_id)) continue;
    map.set(c.consumption_date, (map.get(c.consumption_date) ?? 0) + c.tokens_consumed);
  }
  return [...map.entries()].sort().map(([date, tokens]) => ({ date: date.slice(5), tokens }));
}

function risks(rows: ReturnType<typeof rowsFor>) {
  const order: Record<string, number> = { CRITICAL: 0, AT_RISK: 1 };
  return rows.filter((r) => r.m.risk in order)
    .sort((a, b) => (order[a.m.risk] === order[b.m.risk] ? b.m.projectedUtilization - a.m.projectedUtilization : order[a.m.risk]! - order[b.m.risk]!));
}

function under(rows: ReturnType<typeof rowsFor>) {
  return rows.filter((r) => r.m.risk === "UNDERUTILIZED").sort((a, b) => b.m.surplus - a.m.surplus);
}

function reallocations(db: DB, userIds?: Set<number>) {
  const emp = new Map(db.users.map((u) => [u.id, u.employee_id]));
  return db.reallocations.slice().reverse()
    .filter((r) => !userIds || userIds.has(r.from_user_id) || userIds.has(r.to_user_id))
    .map((r) => ({ ...r, from: emp.get(r.from_user_id), to: emp.get(r.to_user_id) }));
}

function managerSummary(db: DB, rows: ReturnType<typeof rowsFor>) {
  return db.managers.map((m) => {
    const mine = rows.filter((r) => r.manager_code === m.manager_id);
    const projects = db.projects.filter((p) => p.manager_id === m.id);
    return {
      ...m, project_count: projects.length, employee_count: mine.length,
      allocated: mine.reduce((s, r) => s + r.m.allocated, 0),
      consumed: mine.reduce((s, r) => s + r.m.consumed, 0),
      projects: projects.map((p) => p.project_id),
    };
  });
}

function projectSummary(db: DB, rows: ReturnType<typeof rowsFor>, projects = db.projects) {
  return projects.map((p) => {
    const mgr = db.managers.find((m) => m.id === p.manager_id);
    const mine = rows.filter((r) => r.project_id === p.project_id);
    const allocated = mine.reduce((s, r) => s + r.m.allocated, 0);
    const consumed = mine.reduce((s, r) => s + r.m.consumed, 0);
    const remaining = allocated - consumed;
    const utilization = allocated > 0 ? Math.round((consumed / allocated) * 1000) / 10 : 0;
    return {
      ...p, manager_code: mgr?.manager_id ?? null, manager_name: mgr?.name ?? null,
      employee_count: mine.length,
      allocated,
      consumed,
      remaining,
      utilization,
    };
  });
}

export const userLogin = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string }) => idSchema.parse(d))
  .handler(async ({ data }) => ({ ok: getDB().users.some((u) => u.employee_id === data.id) }));

export const adminLogin = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string }) => idSchema.parse(d))
  .handler(async ({ data }) => ({ ok: getDB().admins.some((a) => a.admin_id === data.id) }));

export const managerLogin = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string }) => idSchema.parse(d))
  .handler(async ({ data }) => ({ ok: getDB().managers.some((m) => m.manager_id === data.id) }));

export const getConfig = createServerFn({ method: "GET" }).handler(async () => ({ microsoftFormUrl: formUrl() }));

export const getUserDashboard = createServerFn({ method: "GET" })
  .inputValidator((d: { id: string }) => idSchema.parse(d))
  .handler(async ({ data }) => {
    const db = getDB();
    const user = db.users.find((u) => u.employee_id === data.id);
    if (!user) return null;
    const trendRows = db.consumption
      .filter((c) => c.user_id === user.id)
      .map((c) => ({ date: c.consumption_date.slice(5), tokens: c.tokens_consumed }));
    return {
      user: enrichUser(db, user), metrics: metricsFor(db, user.id), trend: trendRows,
      cycleDays: db.cycleDays, daysElapsed: db.daysElapsed,
      alerts: db.alerts.filter((a) => a.recipient === user.email).slice(-10).reverse(),
      requests: db.requests.filter((r) => r.user_id === user.id).slice().reverse().map((r) => requestDict(db, r)),
      microsoftFormUrl: formUrl(),
    };
  });

export const getAdminDashboard = createServerFn({ method: "GET" })
  .inputValidator((d: { id: string }) => idSchema.parse(d))
  .handler(async ({ data }) => {
    const db = getDB();
    const admin = db.admins.find((a) => a.admin_id === data.id);
    if (!admin) return null;
    const rows = rowsFor(db, db.users);
    const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + f(r), 0);
    const totalCost = db.consumption.reduce((s, c) => s + rowCost(c, db.pricing), 0);
    const deptMap = new Map<string, { department: string; tokens: number; cost: number }>();
    for (const c of db.consumption) {
      const u = db.users.find((x) => x.id === c.user_id);
      const dept = u?.department ?? "Unassigned";
      const g = deptMap.get(dept) ?? { department: dept, tokens: 0, cost: 0 };
      g.tokens += c.tokens_consumed;
      g.cost += rowCost(c, db.pricing);
      deptMap.set(dept, g);
    }
    const deptCost = [...deptMap.values()]
      .sort((a, b) => b.cost - a.cost)
      .map((d) => ({ ...d, cost: Math.round(d.cost * 100) / 100 }));
    return {
      admin,
      cards: {
        users: rows.length, managers: db.managers.length, projects: db.projects.length,
        teams: new Set(rows.map((r) => r.team)).size, departments: new Set(rows.map((r) => r.department)).size,
        allocated: sum((r) => r.m.allocated), consumed: sum((r) => r.m.consumed), remaining: sum((r) => r.m.remaining),
        totalCost: Math.round(totalCost * 100) / 100,
      },
      trend: trend(db), byDept: group(rows, "department"), byProject: group(rows, "project_name"),
      deptCost, pricing: db.pricing,
      users: rows, managers: managerSummary(db, rows), projects: projectSummary(db, rows),
      allocations: db.allocations.slice().reverse().slice(0, 300).map((a) => {
        const u = db.users.find((x) => x.id === a.user_id);
        return { ...a, employee_id: u?.employee_id, employee_name: u?.name };
      }),
      consumption: db.consumption.slice().reverse().slice(0, 200).map((c) => {
        const u = db.users.find((x) => x.id === c.user_id);
        const p = db.projects.find((x) => x.id === u?.project_id);
        return {
          ...c, employee_id: u?.employee_id, employee_name: u?.name, project_name: p?.project_name,
          department: u?.department, total_tokens: c.tokens_consumed,
          estimated_cost: Math.round(rowCost(c, db.pricing) * 10000) / 10000,
        };
      }),
    };
  });

export const getManagerDashboard = createServerFn({ method: "GET" })
  .inputValidator((d: { id: string }) => idSchema.parse(d))
  .handler(async ({ data }) => {
    const db = getDB();
    const manager = db.managers.find((m) => m.manager_id === data.id);
    if (!manager) return null;
    const users = db.users.filter((u) => u.manager_id === manager.id);
    const ids = new Set(users.map((u) => u.id));
    const rows = rowsFor(db, users);
    const projects = db.projects.filter((p) => p.manager_id === manager.id);
    const reqs = db.requests.filter((r) => ids.has(r.user_id)).slice().reverse();
    const pending = reqs.filter((r) => r.status === "PENDING");
    const realloc = reallocations(db, ids);
    const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + f(r), 0);
    return {
      manager,
      cards: {
        projects: projects.length, employees: rows.length,
        allocated: sum((r) => r.m.allocated), consumed: sum((r) => r.m.consumed), remaining: sum((r) => r.m.remaining),
        atRisk: rows.filter((r) => r.m.risk === "AT_RISK" || r.m.risk === "CRITICAL").length,
        under: rows.filter((r) => r.m.risk === "UNDERUTILIZED").length,
        pendingRequests: pending.length, reallocations: realloc.length,
      },
      trend: trend(db, ids), byProject: group(rows, "project_name"),
      projects: projectSummary(db, rows, projects), employees: rows,
      risks: risks(rows), under: under(rows), reallocations: realloc,
      requests: reqs.map((r) => requestDict(db, r)),
    };
  });

export const getAdminCost = createServerFn({ method: "GET" })
  .inputValidator((d: { id: string }) => idSchema.parse(d))
  .handler(async ({ data }) => {
    const db = getDB();
    if (!db.admins.some((a) => a.admin_id === data.id)) return null;
    const byDate = new Map<string, number>();
    const byProject = new Map<string, number>();
    const byDept = new Map<string, number>();
    const byModel = new Map<string, number>();
    const projAgg = new Map<string, { tokens: number; cost: number; users: Set<number>; department: string; team: string }>();
    let total = 0;
    for (const c of db.consumption) {
      const cost = rowCost(c, db.pricing);
      total += cost;
      byDate.set(c.consumption_date, (byDate.get(c.consumption_date) ?? 0) + cost);
      byModel.set(c.model, (byModel.get(c.model) ?? 0) + cost);
      const u = db.users.find((x) => x.id === c.user_id);
      if (!u) continue;
      byDept.set(u.department, (byDept.get(u.department) ?? 0) + cost);
      const p = db.projects.find((x) => x.id === u.project_id);
      const pname = p?.project_name ?? "Unassigned";
      byProject.set(pname, (byProject.get(pname) ?? 0) + cost);
      const agg = projAgg.get(pname) ?? { tokens: 0, cost: 0, users: new Set<number>(), department: p?.department ?? u.department, team: p?.team ?? u.team };
      agg.tokens += c.tokens_consumed; agg.cost += cost; agg.users.add(u.id); projAgg.set(pname, agg);
    }
    const highestProj = [...byProject.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["—", 0];
    const highestDept = [...byDept.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["—", 0];
    return {
      cards: {
        totalCost: Math.round(total * 100) / 100,
        cycleCost: Math.round(total * 100) / 100,
        avgCostPerUser: Math.round((total / Math.max(1, db.users.length)) * 100) / 100,
        highestProject: highestProj[0], highestProjectCost: Math.round(highestProj[1] * 100) / 100,
        highestDepartment: highestDept[0], highestDepartmentCost: Math.round(highestDept[1] * 100) / 100,
      },
      trend: [...byDate.entries()].sort().map(([d, v]) => ({ date: d.slice(5), cost: Math.round(v * 100) / 100 })),
      byProject: [...byProject.entries()].sort((a, b) => b[1] - a[1]).map(([name, cost]) => ({ name, cost: Math.round(cost * 100) / 100 })),
      byDepartment: [...byDept.entries()].sort((a, b) => b[1] - a[1]).map(([name, cost]) => ({ name, cost: Math.round(cost * 100) / 100 })),
      byModel: [...byModel.entries()].sort((a, b) => b[1] - a[1]).map(([name, cost]) => ({ name, cost: Math.round(cost * 100) / 100 })),
      table: [...projAgg.entries()].sort((a, b) => b[1].cost - a[1].cost).map(([project, agg]) => ({
        project, department: agg.department, team: agg.team, users: agg.users.size, tokens: agg.tokens, cost: Math.round(agg.cost * 100) / 100,
      })),
      pricing: db.pricing,
    };
  });

export const getAuditLogs = createServerFn({ method: "GET" }).handler(async () =>
  getDB().audit_logs.slice().reverse().slice(0, 200));

export const createTokenRequest = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string; requested_tokens: number; reason: string; expected_usage?: string }) =>
    z.object({
      id: z.string().trim().toUpperCase().max(10),
      requested_tokens: z.number().int().positive(),
      reason: z.string().min(1),
      expected_usage: z.string().optional(),
    }).parse(d))
  .handler(async ({ data }) => {
    const db = getDB();
    const u = db.users.find((x) => x.employee_id === data.id);
    if (!u) throw new Error("User not found");
    if (metricsFor(db, u.id).allocated > 0) throw new Error("Token requests are only for users with zero allocation");
    const now = new Date().toISOString();
    const req: TokenRequest = {
      id: nextId(db.requests), request_id: `TR-${String(db.requests.length + 1).padStart(4, "0")}`,
      user_id: u.id, project_id: u.project_id, requested_tokens: data.requested_tokens, approved_tokens: null,
      reason: data.reason, expected_usage: data.expected_usage ?? "", status: "PENDING",
      rejection_reason: null, created_at: now, reviewed_at: null, reviewed_by: null,
    };
    db.requests.push(req);
    db.audit_logs.push({ id: nextId(db.audit_logs), action: "TOKEN_REQUEST_CREATED", user_id: u.id,
      details: `${u.employee_id} requested ${data.requested_tokens.toLocaleString()} tokens`, created_at: now });
    const mgr = db.managers.find((m) => m.id === u.manager_id);
    if (mgr) {
      db.alerts.push({ id: nextId(db.alerts), user_id: u.id, alert_type: "TOKEN_REQUEST", recipient: mgr.email,
        message: `${u.employee_id} requested ${data.requested_tokens.toLocaleString()} tokens for project assignment.`, created_at: now });
      db.alerts.push({ id: nextId(db.alerts), user_id: u.id, alert_type: "TOKEN_REQUEST", recipient: u.email,
        message: `Your request for ${data.requested_tokens.toLocaleString()} tokens was submitted and is pending manager review.`, created_at: now });
    }
    return requestDict(db, req);
  });

export const approveTokenRequest = createServerFn({ method: "POST" })
  .inputValidator((d: { request_id: string; manager_id: string; approved_tokens: number }) =>
    z.object({ request_id: z.string().trim().toUpperCase(), manager_id: z.string().trim().toUpperCase(), approved_tokens: z.number().int().positive() }).parse(d))
  .handler(async ({ data }) => {
    const db = getDB();
    const mgr = db.managers.find((m) => m.manager_id === data.manager_id);
    if (!mgr) throw new Error("Manager not found");
    const allowed = new Set(db.users.filter((u) => u.manager_id === mgr.id).map((u) => u.id));
    const req = db.requests.find((r) => r.request_id === data.request_id);
    if (!req) throw new Error("Request not found");
    if (!allowed.has(req.user_id)) throw new Error("Not your employee");
    if (req.status !== "PENDING") throw new Error("Request already reviewed");
    const now = new Date().toISOString();
    const cycle_end = db.allocations[0]?.cycle_end ?? db.cycleStart;
    db.allocations.push({
      id: nextId(db.allocations), user_id: req.user_id, allocated_tokens: data.approved_tokens,
      cycle_start: db.cycleStart, cycle_end, allocation_source: "manager_approval",
    });
    req.status = "APPROVED"; req.approved_tokens = data.approved_tokens; req.reviewed_at = now; req.reviewed_by = mgr.manager_id;
    const u = db.users.find((x) => x.id === req.user_id)!;
    db.audit_logs.push({ id: nextId(db.audit_logs), action: "TOKEN_REQUEST_APPROVED", user_id: u.id,
      details: `${mgr.manager_id} approved ${data.approved_tokens.toLocaleString()} tokens for ${u.employee_id}`, created_at: now });
    db.alerts.push({ id: nextId(db.alerts), user_id: u.id, alert_type: "TOKEN_REQUEST_APPROVED", recipient: u.email,
      message: `Your token request was approved. ${data.approved_tokens.toLocaleString()} tokens were added to your allocation.`, created_at: now });
    return requestDict(db, req);
  });

export const rejectTokenRequest = createServerFn({ method: "POST" })
  .inputValidator((d: { request_id: string; manager_id: string; reason?: string }) =>
    z.object({ request_id: z.string().trim().toUpperCase(), manager_id: z.string().trim().toUpperCase(), reason: z.string().optional() }).parse(d))
  .handler(async ({ data }) => {
    const db = getDB();
    const mgr = db.managers.find((m) => m.manager_id === data.manager_id);
    if (!mgr) throw new Error("Manager not found");
    const allowed = new Set(db.users.filter((u) => u.manager_id === mgr.id).map((u) => u.id));
    const req = db.requests.find((r) => r.request_id === data.request_id);
    if (!req) throw new Error("Request not found");
    if (!allowed.has(req.user_id)) throw new Error("Not your employee");
    if (req.status !== "PENDING") throw new Error("Request already reviewed");
    const now = new Date().toISOString();
    req.status = "REJECTED"; req.rejection_reason = data.reason ?? ""; req.reviewed_at = now; req.reviewed_by = mgr.manager_id;
    const u = db.users.find((x) => x.id === req.user_id)!;
    db.audit_logs.push({ id: nextId(db.audit_logs), action: "TOKEN_REQUEST_REJECTED", user_id: u.id,
      details: `${mgr.manager_id} rejected request ${req.request_id} for ${u.employee_id}: ${data.reason ?? ""}`, created_at: now });
    db.alerts.push({ id: nextId(db.alerts), user_id: u.id, alert_type: "TOKEN_REQUEST_REJECTED", recipient: u.email,
      message: `Your token request was rejected.${data.reason ? ` ${data.reason}` : ""}`, created_at: now });
    return requestDict(db, req);
  });

export const updatePricing = createServerFn({ method: "POST" })
  .inputValidator((d: { model: string; input_cost_per_1k: number; output_cost_per_1k: number }) =>
    z.object({
      model: z.string().min(1),
      input_cost_per_1k: z.number().nonnegative(),
      output_cost_per_1k: z.number().nonnegative(),
    }).parse(d))
  .handler(async ({ data }) => {
    const db = getDB();
    const existing = db.pricing.find((p) => p.model === data.model);
    if (existing) {
      existing.input_cost_per_1k = data.input_cost_per_1k;
      existing.output_cost_per_1k = data.output_cost_per_1k;
      return existing;
    }
    const created = { id: nextId(db.pricing), ...data };
    db.pricing.push(created);
    return created;
  });

export const analyzeQuota = createServerFn({ method: "POST" })
  .inputValidator((d: { manager_id?: string } | undefined) => d ?? {})
  .handler(async ({ data }) => {
    const db = getDB();
    if (data?.manager_id) {
      const mid = data.manager_id.toUpperCase();
      const mgr = db.managers.find((m) => m.manager_id === mid);
      if (!mgr) throw new Error("Manager not found");
      const ids = db.users.filter((u) => u.manager_id === mgr.id).map((u) => u.id);
      return runQuotaAnalysis(db, ids);
    }
    return runQuotaAnalysis(db);
  });

export const resetDemo = createServerFn({ method: "POST" }).handler(async () => { resetDB(); return { ok: true }; });
