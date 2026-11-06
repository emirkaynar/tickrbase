"""Bounds shared by market HTTP and WebSocket inputs."""
import re
import time
from fastapi import HTTPException

SYMBOL_PATTERN = re.compile(r'[A-Za-z0-9^][A-Za-z0-9.^=:_/-]{0,31}\Z')
PERIOD_PATTERN = re.compile(r'[1-9][0-9]{0,2}(?:d|wk|mo|y)\Z')
MAX_HISTORY_POINTS = 20_000


def valid_symbol(value):
    return isinstance(value, str) and bool(SYMBOL_PATTERN.fullmatch(value))


def validate_symbol(value):
    if not valid_symbol(value):
        raise HTTPException(status_code=422, detail='Invalid ticker symbol')
    return value


def validate_history(period, since):
    if period not in {'max', 'ytd'} and not PERIOD_PATTERN.fullmatch(period):
        raise HTTPException(status_code=422, detail='Invalid history period')
    if period not in {'max', 'ytd'}:
        match = re.fullmatch(r'([0-9]+)(d|wk|mo|y)', period)
        days = int(match[1]) * {'d': 1, 'wk': 7, 'mo': 30, 'y': 365}[match[2]]
        if days > 100 * 365:
            raise HTTPException(status_code=422, detail='History period exceeds 100 years')
    if since is not None and (since < 0 or since > int(time.time()) + 300):
        raise HTTPException(status_code=422, detail='Invalid history timestamp')
