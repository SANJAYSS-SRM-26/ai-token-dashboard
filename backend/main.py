"""FastAPI backend. Run: uvicorn main:app --reload --port 8000"""
import os
from collections import defaultdict
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import DB_PATH, get_db
from models import (
    Admin, AlertRow, AuditLog, Manager, ModelPricing, Project, QuotaReallocation,
    TokenAllocation, TokenConsumption, TokenRequest, User,
)
from quota_service import all_metrics, run_quota_analysis
from seed import CYCLE_DAYS, CYCLE_START, DAYS_ELAPSED, ensure_schema, seed

load_dotenv(Path(__file__).resolve().parent.parent / ".env.local")
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

ensure_schema()

app = FastAPI(title="AI Token Quota Intelligence")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def user_dict(u: User, projects: dict | None = None, managers: dict | None = None) -> dict:
    p = projects.get(u.project_id) if projects and u.project_id else None
    m = managers.get(u.manager_id) if managers and u.manager_id else None
    return {
        "id": u.id, "employee_id": u.employee_id, "name": u.name, "email": u.email,
        "department": u.department, "team": u.team, "manager_email": u.manager_email, "status": u.status,
        "project_id": p.project_id if p else None, "project_name": p.project_name if p else None,
        "manager_code": m.manager_id if m else None, "manager_name": m.name if m else None,
    }


def row(o) -> dict:
    d = {c.name: getattr(o, c.name) for c in o.__table__.columns}
    return {k: (v.isoformat() if hasattr(v, "isoformat") else v) for k, v in d.items()}


def org_maps(db: Session):
    return {p.id: p for p in db.query(Project).all()}, {m.id: m for m in db.query(Manager).all()}


def pricing_map(db: Session) -> dict[str, tuple[float, float]]:
    return {p.model: (p.input_cost_per_1k, p.output_cost_per_1k) for p in db.query(ModelPricing).all()}


def row_cost(c: TokenConsumption, prices: dict[str, tuple[float, float]]) -> float:
    inp, out = prices.get(c.model, (0.002, 0.008))
    return ((c.input_tokens or 0) / 1000) * inp + ((c.output_tokens or 0) / 1000) * out


class UserLogin(BaseModel):
    employee_id: str


class AdminLogin(BaseModel):
    admin_id: str


class ManagerLogin(BaseModel):
    manager_id: str


class AnalyzeBody(BaseModel):
    manager_id: str | None = None


class TokenRequestBody(BaseModel):
    requested_tokens: int
    reason: str
    expected_usage: str = ""


class ApproveBody(BaseModel):
    manager_id: str
    approved_tokens: int


class RejectBody(BaseModel):
    manager_id: str
    reason: str = ""


class UpdatePricingBody(BaseModel):
    model: str
    input_cost_per_1k: float
    output_cost_per_1k: float


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/config")
def config():
    return {"microsoftFormUrl": os.getenv("MICROSOFT_FORM_URL") or os.getenv("VITE_MICROSOFT_FORM_URL") or ""}


@app.post("/api/user/login")
def user_login(body: UserLogin, db: Session = Depends(get_db)):
    return {"ok": db.query(User).filter_by(employee_id=body.employee_id.strip().upper()).first() is not None}


@app.post("/api/admin/login")
def admin_login(body: AdminLogin, db: Session = Depends(get_db)):
    return {"ok": db.query(Admin).filter_by(admin_id=body.admin_id.strip().upper()).first() is not None}


@app.post("/api/manager/login")
def manager_login(body: ManagerLogin, db: Session = Depends(get_db)):
    return {"ok": db.query(Manager).filter_by(manager_id=body.manager_id.strip().upper()).first() is not None}


