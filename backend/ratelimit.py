import re
import time

from fastapi import HTTPException, status

DANGEROUS_PATTERNS = [
    re.compile(r"(?i)^\s*rm\s+"),
    re.compile(r"(?i)^\s*dd\s+"),
    re.compile(r"(?i)^\s*mkfs\.?"),
    re.compile(r"(?i)^\s*fdisk\s+"),
    re.compile(r"(?i)^\s*shutdown\s+"),
    re.compile(r"(?i)^\s*reboot\s+"),
    re.compile(r"(?i)^\s*docker\s+system\s+prune"),
    re.compile(r"(?i)^\s*docker\s+volume\s+prune"),
    re.compile(r"(?i)^\s*kill\s+-9"),
    re.compile(r"(?i)^\s*pkill\s+-9"),
]

_rate_limiters = {}


class TokenBucket:
    def __init__(self, rate: float, burst: int):
        self.rate = rate
        self.burst = burst
        self.tokens = float(burst)
        self.last = time.time()

    def allow(self) -> bool:
        now = time.time()
        elapsed = now - self.last
        self.tokens = min(self.burst, self.tokens + elapsed * self.rate)
        self.last = now
        if self.tokens >= 1:
            self.tokens -= 1
            return True
        return False

    def retry_after(self) -> int:
        return int((1 - self.tokens) / self.rate) + 1


def get_rate_limiter(key: str, rate: float, burst: int) -> TokenBucket:
    if key not in _rate_limiters:
        _rate_limiters[key] = TokenBucket(rate, burst)
    return _rate_limiters[key]


def is_dangerous_command(cmd: str) -> bool:
    return any(p.search(cmd) for p in DANGEROUS_PATTERNS)


def check_rate_limit(client_key: str, cmd: str):
    if is_dangerous_command(cmd):
        bucket = get_rate_limiter(f"{client_key}:dangerous", rate=1 / 60, burst=1)
    else:
        bucket = get_rate_limiter(f"{client_key}:safe", rate=10.0, burst=20)
    if not bucket.allow():
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "ok": False,
                "error_code": 429,
                "description": "Too Many Requests",
                "parameters": {"retry_after": bucket.retry_after()},
            },
        )
