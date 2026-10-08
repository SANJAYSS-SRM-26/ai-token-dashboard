import { describe, expect, it } from "vitest";
import { computeMetrics, planReallocations, riskFor, runQuotaAnalysis, seed, metricsFor, allocatedFor, rowCost } from "./engine";

describe("risk thresholds", () => {
  it("classifies by projected utilization", () => {
    expect(riskFor(49)).toBe("UNDERUTILIZED");
    expect(riskFor(50)).toBe("NORMAL");
    expect(riskFor(80)).toBe("NORMAL");
    expect(riskFor(81)).toBe("AT_RISK");
    expect(riskFor(100)).toBe("AT_RISK");
    expect(riskFor(101)).toBe("CRITICAL");
  });
  it("handles zero usage safely", () => {
    expect(computeMetrics(100000, 0, 0, 30).daysUntilExhaustion).toBeNull();
  });
  it("marks zero allocation as UNALLOCATED and not a donor", () => {
    expect(computeMetrics(0, 40, 15, 30).risk).toBe("UNALLOCATED");
    expect(computeMetrics(0, 40, 15, 30).surplus).toBe(0);
  });
});

describe("reallocation safety", () => {
  it("spec example: 50K moves from A to B", () => {
    const { transfers } = planReallocations([{ userId: 1, allocated: 100000, projected: 40000 }], [{ userId: 2, deficit: 50000 }]);
    expect(transfers).toEqual([{ from: 1, to: 2, tokens: 50000 }]);
  });
  it("never takes more than 50% of donor allocation", () => {
    const { transfers } = planReallocations([{ userId: 1, allocated: 100000, projected: 10000 }], [{ userId: 2, deficit: 80000 }]);
    expect(transfers[0]!.tokens).toBe(50000);
  });
  it("reports insufficient surplus without creating tokens", () => {
    const { transfers, unmet } = planReallocations([{ userId: 1, allocated: 100000, projected: 90000 }], [{ userId: 2, deficit: 30000 }]);
    expect(transfers[0]!.tokens).toBe(10000);
    expect(unmet).toEqual([{ userId: 2, deficit: 20000 }]);
  });
  it("seeded analysis conserves total tokens", () => {
    const db = seed();
    const total = () => db.allocations.reduce((s, a) => s + a.allocated_tokens, 0);
    const before = total();
    runQuotaAnalysis(db);
    expect(total()).toBe(before);
    expect(db.users.filter((u) => metricsFor(db, u.id).risk === "CRITICAL")).toHaveLength(0);
    expect(db.users.filter((u) => u.employee_id >= "U0051").every((u) => metricsFor(db, u.id).risk === "UNALLOCATED")).toBe(true);
    expect(db.users.filter((u) => u.employee_id >= "U0051").every((u) => allocatedFor(db, u.id) === 0)).toBe(true);
  });
});

describe("organization & projects hierarchy", () => {
  it("seeds 5 managers (M001-M005)", () => {
    const db = seed();
    expect(db.managers).toHaveLength(5);
    const mCodes = db.managers.map((m) => m.manager_id);
    expect(mCodes).toEqual(["M001", "M002", "M003", "M004", "M005"]);
  });

  it("seeds 15 projects (P001-P015) assigned to managers", () => {
    const db = seed();
    expect(db.projects).toHaveLength(15);
    const pCodes = db.projects.map((p) => p.project_id);
    expect(pCodes).toContain("P001");
    expect(pCodes).toContain("P015");
    // All projects assigned to valid manager id
    const validMgrIds = new Set(db.managers.map((m) => m.id));
    expect(db.projects.every((p) => validMgrIds.has(p.manager_id))).toBe(true);
  });

  it("seeds zero-token users U0051-U0055 with 0 allocated tokens", () => {
    const db = seed();
    const zeroUsers = db.users.filter((u) => ["U0051", "U0052", "U0053", "U0054", "U0055"].includes(u.employee_id));
    expect(zeroUsers).toHaveLength(5);
    for (const u of zeroUsers) {
      expect(allocatedFor(db, u.id)).toBe(0);
      expect(u.project_id).not.toBeNull();
      expect(u.manager_id).not.toBeNull();
    }
  });
});

describe("token requests & cost calculation", () => {
  it("calculates cost accurately using input and output token rates", () => {
    const db = seed();
    // github-copilot pricing: inp: 0.002, out: 0.008 per 1k
    const cost = rowCost(
      { model: "github-copilot", input_tokens: 1000, output_tokens: 1000 },
      db.pricing,
    );
    expect(cost).toBeCloseTo(0.002 + 0.008, 6);
  });

  it("manages token request lifecycle with approval and reviewed_by", () => {
    const db = seed();
    const sample = db.requests[0]!;
    expect(sample.status).toBe("PENDING");
    expect(sample.reviewed_by).toBeNull();

    // Manager approval creates allocation
    const mgr = db.managers.find((m) => m.manager_id === "M001")!;
    const user = db.users.find((u) => u.id === sample.user_id)!;
    expect(user.manager_id).toBe(mgr.id);

    sample.status = "APPROVED";
    sample.approved_tokens = 50000;
    sample.reviewed_by = mgr.manager_id;
    sample.reviewed_at = new Date().toISOString();
    db.allocations.push({
      id: 999,
      user_id: user.id,
      allocated_tokens: 50000,
      cycle_start: db.cycleStart,
      cycle_end: "2026-10-31",
      allocation_source: "manager_approval",
    });

    expect(allocatedFor(db, user.id)).toBe(50000);
    expect(sample.status).toBe("APPROVED");
    expect(sample.reviewed_by).toBe("M001");
  });
});