@app.get("/api/users/{employee_id}/dashboard")
def user_dashboard(employee_id: str, db: Session = Depends(get_db)):
    u = db.query(User).filter_by(employee_id=employee_id.upper()).first()
    if not u:
        raise HTTPException(404, "User not found")
    projects, managers = org_maps(db)
    trend = [{"date": c.consumption_date.isoformat()[5:], "tokens": c.tokens_consumed}
             for c in db.query(TokenConsumption).filter_by(user_id=u.id).order_by(TokenConsumption.consumption_date)]
    alerts = db.query(AlertRow).filter_by(recipient=u.email).order_by(AlertRow.id.desc()).limit(10).all()
    reqs = db.query(TokenRequest).filter_by(user_id=u.id).order_by(TokenRequest.id.desc()).all()
    return {
        "user": user_dict(u, projects, managers), "metrics": all_metrics(db)[u.id], "trend": trend,
        "cycleDays": CYCLE_DAYS, "daysElapsed": DAYS_ELAPSED, "alerts": [row(a) for a in alerts],
        "requests": [_request_dict(r, db) for r in reqs],
        "microsoftFormUrl": os.getenv("MICROSOFT_FORM_URL") or os.getenv("VITE_MICROSOFT_FORM_URL") or "",
    }


def _request_dict(r: TokenRequest, db: Session) -> dict:
    u = db.get(User, r.user_id)
    p = db.get(Project, r.project_id) if r.project_id else None
    return {
        **row(r),
        "employee_id": u.employee_id if u else None,
        "employee_name": u.name if u else None,
        "project_code": p.project_id if p else None,
        "project_name": p.project_name if p else None,
        "department": p.department if p else (u.department if u else None),
        "team": p.team if p else (u.team if u else None),
    }


def _rows(db: Session, users: list[User] | None = None):
    m = all_metrics(db)
    projects, managers = org_maps(db)
    qs = users if users is not None else db.query(User).all()
    return [{**user_dict(u, projects, managers), "m": m[u.id]} for u in qs]


def _risks(rows):
    order = {"CRITICAL": 0, "AT_RISK": 1}
    return sorted([r for r in rows if r["m"]["risk"] in order],
                  key=lambda r: (order[r["m"]["risk"]], -r["m"]["projectedUtilization"]))


def _under(rows):
    return sorted([r for r in rows if r["m"]["risk"] == "UNDERUTILIZED"], key=lambda r: -r["m"]["surplus"])


def _reallocations(db: Session, user_ids: set[int] | None = None):
    emp = {u.id: u.employee_id for u in db.query(User).all()}
    q = db.query(QuotaReallocation).order_by(QuotaReallocation.id.desc())
    out = []
    for r in q:
        if user_ids is not None and r.from_user_id not in user_ids and r.to_user_id not in user_ids:
            continue
        out.append({**row(r), "from": emp.get(r.from_user_id), "to": emp.get(r.to_user_id)})
    return out


def _group(rows, key):
    g = defaultdict(lambda: {"allocated": 0, "consumed": 0})
    for r in rows:
        name = r.get(key) or "Unassigned"
        g[name]["allocated"] += r["m"]["allocated"]
        g[name]["consumed"] += r["m"]["consumed"]
    return [{"name": k, **v} for k, v in g.items()]


def _trend(db: Session, user_ids: set[int] | None = None):
    trend = defaultdict(int)
    for c in db.query(TokenConsumption).all():
        if user_ids is not None and c.user_id not in user_ids:
            continue
        trend[c.consumption_date.isoformat()] += c.tokens_consumed
    return [{"date": d[5:], "tokens": t} for d, t in sorted(trend.items())]


def _mgr_users(db: Session, manager_id: str) -> tuple[Manager, list[User]]:
    mgr = db.query(Manager).filter_by(manager_id=manager_id.upper()).first()
    if not mgr:
        raise HTTPException(404, "Manager not found")
    users = db.query(User).filter_by(manager_id=mgr.id).all()
    return mgr, users


