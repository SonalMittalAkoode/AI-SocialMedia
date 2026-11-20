"""Add an optional office address to companies."""

from alembic import op
import sqlalchemy as sa

revision = "0eaa6d711c8f"
down_revision = "f76c3b21a0d4"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("companies", sa.Column("office_address", sa.String(500), nullable=True))


def downgrade():
    op.drop_column("companies", "office_address")
