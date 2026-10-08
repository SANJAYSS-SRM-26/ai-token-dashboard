from datetime import datetime
from sqlalchemy import Column, Date, DateTime, Float, ForeignKey, Integer, String, Text
from database import Base


class Manager(Base):
    __tablename__ = "managers"
    id = Column(Integer, primary_key=True)
    manager_id = Column(String, unique=True, index=True, nullable=False)
    name = Column(String, nullable=False)
    email = Column(String, nullable=False)
    department = Column(String, nullable=False)
    status = Column(String, default="active")


class Project(Base):
    __tablename__ = "projects"
    id = Column(Integer, primary_key=True)
    project_id = Column(String, unique=True, index=True, nullable=False)
    project_name = Column(String, nullable=False)
    department = Column(String, nullable=False)
    team = Column(String, nullable=False)
    manager_id = Column(Integer, ForeignKey("managers.id"), nullable=False)
    status = Column(String, default="active")


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    employee_id = Column(String, unique=True, index=True, nullable=False)
    name = Column(String, nullable=False)
    email = Column(String, nullable=False)
    department = Column(String, nullable=False)
    team = Column(String, nullable=False)
    manager_email = Column(String, nullable=False)
    status = Column(String, default="active")
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=True)
    manager_id = Column(Integer, ForeignKey("managers.id"), nullable=True)


class Admin(Base):
    __tablename__ = "admins"
    id = Column(Integer, primary_key=True)
    admin_id = Column(String, unique=True, index=True, nullable=False)
    name = Column(String, nullable=False)
    email = Column(String, nullable=False)
    status = Column(String, default="active")


class TokenAllocation(Base):
    __tablename__ = "token_allocations"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    allocated_tokens = Column(Integer, nullable=False)  # negative rows = tokens given away
    cycle_start = Column(Date, nullable=False)
    cycle_end = Column(Date, nullable=False)
    allocation_source = Column(String, default="initial")


class TokenConsumption(Base):
    __tablename__ = "token_consumption"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    consumption_date = Column(Date, nullable=False)
    tokens_consumed = Column(Integer, nullable=False)
    model = Column(String, nullable=False)
    input_tokens = Column(Integer, default=0)
    output_tokens = Column(Integer, default=0)


class QuotaReallocation(Base):
    __tablename__ = "quota_reallocations"
    id = Column(Integer, primary_key=True)
    from_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    to_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    tokens_transferred = Column(Integer, nullable=False)
    reason = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class AlertRow(Base):
    __tablename__ = "alerts"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    alert_type = Column(String, nullable=False)
    message = Column(Text, nullable=False)
    recipient = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id = Column(Integer, primary_key=True)
    action = Column(String, nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    details = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class ModelPricing(Base):
    __tablename__ = "model_pricing"
    id = Column(Integer, primary_key=True)
    model = Column(String, unique=True, nullable=False)
    input_cost_per_1k = Column(Float, nullable=False)
    output_cost_per_1k = Column(Float, nullable=False)


class TokenRequest(Base):
    __tablename__ = "token_requests"
    id = Column(Integer, primary_key=True)
    request_id = Column(String, unique=True, index=True, nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=True)
    requested_tokens = Column(Integer, nullable=False)
    approved_tokens = Column(Integer, nullable=True)
    reason = Column(Text, nullable=False)
    expected_usage = Column(Text, nullable=True)
    status = Column(String, default="PENDING")
    rejection_reason = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    reviewed_at = Column(DateTime, nullable=True)
    reviewed_by = Column(String, nullable=True)
