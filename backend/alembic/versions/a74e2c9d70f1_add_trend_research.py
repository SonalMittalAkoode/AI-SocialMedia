"""Independent trend notes and a display-only search journal kind."""
import sqlalchemy as sa
from alembic import op

revision = "a74e2c9d70f1"
down_revision = "87aa6b6cc390"
branch_labels = None
depends_on = None

PREVIOUS_KINDS = "'competitor_discovery','competitor_research','content_generation','image_generation'"


def upgrade():
    op.drop_constraint("ck_ai_job_kind", "ai_jobs", type_="check")
    op.create_check_constraint("ck_ai_job_kind", "ai_jobs", f"kind IN ({PREVIOUS_KINDS},'trend_search')")
    op.create_table(
        "trend_notes",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("company_id", sa.Uuid(), sa.ForeignKey("companies.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("creation_key", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(180), nullable=False),
        sa.Column("source_url", sa.String(2048), nullable=False),
        sa.Column("published_on", sa.Date()),
        sa.Column("finding", sa.Text(), nullable=False),
        sa.Column("dismissed_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("company_id", "creation_key", name="uq_trend_note_creation"),
    )
    op.create_index("ix_trend_notes_company_id", "trend_notes", ["company_id"])


def downgrade():
    # Keep historical notes and usage rather than silently discarding them.
    conn = op.get_bind()
    if conn.scalar(sa.text("SELECT EXISTS (SELECT 1 FROM trend_notes) OR EXISTS (SELECT 1 FROM ai_jobs WHERE kind = 'trend_search')")):
        raise RuntimeError("Archive retained trend records explicitly before rolling back Phase 9A.")
    op.drop_table("trend_notes")
    op.drop_constraint("ck_ai_job_kind", "ai_jobs", type_="check")
    op.create_check_constraint("ck_ai_job_kind", "ai_jobs", f"kind IN ({PREVIOUS_KINDS})")