@app.get("/api/admin/dashboard")
def admin_dashboard(admin_id: str, db: Session = Depends(get_db)):
    a = db.query(Admin).filter_by(admin_id=admin_id.upper()).first()
    if not a:
        raise HTTPException(404, "Admin not found")
    rows = _rows(db)
    s = lambda f: sum(f(r) for r in rows)
    prices = pricing_map(db)
    users = {u.id: u for u in db.query(User).all()}
    dept_costs = defaultdict(lambda: {"tokens": 0, "cost": 0.0})
    for c in db.query(TokenConsumption).all():
        cost = row_cost(c, prices)
        u = users.get(c.user_id)
        dept = u.department if u else "Unassigned"
        dept_costs[dept]["tokens"] += c.tokens_consumed
        dept_costs[dept]["cost"] += cost
    dept_cost_list = [
        {"department": d, "tokens": v["tokens"], "cost": round(v["cost"], 2)}
        for d, v in sorted(dept_costs.items(), key=lambda x: -x[1]["cost"])
    ]
    total_cost = sum(v["cost"] for v in dept_cost_list)
    return {
        "admin": row(a),
        "cards": {
            "users": len(rows),
            "managers": db.query(Manager).count(),
            "projects": db.query(Project).count(),
            "teams": len({r["team"] for r in rows}),
            "departments": len({r["department"] for r in rows}),
            "allocated": s(lambda r: r["m"]["allocated"]),
            "consumed": s(lambda r: r["m"]["consumed"]),
            "remaining": s(lambda r: r["m"]["remaining"]),
            "totalCost": round(total_cost, 2),
        },
        "trend": _trend(db),
        "byDept": _group(rows, "department"),
        "byProject": _group(rows, "project_name"),
        "deptCost": dept_cost_list,
        "pricing": [row(p) for p in db.query(ModelPricing).all()],
        "users": rows,
        "managers": [_manager_summary(db, m, rows) for m in db.query(Manager).all()],
        "projects": [_project_summary(db, p, rows) for p in db.query(Project).all()],
        "allocations": _allocations(db),
        "consumption": _consumption_rows(db, prices)[:400],
    }


def _manager_summary(db: Session, m: Manager, rows):
    mine = [r for r in rows if r.get("manager_code") == m.manager_id]
    projects = db.query(Project).filter_by(manager_id=m.id).all()
    return {
        **row(m),
        "project_count": len(projects),
        "employee_count": len(mine),
        "allocated": sum(r["m"]["allocated"] for r in mine),
        "consumed": sum(r["m"]["consumed"] for r in mine),
        "projects": [p.project_id for p in projects],
    }


def _project_summary(db: Session, p: Project, rows):
    mgr = db.get(Manager, p.manager_id)
    mine = [r for r in rows if r.get("project_id") == p.project_id]
    alloc = sum(r["m"]["allocated"] for r in mine)
    cons = sum(r["m"]["consumed"] for r in mine)
    rem = alloc - cons
    util = round((cons / alloc * 100), 1) if alloc > 0 else 0.0
    return {
        **row(p),
        "manager_code": mgr.manager_id if mgr else None,
        "manager_name": mgr.name if mgr else None,
        "employee_count": len(mine),
        "allocated": alloc,
        "consumed": cons,
        "remaining": rem,
        "utilization": util,
    }


def _allocations(db: Session):
    emp = {u.id: u.employee_id for u in db.query(User).all()}
    names = {u.id: u.name for u in db.query(User).all()}
    out = []
    for a in db.query(TokenAllocation).order_by(TokenAllocation.id.desc()).limit(300):
        out.append({**row(a), "employee_id": emp.get(a.user_id), "employee_name": names.get(a.user_id)})
    return out


def _consumption_rows(db: Session, prices):
    emp = {u.id: u for u in db.query(User).all()}
    projects, _ = org_maps(db)
    out = []
    for c in db.query(TokenConsumption).order_by(TokenConsumption.consumption_date.desc(), TokenConsumption.id.desc()).limit(400):
        u = emp.get(c.user_id)
        p = projects.get(u.project_id) if u and u.project_id else None
        cost = row_cost(c, prices)
        out.append({
            **row(c), "employee_id": u.employee_id if u else None, "employee_name": u.name if u else None,
            "project_name": p.project_name if p else None, "department": u.department if u else None,
            "input_tokens": c.input_tokens or 0, "output_tokens": c.output_tokens or 0,
            "total_tokens": c.tokens_consumed, "estimated_cost": round(cost, 4),
        })
    return out


