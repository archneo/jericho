# Security Model

Jericho protects server infrastructure through multiple defense layers. This document explains the threat model, authentication mechanisms, and operational security practices.

---

## Threat Model

### Assets Protected
- Server filesystem (`/srv` and beyond)
- Docker daemon control
- Live terminal access (bash as the user running Jericho)
- Service discovery data (internal IP addresses, ports)
- Kimi CLI sessions (may contain sensitive code or credentials)

### Threat Actors
1. **Network eavesdropper** — Passive attacker on local network or Tailscale
2. **Credential thief** — Obtains passphrase or TOTP secret
3. **Session hijacker** — Steals session cookie or JWT token
4. **Malicious user** — Legitimate user who runs destructive commands
5. **Bot/automated attacker** — Brute-force or automated exploitation

### Trust Boundaries
- Nginx → FastAPI: Localhost loopback (trusted)
- FastAPI → SQLite: Local filesystem (trusted)
- FastAPI → Docker socket: Host filesystem mount (privileged)
- Client → Nginx: Network (untrusted)
- Host Bridge → Kimi processes: Host filesystem (trusted)

---

## Authentication

### Layer 1: Passphrase (Argon2id)

- Algorithm: Argon2id (time_cost=3, memory_cost=65536, parallelism=1)
- Hash stored in `JERICHO_PASSPHRASE_HASH` environment variable
- Never transmitted after initial login; verified server-side

### Layer 2: TOTP (Time-based One-Time Password)

- Algorithm: RFC 6238 TOTP, 6 digits, 30-second window
- Secret stored in `JERICHO_TOTP_SECRET` environment variable
- Valid window: ±1 period (allows 30-second clock drift)
- Setup URI: `otpauth://totp/Jericho:USER?secret=SECRET&issuer=Jericho`

### Layer 3: JWT Access Token

- Algorithm: HS256
- TTL: 15 minutes
- Payload: `sub` (user_id), `client_type`, `tier`, `attested`, `jti`, `iat`, `exp`
- Transport: `Authorization: Bearer <token>` header

### Layer 4: JWT Refresh Token

- Algorithm: HS256
- TTL: 7 days
- Stored in HTTP-only, Secure, Strict SameSite cookie
- Revocation tracked in SQLite (`refresh_tokens` table)
- Rotation on every use (old JTI revoked, new JTI issued)

### Layer 5: Terminal Ticket

- Algorithm: HS256
- TTL: 5 minutes
- Single-use JTI with 30-second idempotency window
- Transport: WebSocket URL query parameter (`?ticket=...`)
- Scope: Terminal access only, no API privileges

---

## Session Security

### Cookie Attributes

| Attribute | Value | Rationale |
|-----------|-------|-----------|
| `HttpOnly` | true | Prevents XSS theft via `document.cookie` |
| `Secure` | scheme-dependent | Set when HTTPS detected; false for local HTTP dev |
| `SameSite` | Strict | Prevents CSRF from cross-site navigations |
| `Max-Age` | 900 (session) / 604800 (refresh) | Short session, long refresh |

### Session Fingerprinting
- IP address stored in session data
- Tailscale IPs allowed slight roaming (no strict IP lock)
- Future: Add User-Agent fingerprinting

---

## Transport Security

### Tailscale (Recommended)
- WireGuard mesh VPN with NAT traversal
- No open ports to the public internet
- MagicDNS provides stable hostnames
- TLS certificates available via `tailscale cert`

### Nginx
- Reverse proxy terminates all connections
- WebSocket upgrade headers forwarded correctly
- `proxy_buffering off` for real-time streaming

### HTTPS (Production)
- Caddy or nginx with Let's Encrypt
- Required for WebAuthn, Service Worker, and secure cookies
- Local development runs HTTP with `Secure=false` cookies

---

## Authorization

### Capability Tiers

| Tier | Terminal | Agents | Files | Push | Offline | Team | Audit |
|------|----------|--------|-------|------|---------|------|-------|
| web (free) | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| native_free | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| native_pro | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| native_team | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

### Rate Limits

Implemented per-client key (IP + user agent hash):

- Safe commands: 10/sec, burst 20
- Dangerous commands: 1/min, burst 1
- Exceeding limits returns HTTP 429 with `retry_after` (seconds)

### Path Sandbox

All file operations resolve paths against `/` root:
```python
base = Path("/").resolve()
target = (base / path).resolve()
if not str(target).startswith(str(base)):
    raise HTTPException(400, "Invalid path")
```

This prevents `../../../etc/shadow` traversal.

---

## Secrets Management

### Environment Variables

| Variable | Purpose | Rotation |
|----------|---------|----------|
| `JERICHO_SECRET_KEY` | JWT signing, session cookies | On compromise |
| `JERICHO_PASSPHRASE_HASH` | Argon2id login verification | Via `scripts/setup.sh` |
| `JERICHO_TOTP_SECRET` | TOTP seed | Via `scripts/setup.sh` |
| `CODE_SERVER_PASSWORD` | code-server login | Via `scripts/setup.sh` |

### Best Practices
- `.env` is gitignored — never commit
- Use `.env.example` as a template
- Rotate all secrets with `scripts/setup.sh` if compromise suspected
- Run `docker compose down` before rotating to clear memory

---

## Incident Response

| Scenario | Immediate Action | Follow-up |
|----------|-----------------|-----------|
| Forgot passphrase | Re-run `scripts/setup.sh` | Reconfigure TOTP app |
| Lost phone / TOTP | Re-run `scripts/setup.sh` | Revoke old TOTP secret |
| Suspected token leak | `docker compose down && up` | Rotate `JERICHO_SECRET_KEY` |
| Session hijacking | Clear browser cookies | Check `audit` table for anomalies |
| Path traversal attempt | Check nginx access logs | Review `audit` table |
