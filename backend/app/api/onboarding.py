from uuid import UUID
from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.exc import SQLAlchemyError
from fastapi import HTTPException

from app.api.auth import current_user, check_origin
from app.db.database import get_db
from app.models.user import User
from app.models.onboarding import Workspace, WorkspaceMember, Company
from app.core.permissions import workspace_access, company_access
from app.schemas.onboarding import WorkspaceCreate, WorkspaceUpdate, WorkspaceResponse, WorkspaceMemberResponse, CompanyCreate, CompanyUpdate, CompanyResponse, BrandProfileUpdate, BrandProfileResponse, ContentPreferencesUpdate, ContentPreferencesResponse, OnboardingProgressResponse, OnboardingStepUpdate, OnboardingCompleteStepRequest, Revision
from app.services import onboarding as service


def request_policy(request: Request, response: Response):
    response.headers["Cache-Control"] = "no-store"
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        check_origin(request)


router = APIRouter(tags=["Company onboarding"], dependencies=[Depends(request_policy)])


def storage(db: Session = Depends(get_db)):
    try:
        yield db
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(503, "Company storage is temporarily unavailable") from None


@router.post("/workspaces", response_model=WorkspaceResponse, status_code=201)
def create_workspace(data: WorkspaceCreate, user: User = Depends(current_user), db: Session = Depends(storage)):
    return service.create_workspace(db, user, data)


@router.get("/workspaces", response_model=list[WorkspaceResponse])
def workspaces(user: User = Depends(current_user), db: Session = Depends(storage)):
    return db.scalars(select(Workspace).join(WorkspaceMember).where(WorkspaceMember.user_id == user.id).order_by(Workspace.created_at, Workspace.id)).all()


@router.get("/workspaces/{workspace_id}", response_model=WorkspaceResponse)
def workspace(workspace_id: UUID, user: User = Depends(current_user), db: Session = Depends(storage)):
    return workspace_access(db, user, workspace_id)


@router.get("/workspaces/{workspace_id}/membership", response_model=WorkspaceMemberResponse)
def membership(workspace_id: UUID, user: User = Depends(current_user), db: Session = Depends(storage)):
    workspace_access(db, user, workspace_id)
    return db.scalar(select(WorkspaceMember).where(WorkspaceMember.workspace_id == workspace_id, WorkspaceMember.user_id == user.id))


@router.patch("/workspaces/{workspace_id}", response_model=WorkspaceResponse)
def update_workspace(workspace_id: UUID, data: WorkspaceUpdate, user: User = Depends(current_user), db: Session = Depends(storage)):
    workspace = workspace_access(db, user, workspace_id, True)
    service.check_revision(workspace, data.revision)
    with service.transaction(db):
        service.assign(workspace, data.model_dump(exclude_unset=True, exclude={"revision"}))
    return workspace


@router.post("/workspaces/{workspace_id}/companies", response_model=CompanyResponse, status_code=201)
def create_company(workspace_id: UUID, data: CompanyCreate, user: User = Depends(current_user), db: Session = Depends(storage)):
    return service.create_company(db, workspace_access(db, user, workspace_id, True), data)


@router.get("/workspaces/{workspace_id}/companies", response_model=list[CompanyResponse])
def companies(workspace_id: UUID, offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=100), user: User = Depends(current_user), db: Session = Depends(storage)):
    workspace_access(db, user, workspace_id)
    return db.scalars(select(Company).where(Company.workspace_id == workspace_id).order_by(Company.created_at, Company.id).offset(offset).limit(limit)).all()


@router.get("/companies/{company_id}", response_model=CompanyResponse)
def company(company_id: UUID, user: User = Depends(current_user), db: Session = Depends(storage)):
    return company_access(db, user, company_id)


@router.patch("/companies/{company_id}", response_model=CompanyResponse)
def update_company(company_id: UUID, data: CompanyUpdate, user: User = Depends(current_user), db: Session = Depends(storage)):
    return service.update_company(db, company_access(db, user, company_id, True), data)


@router.get("/companies/{company_id}/brand", response_model=BrandProfileResponse)
def brand(company_id: UUID, user: User = Depends(current_user), db: Session = Depends(storage)):
    return company_access(db, user, company_id).brand


@router.patch("/companies/{company_id}/brand", response_model=BrandProfileResponse)
def update_brand(company_id: UUID, data: BrandProfileUpdate, user: User = Depends(current_user), db: Session = Depends(storage)):
    return service.update_brand(db, company_access(db, user, company_id, True), data)


@router.post("/companies/{company_id}/brand/confirm", response_model=BrandProfileResponse)
def confirm_brand(company_id: UUID, data: Revision, user: User = Depends(current_user), db: Session = Depends(storage)):
    return service.confirm_brand(db, company_access(db, user, company_id, True), data)


@router.get("/companies/{company_id}/preferences", response_model=ContentPreferencesResponse)
def preferences(company_id: UUID, user: User = Depends(current_user), db: Session = Depends(storage)):
    return company_access(db, user, company_id).preferences


@router.put("/companies/{company_id}/preferences", response_model=ContentPreferencesResponse)
def update_preferences(company_id: UUID, data: ContentPreferencesUpdate, user: User = Depends(current_user), db: Session = Depends(storage)):
    return service.update_preferences(db, company_access(db, user, company_id, True), data)


@router.get("/companies/{company_id}/onboarding", response_model=OnboardingProgressResponse)
def onboarding(company_id: UUID, user: User = Depends(current_user), db: Session = Depends(storage)):
    return company_access(db, user, company_id).onboarding


@router.patch("/companies/{company_id}/onboarding", response_model=OnboardingProgressResponse)
def navigate(company_id: UUID, data: OnboardingStepUpdate, user: User = Depends(current_user), db: Session = Depends(storage)):
    return service.navigate(db, company_access(db, user, company_id, True), data)


@router.get("/companies/{company_id}/onboarding/readiness")
def readiness(company_id:UUID,user:User=Depends(current_user),db:Session=Depends(storage)):
    from app.models.content import Post
    company_access(db,user,company_id)
    return {"has_generated_post":db.scalar(select(Post.id).where(Post.company_id==company_id,Post.generation_job_id.is_not(None)).limit(1)) is not None}


@router.post("/companies/{company_id}/onboarding/complete-step", response_model=OnboardingProgressResponse)
def complete_step(company_id: UUID, data: OnboardingCompleteStepRequest, user: User = Depends(current_user), db: Session = Depends(storage)):
    return service.complete_step(db, company_access(db, user, company_id, True), data)


@router.post("/companies/{company_id}/onboarding/complete", response_model=OnboardingProgressResponse)
def complete(company_id: UUID, data: Revision, user: User = Depends(current_user), db: Session = Depends(storage)):
    return service.complete(db, company_access(db, user, company_id, True), data)