@app.get("/api/manager/dashboard")
def manager_dashboard(manager_id: str, db: Session = Depends(get_db)):
    mgr, users = _mgr_users(db, manager_id)
    ids = {u.id for u in users}
    rows = _rows(db, users)
    projects = db.query(Project).filter_by(manager_id=mgr.id).all()
    reqs = [r for r in db.query(TokenRequest).order_by(TokenRequest.id.desc()).all() if r.user_id in ids]
    pending = [r for r in reqs if r.status == "PENDING"]
    s = lambda f: sum(f(r) for r in rows)
    return {
        "manager": row(mgr),
        "cards": {
            "projects": len(projects), "employees": len(rows),
            "allocated": s(lambda r: r["m"]["allocated"]), "consumed": s(lambda r: r["m"]["consumed"]),
            "remaining": s(lambda r: r["m"]["remaining"]),
            "atRisk": len([r for r in rows if r["m"]["risk"] in ("AT_RISK", "CRITICAL")]),
            "under": len([r for r in rows if r["m"]["risk"] == "UNDERUTILIZED"]),
            "pendingRequests": len(pending),
            "reallocations": len(_reallocations(db, ids)),
        },
        "trend": _trend(db, ids),
        "byProject": _group(rows, "project_name"),
        "projects": [_project_summary(db, p, rows) for p in projects],
        "employees": rows,
        "risks": _risks(rows),
        "under": _under(rows),
        "reallocations": _reallocations(db, ids),
        "requests": [_request_dict(r, db) for r in reqs],
    }


@app.get("/api/quota/risks")
def risks(db: Session = Depends(get_db)):
    return _risks(_rows(db))


@app.get("/api/quota/underutilized")
def underutilized(db: Session = Depends(get_db)):
    return _under(_rows(db))


@app.post("/api/quota/analyze")
def analyze(body: AnalyzeBody | None = None, manager_id: str | None = None, db: Session = Depends(get_db)):
    mid = (body.manager_id if body else None) or manager_id
    if mid:
        _, users = _mgr_users(db, mid)
        return run_quota_analysis(db, [u.id for u in users])
    return run_quota_analysis(db)


@app.get("/api/reallocations")
def reallocations(db: Session = Depends(get_db)):
    return _reallocations(db)


@app.get("/api/alerts")
def alerts(db: Session = Depends(get_db)):
    return [row(x) for x in db.query(AlertRow).order_by(AlertRow.id.desc()).limit(100)]


@app.get("/api/audit-logs")
def audit_logs(db: Session = Depends(get_db)):
    return [row(x) for x in db.query(AuditLog).order_by(AuditLog.id.desc()).limit(200)]


