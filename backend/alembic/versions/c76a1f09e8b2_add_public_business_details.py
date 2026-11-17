"""Add optional public business details without touching existing rows.

Revision ID: c76a1f09e8b2
Revises: e8f3c2a61b45
"""
from alembic import op
import sqlalchemy as sa

revision = "c76a1f09e8b2"
down_revision = "e8f3c2a61b45"
branch_labels = depends_on = None


def upgrade():
    op.add_column("companies", sa.Column("state", sa.String(150), nullable=True))
    op.add_column("companies", sa.Column("public_email", sa.String(254), nullable=True))
    op.add_column("companies", sa.Column("public_phone", sa.String(100), nullable=True))


def downgrade():
    for name in ("public_phone", "public_email", "state"):
        op.drop_column("companies", name)
