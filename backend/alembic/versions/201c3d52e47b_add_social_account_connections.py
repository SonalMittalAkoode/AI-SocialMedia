"""add social account connections

Phase 8A. Additive only: creates social_accounts, social_account_credentials and
oauth_authorization_states. Existing tables (including post_schedules and its
ck_schedule_no_account guard) are not altered and no rows are backfilled.
Do not downgrade a deployment holding real connections: downgrade drops the three
new tables and therefore destroys the stored (encrypted) credentials.

Revision ID: 201c3d52e47b
Revises: 0eaa6d711c8f
Create Date: 2026-11-19 11:54:31.712775

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '201c3d52e47b'
down_revision: Union[str, Sequence[str], None] = '0eaa6d711c8f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('social_accounts',
    sa.Column('company_id', sa.UUID(), nullable=False),
    sa.Column('platform', sa.String(length=20), nullable=False),
    sa.Column('provider_account_id', sa.String(length=255), nullable=False),
    sa.Column('account_type', sa.String(length=20), server_default='person', nullable=False),
    sa.Column('display_name', sa.String(length=300), nullable=True),
    sa.Column('email', sa.String(length=320), nullable=True),
    sa.Column('email_verified', sa.Boolean(), nullable=True),
    sa.Column('avatar_url', sa.Text(), nullable=True),
    sa.Column('capabilities', postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'[]'::jsonb"), nullable=False),
    sa.Column('granted_scopes', postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'[]'::jsonb"), nullable=False),
    sa.Column('status', sa.String(length=24), nullable=False),
    sa.Column('last_error_code', sa.String(length=40), nullable=True),
    sa.Column('connected_by', sa.UUID(), nullable=False),
    sa.Column('connected_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('last_verified_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('token_expires_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('refresh_token_expires_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('disconnected_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('disconnected_by', sa.UUID(), nullable=True),
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('revision', sa.Integer(), server_default='1', nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("(status = 'disconnected') = (disconnected_at IS NOT NULL)", name='ck_social_account_disconnected'),
    sa.CheckConstraint("account_type IN ('person','organization')", name='ck_social_account_type'),
    sa.CheckConstraint("jsonb_typeof(capabilities) = 'array' AND jsonb_typeof(granted_scopes) = 'array'", name='ck_social_account_json'),
    sa.CheckConstraint("platform IN ('LinkedIn','Instagram','Facebook','X')", name='ck_social_account_platform'),
    sa.CheckConstraint("status IN ('connected','limited','reconnect_required','disconnected','error')", name='ck_social_account_status'),
    sa.CheckConstraint('length(provider_account_id) > 0', name='ck_social_account_provider_id'),
    sa.ForeignKeyConstraint(['company_id'], ['companies.id'], ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['connected_by'], ['users.id'], ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['disconnected_by'], ['users.id'], ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('company_id', 'platform', 'provider_account_id', name='uq_social_account_identity'),
    sa.UniqueConstraint('id', 'company_id', name='uq_social_account_company')
    )
    op.create_index('ix_social_account_company_status', 'social_accounts', ['company_id', 'status'], unique=False)
    op.create_table('oauth_authorization_states',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('state_hash', sa.String(length=64), nullable=False),
    sa.Column('nonce_hash', sa.String(length=64), nullable=False),
    sa.Column('binding_hash', sa.String(length=64), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('company_id', sa.UUID(), nullable=False),
    sa.Column('platform', sa.String(length=20), nullable=False),
    sa.Column('purpose', sa.String(length=12), nullable=False),
    sa.Column('target_account_id', sa.UUID(), nullable=True),
    sa.Column('redirect_uri', sa.Text(), nullable=False),
    sa.Column('return_origin', sa.Text(), nullable=False),
    sa.Column('requested_scopes', postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'[]'::jsonb"), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('consumed_at', sa.DateTime(timezone=True), nullable=True),
    sa.CheckConstraint("(purpose = 'reconnect') = (target_account_id IS NOT NULL)", name='ck_oauth_state_target'),
    sa.CheckConstraint("jsonb_typeof(requested_scopes) = 'array'", name='ck_oauth_state_scopes'),
    sa.CheckConstraint("platform IN ('LinkedIn','Instagram','Facebook','X')", name='ck_oauth_state_platform'),
    sa.CheckConstraint("purpose IN ('connect','reconnect')", name='ck_oauth_state_purpose'),
    sa.CheckConstraint('expires_at > created_at', name='ck_oauth_state_expiry'),
    sa.CheckConstraint('length(state_hash) = 64 AND length(nonce_hash) = 64 AND length(binding_hash) = 64', name='ck_oauth_state_hashes'),
    sa.ForeignKeyConstraint(['company_id'], ['companies.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['target_account_id', 'company_id'], ['social_accounts.id', 'social_accounts.company_id'], name='fk_oauth_state_target_company', ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('state_hash')
    )
    op.create_index(op.f('ix_oauth_authorization_states_user_id'), 'oauth_authorization_states', ['user_id'], unique=False)
    op.create_index('ix_oauth_state_company', 'oauth_authorization_states', ['company_id'], unique=False)
    op.create_index('ix_oauth_state_expires', 'oauth_authorization_states', ['expires_at'], unique=False)
    op.create_index('ix_oauth_state_target', 'oauth_authorization_states', ['target_account_id'], unique=False)
    op.create_table('social_account_credentials',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('social_account_id', sa.UUID(), nullable=False),
    sa.Column('company_id', sa.UUID(), nullable=False),
    sa.Column('key_version', sa.Integer(), nullable=False),
    sa.Column('access_token_ciphertext', sa.LargeBinary(), nullable=False),
    sa.Column('refresh_token_ciphertext', sa.LargeBinary(), nullable=True),
    sa.Column('granted_scopes', postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'[]'::jsonb"), nullable=False),
    sa.Column('access_token_expires_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('refresh_token_expires_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("jsonb_typeof(granted_scopes) = 'array'", name='ck_credential_scopes'),
    sa.CheckConstraint('(refresh_token_ciphertext IS NULL) OR (length(refresh_token_ciphertext) > 12)', name='ck_credential_refresh_token'),
    sa.CheckConstraint('key_version > 0', name='ck_credential_key_version'),
    sa.CheckConstraint('length(access_token_ciphertext) > 12', name='ck_credential_access_token'),
    sa.CheckConstraint('refresh_token_ciphertext IS NOT NULL OR refresh_token_expires_at IS NULL', name='ck_credential_refresh_expiry'),
    sa.ForeignKeyConstraint(['social_account_id', 'company_id'], ['social_accounts.id', 'social_accounts.company_id'], name='fk_credential_account_company', ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('social_account_id', name='uq_credential_account')
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('social_account_credentials')
    op.drop_index('ix_oauth_state_target', table_name='oauth_authorization_states')
    op.drop_index('ix_oauth_state_expires', table_name='oauth_authorization_states')
    op.drop_index('ix_oauth_state_company', table_name='oauth_authorization_states')
    op.drop_index(op.f('ix_oauth_authorization_states_user_id'), table_name='oauth_authorization_states')
    op.drop_table('oauth_authorization_states')
    op.drop_index('ix_social_account_company_status', table_name='social_accounts')
    op.drop_table('social_accounts')
