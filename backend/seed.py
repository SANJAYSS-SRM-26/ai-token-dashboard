"""Create tables and fill them with fictional demo data. Run: python seed.py"""
import random
from datetime import date, timedelta

from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from database import Base, SessionLocal, engine
from models import (
    Admin, Manager, ModelPricing, Project, TokenAllocation, TokenConsumption, TokenRequest, User,
)

CYCLE_START = date(2026, 10, 1)
CYCLE_DAYS = 30
DAYS_ELAPSED = 15
ALLOC = 100_000

FIRST = ["Aarav", "Priya", "Liam", "Mei", "Noah", "Sofia", "Ravi", "Elena", "Kenji", "Amara", "Lucas", "Zara", "Omar",
         "Ines", "Tariq", "Hana", "Diego", "Leila", "Ivan", "Nora", "Arjun", "Maya", "Felix", "Yara", "Theo"]
LAST = ["Shah", "Nakamura", "Okafor", "Rossi", "Kim", "Silva", "Novak", "Haddad", "Iyer", "Larsen"]
MODELS = ["github-copilot"]

MANAGERS = [
    ("M001", "Nisha Patel", "nisha.patel@acme.example", "Enterprise Middleware"),
    ("M002", "James Okonkwo", "james.okonkwo@acme.example", "IT & Technology"),
    ("M003", "Sofia Alvarez", "sofia.alvarez@acme.example", "Infrastructure"),
    ("M004", "Kenji Sato", "kenji.sato@acme.example", "Cybersecurity"),
    ("M005", "Amara Diallo", "amara.diallo@acme.example", "Software Engineering"),
]

PROJECTS = [
    ("P001", "Application Server Modernization", "Enterprise Middleware", "WebSphere Team", "M001"),
    ("P002", "Enterprise Messaging Upgrade", "Enterprise Middleware", "Messaging Team", "M001"),
    ("P003", "Secure File Transfer Migration", "Enterprise Middleware", "IBM Sterling Team", "M001"),
    ("P004", "API Gateway Modernization", "Enterprise Middleware", "API Management Team", "M002"),
    ("P005", "File Transfer as a Service", "Enterprise Middleware", "FTaaS Team", "M002"),
    ("P006", "CI/CD Pipeline Automation", "IT & Technology", "DevOps Team", "M002"),
    ("P007", "Linux Server Patching Automation", "Infrastructure", "Linux/UNIX Team", "M003"),
    ("P008", "Server Lifecycle Management", "Infrastructure", "Server Management Team", "M003"),
    ("P009", "Transaction Processing Platform", "Software Engineering", "Backend Team", "M003"),
    ("P010", "Enterprise Identity Management", "Cybersecurity", "IAM Team", "M004"),
    ("P011", "Real-Time Banking Data Pipeline", "Data & Analytics", "Data Engineering", "M004"),
    ("P012", "Application Monitoring & Incident Management", "Operations", "Production Support", "M004"),
    ("P013", "Cloud Infrastructure Migration", "IT & Technology", "Cloud Engineering", "M005"),
    ("P014", "Security Monitoring Platform", "Cybersecurity", "Security Operations", "M005"),
    ("P015", "Automated Testing Framework", "Software Engineering", "QA Team", "M005"),
]

PRICING = [
    ("github-copilot", 0.002, 0.008),
]

ZERO_USERS = [
    ("U0051", "Jordan Blake", "P001"),
    ("U0052", "Samira Khan", "P006"),
    ("U0053", "Wei Chen", "P008"),
    ("U0054", "Luca Bianchi", "P011"),
    ("U0055", "Aisha Rahman", "P015"),
]


def _add_columns():
    insp = inspect(engine)
    tables = insp.get_table_names()
    with engine.begin() as conn:
        if "users" in tables:
            cols = {c["name"] for c in insp.get_columns("users")}
            if "project_id" not in cols:
                conn.execute(text("ALTER TABLE users ADD COLUMN project_id INTEGER"))
            if "manager_id" not in cols:
                conn.execute(text("ALTER TABLE users ADD COLUMN manager_id INTEGER"))
        if "token_consumption" in tables:
            cols = {c["name"] for c in insp.get_columns("token_consumption")}
            if "input_tokens" not in cols:
                conn.execute(text("ALTER TABLE token_consumption ADD COLUMN input_tokens INTEGER DEFAULT 0"))
            if "output_tokens" not in cols:
                conn.execute(text("ALTER TABLE token_consumption ADD COLUMN output_tokens INTEGER DEFAULT 0"))
        if "token_requests" in tables:
            cols = {c["name"] for c in insp.get_columns("token_requests")}
            if "reviewed_by" not in cols:
                conn.execute(text("ALTER TABLE token_requests ADD COLUMN reviewed_by TEXT"))


def _insert_org(db: Session):
    if db.query(Manager).count() == 0:
        for i, (mid, name, email, dept) in enumerate(MANAGERS, start=1):
            db.add(Manager(id=i, manager_id=mid, name=name, email=email, department=dept, status="active"))
        db.flush()
    mgr = {m.manager_id: m for m in db.query(Manager).all()}
    if db.query(Project).count() == 0:
        for i, (pid, name, dept, team, mid) in enumerate(PROJECTS, start=1):
            db.add(Project(id=i, project_id=pid, project_name=name, department=dept, team=team,
                           manager_id=mgr[mid].id, status="active"))
        db.flush()


