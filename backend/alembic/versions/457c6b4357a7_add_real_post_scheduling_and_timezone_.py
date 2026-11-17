"""add real post scheduling and timezone support

Revision ID: 457c6b4357a7
Revises: 42e2d03f6e9d
Create Date: 2026-11-16 13:10:49.842291

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '457c6b4357a7'
down_revision: Union[str, Sequence[str], None] = '42e2d03f6e9d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Catalog-backed validation avoids a tenant-specific or environment-specific
    # timezone backfill. Existing NULL company choices remain unspecified.
    op.execute("""
        CREATE FUNCTION socialai_is_timezone(zone_name text) RETURNS boolean
        LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
          SELECT length(zone_name) <= 100
            AND zone_name NOT IN ('localtime', 'posixrules')
            AND zone_name NOT LIKE 'posix/%' AND zone_name NOT LIKE 'right/%'
            AND EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = zone_name)
        $$
    """)
    op.create_table('post_schedules',
    sa.Column('company_id', sa.UUID(), nullable=False),
    sa.Column('post_id', sa.UUID(), nullable=False),
    sa.Column('created_by', sa.UUID(), nullable=False),
    sa.Column('target_platform', sa.String(length=20), nullable=False),
    sa.Column('social_account_id', sa.UUID(), nullable=True),
    sa.Column('scheduled_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('timezone', sa.String(length=100), nullable=False),
    sa.Column('status', sa.String(length=24), server_default='scheduled', nullable=False),
    sa.Column('post_revision', sa.Integer(), nullable=False),
    sa.Column('idempotency_key', sa.UUID(), nullable=False),
    sa.Column('failure_code', sa.String(length=40), nullable=True),
    sa.Column('failure_message', sa.Text(), nullable=True),
    sa.Column('claimed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('cancelled_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('revision', sa.Integer(), server_default='1', nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("(status = 'cancelled') = (cancelled_at IS NOT NULL)", name='ck_schedule_cancelled'),
    sa.CheckConstraint("(status IN ('blocked','failed')) = (failure_code IS NOT NULL AND failure_message IS NOT NULL) AND (status IN ('blocked','failed') OR (failure_code IS NULL AND failure_message IS NULL))", name='ck_schedule_failure'),
    sa.CheckConstraint("status <> 'awaiting_publisher' OR claimed_at IS NOT NULL", name='ck_schedule_claimed'),
    sa.CheckConstraint("status IN ('scheduled','awaiting_publisher','blocked','cancelled','failed')", name='ck_schedule_status'),
    sa.CheckConstraint("target_platform IN ('Instagram','LinkedIn','Facebook','X')", name='ck_schedule_platform'),
    sa.CheckConstraint('cancelled_at IS NULL OR isfinite(cancelled_at)', name='ck_schedule_cancel_instant'),
    sa.CheckConstraint('claimed_at IS NULL OR isfinite(claimed_at)', name='ck_schedule_claim_instant'),
    sa.CheckConstraint('isfinite(scheduled_at)', name='ck_schedule_instant'),
    sa.CheckConstraint('post_revision > 0 AND revision > 0', name='ck_schedule_revisions'),
    sa.CheckConstraint('social_account_id IS NULL', name='ck_schedule_no_account'),
    sa.CheckConstraint('socialai_is_timezone(timezone)', name='ck_schedule_timezone'),
    sa.ForeignKeyConstraint(['company_id'], ['companies.id'], ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['post_id', 'company_id'], ['posts.id', 'posts.company_id'], name='fk_schedule_post_company', ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('company_id', 'idempotency_key', name='uq_schedule_creation')
    )
    op.create_index('ix_schedule_calendar', 'post_schedules', ['company_id', 'scheduled_at', 'id'], unique=False)
    op.create_index('ix_schedule_due', 'post_schedules', ['scheduled_at', 'id'], unique=False, postgresql_where=sa.text("status = 'scheduled'"))
    op.create_index('ix_schedule_post', 'post_schedules', ['post_id', 'company_id'], unique=False)
    op.create_index('uq_schedule_active', 'post_schedules', ['company_id', 'post_id', 'target_platform'], unique=True, postgresql_where=sa.text("status IN ('scheduled','awaiting_publisher','blocked')"))
    op.add_column('companies', sa.Column('timezone', sa.String(length=100), nullable=True))
    op.create_check_constraint('ck_company_timezone', 'companies', 'timezone IS NULL OR socialai_is_timezone(timezone)')
    op.execute("""
      CREATE FUNCTION socialai_schedule_guard() RETURNS trigger
      LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
      DECLARE source_post public.posts%ROWTYPE;
              plan_changed boolean := false;
      BEGIN
        IF TG_OP = 'INSERT' THEN
          IF NEW.status <> 'scheduled' THEN
            RAISE EXCEPTION 'New schedules must start scheduled' USING ERRCODE='23514';
          END IF;
        ELSE
          IF NEW IS NOT DISTINCT FROM OLD THEN RETURN OLD; END IF;
          IF ROW(NEW.company_id, NEW.post_id, NEW.created_by, NEW.target_platform, NEW.idempotency_key, NEW.created_at, NEW.id)
             IS DISTINCT FROM ROW(OLD.company_id, OLD.post_id, OLD.created_by, OLD.target_platform, OLD.idempotency_key, OLD.created_at, OLD.id) THEN
            RAISE EXCEPTION 'Schedule identity is immutable' USING ERRCODE='23514';
          END IF;
          IF NOT (
             (OLD.status='scheduled' AND NEW.status IN ('scheduled','awaiting_publisher','blocked','cancelled','failed')) OR
             (OLD.status='awaiting_publisher' AND NEW.status IN ('scheduled','awaiting_publisher','blocked','cancelled','failed')) OR
             (OLD.status='blocked' AND NEW.status IN ('blocked','scheduled','cancelled'))
          ) THEN
            RAISE EXCEPTION 'Invalid schedule transition' USING ERRCODE='23514';
          END IF;
          plan_changed := ROW(NEW.scheduled_at, NEW.timezone, NEW.post_revision)
                          IS DISTINCT FROM ROW(OLD.scheduled_at, OLD.timezone, OLD.post_revision);
          IF plan_changed AND NEW.status <> 'scheduled' THEN
            RAISE EXCEPTION 'Plan changes require explicit rescheduling' USING ERRCODE='23514';
          END IF;
        END IF;

        IF NEW.status IN ('scheduled','awaiting_publisher') THEN
          SELECT * INTO source_post FROM public.posts
           WHERE id=NEW.post_id AND company_id=NEW.company_id FOR UPDATE;
          IF NOT FOUND OR source_post.status <> 'approved'
             OR source_post.revision <> NEW.post_revision
             OR source_post.platform <> NEW.target_platform THEN
            RAISE EXCEPTION 'Schedule requires the current approved company post and platform'
              USING ERRCODE='23514', CONSTRAINT='ck_schedule_approved_post';
          END IF;
        END IF;
        IF TG_OP='INSERT' OR (NEW.status='scheduled' AND (OLD.status<>'scheduled' OR plan_changed)) THEN
          IF NEW.scheduled_at <= statement_timestamp() THEN
            RAISE EXCEPTION 'Schedule time must be in the future' USING ERRCODE='23514';
          END IF;
        END IF;
        IF NEW.status='awaiting_publisher' THEN
          IF NEW.scheduled_at > statement_timestamp() THEN
            RAISE EXCEPTION 'Scheduled instant has not arrived' USING ERRCODE='23514';
          END IF;
          IF TG_OP='UPDATE' AND OLD.status <> 'awaiting_publisher' THEN
            NEW.claimed_at := statement_timestamp();
          END IF;
        ELSIF NEW.status='scheduled' THEN
          NEW.claimed_at := NULL;
        END IF;
        IF NEW.status='cancelled' THEN
          NEW.cancelled_at := statement_timestamp();
        ELSE
          NEW.cancelled_at := NULL;
        END IF;
        IF NEW.status='blocked' THEN
          IF NEW.failure_code NOT IN ('post_changed','post_unapproved','post_archived') OR NEW.failure_code IS NULL THEN
            RAISE EXCEPTION 'A blocked schedule needs a known approval failure' USING ERRCODE='23514';
          END IF;
          NEW.failure_message := 'Post changed or approval was removed. Review, approve and explicitly reschedule.';
        ELSIF NEW.status='failed' THEN
          NEW.failure_code := 'scheduling_error';
          NEW.failure_message := 'Scheduling encountered a terminal internal error. Review before creating a new schedule.';
        ELSE
          NEW.failure_code := NULL; NEW.failure_message := NULL;
        END IF;
        IF TG_OP='UPDATE' THEN
          NEW.revision := OLD.revision + 1;
          NEW.updated_at := statement_timestamp();
        END IF;
        RETURN NEW;
      END $$
    """)
    op.execute("CREATE TRIGGER schedule_guard BEFORE INSERT OR UPDATE ON post_schedules FOR EACH ROW EXECUTE FUNCTION socialai_schedule_guard()")
    op.execute("""
      CREATE FUNCTION socialai_block_changed_post() RETURNS trigger
      LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
      BEGIN
        UPDATE public.post_schedules
           SET status='blocked', failure_code=CASE
                 WHEN NEW.status='archived' THEN 'post_archived'
                 WHEN NEW.revision<>OLD.revision THEN 'post_changed'
                 WHEN NEW.status<>'approved' THEN 'post_unapproved'
                 ELSE 'post_changed' END
         WHERE company_id=NEW.company_id AND post_id=NEW.id
           AND status IN ('scheduled','awaiting_publisher');
        RETURN NEW;
      END $$
    """)
    op.execute("""CREATE TRIGGER block_schedules_on_post_change AFTER UPDATE ON posts
        FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*)
        EXECUTE FUNCTION socialai_block_changed_post()""")


def downgrade() -> None:
    """Downgrade schema."""
    # Data-removing downgrade is never run against the populated workspace.
    op.execute('DROP TRIGGER block_schedules_on_post_change ON posts')
    op.execute('DROP FUNCTION socialai_block_changed_post()')
    op.execute('DROP TRIGGER schedule_guard ON post_schedules')
    op.execute('DROP FUNCTION socialai_schedule_guard()')
    op.drop_constraint('ck_company_timezone', 'companies', type_='check')
    op.drop_column('companies', 'timezone')
    op.drop_index('uq_schedule_active', table_name='post_schedules', postgresql_where=sa.text("status IN ('scheduled','awaiting_publisher','blocked')"))
    op.drop_index('ix_schedule_post', table_name='post_schedules')
    op.drop_index('ix_schedule_due', table_name='post_schedules', postgresql_where=sa.text("status = 'scheduled'"))
    op.drop_index('ix_schedule_calendar', table_name='post_schedules')
    op.drop_table('post_schedules')
    op.execute('DROP FUNCTION socialai_is_timezone(text)')
