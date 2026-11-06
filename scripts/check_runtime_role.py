"""CI/deployment read-only bootstrap check and a transactional DDL-denial probe."""
import asyncio

from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from backend.core.bootstrap import check_database
from backend.core.database import engine


async def main():
    try:
        await check_database(engine)
        async with engine.connect() as connection:
            transaction = await connection.begin()
            try:
                await connection.execute(text('CREATE TABLE runtime_ddl_probe (id integer)'))
            except DBAPIError as error:
                if getattr(error.orig, 'sqlstate', None) != '42501':
                    raise
            else:
                raise RuntimeError('Runtime role can create tables')
            finally:
                await transaction.rollback()
    finally:
        await engine.dispose()


if __name__ == '__main__':
    asyncio.run(main())
