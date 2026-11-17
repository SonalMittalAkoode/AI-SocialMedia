"""add targeted ai jobs, research batches and competitor soft removal

Revision ID: c4e1a9b27d10
Revises: ba56aacf52ad
Create Date: 2026-11-17 12:40:00.000000

Additive only. Existing ai_jobs rows receive target_key '' which preserves the
previous one-active-job-per-company-and-kind rule for every existing kind.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c4e1a9b27d10'
down_revision: Union[str, Sequence[str], None] = 'ba56aacf52ad'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

ACTIVE = sa.text("status IN ('queued','running')")


def upgrade() -> None:
    op.add_column('ai_jobs', sa.Column('target_key', sa.String(length=80), server_default='', nullable=False))
    op.add_column('ai_jobs', sa.Column('batch_id', sa.UUID(), nullable=True))
    op.drop_index('uq_ai_job_active', table_name='ai_jobs', postgresql_where=ACTIVE)
    op.create_index('uq_ai_job_active', 'ai_jobs', ['company_id', 'kind', 'target_key'], unique=True, postgresql_where=ACTIVE)
    op.create_index('ix_ai_job_batch', 'ai_jobs', ['company_id', 'batch_id'], unique=False, postgresql_where=sa.text('batch_id IS NOT NULL'))
    op.create_index('ix_ai_job_target', 'ai_jobs', ['company_id', 'kind', 'target_key', 'created_at'], unique=False)
    op.add_column('competitors', sa.Column('removed_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    # Restoring the narrower index fails if several targeted jobs are active; that is intentional.
    op.drop_column('competitors', 'removed_at')
    op.drop_index('ix_ai_job_target', table_name='ai_jobs')
    op.drop_index('ix_ai_job_batch', table_name='ai_jobs', postgresql_where=sa.text('batch_id IS NOT NULL'))
    op.drop_index('uq_ai_job_active', table_name='ai_jobs', postgresql_where=ACTIVE)
    op.create_index('uq_ai_job_active', 'ai_jobs', ['company_id', 'kind'], unique=True, postgresql_where=ACTIVE)
    op.drop_column('ai_jobs', 'batch_id')
    op.drop_column('ai_jobs', 'target_key')
