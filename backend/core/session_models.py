"""Session credentials are stored only as SHA-256 digests."""
from sqlalchemy import Column, DateTime, ForeignKey, Integer, String
from .database import Base


class AuthSession(Base):
    __tablename__ = "auth_sessions"

    token_digest = Column(String(64), primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    expires_at = Column(DateTime(timezone=True), nullable=False, index=True)
