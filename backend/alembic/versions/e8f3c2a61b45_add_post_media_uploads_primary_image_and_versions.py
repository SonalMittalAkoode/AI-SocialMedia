"""add post media uploads, result images, primary image and post versions

Revision ID: e8f3c2a61b45
Revises: c4e1a9b27d10
Create Date: 2026-11-17 13:10:00.000000

Additive only. Every existing post_assets row is provider output attached to a post,
so it receives source='generated' and satisfies the new ownership checks unchanged.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'e8f3c2a61b45'
down_revision: Union[str, Sequence[str], None] = 'c4e1a9b27d10'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SNAPSHOT_FIELDS = ("title", "platform", "content_type", "caption", "hashtags", "hook", "call_to_action", "image_prompt", "slides", "status", "primary_asset_id")


def upgrade() -> None:
    # --- assets: uploads, duplicates and images generated for unsaved results ---
    op.add_column('post_assets', sa.Column('source', sa.String(length=12), server_default='generated', nullable=False))
    op.add_column('post_assets', sa.Column('generation_job_id', sa.UUID(), nullable=True))
    op.add_column('post_assets', sa.Column('result_index', sa.Integer(), nullable=True))
    op.add_column('post_assets', sa.Column('original_filename', sa.String(length=255), nullable=True))
    op.add_column('post_assets', sa.Column('aspect_ratio', sa.String(length=8), nullable=True))
    op.add_column('post_assets', sa.Column('created_by', sa.UUID(), nullable=True))
    op.alter_column('post_assets', 'job_id', existing_type=sa.UUID(), nullable=True)
    op.alter_column('post_assets', 'post_id', existing_type=sa.UUID(), nullable=True)
    op.create_foreign_key('fk_asset_generation_job', 'post_assets', 'ai_jobs', ['generation_job_id', 'company_id'], ['id', 'company_id'], ondelete='RESTRICT')
    op.create_foreign_key('post_assets_created_by_fkey', 'post_assets', 'users', ['created_by'], ['id'], ondelete='RESTRICT')
    op.create_unique_constraint('uq_asset_post', 'post_assets', ['id', 'post_id'])
    op.create_check_constraint('ck_asset_source', 'post_assets', "source IN ('generated','uploaded','duplicated')")
    op.create_check_constraint('ck_asset_source_job', 'post_assets', "(source = 'generated') = (job_id IS NOT NULL)")
    op.create_check_constraint('ck_asset_owner', 'post_assets', "post_id IS NOT NULL OR (generation_job_id IS NOT NULL AND result_index IS NOT NULL)")
    op.create_check_constraint('ck_asset_result_index', 'post_assets', "result_index IS NULL OR result_index BETWEEN 0 AND 2")
    op.create_index('ix_asset_generation_result', 'post_assets', ['company_id', 'generation_job_id', 'result_index'], unique=False, postgresql_where=sa.text('generation_job_id IS NOT NULL'))

    # --- posts: primary image (must belong to the same post) ---
    op.add_column('posts', sa.Column('primary_asset_id', sa.UUID(), nullable=True))
    op.create_foreign_key('fk_post_primary_asset', 'posts', 'post_assets', ['primary_asset_id', 'id'], ['id', 'post_id'], ondelete='RESTRICT')

    # --- append-only post version history ---
    op.create_table('post_versions',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('post_id', sa.UUID(), nullable=False),
        sa.Column('company_id', sa.UUID(), nullable=False),
        sa.Column('revision', sa.Integer(), nullable=False),
        sa.Column('snapshot', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['company_id'], ['companies.id'], ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['post_id', 'company_id'], ['posts.id', 'posts.company_id'], ondelete='RESTRICT'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('post_id', 'revision', name='uq_post_version_revision'),
    )
    op.create_index(op.f('ix_post_versions_post_id'), 'post_versions', ['post_id'], unique=False)
    fields = ", ".join(f"'{f}', OLD.{f}" for f in SNAPSHOT_FIELDS)
    changed = " OR ".join(f"NEW.{f} IS DISTINCT FROM OLD.{f}" for f in SNAPSHOT_FIELDS)
    op.execute(f"""
      CREATE FUNCTION socialai_snapshot_post() RETURNS trigger
      LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
      BEGIN
        IF {changed} THEN
          INSERT INTO public.post_versions (id, post_id, company_id, revision, snapshot, created_at)
          VALUES (gen_random_uuid(), OLD.id, OLD.company_id, OLD.revision,
                  jsonb_build_object({fields}, 'updated_at', OLD.updated_at), statement_timestamp())
          ON CONFLICT (post_id, revision) DO NOTHING;
        END IF;
        RETURN NEW;
      END $$
    """)
    op.execute("CREATE TRIGGER snapshot_post_before_change AFTER UPDATE ON posts FOR EACH ROW EXECUTE FUNCTION socialai_snapshot_post()")
    op.execute("""
      CREATE FUNCTION socialai_immutable_post_version() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN
        RAISE EXCEPTION 'Post version history is append-only' USING ERRCODE='23514';
      END $$
    """)
    op.execute("CREATE TRIGGER immutable_post_version BEFORE UPDATE OR DELETE ON post_versions FOR EACH ROW EXECUTE FUNCTION socialai_immutable_post_version()")


def downgrade() -> None:
    # Data-removing downgrade is never run against the populated workspace.
    op.execute('DROP TRIGGER immutable_post_version ON post_versions')
    op.execute('DROP FUNCTION socialai_immutable_post_version()')
    op.execute('DROP TRIGGER snapshot_post_before_change ON posts')
    op.execute('DROP FUNCTION socialai_snapshot_post()')
    op.drop_index(op.f('ix_post_versions_post_id'), table_name='post_versions')
    op.drop_table('post_versions')
    op.drop_constraint('fk_post_primary_asset', 'posts', type_='foreignkey')
    op.drop_column('posts', 'primary_asset_id')
    op.drop_index('ix_asset_generation_result', table_name='post_assets', postgresql_where=sa.text('generation_job_id IS NOT NULL'))
    for name in ('ck_asset_result_index', 'ck_asset_owner', 'ck_asset_source_job', 'ck_asset_source'):
        op.drop_constraint(name, 'post_assets', type_='check')
    op.drop_constraint('uq_asset_post', 'post_assets', type_='unique')
    op.drop_constraint('post_assets_created_by_fkey', 'post_assets', type_='foreignkey')
    op.drop_constraint('fk_asset_generation_job', 'post_assets', type_='foreignkey')
    op.alter_column('post_assets', 'post_id', existing_type=sa.UUID(), nullable=False)
    op.alter_column('post_assets', 'job_id', existing_type=sa.UUID(), nullable=False)
    for column in ('created_by', 'aspect_ratio', 'original_filename', 'result_index', 'generation_job_id', 'source'):
        op.drop_column('post_assets', column)
