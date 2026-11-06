"""Safe HTTP errors and bounded, payload-free request telemetry."""
from __future__ import annotations

from collections import Counter
import json
import logging
from time import perf_counter
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

logger = logging.getLogger(__name__)
REQUEST_COUNTS: Counter = Counter()
REQUEST_SECONDS: Counter = Counter()
BUCKETS = (0.01, 0.05, 0.1, 0.5, 1, 5, 30, float('inf'))


def security_headers():
    from .config import DEV_MODE
    headers = {'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
               'Referrer-Policy': 'no-referrer',
               'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'"}
    if not DEV_MODE:
        headers['Strict-Transport-Security'] = 'max-age=31536000'
    return headers


def error_response(request: Request, status: int, code: str, message: str, *, headers=None, fields=None):
    payload = {'error': True, 'code': code, 'message': message,
               'request_id': request.scope.setdefault('request_id', uuid4().hex)}
    if fields:
        payload['fields'] = fields
    return JSONResponse(payload, status_code=status, headers=headers)


class RequestBoundary:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)
        scope['request_id'] = uuid4().hex
        started = perf_counter()
        status = 500
        response_started = False

        async def tracked_send(message):
            nonlocal status, response_started
            if message['type'] == 'http.response.start':
                response_started = True
                status = message['status']
                message['headers'] = [*(header for header in message.get('headers', []) if header[0].lower() != b'cache-control'),
                    (b'x-request-id', scope['request_id'].encode()), (b'cache-control', b'no-store')]
            await send(message)

        try:
            await self.app(scope, receive, tracked_send)
        except Exception as exc:
            # Never log exception text or traceback: upstream URLs/SQL can contain credentials.
            logger.error(json.dumps({'event': 'request_failed', 'request_id': scope['request_id'],
                                     'error_type': type(exc).__name__}))
            if response_started:
                raise
            response = error_response(Request(scope), 500, 'INTERNAL_ERROR', 'Internal server error', headers=security_headers())
            await response(scope, receive, tracked_send)
        finally:
            duration = perf_counter() - started
            route = getattr(scope.get('route'), 'path', 'unmatched')
            method = scope['method'] if scope['method'] in {'GET','POST','PUT','PATCH','DELETE','OPTIONS','HEAD'} else 'OTHER'
            # No raw URLs, query values, account IDs, or ticker values as metric dimensions.
            key = (method, route, f'{status // 100}xx')
            if not route.startswith('/portfolio'):
                REQUEST_COUNTS[key] += 1
                for bucket in BUCKETS:
                    if duration <= bucket:
                        REQUEST_SECONDS[(*key, bucket)] += 1
            logger.info(json.dumps({'event': 'request_completed', 'request_id': scope['request_id'],
                'method': method, 'route': route, 'status': status, 'duration_ms': round(duration * 1000, 2)}))


def install_error_handling(app: FastAPI):
    @app.exception_handler(HTTPException)
    async def http_error(request: Request, exc: HTTPException):
        from http import HTTPStatus
        code = {401: 'UNAUTHENTICATED', 403: 'FORBIDDEN', 404: 'NOT_FOUND',
                409: 'CONFLICT', 412: 'PRECONDITION_FAILED', 429: 'RATE_LIMITED',
                502: 'UPSTREAM_ERROR', 503: 'UNAVAILABLE'}.get(exc.status_code, 'REQUEST_FAILED')
        try:
            message = HTTPStatus(exc.status_code).phrase
        except ValueError:
            message = 'Request failed'
        return error_response(request, exc.status_code, code, message, headers=exc.headers)

    @app.exception_handler(ValueError)
    async def value_error(request: Request, exc: ValueError):
        return error_response(request, 400, 'INVALID_INPUT', 'Invalid input')

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError):
        # Do not serialize Pydantic input/context/messages, which can echo submitted secrets.
        fields = [{'field': '.'.join(str(part) for part in error['loc']), 'code': error['type']}
                  for error in exc.errors()[:25]]
        return error_response(request, 422, 'VALIDATION_ERROR', 'Invalid request', fields=fields)

    app.add_middleware(RequestBoundary)
