"""Persist the company-scoped handoff from onboarding to Content Studio."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "87aa6b6cc390"
down_revision = "09efca8855d4"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("onboarding_progress", sa.Column("first_post", JSONB(), nullable=True))


def downgrade():
    op.drop_column("onboarding_progress", "first_post")