@app.get("/api/admin/cost")
def admin_cost(admin_id: str, db: Session = Depends(get_db)):
    a = db.query(Admin).filter_by(admin_id=admin_id.upper()).first()
    if not a:
        raise HTTPException(404, "Admin not found")
    prices = pricing_map(db)
    users = {u.id: u for u in db.query(User).all()}
    projects, managers = org_maps(db)
    rows = _rows(db)
    by_date = defaultdict(float)
    by_project = defaultdict(float)
    by_dept = defaultdict(float)
    by_model = defaultdict(float)
    proj_agg = defaultdict(lambda: {"tokens": 0, "cost": 0.0, "users": set(), "department": "", "team": ""})
    cycle_cost = 0.0
    total = 0.0
    user_cost = defaultdict(float)
    for c in db.query(TokenConsumption).all():
        cost = row_cost(c, prices)
        total += cost
        cycle_cost += cost
        by_date[c.consumption_date.isoformat()] += cost
        by_model[c.model] += cost
        u = users.get(c.user_id)
        if not u:
            continue
        user_cost[u.id] += cost
        by_dept[u.department] += cost
        p = projects.get(u.project_id) if u.project_id else None
        pname = p.project_name if p else "Unassigned"
        by_project[pname] += cost
        agg = proj_agg[pname]
        agg["tokens"] += c.tokens_consumed
        agg["cost"] += cost
        agg["users"].add(u.id)
        agg["department"] = p.department if p else u.department
        agg["team"] = p.team if p else u.team
    n_users = max(1, len(users))
    highest_proj = max(by_project.items(), key=lambda x: x[1], default=("—", 0.0))
    highest_dept = max(by_dept.items(), key=lambda x: x[1], default=("—", 0.0))
    table = []
    for name, agg in sorted(proj_agg.items(), key=lambda x: -x[1]["cost"]):
        table.append({
            "project": name, "department": agg["department"], "team": agg["team"],
            "users": len(agg["users"]), "tokens": agg["tokens"], "cost": round(agg["cost"], 2),
        })
    return {
        "cards": {
            "totalCost": round(total, 2),
            "cycleCost": round(cycle_cost, 2),
            "avgCostPerUser": round(total / n_users, 2),
            "highestProject": highest_proj[0],
            "highestProjectCost": round(highest_proj[1], 2),
            "highestDepartment": highest_dept[0],
            "highestDepartmentCost": round(highest_dept[1], 2),
        },
        "trend": [{"date": d[5:], "cost": round(v, 2)} for d, v in sorted(by_date.items())],
        "byProject": [{"name": k, "cost": round(v, 2)} for k, v in sorted(by_project.items(), key=lambda x: -x[1])],
        "byDepartment": [{"name": k, "cost": round(v, 2)} for k, v in sorted(by_dept.items(), key=lambda x: -x[1])],
        "byModel": [{"name": k, "cost": round(v, 2)} for k, v in sorted(by_model.items(), key=lambda x: -x[1])],
        "table": table,
        "pricing": [row(p) for p in db.query(ModelPricing).all()],
    }


@app.post("/api/users/{employee_id}/token-requests")
def create_token_request(employee_id: str, body: TokenRequestBody, db: Session = Depends(get_db)):
    u = db.query(User).filter_by(employee_id=employee_id.upper()).first()
    if not u:
        raise HTTPException(404, "User not found")
    metrics = all_metrics(db)[u.id]
    if metrics["allocated"] > 0:
        raise HTTPException(400, "Token requests are only for users with zero allocation")
    if body.requested_tokens <= 0:
        raise HTTPException(400, "Requested tokens must be positive")
    n = db.query(TokenRequest).count() + 1
    req = TokenRequest(
        request_id=f"TR-{n:04d}", user_id=u.id, project_id=u.project_id,
        requested_tokens=body.requested_tokens, reason=body.reason,
        expected_usage=body.expected_usage, status="PENDING",
    )
    db.add(req)
    db.add(AuditLog(action="TOKEN_REQUEST_CREATED", user_id=u.id,
                    details=f"{u.employee_id} requested {body.requested_tokens:,} tokens"))
    mgr = db.get(Manager, u.manager_id) if u.manager_id else None
    if mgr:
        db.add(AlertRow(user_id=u.id, alert_type="TOKEN_REQUEST", recipient=mgr.email,
                        message=f"{u.employee_id} requested {body.requested_tokens:,} tokens for project assignment."))
        db.add(AlertRow(user_id=u.id, alert_type="TOKEN_REQUEST", recipient=u.email,
                        message=f"Your request for {body.requested_tokens:,} tokens was submitted and is pending manager review."))
    db.commit()
    db.refresh(req)
    return _request_dict(req, db)


