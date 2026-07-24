"""User layout, watchlists, settings, and table preferences

Revision ID: 002_user_layout_and_settings
Revises: 001_initial_schema
Create Date: 2026-07-23 10:40:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '002_user_layout_and_settings'
down_revision: Union[str, None] = '001_initial_schema'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'user_screens',
        sa.Column('id', sa.String(length=100), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('order', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_user_screens_user_id'), 'user_screens', ['user_id'], unique=False)

    op.create_table(
        'user_widgets',
        sa.Column('id', sa.String(length=100), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('screen_id', sa.String(length=100), nullable=False),
        sa.Column('type', sa.String(length=100), nullable=False),
        sa.Column('x', sa.Integer(), nullable=False),
        sa.Column('y', sa.Integer(), nullable=False),
        sa.Column('w', sa.Integer(), nullable=False),
        sa.Column('h', sa.Integer(), nullable=False),
        sa.Column('min_w', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('min_h', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('created_at', sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(['screen_id'], ['user_screens.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_user_widgets_screen_id'), 'user_widgets', ['screen_id'], unique=False)
    op.create_index(op.f('ix_user_widgets_user_id'), 'user_widgets', ['user_id'], unique=False)

    op.create_table(
        'user_widget_states',
        sa.Column('widget_id', sa.String(length=100), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('symbol', sa.String(length=50), nullable=True),
        sa.Column('interval', sa.String(length=20), nullable=True),
        sa.Column('state_json', sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['widget_id'], ['user_widgets.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('widget_id')
    )
    op.create_index(op.f('ix_user_widget_states_user_id'), 'user_widget_states', ['user_id'], unique=False)

    op.create_table(
        'user_watchlists',
        sa.Column('id', sa.String(length=100), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('name_lower', sa.String(length=255), nullable=False),
        sa.Column('order', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('items_json', sa.Text(), nullable=False, server_default='[]'),
        sa.Column('row_state_json', sa.Text(), nullable=True),
        sa.Column('created_at', sa.BigInteger(), nullable=False),
        sa.Column('updated_at', sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_user_watchlists_user_id'), 'user_watchlists', ['user_id'], unique=False)

    op.create_table(
        'user_settings',
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('key', sa.String(length=100), nullable=False),
        sa.Column('value_json', sa.Text(), nullable=False),
        sa.Column('updated_at', sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('user_id', 'key')
    )

    op.create_table(
        'user_table_prefs',
        sa.Column('id', sa.String(length=100), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('scope_type', sa.String(length=50), nullable=False),
        sa.Column('scope_id', sa.String(length=100), nullable=False),
        sa.Column('table_id', sa.String(length=100), nullable=False),
        sa.Column('prefs_json', sa.Text(), nullable=False),
        sa.Column('updated_at', sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_user_table_prefs_user_id'), 'user_table_prefs', ['user_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_user_table_prefs_user_id'), table_name='user_table_prefs')
    op.drop_table('user_table_prefs')
    op.drop_table('user_settings')
    op.drop_index(op.f('ix_user_watchlists_user_id'), table_name='user_watchlists')
    op.drop_table('user_watchlists')
    op.drop_index(op.f('ix_user_widget_states_user_id'), table_name='user_widget_states')
    op.drop_table('user_widget_states')
    op.drop_index(op.f('ix_user_widgets_user_id'), table_name='user_widgets')
    op.drop_index(op.f('ix_user_widgets_screen_id'), table_name='user_widgets')
    op.drop_table('user_widgets')
    op.drop_index(op.f('ix_user_screens_user_id'), table_name='user_screens')
    op.drop_table('user_screens')
