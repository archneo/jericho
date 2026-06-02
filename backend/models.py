from pydantic import BaseModel


class LoginRequest(BaseModel):
    passphrase: str
    totp: str


class NoteSave(BaseModel):
    name: str
    content: str


class ThemeSave(BaseModel):
    id: str
    name: str
    description: str
    category: str
    tokens: str
    fontFamily: str
    effects: str


class SudoTicketRequest(BaseModel):
    passphrase: str
    totp: str