def _assign_users_to_projects(db: Session):
    projects = db.query(Project).order_by(Project.id).all()
    managers = {m.id: m for m in db.query(Manager).all()}
    if not projects:
        return
    users = db.query(User).filter(User.employee_id.like("U00%")).order_by(User.id).all()
    allocated = {u.employee_id for u in users if u.employee_id <= "U0050"}
    for i, u in enumerate(users):
        if u.employee_id > "U0050":
            continue
        p = projects[i % len(projects)]
        m = managers[p.manager_id]
        u.project_id = p.id
        u.manager_id = p.manager_id
        u.department = p.department
        u.team = p.team
        u.manager_email = m.email
    _ = allocated


def _add_zero_token_users(db: Session):
    db.flush()
    projects = {p.project_id: p for p in db.query(Project).all()}
    managers = {m.id: m for m in db.query(Manager).all()}
    max_id = db.query(User.id).order_by(User.id.desc()).first()
    next_id = (max_id[0] if max_id else 0) + 1
    cycle_end = CYCLE_START + timedelta(days=CYCLE_DAYS - 1)
    rnd = random.Random(7)
    for eid, name, pid in ZERO_USERS:
        if db.query(User).filter_by(employee_id=eid).first():
            continue
        p = projects[pid]
        m = managers[p.manager_id]
        db.add(User(id=next_id, employee_id=eid, name=name,
                    email=f"{name.lower().replace(' ', '.')}@acme.example",
                    department=p.department, team=p.team, manager_email=m.email,
                    status="active", project_id=p.id, manager_id=p.manager_id))
        db.add(TokenAllocation(user_id=next_id, allocated_tokens=0, cycle_start=CYCLE_START, cycle_end=cycle_end,
                               allocation_source="initial"))
        if eid in ("U0054", "U0055"):
            for d in range(3):
                total = rnd.randint(12, 80)
                inp = round(total * 0.4)
                db.add(TokenConsumption(
                    user_id=next_id, consumption_date=CYCLE_START + timedelta(days=d),
                    tokens_consumed=total, model=rnd.choice(MODELS),
                    input_tokens=inp, output_tokens=total - inp,
                ))
        next_id += 1


def _seed_pricing(db: Session):
    if db.query(ModelPricing).count():
        return
    for model, inp, out in PRICING:
        db.add(ModelPricing(model=model, input_cost_per_1k=inp, output_cost_per_1k=out))


def _backfill_token_splits(db: Session):
    for c in db.query(TokenConsumption).all():
        if (c.input_tokens or 0) + (c.output_tokens or 0) > 0:
            continue
        total = c.tokens_consumed or 0
        inp = round(total * 0.4)
        c.input_tokens = inp
        c.output_tokens = total - inp


def _seed_sample_request(db: Session):
    if db.query(TokenRequest).count():
        return
    u = db.query(User).filter_by(employee_id="U0051").first()
    if not u:
        return
    db.add(TokenRequest(
        request_id="TR-0001", user_id=u.id, project_id=u.project_id,
        requested_tokens=100_000, reason="New joiner onboarding — need Copilot/GPT quota for Application Server Modernization.",
        expected_usage="Daily code assist and design reviews, ~4k tokens/day.",
        status="PENDING",
    ))


def ensure_schema():
    """Add new tables/columns and demo org data without dropping existing rows."""
    Base.metadata.create_all(engine)
    _add_columns()
    db = SessionLocal()
    try:
        if db.query(User).count() == 0:
            db.close()
            seed()
            return
        _insert_org(db)
        _assign_users_to_projects(db)
        _add_zero_token_users(db)
        _seed_pricing(db)
        _backfill_token_splits(db)
        _seed_sample_request(db)
        db.commit()
    finally:
        db.close()


def seed():
    rnd = random.Random(42)
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    db = SessionLocal()
    _insert_org(db)
    db.flush()
    projects = db.query(Project).order_by(Project.id).all()
    managers = {m.id: m for m in db.query(Manager).all()}
    bands = [(55, 78)] * 25 + [(20, 45)] * 10 + [(83, 98)] * 10 + [(115, 160)] * 5
    rnd.shuffle(bands)
    cycle_end = CYCLE_START + timedelta(days=CYCLE_DAYS - 1)
    for i, (lo, hi) in enumerate(bands):
        uid = i + 1
        p = projects[i % len(projects)]
        m = managers[p.manager_id]
        name = f"{FIRST[i % len(FIRST)]} {LAST[(i * 7) % len(LAST)]}"
        db.add(User(id=uid, employee_id=f"U{uid:04d}", name=name,
                    email=f"{name.lower().replace(' ', '.')}@acme.example",
                    department=p.department, team=p.team, manager_email=m.email, status="active",
                    project_id=p.id, manager_id=p.manager_id))
        db.add(TokenAllocation(user_id=uid, allocated_tokens=ALLOC, cycle_start=CYCLE_START, cycle_end=cycle_end,
                               allocation_source="initial"))
        target_daily = (lo + rnd.random() * (hi - lo)) / 100 * ALLOC / CYCLE_DAYS
        for d in range(DAYS_ELAPSED):
            total = round(target_daily * (0.85 + rnd.random() * 0.3))
            inp = round(total * 0.4)
            db.add(TokenConsumption(user_id=uid, consumption_date=CYCLE_START + timedelta(days=d),
                                    tokens_consumed=total, model=rnd.choice(MODELS),
                                    input_tokens=inp, output_tokens=total - inp))
    db.flush()
    _add_zero_token_users(db)
    for i, n in enumerate(["Grace Hopper", "Alan Turing", "Ada Lovelace"]):
        db.add(Admin(id=i + 1, admin_id=f"A{i + 1:04d}", name=n, email=f"{n.split()[0].lower()}@acme.example"))
    _seed_pricing(db)
    _seed_sample_request(db)
    db.commit()
    db.close()
    print("Seeded ai_token_dashboard.db: 55 users, 5 managers, 15 projects, 3 admins")


if __name__ == "__main__":
    seed()
