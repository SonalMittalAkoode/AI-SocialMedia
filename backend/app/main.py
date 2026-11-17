
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.db.database import engine
from app.api.auth import router as auth_router
from app.api.onboarding import router as onboarding_router
from app.api.brand_extractions import router as extraction_router
from app.api.intelligence import router as intelligence_router
from app.api.content import router as content_router
from app.api.scheduling import router as scheduling_router
from app.api.crm import router as crm_router
from app.core.auth_config import FRONTEND_ORIGINS


# 1. Create the FastAPI application
app = FastAPI(
    title="SocialAI API",
    description="AI-Powered Social Media SaaS Backend",
    version="1.0.0",
)


# 2. Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(FRONTEND_ORIGINS),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Content-Type", "Authorization"],
)


# 3. Register authentication routes
app.include_router(
    auth_router,
    prefix="/api/v1",
)
app.include_router(onboarding_router, prefix="/api/v1")
app.include_router(extraction_router, prefix="/api/v1")
app.include_router(intelligence_router, prefix="/api/v1")
app.include_router(content_router, prefix="/api/v1")
app.include_router(scheduling_router, prefix="/api/v1")
app.include_router(crm_router, prefix="/api/v1")


@app.exception_handler(RequestValidationError)
async def safe_auth_validation(request, exc: RequestValidationError):
    if request.url.path.startswith("/api/v1/auth/"):
        # FastAPI's default validation response includes rejected input, including passwords.
        errors = [{"loc": error["loc"], "msg": error["msg"], "type": error["type"]} for error in exc.errors()]
        return JSONResponse(status_code=422, content={"detail": errors}, headers={"Cache-Control": "no-store"})
    return await request_validation_exception_handler(request, exc)


# 4. Home endpoint
@app.get("/")
def home():
    return {
        "message": "Welcome to SocialAI Backend"
    }


# 5. Health check
@app.get("/api/v1/health")
def health():
    return {
        "status": "ok",
        "service": "SocialAI API",
    }


# 6. Database connection check
@app.get("/api/v1/db-check")
def database_check():
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))

        return {
            "status": "connected",
            "database": "PostgreSQL",
        }

    except Exception:
        raise HTTPException(
            status_code=503,
            detail="Database connection unavailable",
        )
