"""Opaque digest-backed browser sessions, independent of portfolio tables."""
from alembic import op
import sqlalchemy as sa

revision = "009_auth_sessions"
down_revision = "008_public_user_identity"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table("auth_sessions",
        sa.Column("token_digest", sa.String(64), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_auth_sessions_user_id", "auth_sessions", ["user_id"])
    op.create_index("ix_auth_sessions_expires_at", "auth_sessions", ["expires_at"])


def downgrade() -> None:
    op.drop_table("auth_sessions")
