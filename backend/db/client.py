import logging
import os

from supabase import AsyncClient, acreate_client

logger = logging.getLogger(__name__)

_client: AsyncClient | None = None


async def get_client() -> AsyncClient:
    global _client
    if _client is None:
        url = os.environ["SUPABASE_URL"]
        key = os.environ["SUPABASE_SERVICE_KEY"]
        _client = await acreate_client(url, key)
        logger.info("Supabase client initialised (url=%s...)", url[:30])
    return _client
