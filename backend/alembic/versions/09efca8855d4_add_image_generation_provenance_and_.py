"""add image generation provenance and review

Phase 8A.1. Additive only: nullable columns on post_assets for variation lineage,
prompt version, generation options, provider request id, duration, perceptual hash,
quality report and the user's accept/reject decision. Existing assets keep NULL values
(shown as "not checked"). No existing row is changed.

Revision ID: 09efca8855d4
Revises: 201c3d52e47b
Create Date: 2026-11-19 15:46:39.742338

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '09efca8855d4'
down_revision: Union[str, Sequence[str], None] = '201c3d52e47b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('post_assets', sa.Column('parent_asset_id', sa.UUID(), nullable=True))
    op.add_column('post_assets', sa.Column('generation_mode', sa.String(length=8), nullable=True))
    op.add_column('post_assets', sa.Column('prompt_version', sa.String(length=40), nullable=True))
    op.add_column('post_assets', sa.Column('generation_options', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column('post_assets', sa.Column('provider_request_id', sa.String(length=200), nullable=True))
    op.add_column('post_assets', sa.Column('duration_ms', sa.Integer(), nullable=True))
    op.add_column('post_assets', sa.Column('perceptual_hash', sa.String(length=16), nullable=True))
    op.add_column('post_assets', sa.Column('quality_status', sa.String(length=20), nullable=True))
    op.add_column('post_assets', sa.Column('quality_report', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column('post_assets', sa.Column('review_decision', sa.String(length=10), nullable=True))
    op.add_column('post_assets', sa.Column('reviewed_by', sa.UUID(), nullable=True))
    op.add_column('post_assets', sa.Column('reviewed_at', sa.DateTime(timezone=True), nullable=True))
    op.create_unique_constraint('uq_asset_company', 'post_assets', ['id', 'company_id'])
    op.create_foreign_key('fk_asset_parent', 'post_assets', 'post_assets', ['parent_asset_id', 'company_id'], ['id', 'company_id'], ondelete='RESTRICT')
    op.create_foreign_key('post_assets_reviewed_by_fkey', 'post_assets', 'users', ['reviewed_by'], ['id'], ondelete='RESTRICT')
    op.create_check_constraint('ck_asset_generation_mode', 'post_assets', "generation_mode IS NULL OR generation_mode IN ('fresh','edit')")
    op.create_check_constraint('ck_asset_quality_status', 'post_assets', "quality_status IS NULL OR quality_status IN ('ready_for_review','needs_review')")
    op.create_check_constraint('ck_asset_review_decision', 'post_assets', "review_decision IS NULL OR review_decision IN ('accepted','rejected')")
    op.create_check_constraint('ck_asset_review_time', 'post_assets', "(review_decision IS NULL) = (reviewed_at IS NULL)")


def downgrade() -> None:
    """Downgrade schema."""
    for name in ('ck_asset_review_time', 'ck_asset_review_decision', 'ck_asset_quality_status', 'ck_asset_generation_mode'):
        op.drop_constraint(name, 'post_assets', type_='check')
    op.drop_constraint('post_assets_reviewed_by_fkey', 'post_assets', type_='foreignkey')
    op.drop_constraint('fk_asset_parent', 'post_assets', type_='foreignkey')
    op.drop_constraint('uq_asset_company', 'post_assets', type_='unique')
    op.drop_column('post_assets', 'reviewed_at')
    op.drop_column('post_assets', 'reviewed_by')
    op.drop_column('post_assets', 'review_decision')
    op.drop_column('post_assets', 'quality_report')
    op.drop_column('post_assets', 'quality_status')
    op.drop_column('post_assets', 'perceptual_hash')
    op.drop_column('post_assets', 'duration_ms')
    op.drop_column('post_assets', 'provider_request_id')
    op.drop_column('post_assets', 'generation_options')
    op.drop_column('post_assets', 'prompt_version')
    op.drop_column('post_assets', 'generation_mode')
    op.drop_column('post_assets', 'parent_asset_id')
