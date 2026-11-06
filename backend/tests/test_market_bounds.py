import asyncio
import json
import time
from types import SimpleNamespace
from unittest.mock import AsyncMock

from backend.services import prices


def test_price_cache_outage_does_not_discard_success():
    async def run():
        redis = SimpleNamespace(get=AsyncMock(side_effect=ConnectionError), set=AsyncMock(side_effect=ConnectionError))
        provider = SimpleNamespace(source_id='test', get_price_async=AsyncMock(return_value=(12.0, int(time.time()))))
        result = await prices.get_price(provider, redis, 'AAPL')
        assert result[0:2] == (12.0, False)
    asyncio.run(run())


def test_concurrent_price_misses_share_one_provider_call():
    async def run():
        async def fetch(ticker):
            await asyncio.sleep(.01)
            return 12.0, int(time.time())
        provider = SimpleNamespace(source_id='test', get_price_async=AsyncMock(side_effect=fetch))
        redis = SimpleNamespace(get=AsyncMock(return_value=None), set=AsyncMock())
        results = await asyncio.gather(*(prices.get_price(provider, redis, 'AAPL') for _ in range(20)))
        assert all(result[0] == 12 for result in results)
        assert provider.get_price_async.await_count == 1
        assert redis.set.call_args.args[0] == 'price:test:AAPL'
    asyncio.run(run())


def test_stale_price_survives_provider_failure_and_sources_do_not_mix():
    async def run():
        redis = SimpleNamespace(get=AsyncMock(return_value=json.dumps({'price': 9, 'fetched_at': int(time.time())-120})), set=AsyncMock())
        provider = SimpleNamespace(source_id='other', get_price_async=AsyncMock(side_effect=TimeoutError))
        result = await prices.get_price(provider, redis, 'AAPL')
        assert result[0:2] == (9, True)
        assert redis.get.call_args.args[0] == 'price:other:AAPL'
    asyncio.run(run())


def test_watchlist_strings_and_legacy_objects_parse_without_silent_loss(caplog):
    from backend.services.watchlist_prewarm import parse_symbols
    assert parse_symbols('["AAPL", "MSFT", {"symbol": "IBM"}, {"value": "NVDA"}]') == ['AAPL', 'IBM', 'MSFT', 'NVDA']
    assert parse_symbols('{') == []
    assert 'watchlist_prewarm_parse_failed' in caplog.text


def test_watchlist_cursor_eventually_visits_symbols_after_first_batch(monkeypatch):
    from backend.services import watchlist_prewarm as warm
    async def run():
        monkeypatch.setattr(warm, '_cursor', ('', ''))
        rows = [SimpleNamespace(id='a', items_json=json.dumps([f'T{i:03}' for i in range(80)]))]
        db = SimpleNamespace(execute=AsyncMock(return_value=SimpleNamespace(all=lambda: rows)))
        visited = set()
        for _ in range(4):
            batch = await warm.select_watchlist_batch(db)
            assert len(batch) <= 25
            visited.update(batch)
        assert len(visited) == 80
    asyncio.run(run())


def test_stream_redis_outage_never_blocks_delivery_and_quota_is_atomic():
    from backend.services.streaming import LivePriceStreamHub
    async def run():
        hub = LivePriceStreamHub()
        sockets = [SimpleNamespace(send_json=AsyncMock(), close=AsyncMock()) for _ in range(5)]
        ids = [await hub.register_client(socket, 'user') for socket in sockets[:4]]
        import pytest
        with pytest.raises(ValueError):
            await hub.register_client(sockets[4], 'user')
        await hub.replace_symbols(ids[0], ['AAPL'])
        # Redis worker isn't consuming; delivery is independent even if it stays stuck.
        for n in range(300):
            await hub._broadcast_tick('AAPL', n, 123)
        assert hub._redis_queue.qsize() == 256
        assert hub._queues[ids[0]].qsize() <= 500
        assert hub.drop_count >= 44
        for client_id in ids:
            await hub.unregister_client(client_id)
        assert hub.active_symbol_count == hub.active_client_count == 0
    asyncio.run(run())


def test_market_input_bounds_reject_before_io():
    import pytest
    from fastapi import HTTPException
    from backend.services.market_validation import validate_symbol, validate_history
    for ticker in ['', 'X'*33, 'A B', 'A?token=secret', None]:
        with pytest.raises(HTTPException):
            validate_symbol(ticker)
    for period in ['', '-1d', '99999y', 'nonsense']:
        with pytest.raises(HTTPException):
            validate_history(period, None)
    with pytest.raises(HTTPException):
        validate_history('max', -1)


