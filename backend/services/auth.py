from __future__ import annotations

import asyncio
import re
from anyio import to_thread
from fastapi import HTTPException
from passlib.context import CryptContext


pwd_context = CryptContext(schemes=["argon2", "bcrypt"], deprecated="auto",
                          argon2__memory_cost=19456, argon2__time_cost=2, argon2__parallelism=1)
# A missing user still consumes one password verification.
DUMMY_HASH = pwd_context.hash("dummy-password-for-timing-only")
_hash_slots = asyncio.Semaphore(4)


async def password_work(function, *args):
    try:
        await asyncio.wait_for(_hash_slots.acquire(), timeout=0.25)
    except TimeoutError:
        raise HTTPException(503, "Authentication busy", headers={"Retry-After": "1"}) from None
    # Cancellation of the HTTP request must not free a slot while its CPU work
    # is still running. Keep the underlying task alive until the thread finishes.
    task = asyncio.create_task(to_thread.run_sync(function, *args))
    def finished(completed):
        _hash_slots.release()
        if not completed.cancelled():
            completed.exception()
    task.add_done_callback(finished)
    return await asyncio.shield(task)


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    # Reject corrupt/unbounded stored hash parameters before doing expensive work.
    if hashed_password.startswith("$argon2"):
        params = re.search(r"\$m=(\d+),t=(\d+),p=(\d+)\$", hashed_password)
        if not params or not (1 <= int(params[1]) <= 65536 and 1 <= int(params[2]) <= 4 and 1 <= int(params[3]) <= 4):
            return False
    elif hashed_password.startswith(("$2a$", "$2b$", "$2y$")):
        cost = hashed_password[4:6]
        if not cost.isdecimal() or not 4 <= int(cost) <= 14:
            return False
    else:
        return False
    try:
        return pwd_context.verify(plain_password, hashed_password)
    except (ValueError, TypeError):
        return False
