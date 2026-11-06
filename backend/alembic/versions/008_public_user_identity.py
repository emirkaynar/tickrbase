"""Add a public user UUID while retaining internal user keys."""
from alembic import op
import sqlalchemy as sa

revision = "008_public_user_identity"
down_revision = "007_history_sources"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "public_id", sa.Uuid(), nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
    )
    op.create_unique_constraint("uq_users_public_id", "users", ["public_id"])


def downgrade() -> None:
    op.drop_constraint("uq_users_public_id", "users", type_="unique")
    op.drop_column("users", "public_id")
