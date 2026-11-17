from datetime import date
from typing import Literal
from uuid import UUID
from fastapi import HTTPException
from fastapi import APIRouter, Depends, Query
from app.api.auth import current_user
from app.api.onboarding import storage, request_policy
from app.core.permissions import company_access, workspace_access
from app.schemas.content import Platform, Status
from app.schemas.crm import DashboardSummary, LibraryPage, GenerationPage, DirectoryPage
from app.services import crm as service

router = APIRouter(tags=['CRM'], dependencies=[Depends(request_policy)])


@router.get('/companies/{company_id}/dashboard/summary', response_model=DashboardSummary)
def summary(company_id: UUID, user=Depends(current_user), db=Depends(storage)):
    return service.summary(db, company_access(db, user, company_id))


@router.get('/companies/{company_id}/post-library', response_model=LibraryPage)
def library(company_id: UUID, q: str = Query('', max_length=200), platform: Platform | None = None,
    status: Status | None = None, sort: Literal['created_desc', 'created_asc', 'updated_desc', 'updated_asc'] = 'updated_desc',
    limit: int = Query(25, ge=1, le=100), offset: int = Query(0, ge=0), created_from: date | None = None, created_to: date | None = None,
    media: Literal['with_image', 'text_only'] | None = None, user=Depends(current_user), db=Depends(storage)):
    company = company_access(db, user, company_id)
    if created_from and created_to and created_from > created_to:
        raise HTTPException(422, 'created_from must be on or before created_to')
    zone = service.zone_for(company)
    return service.library(db, company_id, q, platform, status, sort, limit, offset, created_from, created_to, zone, media) | {'company_timezone': zone}


@router.get('/companies/{company_id}/generation-history', response_model=GenerationPage)
def history(company_id: UUID, limit: int = Query(20, ge=1, le=100), offset: int = Query(0, ge=0),
    user=Depends(current_user), db=Depends(storage)):
    company_access(db, user, company_id)
    return service.generation_history(db, company_id, limit, offset)


@router.get('/workspaces/{workspace_id}/company-directory', response_model=DirectoryPage)
def directory(workspace_id: UUID, q: str = Query('', max_length=200), limit: int = Query(25, ge=1, le=100),
    offset: int = Query(0, ge=0), user=Depends(current_user), db=Depends(storage)):
    workspace_access(db, user, workspace_id)
    return service.directory(db, workspace_id, q, limit, offset)