@app.post("/api/manager/requests/{request_id}/approve")
def approve_request(request_id: str, body: ApproveBody, db: Session = Depends(get_db)):
    mgr, users = _mgr_users(db, body.manager_id)
    allowed = {u.id for u in users}
    req = db.query(TokenRequest).filter_by(request_id=request_id.upper()).first()
    if not req:
        raise HTTPException(404, "Request not found")
    if req.user_id not in allowed:
        raise HTTPException(403, "Not your employee")
    if req.status != "PENDING":
        raise HTTPException(400, "Request already reviewed")
    if body.approved_tokens <= 0:
        raise HTTPException(400, "Approved tokens must be positive")
    from datetime import timedelta
    cycle_end = CYCLE_START + timedelta(days=CYCLE_DAYS - 1)
    db.add(TokenAllocation(user_id=req.user_id, allocated_tokens=body.approved_tokens,
                           cycle_start=CYCLE_START, cycle_end=cycle_end, allocation_source="manager_approval"))
    req.status = "APPROVED"
    req.approved_tokens = body.approved_tokens
    req.reviewed_at = datetime.utcnow()
    req.reviewed_by = mgr.manager_id
    u = db.get(User, req.user_id)
    db.add(AuditLog(action="TOKEN_REQUEST_APPROVED", user_id=u.id,
                    details=f"{mgr.manager_id} approved {body.approved_tokens:,} tokens for {u.employee_id}"))
    db.add(AlertRow(user_id=u.id, alert_type="TOKEN_REQUEST_APPROVED", recipient=u.email,
                    message=f"Your token request was approved. {body.approved_tokens:,} tokens were added to your allocation."))
    db.add(AlertRow(user_id=u.id, alert_type="TOKEN_REQUEST_APPROVED", recipient=mgr.email,
                    message=f"You approved {body.approved_tokens:,} tokens for {u.employee_id}."))
    db.commit()
    return _request_dict(req, db)


@app.post("/api/manager/requests/{request_id}/reject")
def reject_request(request_id: str, body: RejectBody, db: Session = Depends(get_db)):
    mgr, users = _mgr_users(db, body.manager_id)
    allowed = {u.id for u in users}
    req = db.query(TokenRequest).filter_by(request_id=request_id.upper()).first()
    if not req:
        raise HTTPException(404, "Request not found")
    if req.user_id not in allowed:
        raise HTTPException(403, "Not your employee")
    if req.status != "PENDING":
        raise HTTPException(400, "Request already reviewed")
    req.status = "REJECTED"
    req.rejection_reason = body.reason
    req.reviewed_at = datetime.utcnow()
    req.reviewed_by = mgr.manager_id
    u = db.get(User, req.user_id)
    db.add(AuditLog(action="TOKEN_REQUEST_REJECTED", user_id=u.id,
                    details=f"{mgr.manager_id} rejected request {req.request_id} for {u.employee_id}: {body.reason}"))
    db.add(AlertRow(user_id=u.id, alert_type="TOKEN_REQUEST_REJECTED", recipient=u.email,
                    message=f"Your token request was rejected.{(' ' + body.reason) if body.reason else ''}"))
    db.add(AlertRow(user_id=u.id, alert_type="TOKEN_REQUEST_REJECTED", recipient=mgr.email,
                    message=f"You rejected token request {req.request_id} for {u.employee_id}."))
    db.commit()
    return _request_dict(req, db)


@app.post("/api/admin/pricing")
def update_pricing(body: UpdatePricingBody, db: Session = Depends(get_db)):
    p = db.query(ModelPricing).filter_by(model=body.model).first()
    if not p:
        p = ModelPricing(model=body.model, input_cost_per_1k=body.input_cost_per_1k, output_cost_per_1k=body.output_cost_per_1k)
        db.add(p)
    else:
        p.input_cost_per_1k = body.input_cost_per_1k
        p.output_cost_per_1k = body.output_cost_per_1k
    db.commit()
    db.refresh(p)
    return row(p)


@app.post("/api/demo/reset")
def reset():
    seed()
    return {"ok": True}
