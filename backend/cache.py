import time as _time

from starlette.staticfiles import StaticFiles as BaseStaticFiles


class CachedStaticFiles(BaseStaticFiles):
    def file_response(self, *args, **kwargs):
        response = super().file_response(*args, **kwargs)
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return response


_api_cache = {}


def cached(cache_key, ttl=30, fn=None):
    now = _time.time()
    if cache_key in _api_cache:
        result, expiry = _api_cache[cache_key]
        if now < expiry:
            return result
    result = fn()
    _api_cache[cache_key] = (result, now + ttl)
    return result
