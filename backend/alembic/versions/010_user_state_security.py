"""Owned non-portfolio relationships and layout revisions (dev-only reset)."""
from alembic import op
import sqlalchemy as sa

revision = "010_user_state_security"
down_revision = "009_auth_sessions"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("user_layouts",
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="0"))
    op.create_unique_constraint("uq_screen_owner_id", "user_screens", ["user_id", "id"])
    op.create_unique_constraint("uq_widget_owner_id", "user_widgets", ["user_id", "id"])
    op.create_foreign_key("fk_widget_owned_screen", "user_widgets", "user_screens", ["user_id", "screen_id"], ["user_id", "id"], ondelete="CASCADE")
    op.create_foreign_key("fk_state_owned_widget", "user_widget_states", "user_widgets", ["user_id", "widget_id"], ["user_id", "id"], ondelete="CASCADE")
    op.create_unique_constraint("uq_table_pref_scope", "user_table_prefs", ["user_id", "scope_type", "scope_id", "table_id"])


def downgrade():
    op.drop_constraint("uq_table_pref_scope", "user_table_prefs")
    op.drop_constraint("fk_state_owned_widget", "user_widget_states")
    op.drop_constraint("fk_widget_owned_screen", "user_widgets")
    op.drop_constraint("uq_widget_owner_id", "user_widgets")
    op.drop_constraint("uq_screen_owner_id", "user_screens")
    op.drop_table("user_layouts")
