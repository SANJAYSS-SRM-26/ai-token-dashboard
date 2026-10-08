"""Rule-based quota intelligence (no ML). Mirrors src/lib/quota/engine.ts."""
from datetime import timedelta

from sqlalchemy import func
from sqlalchemy.orm import Session

from models import AlertRow, AuditLog, QuotaReallocation, TokenAllocation, TokenConsumption, User
from seed import CYCLE_DAYS, CYCLE_START, DAYS_ELAPSED


def risk_for(pu: float) -> str:
    if pu < 50:
        return "UNDERUTILIZED"
    if pu <= 80:
        return "NORMAL"
    if pu <= 100:
        return "AT_RISK"
    return "CRITICAL"


def compute_metrics(allocated: int, consumed: int, days_elapsed=DAYS_ELAPSED, cycle_days=CYCLE_DAYS) -> dict:
    daily = consumed / days_elapsed if days_elapsed > 0 else 0
    projected = round(daily * cycle_days)
    remaining = allocated - consumed
    if allocated <= 0:
        return {
            "allocated": allocated, "consumed": consumed, "remaining": remaining, "utilization": 0,
            "dailyUsage": daily, "projected": projected, "projectedUtilization": 0,
            "daysUntilExhaustion": None, "risk": "UNALLOCATED", "surplus": 0, "deficit": 0,
        }
    util = consumed / allocated * 100
    pu = projected / allocated * 100
    risk = risk_for(pu)
    return {
        "allocated": allocated, "consumed": consumed, "remaining": remaining, "utilization": util,
        "dailyUsage": daily, "projected": projected, "projectedUtilization": pu,
        "daysUntilExhaustion": max(0, remaining / daily) if daily > 0 else None, "risk": risk,
        "surplus": max(0, allocated - projected) if risk == "UNDERUTILIZED" else 0,
        "deficit": max(0, projected - allocated) if risk == "CRITICAL" else 0,
    }


def plan_reallocations(donors: list[dict], recipients: list[dict]):
    """Safety rules: never exceed deficit, never take >50% of donor allocation,
    never drop donor below projected need, each surplus used once per run."""
    pool = [{"user_id": d["user_id"], "available": max(0, min(d["allocated"] - d["projected"], d["allocated"] // 2))}
            for d in donors]
    pool = sorted([p for p in pool if p["available"] > 0], key=lambda p: -p["available"])
    transfers, unmet = [], []
    for r in sorted(recipients, key=lambda r: -r["deficit"]):
        need = r["deficit"]
        for d in pool:
            if need <= 0:
                break
            if d["available"] <= 0:
                continue
            amt = min(need, d["available"])
            d["available"] -= amt
            need -= amt
            transfers.append({"from": d["user_id"], "to": r["user_id"], "tokens": amt})
        if need > 0:
            unmet.append({"user_id": r["user_id"], "deficit": need})
    return transfers, unmet


def all_metrics(db: Session) -> dict[int, dict]:
    alloc = dict(db.query(TokenAllocation.user_id, func.sum(TokenAllocation.allocated_tokens))
                 .group_by(TokenAllocation.user_id).all())
    cons = dict(db.query(TokenConsumption.user_id, func.sum(TokenConsumption.tokens_consumed))
                .group_by(TokenConsumption.user_id).all())
    return {u.id: compute_metrics(int(alloc.get(u.id, 0)), int(cons.get(u.id, 0))) for u in db.query(User).all()}


def run_quota_analysis(db: Session, user_ids: list[int] | None = None) -> dict:
    users = {u.id: u for u in db.query(User).all()}
    metrics = all_metrics(db)
    scope = set(user_ids) if user_ids is not None else set(users)
    eligible = {uid: m for uid, m in metrics.items() if uid in scope and m["allocated"] > 0}
    donors = [{"user_id": uid, "allocated": m["allocated"], "projected": m["projected"]}
              for uid, m in eligible.items() if m["risk"] == "UNDERUTILIZED"]
    recipients = [{"user_id": uid, "deficit": m["deficit"]} for uid, m in eligible.items() if m["risk"] == "CRITICAL"]
    transfers, unmet = plan_reallocations(donors, recipients)
    cycle_end = CYCLE_START + timedelta(days=CYCLE_DAYS - 1)

    def alert(uid, t, to, msg):
        db.add(AlertRow(user_id=uid, alert_type=t, recipient=to, message=msg))

    for t in transfers:
        f, to = users[t["from"]], users[t["to"]]
        n = f"{t['tokens']:,}"
        for uid, amount in ((f.id, -t["tokens"]), (to.id, t["tokens"])):
            db.add(TokenAllocation(user_id=uid, allocated_tokens=amount, cycle_start=CYCLE_START, cycle_end=cycle_end,
                                   allocation_source="auto_reallocation"))
        db.add(QuotaReallocation(from_user_id=f.id, to_user_id=to.id, tokens_transferred=t["tokens"],
                                 reason="Projected quota exhaustion"))
        db.add(AuditLog(action="AUTO_REALLOCATION", user_id=to.id,
                        details=f"{n} tokens moved from {f.employee_id} to {to.employee_id}"))
        alert(to.id, "QUOTA_INCREASED", to.email,
              f"Your projected usage exceeded your quota. {n} tokens were automatically added to your allocation.")
        alert(to.id, "MANAGER_REALLOCATION", to.manager_email,
              f"User {to.employee_id} is projected to exceed their quota. {n} tokens were automatically reallocated from underutilized user {f.employee_id}.")
        alert(f.id, "QUOTA_REDUCED", f.email,
              f"{n} unused tokens from your allocation were redistributed. Your projected needs are still fully covered.")
    for u in unmet:
        user = users[u["user_id"]]
        db.add(AuditLog(action="INSUFFICIENT_SURPLUS", user_id=user.id, details=f"Unmet deficit of {u['deficit']:,} tokens"))
        alert(user.id, "INSUFFICIENT_SURPLUS", user.manager_email,
              f"Insufficient surplus quota available. User {user.employee_id} still needs {u['deficit']:,} tokens.")
    for uid, m in eligible.items():
        u = users[uid]
        if m["risk"] == "AT_RISK":
            alert(uid, "AT_RISK_WARNING", u.email, "Your AI token usage is higher than expected. Based on your current usage, your quota may be exhausted before the allocation cycle ends.")
            alert(uid, "AT_RISK_WARNING", u.manager_email, f"User {u.employee_id} is projected to use {m['projectedUtilization']:.0f}% of their allocation.")
        if m["risk"] == "UNDERUTILIZED":
            alert(uid, "UNDERUTILIZATION", u.manager_email, f"User {u.employee_id} is projected to use only {m['projectedUtilization']:.0f}% of their allocation. {m['surplus']:,} tokens are identified as potential surplus.")
    moved = sum(t["tokens"] for t in transfers)
    db.add(AuditLog(action="QUOTA_ANALYSIS_RUN", details=f"Analyzed {len(eligible)} users, {len(transfers)} transfers, {moved:,} tokens moved"))
    db.commit()
    return {"analyzed": len(eligible), "transfers": len(transfers), "tokensMoved": moved, "unmet": len(unmet)}
