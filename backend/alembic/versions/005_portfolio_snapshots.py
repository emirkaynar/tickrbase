"""portfolio_snapshots

Revision ID: 005_portfolio_snapshots
Revises: 004_add_realized_pnl_base
Create Date: 2026-08-10 11:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '005_portfolio_snapshots'
down_revision: Union[str, None] = '004_add_realized_pnl_base'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'portfolio_ledger_snapshots',
        sa.Column('portfolio_id', sa.String(length=100), sa.ForeignKey('user_portfolios.id', ondelete='CASCADE'), nullable=False),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('snap_date', sa.BigInteger(), nullable=False),
        sa.Column('ticker', sa.String(length=50), nullable=False),
        sa.Column('quantity', sa.Float(), nullable=False),
        sa.Column('avg_price_native', sa.Float(), nullable=False),
        sa.Column('avg_price_base', sa.Float(), nullable=False),
        sa.Column('net_invested_native', sa.Float(), nullable=False),
        sa.Column('net_invested_base', sa.Float(), nullable=False),
        sa.Column('fx_rate_snap', sa.Float(), nullable=False),
        sa.PrimaryKeyConstraint('portfolio_id', 'snap_date', 'ticker'),
    )
    op.create_index('ix_ledger_snap_portfolio_date', 'portfolio_ledger_snapshots', ['portfolio_id', 'snap_date'])
    op.create_index('ix_portfolio_ledger_snapshots_user_id', 'portfolio_ledger_snapshots', ['user_id'])

    op.create_table(
        'portfolio_value_snapshots',
        sa.Column('portfolio_id', sa.String(length=100), sa.ForeignKey('user_portfolios.id', ondelete='CASCADE'), nullable=False),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('snap_date', sa.BigInteger(), nullable=False),
        sa.Column('market_value_base', sa.Float(), nullable=False),
        sa.Column('net_invested_base', sa.Float(), nullable=False),
        sa.Column('pnl_base', sa.Float(), nullable=False),
        sa.Column('pnl_pct', sa.Float(), nullable=False),
        sa.Column('fx_effect_base', sa.Float(), nullable=False),
        sa.Column('last_updated', sa.BigInteger(), nullable=False),
        sa.PrimaryKeyConstraint('portfolio_id', 'snap_date'),
    )
    op.create_index('ix_portfolio_value_snapshots_user_id', 'portfolio_value_snapshots', ['user_id'])


def downgrade() -> None:
    op.drop_table('portfolio_value_snapshots')
    op.drop_table('portfolio_ledger_snapshots')
