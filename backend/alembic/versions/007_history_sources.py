"""Partition history by source and session coverage."""
from alembic import op
import sqlalchemy as sa

revision = "007_history_sources"
down_revision = "006_cleanup_unscoped_screens"
branch_labels = None
depends_on = None


def upgrade():
    for table in ("ohlc", "history_meta"):
        op.add_column(table, sa.Column("source", sa.String(50), nullable=False, server_default="yahoo"))
        op.add_column(table, sa.Column("sessions", sa.String(20), nullable=False, server_default="regular"))
        op.drop_constraint(f"{table}_pkey", table, type_="primary")
        columns = ["source", "sessions", "ticker", "interval"]
        if table == "ohlc":
            columns.append("time")
        op.create_primary_key(f"{table}_pkey", table, columns)


def downgrade():
    # Preserve the original namespace; other namespaces cannot fit the old key.
    for table in ("ohlc", "history_meta"):
        op.execute(sa.text(f"DELETE FROM {table} WHERE source != 'yahoo' OR sessions != 'regular'"))
        op.drop_constraint(f"{table}_pkey", table, type_="primary")
        columns = ["ticker", "interval"] + (["time"] if table == "ohlc" else [])
        op.create_primary_key(f"{table}_pkey", table, columns)
        op.drop_column(table, "sessions")
        op.drop_column(table, "source")