def test_quotes_batch_reads_cache_and_preserves_symbol_order():
    from backend.services.quotes import get_quotes
    async def run():
        timestamp = int(time.time())
        value = json.dumps({'data': {'symbol': 'AAPL', 'current_price': 10}, 'fetched_at': timestamp})
        redis = SimpleNamespace(mget=AsyncMock(return_value=[value]))
        provider = SimpleNamespace(source_id='other', get_quote_snapshot_async=AsyncMock(side_effect=AssertionError('must use cache')))
        items, stale, _ = await get_quotes(provider, redis, ['AAPL'], {'quote'})
        assert items[0]['current_price'] == 10
        assert not stale
        assert redis.mget.call_args.args[0] == ['quote:other:AAPL:quote']
        provider.get_quote_snapshot_async.assert_not_awaited()
    asyncio.run(run())


def test_websocket_malformed_json_closes_and_cleans_up(monkeypatch):
    from backend.api import ws
    from backend.services.streaming import LivePriceStreamHub
    async def run():
        hub = LivePriceStreamHub()
        socket = SimpleNamespace(headers={'origin': ws.CORS_ORIGINS[0]}, query_params={}, cookies={'access_token': 'opaque'}, close=AsyncMock(), accept=AsyncMock(), send_json=AsyncMock(), receive=AsyncMock(return_value={'type':'websocket.receive','text':'{'}))
        monkeypatch.setattr(ws, '_principal', AsyncMock(return_value=SimpleNamespace(id=1)))
        monkeypatch.setattr(ws, 'get_ws_stream_hub', lambda: hub)
        await ws.ws_prices(socket)
        assert any(call.kwargs.get('code') == 1008 for call in socket.close.call_args_list)
        assert hub.active_client_count == 0
    asyncio.run(run())


def test_websocket_invalid_frames_count_against_rate_budget(monkeypatch):
    from backend.api import ws
    from backend.services.streaming import LivePriceStreamHub
    async def run():
        hub = LivePriceStreamHub()
        socket = SimpleNamespace(headers={'origin': ws.CORS_ORIGINS[0]}, query_params={}, cookies={'access_token': 'opaque'}, close=AsyncMock(), accept=AsyncMock(), send_json=AsyncMock(), receive=AsyncMock(return_value={'type':'websocket.receive','text':'{}'}))
        monkeypatch.setattr(ws, '_principal', AsyncMock(return_value=SimpleNamespace(id=1)))
        monkeypatch.setattr(ws, 'get_ws_stream_hub', lambda: hub)
        monkeypatch.setattr(ws, 'WS_COMMAND_RATE_LIMIT_PER_SEC', 3)
        await ws.ws_prices(socket)
        assert socket.receive.await_count == 4
        assert hub.active_client_count == 0
    asyncio.run(run())


def test_slow_websocket_send_releases_principal_and_subscriptions(monkeypatch):
    from backend.services import streaming
    async def run():
        hub = streaming.LivePriceStreamHub()
        async def stalled_send(_):
            await asyncio.Event().wait()
        socket = SimpleNamespace(send_json=stalled_send, close=AsyncMock())
        monkeypatch.setattr(streaming, 'WS_SEND_TIMEOUT_SECONDS', .001)
        client_id = await hub.register_client(socket, 'user')
        await hub.replace_symbols(client_id, ['AAPL'])
        writer = hub._writer_tasks[client_id]
        await hub.send_control(client_id, {'type':'hello'})
        await asyncio.wait_for(writer, .1)
        assert hub.active_client_count == hub.active_symbol_count == 0
        assert not hub._principals
    asyncio.run(run())


def test_second_stream_owner_fails_before_starting_upstream(monkeypatch):
    from backend.services import streaming
    async def run():
        redis = SimpleNamespace(set=AsyncMock(return_value=False))
        monkeypatch.setattr(streaming, 'get_redis_client', lambda: redis)
        hub = streaming.LivePriceStreamHub()
        import pytest
        with pytest.raises(RuntimeError, match='single API worker'):
            await hub.start()
        assert hub._stream_task is None
        assert redis.set.call_args.kwargs == {'nx': True, 'ex': 30}
    asyncio.run(run())


