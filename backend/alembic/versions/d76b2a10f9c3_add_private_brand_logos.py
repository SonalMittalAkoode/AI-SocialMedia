"""Private validated brand logo storage.
Revision ID: d76b2a10f9c3
Revises: c76a1f09e8b2
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID
revision="d76b2a10f9c3"
down_revision="c76a1f09e8b2"
branch_labels=depends_on=None
def upgrade():
    op.create_table("brand_logos",sa.Column("company_id",UUID(as_uuid=True),sa.ForeignKey("companies.id",ondelete="RESTRICT"),primary_key=True),sa.Column("storage_key",sa.String(150),nullable=False),sa.Column("mime_type",sa.String(50),nullable=False),sa.Column("width",sa.Integer,nullable=False),sa.Column("height",sa.Integer,nullable=False),sa.Column("size_bytes",sa.Integer,nullable=False),sa.Column("source_url",sa.String(2048),nullable=True),sa.Column("created_at",sa.DateTime(timezone=True),nullable=False,server_default=sa.func.now()))
def downgrade():op.drop_table("brand_logos")
