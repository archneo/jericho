from fastapi import APIRouter, HTTPException, Request, status
from utils.auth_jwt import mint_terminal_ticket, verify_token

router = APIRouter()


@router.post("/api/web/tickets/terminal")
async def ticket_terminal(request: Request):
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing access token")
    token_data = verify_token(auth_header[7:], "access")
    user_id = token_data["sub"]
    client_type = token_data.get("client_type", "web")
    tier = token_data.get("tier", "free")
    attested = token_data.get("attested", False)

    ticket = mint_terminal_ticket(user_id, client_type, tier, attested)
    return {"ticket": ticket, "expires_in": 300}


@router.post("/api/native/tickets/terminal")
async def ticket_terminal_native(request: Request):
    attestation = request.headers.get("X-Attestation-Token", "")
    attested = bool(attestation)

    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing access token")
    token_data = verify_token(auth_header[7:], "access")
    user_id = token_data["sub"]
    client_type = token_data.get("client_type", "native")
    tier = token_data.get("tier", "free")

    ticket = mint_terminal_ticket(user_id, client_type, tier, attested)
    return {"ticket": ticket, "expires_in": 300, "attested": attested}