def test_websocket_rechecks_session_while_client_is_idle(monkeypatch):
    from backend.api import ws
    from backend.services.streaming import LivePriceStreamHub
    async def run():
        hub = LivePriceStreamHub()
        async def receive():
            await asyncio.Event().wait()
        socket = SimpleNamespace(headers={'origin': ws.CORS_ORIGINS[0]}, query_params={}, cookies={'access_token':'opaque'}, close=AsyncMock(), accept=AsyncMock(), send_json=AsyncMock(), receive=receive)
        monkeypatch.setattr(ws, '_principal', AsyncMock(side_effect=[SimpleNamespace(id=1), None]))
        monkeypatch.setattr(ws, 'get_ws_stream_hub', lambda: hub)
        monkeypatch.setattr(ws, 'WS_SESSION_CHECK_SECONDS', .001)
        await asyncio.wait_for(ws.ws_prices(socket), .1)
        assert any(call.kwargs.get('reason') == 'Session expired' for call in socket.close.call_args_list)
        assert hub.active_client_count == 0
    asyncio.run(run())


def test_history_upstream_is_bounded_before_io_and_shared_without_shared_db(monkeypatch):
    from backend.core import history_cache as history
    from backend.schemas.models import Candle
    async def run():
        monkeypatch.setattr(history, '_now_ts', lambda: 1_800_000_000)
        monkeypatch.setattr(history, '_get_last_refresh', AsyncMock(return_value=None))
        monkeypatch.setattr(history, '_get_latest_time', AsyncMock(return_value=None))
        write = AsyncMock()
        monkeypatch.setattr(history, '_upsert_history', write)
        monkeypatch.setattr(history, '_set_last_refresh', AsyncMock())
        monkeypatch.setattr(history, '_read_history', AsyncMock(return_value=[]))
        async def fetch(*args, **kwargs):
            assert kwargs['end'] - kwargs['start'] <= 20_000 * 60
            await asyncio.sleep(.01)
            return [Candle(time=1_799_999_900, open=1, high=1, low=1, close=1)]
        provider = SimpleNamespace(source_id='test', normalize_symbol=lambda x:x, history_capabilities=lambda:{}, history_range=lambda interval: 'max', get_history_async=AsyncMock(side_effect=fetch))
        first_db, second_db = object(), object()
        await asyncio.gather(history.get_history(first_db, provider, 'AAPL', '1m'), history.get_history(second_db, provider, 'AAPL', '1m'))
        assert provider.get_history_async.await_count == 1
        assert write.await_count == 2
        assert {call.args[0] for call in write.call_args_list} == {first_db, second_db}
    asyncio.run(run())


def test_symbol_replacement_can_swap_at_global_capacity(monkeypatch):
    from backend.services import streaming
    async def run():
        monkeypatch.setattr(streaming, 'WS_MAX_GLOBAL_SYMBOLS', 1)
        hub = streaming.LivePriceStreamHub()
        socket = SimpleNamespace(send_json=AsyncMock(), close=AsyncMock())
        client_id = await hub.register_client(socket, 'user')
        assert (await hub.replace_symbols(client_id, ['AAPL']))[0]
        ok, _, symbols = await hub.replace_symbols(client_id, ['MSFT'])
        assert ok and symbols == {'MSFT'}
        assert hub.active_symbol_count == 1
        await hub.unregister_client(client_id)
    asyncio.run(run())


def test_failed_upstream_listener_reconnects_and_cleans_up(monkeypatch):
    import yfinance
    from backend.services import streaming
    async def run():
        hub = streaming.LivePriceStreamHub()
        hub._symbol_ref_counts['AAPL'] = 1
        instances = []
        class BrokenUpstream:
            def __init__(self, **kwargs):
                self.close = AsyncMock()
                instances.append(self)
            async def subscribe(self, symbols):
                if len(instances) == 2:
                    hub._stop_event.set()
            async def listen(self, handler):
                raise ConnectionError('upstream ended')
        monkeypatch.setattr(yfinance, 'AsyncWebSocket', BrokenUpstream)
        monkeypatch.setattr(streaming, 'WS_RECONNECT_BACKOFF_MIN_SECONDS', .001)
        await asyncio.wait_for(hub._stream_loop(), timeout=2.5)
        assert len(instances) == 2
        assert all(instance.close.await_count == 1 for instance in instances)
    asyncio.run(run())


def test_hung_price_provider_returns_stale_before_whole_flight_deadline(monkeypatch):
    async def run():
        async def fetch(_):
            await asyncio.Event().wait()
        monkeypatch.setattr(prices, 'PRICE_PROVIDER_TIMEOUT_SECONDS', .01, raising=False)
        cached = json.dumps({'price': 9, 'fetched_at': int(time.time()) - 120})
        redis = SimpleNamespace(get=AsyncMock(return_value=cached), set=AsyncMock())
        provider = SimpleNamespace(source_id='test', get_price_async=fetch)
        price, stale, _ = await asyncio.wait_for(prices.get_price(provider, redis, 'AAPL'), timeout=.1)
        assert price == 9 and stale
    asyncio.run(run())
