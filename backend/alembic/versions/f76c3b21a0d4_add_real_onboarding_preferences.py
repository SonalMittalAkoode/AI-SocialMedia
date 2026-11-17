"""Real onboarding completion and additional editorial preferences.
Revision ID: f76c3b21a0d4
Revises: d76b2a10f9c3
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
revision='f76c3b21a0d4'
down_revision='d76b2a10f9c3'
branch_labels=depends_on=None
def upgrade():
    op.add_column('content_preferences',sa.Column('content_topics',JSONB,nullable=False,server_default=sa.text("'[]'::jsonb")))
    op.add_column('content_preferences',sa.Column('target_audience',sa.Text,nullable=True))
    op.add_column('content_preferences',sa.Column('visual_style',sa.Text,nullable=True))
    op.drop_constraint('ck_onboarding_completion','onboarding_progress',type_='check')
    op.create_check_constraint('ck_onboarding_completion','onboarding_progress',"(status = 'completed') = (completed_at IS NOT NULL)")
def downgrade():
    # Real completed records cannot be represented by the old demo-only constraint.
    # Refuse before dropping data, rather than rewriting users' completion flags.
    bind=op.get_bind()
    if bind.execute(sa.text("SELECT 1 FROM onboarding_progress WHERE status='completed' AND NOT demo_completed LIMIT 1")).first():
        raise RuntimeError('Real completed onboarding exists; export or explicitly reconcile before downgrade')
    op.drop_constraint('ck_onboarding_completion','onboarding_progress',type_='check')
    op.create_check_constraint('ck_onboarding_completion','onboarding_progress',"(status = 'completed') = (completed_at IS NOT NULL) AND (status <> 'completed' OR demo_completed)")
    for name in ('visual_style','target_audience','content_topics'):op.drop_column('content_preferences',name)
