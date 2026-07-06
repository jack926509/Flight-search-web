import logging
import os

from supabase import AsyncClient, acreate_client

logger = logging.getLogger(__name__)

_client: AsyncClient | None = None


async def get_client() -> AsyncClient:
    global _client
    if _client is None:
        url = os.getenv("SUPABASE_URL", "")
        key = os.getenv("SUPABASE_SERVICE_KEY", "")
        if not url or not key:
            raise RuntimeError(
                "SUPABASE_URL and SUPABASE_SERVICE_KEY must both be set "
                "(check Zeabur environment variables — see backend/.env.example)"
            )
        _client = await acreate_client(url, key)
        logger.info("Supabase client initialised (url=%s...)", url[:30])
    return _client
