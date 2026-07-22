"""Initial schema

Revision ID: 001_initial_schema
Revises: 
Create Date: 2026-07-22 15:55:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '001_initial_schema'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'users',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('email', sa.String(length=255), nullable=False),
        sa.Column('hashed_password', sa.String(length=255), nullable=False),
        sa.Column('tier', sa.String(length=50), nullable=False, server_default='free'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_users_email'), 'users', ['email'], unique=True)
    op.create_index(op.f('ix_users_id'), 'users', ['id'], unique=False)

    op.create_table(
        'portfolio',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('ticker', sa.String(length=50), nullable=False),
        sa.Column('quantity', sa.Float(), nullable=False),
        sa.Column('avg_price', sa.Float(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'ticker', name='uq_user_ticker')
    )
    op.create_index(op.f('ix_portfolio_id'), 'portfolio', ['id'], unique=False)
    op.create_index(op.f('ix_portfolio_user_id'), 'portfolio', ['user_id'], unique=False)

    op.create_table(
        'ohlc',
        sa.Column('ticker', sa.String(length=50), nullable=False),
        sa.Column('interval', sa.String(length=20), nullable=False),
        sa.Column('time', sa.BigInteger(), nullable=False),
        sa.Column('open', sa.Float(), nullable=False),
        sa.Column('high', sa.Float(), nullable=False),
        sa.Column('low', sa.Float(), nullable=False),
        sa.Column('close', sa.Float(), nullable=False),
        sa.Column('volume', sa.Float(), nullable=True),
        sa.PrimaryKeyConstraint('ticker', 'interval', 'time')
    )

    op.create_table(
        'history_meta',
        sa.Column('ticker', sa.String(length=50), nullable=False),
        sa.Column('interval', sa.String(length=20), nullable=False),
        sa.Column('last_refresh', sa.BigInteger(), nullable=False),
        sa.PrimaryKeyConstraint('ticker', 'interval')
    )

    op.create_table(
        'symbols_cache',
        sa.Column('id', sa.String(length=50), nullable=False),
        sa.Column('payload', sa.Text(), nullable=False),
        sa.Column('fetched_at', sa.BigInteger(), nullable=False),
        sa.PrimaryKeyConstraint('id')
    )

    op.create_table(
        'lookup_cache',
        sa.Column('query', sa.String(length=255), nullable=False),
        sa.Column('payload', sa.Text(), nullable=False),
        sa.Column('fetched_at', sa.BigInteger(), nullable=False),
        sa.PrimaryKeyConstraint('query')
    )


def downgrade() -> None:
    op.drop_table('lookup_cache')
    op.drop_table('symbols_cache')
    op.drop_table('history_meta')
    op.drop_table('ohlc')
    op.drop_index(op.f('ix_portfolio_user_id'), table_name='portfolio')
    op.drop_index(op.f('ix_portfolio_id'), table_name='portfolio')
    op.drop_table('portfolio')
    op.drop_index(op.f('ix_users_id'), table_name='users')
    op.drop_index(op.f('ix_users_email'), table_name='users')
    op.drop_table('users')
