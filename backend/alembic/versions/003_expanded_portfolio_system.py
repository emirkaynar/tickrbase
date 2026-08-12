"""Expanded portfolio system (multiple portfolios, position metrics, transactions ledger, goals)

Revision ID: 003_expanded_portfolio_system
Revises: 002_user_layout_and_settings
Create Date: 2026-07-30 11:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '003_expanded_portfolio_system'
down_revision: Union[str, None] = '002_user_layout_and_settings'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Drop legacy portfolio table if exists
    op.execute("DROP TABLE IF EXISTS portfolio CASCADE;")

    # 1. user_portfolios
    op.create_table(
        'user_portfolios',
        sa.Column('id', sa.String(length=100), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('base_currency', sa.String(length=10), nullable=False, server_default='TRY'),
        sa.Column('is_default', sa.String(length=10), nullable=False, server_default='false'),
        sa.Column('created_at', sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_user_portfolios_user_id'), 'user_portfolios', ['user_id'], unique=False)

    # 2. portfolio_positions
    op.create_table(
        'portfolio_positions',
        sa.Column('id', sa.String(length=100), nullable=False),
        sa.Column('portfolio_id', sa.String(length=100), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('ticker', sa.String(length=50), nullable=False),
        sa.Column('asset_class', sa.String(length=50), nullable=False, server_default='EQUITY'),
        sa.Column('sector', sa.String(length=100), nullable=True),
        sa.Column('quantity', sa.Float(), nullable=False, server_default='0.0'),
        sa.Column('avg_price', sa.Float(), nullable=False, server_default='0.0'),
        sa.Column('target_weight_pct', sa.Float(), nullable=True),
        sa.Column('tags_json', sa.Text(), nullable=False, server_default='[]'),
        sa.Column('is_closed', sa.String(length=10), nullable=False, server_default='false'),
        sa.Column('created_at', sa.BigInteger(), nullable=False),
        sa.Column('updated_at', sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(['portfolio_id'], ['user_portfolios.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('portfolio_id', 'ticker', name='uq_portfolio_ticker')
    )
    op.create_index(op.f('ix_portfolio_positions_portfolio_id'), 'portfolio_positions', ['portfolio_id'], unique=False)
    op.create_index(op.f('ix_portfolio_positions_user_id'), 'portfolio_positions', ['user_id'], unique=False)

    # 3. portfolio_transactions
    op.create_table(
        'portfolio_transactions',
        sa.Column('id', sa.String(length=100), nullable=False),
        sa.Column('portfolio_id', sa.String(length=100), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('ticker', sa.String(length=50), nullable=False),
        sa.Column('type', sa.String(length=30), nullable=False),
        sa.Column('quantity', sa.Float(), nullable=False, server_default='0.0'),
        sa.Column('unit_price', sa.Float(), nullable=False, server_default='0.0'),
        sa.Column('fee', sa.Float(), nullable=False, server_default='0.0'),
        sa.Column('tax', sa.Float(), nullable=False, server_default='0.0'),
        sa.Column('currency', sa.String(length=10), nullable=False, server_default='TRY'),
        sa.Column('fx_rate_to_base', sa.Float(), nullable=False, server_default='1.0'),
        sa.Column('realized_pnl', sa.Float(), nullable=True, server_default='0.0'),
        sa.Column('executed_at', sa.BigInteger(), nullable=False),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('created_at', sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(['portfolio_id'], ['user_portfolios.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_portfolio_transactions_portfolio_id'), 'portfolio_transactions', ['portfolio_id'], unique=False)
    op.create_index(op.f('ix_portfolio_transactions_user_id'), 'portfolio_transactions', ['user_id'], unique=False)

    # 4. user_portfolio_goals
    op.create_table(
        'user_portfolio_goals',
        sa.Column('id', sa.String(length=100), nullable=False),
        sa.Column('portfolio_id', sa.String(length=100), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('title', sa.String(length=255), nullable=False),
        sa.Column('target_amount', sa.Float(), nullable=False),
        sa.Column('target_date', sa.BigInteger(), nullable=False),
        sa.Column('created_at', sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(['portfolio_id'], ['user_portfolios.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_user_portfolio_goals_portfolio_id'), 'user_portfolio_goals', ['portfolio_id'], unique=False)
    op.create_index(op.f('ix_user_portfolio_goals_user_id'), 'user_portfolio_goals', ['user_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_user_portfolio_goals_user_id'), table_name='user_portfolio_goals')
    op.drop_index(op.f('ix_user_portfolio_goals_portfolio_id'), table_name='user_portfolio_goals')
    op.drop_table('user_portfolio_goals')

    op.drop_index(op.f('ix_portfolio_transactions_user_id'), table_name='portfolio_transactions')
    op.drop_index(op.f('ix_portfolio_transactions_portfolio_id'), table_name='portfolio_transactions')
    op.drop_table('portfolio_transactions')

    op.drop_index(op.f('ix_portfolio_positions_user_id'), table_name='portfolio_positions')
    op.drop_index(op.f('ix_portfolio_positions_portfolio_id'), table_name='portfolio_positions')
    op.drop_table('portfolio_positions')

    op.drop_index(op.f('ix_user_portfolios_user_id'), table_name='user_portfolios')
    op.drop_table('user_portfolios')
