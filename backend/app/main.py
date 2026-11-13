
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from app.api.auth import router as auth_router

from app.db.database import engine

app.include_router(
    auth_router,
    prefix="/api/v1",
)

app = FastAPI(
    title="SocialAI API",
    description="AI-Powered Social Media SaaS",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Content-Type", "Authorization"],
)


@app.get("/")
def home():
    return {
        "message": "Welcome to SocialAI Backend"
    }


@app.get("/api/v1/health")
def health():
    return {
        "status": "ok",
        "service": "SocialAI API"
    }


@app.get("/api/v1/db-check")
def database_check():
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))

        return {
            "status": "connected",
            "database": "PostgreSQL"
        }

    except Exception:
        raise HTTPException(
            status_code=503,
            detail="Database connection unavailable"
        )
