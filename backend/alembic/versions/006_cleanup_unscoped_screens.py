"""cleanup unscoped screens

Revision ID: 006_cleanup_unscoped_screens
Revises: 005_portfolio_snapshots
Create Date: 2026-10-06 22:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '006_cleanup_unscoped_screens'
down_revision: Union[str, None] = '005_portfolio_snapshots'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. For unscoped screens that have duplicate scoped screens (id = user_id || ':' || unscoped.id),
    # re-link any widgets to the scoped screen, then delete the unscoped screen.
    op.execute("""
        UPDATE user_widgets uw
        SET screen_id = uw.user_id || ':' || uw.screen_id
        WHERE uw.screen_id NOT LIKE '%:%'
          AND EXISTS (
              SELECT 1 FROM user_screens us
              WHERE us.id = uw.user_id || ':' || uw.screen_id
          );
    """)

    op.execute("""
        DELETE FROM user_screens us
        WHERE us.id NOT LIKE '%:%'
          AND EXISTS (
              SELECT 1 FROM user_screens scoped
              WHERE scoped.id = us.user_id || ':' || us.id
          );
    """)

    # 2. For any remaining unscoped screens that have no widgets, but the user already has at least one other screen:
    # delete them to remove empty duplicates.
    op.execute("""
        DELETE FROM user_screens us
        WHERE us.id NOT LIKE '%:%'
          AND NOT EXISTS (
              SELECT 1 FROM user_widgets uw
              WHERE uw.screen_id = us.id
          )
          AND (
              SELECT COUNT(*) FROM user_screens us2
              WHERE us2.user_id = us.user_id
          ) > 1;
    """)


def downgrade() -> None:
    pass
