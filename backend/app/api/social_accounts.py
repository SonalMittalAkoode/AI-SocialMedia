"""Company-scoped social account APIs and the provider-level OAuth callback (Phase 8A).

Members may read; owners/admins may connect, reconnect, verify and disconnect. Accounts of
other companies are concealed with 404. Responses never contain credentials.
"""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.api.auth import current_user
from app.api.onboarding import request_policy, storage
from app.core.auth_config import COOKIE_SAMESITE, COOKIE_SECURE
from app.core.permissions import company_access
from app.db.database import get_db
from app.models.user import User
from app.schemas.social_accounts import (AccountStatusResponse, AuthorizationStart, DisconnectResponse, PlatformList,
                                         SocialAccountList, SocialAccountResponse)
from app.services import social_accounts as service

router = APIRouter(prefix="/companies/{company_id}/social-accounts", tags=["Social accounts"],
                   dependencies=[Depends(request_policy)])
callback_router = APIRouter(prefix="/social-accounts/oauth", tags=["Social accounts"])


@router.get("", response_model=SocialAccountList)
def listing(company_id: UUID, include_disconnected: bool = False, user: User = Depends(current_user), db: Session = Depends(storage)):
    company_access(db, user, company_id)
    return service.list_accounts(db, company_id, include_disconnected)


@router.get("/platforms", response_model=PlatformList)
def platforms(company_id: UUID, user: User = Depends(current_user), db: Session = Depends(storage)):
    company_access(db, user, company_id)
    return service.platform_catalog()


def _set_binding_cookie(response: Response, name: str, value: str, max_age: int):
    response.set_cookie(key=name, value=value, max_age=max_age, path=service.CALLBACK_COOKIE_PATH,
                        httponly=True, secure=COOKIE_SECURE, samesite=COOKIE_SAMESITE)


@router.post("/{platform}/connect", response_model=AuthorizationStart)
def connect(company_id: UUID, platform: str, request: Request, response: Response,
            user: User = Depends(current_user), db: Session = Depends(storage)):
    company = company_access(db, user, company_id, write=True)
    body, name, value, max_age = service.start_authorization(db, company, user, platform.lower(), request.headers.get("origin"))
    _set_binding_cookie(response, name, value, max_age)
    return body


@router.get("/{account_id}", response_model=SocialAccountResponse)
def detail(company_id: UUID, account_id: UUID, user: User = Depends(current_user), db: Session = Depends(storage)):
    company_access(db, user, company_id)
    account = service.account_access(db, company_id, account_id)
    return service.serialize(account, service.credential_for(db, account))


@router.get("/{account_id}/status", response_model=AccountStatusResponse)
def status(company_id: UUID, account_id: UUID, user: User = Depends(current_user), db: Session = Depends(storage)):
    """Stored-state status only; no provider call."""
    company_access(db, user, company_id)
    account = service.account_access(db, company_id, account_id)
    return service.status_payload(account, service.credential_for(db, account))


@router.post("/{account_id}/reconnect", response_model=AuthorizationStart)
def reconnect(company_id: UUID, account_id: UUID, request: Request, response: Response,
              user: User = Depends(current_user), db: Session = Depends(storage)):
    company = company_access(db, user, company_id, write=True)
    account = service.account_access(db, company_id, account_id)
    body, name, value, max_age = service.start_authorization(db, company, user, "linkedin", request.headers.get("origin"), target=account)
    _set_binding_cookie(response, name, value, max_age)
    return body


@router.post("/{account_id}/verify", response_model=AccountStatusResponse)
def verify(company_id: UUID, account_id: UUID, user: User = Depends(current_user), db: Session = Depends(storage)):
    return service.verify(db, user, company_id, account_id)


@router.post("/{account_id}/disconnect", response_model=DisconnectResponse)
def disconnect(company_id: UUID, account_id: UUID, user: User = Depends(current_user), db: Session = Depends(storage)):
    return service.disconnect(db, company_access(db, user, company_id, write=True), user, account_id)


def optional_user(request: Request, db: Session = Depends(get_db)) -> User | None:
    try:
        return current_user(request, db)
    except HTTPException:
        return None


@callback_router.get("/linkedin/callback", include_in_schema=True)
def linkedin_callback(request: Request, state: str | None = None, code: str | None = None, error: str | None = None,
                      user: User | None = Depends(optional_user), db: Session = Depends(get_db)):
    # Lengths are bounded in the service, not here: a validation 422 would echo the code.
    # LinkedIn's error_description is deliberately ignored (never echoed, stored or logged).
    error = error[:100] if error else None
    target, cookie_name = service.handle_callback(db, {"state": state, "code": code, "error": error}, user, request.cookies)
    response = RedirectResponse(target, status_code=303)
    response.headers["Cache-Control"] = "no-store"
    # The callback URL carries the authorization code: never leak it through Referer.
    response.headers["Referrer-Policy"] = "no-referrer"
    if cookie_name:
        response.delete_cookie(cookie_name, path=service.CALLBACK_COOKIE_PATH, httponly=True,
                               secure=COOKIE_SECURE, samesite=COOKIE_SAMESITE)
    return response
