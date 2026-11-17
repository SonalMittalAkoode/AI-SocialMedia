"""Exercise the real PostgreSQL schema inside transactions rolled back after each test."""
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.db.database import engine, get_db
from app.main import app


@pytest.fixture
def db():
    connection = engine.connect()
    transaction = connection.begin()
    session = Session(bind=connection, join_transaction_mode="create_savepoint")
    try:
        yield session
    finally:
        session.close()
        transaction.rollback()
        connection.close()


@pytest.fixture
def client(db):
    def test_db():
        yield db

    app.dependency_overrides[get_db] = test_db
    try:
        with TestClient(app, base_url="http://localhost:8000", headers={"Origin": "http://localhost:3000"}) as client:
            yield client
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.fixture
def credentials():
    return {"full_name": "Auth Test User", "email": f"auth-test-{uuid.uuid4().hex}@example.com", "password": "TestPassword123!"}
