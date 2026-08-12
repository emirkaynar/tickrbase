"""add_realized_pnl_base

Revision ID: 004_add_realized_pnl_base
Revises: 003_expanded_portfolio_system
Create Date: 2026-08-07 11:40:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '004_add_realized_pnl_base'
down_revision: Union[str, None] = '003_expanded_portfolio_system'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'portfolio_transactions',
        sa.Column('realized_pnl_base', sa.Float(), nullable=True)
    )


def downgrade() -> None:
    op.drop_column('portfolio_transactions', 'realized_pnl_base')
