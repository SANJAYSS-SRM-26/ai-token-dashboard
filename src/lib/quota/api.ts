import {
  adminLogin, analyzeQuota, approveTokenRequest, createTokenRequest, getAdminCost, getAdminDashboard,
  getAuditLogs, getConfig, getManagerDashboard, getUserDashboard, managerLogin, rejectTokenRequest,
  resetDemo, updatePricing, userLogin,
} from "./quota.functions";

// When VITE_API_URL is set (e.g. http://localhost:8000), the app talks to the local
// Python FastAPI backend. Otherwise it uses the built-in server functions.
const BASE = (import.meta.env['VITE_API_URL'] as string | undefined)?.replace(/\/$/, "");

export type UserDash = NonNullable<Awaited<ReturnType<typeof getUserDashboard>>>;
export type AdminDash = NonNullable<Awaited<ReturnType<typeof getAdminDashboard>>>;
export type ManagerDash = NonNullable<Awaited<ReturnType<typeof getManagerDashboard>>>;
export type CostDash = NonNullable<Awaited<ReturnType<typeof getAdminCost>>>;
export type Analysis = Awaited<ReturnType<typeof analyzeQuota>>;

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: { "content-type": "application/json" }, ...init });
  if (res.status === 404) return null as T;
  if (!res.ok) {
    let detail = `API error ${res.status}`;
    try {
      const body = await res.json() as { detail?: string };
      if (body.detail) detail = body.detail;
    } catch { /* keep default */ }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}
const post = (body?: unknown): RequestInit => (body ? { method: "POST", body: JSON.stringify(body) } : { method: "POST" });

export const api = {
  userLogin: (id: string) =>
    BASE ? http<{ ok: boolean }>("/api/user/login", post({ employee_id: id })) : userLogin({ data: { id } }),
  adminLogin: (id: string) =>
    BASE ? http<{ ok: boolean }>("/api/admin/login", post({ admin_id: id })) : adminLogin({ data: { id } }),
  managerLogin: (id: string) =>
    BASE ? http<{ ok: boolean }>("/api/manager/login", post({ manager_id: id })) : managerLogin({ data: { id } }),
  userDashboard: (id: string): Promise<UserDash | null> =>
    BASE ? http(`/api/users/${encodeURIComponent(id)}/dashboard`) : getUserDashboard({ data: { id } }),
  adminDashboard: (id: string): Promise<AdminDash | null> =>
    BASE ? http(`/api/admin/dashboard?admin_id=${encodeURIComponent(id)}`) : getAdminDashboard({ data: { id } }),
  managerDashboard: (id: string): Promise<ManagerDash | null> =>
    BASE ? http(`/api/manager/dashboard?manager_id=${encodeURIComponent(id)}`) : getManagerDashboard({ data: { id } }),
  adminCost: (id: string): Promise<CostDash | null> =>
    BASE ? http(`/api/admin/cost?admin_id=${encodeURIComponent(id)}`) : getAdminCost({ data: { id } }),
  auditLogs: () => (BASE ? http<Awaited<ReturnType<typeof getAuditLogs>>>("/api/audit-logs") : getAuditLogs()),
  config: () => (BASE ? http<{ microsoftFormUrl: string }>("/api/config") : getConfig()),
  analyze: (managerId?: string): Promise<Analysis> =>
    BASE ? http("/api/quota/analyze", post(managerId ? { manager_id: managerId } : {})) : analyzeQuota({ data: managerId ? { manager_id: managerId } : {} }),
  requestTokens: (id: string, body: { requested_tokens: number; reason: string; expected_usage: string }) =>
    BASE ? http(`/api/users/${encodeURIComponent(id)}/token-requests`, post(body)) : createTokenRequest({ data: { id, ...body } }),
  approveRequest: (requestId: string, managerId: string, approvedTokens: number) =>
    BASE
      ? http(`/api/manager/requests/${encodeURIComponent(requestId)}/approve`, post({ manager_id: managerId, approved_tokens: approvedTokens }))
      : approveTokenRequest({ data: { request_id: requestId, manager_id: managerId, approved_tokens: approvedTokens } }),
  rejectRequest: (requestId: string, managerId: string, reason: string) =>
    BASE
      ? http(`/api/manager/requests/${encodeURIComponent(requestId)}/reject`, post({ manager_id: managerId, reason }))
      : rejectTokenRequest({ data: { request_id: requestId, manager_id: managerId, reason } }),
  reset: () => (BASE ? http<{ ok: boolean }>("/api/demo/reset", post()) : resetDemo()),
  updatePricing: (model: string, inputCostPer1k: number, outputCostPer1k: number) =>
    BASE
      ? http<{ ok: boolean }>("/api/admin/pricing", post({ model, input_cost_per_1k: inputCostPer1k, output_cost_per_1k: outputCostPer1k }))
      : updatePricing({ data: { model, input_cost_per_1k: inputCostPer1k, output_cost_per_1k: outputCostPer1k } }),
};
