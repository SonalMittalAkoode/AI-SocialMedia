"""Tenant IDs are resource locators, never authorization. Conceal unauthorized resources."""
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.models.onboarding import Workspace, WorkspaceMember, Company
from app.models.user import User


def workspace_access(db: Session, user: User, workspace_id, write=False):
    membership = db.scalar(select(WorkspaceMember).where(WorkspaceMember.workspace_id == workspace_id, WorkspaceMember.user_id == user.id))
    if not membership:
        raise HTTPException(404, "Workspace not found")
    if write and membership.role not in {"owner", "admin"}:
        raise HTTPException(403, "Owner or Admin permission required")
    return db.get(Workspace, workspace_id)


def company_access(db: Session, user: User, company_id, write=False):
    query = select(Company).join(WorkspaceMember, WorkspaceMember.workspace_id == Company.workspace_id).where(Company.id == company_id, WorkspaceMember.user_id == user.id)
    company = db.scalar(query.with_for_update(of=Company) if write else query)
    if company is None:
        raise HTTPException(404, "Company not found")
    workspace_access(db, user, company.workspace_id, write)
    return company
