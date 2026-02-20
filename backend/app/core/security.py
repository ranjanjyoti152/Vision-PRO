"""
Security utilities – JWT auth, password hashing, credential encryption.
"""
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
from cryptography.fernet import Fernet
from jose import JWTError, jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from app.config import settings
from app.database import users_collection

# JWT Bearer scheme
security_scheme = HTTPBearer()

# Credential encryption key (derived from SECRET_KEY)
_fernet_key: Fernet | None = None


def _get_fernet() -> Fernet:
    """Get or create Fernet encryption instance."""
    global _fernet_key
    if _fernet_key is None:
        import hashlib, base64
        key = hashlib.sha256(settings.SECRET_KEY.encode()).digest()
        _fernet_key = Fernet(base64.urlsafe_b64encode(key))
    return _fernet_key


# ----- Password -----
def hash_password(password: str) -> str:
    """Hash a password using bcrypt."""
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a password against its hash."""
    return bcrypt.checkpw(
        plain_password.encode("utf-8"), hashed_password.encode("utf-8")
    )


# ----- JWT -----
def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """Create a JWT access token."""
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(hours=settings.JWT_EXPIRATION_HOURS)
    )
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_token(token: str) -> dict:
    """Decode and validate a JWT token."""
    try:
        payload = jwt.decode(
            token, settings.SECRET_KEY, algorithms=[settings.JWT_ALGORITHM]
        )
        return payload
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security_scheme),
) -> dict:
    """FastAPI dependency to get the current authenticated user."""
    payload = decode_token(credentials.credentials)
    username = payload.get("sub")
    if username is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload",
        )
    user = await users_collection().find_one({"username": username})
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
        )
    user["_id"] = str(user["_id"])
    return user


async def require_admin(user: dict = Depends(get_current_user)) -> dict:
    """FastAPI dependency to require admin role."""
    if user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return user


# ----- Credential Encryption -----
def encrypt_credential(value: str) -> str:
    """Encrypt a service credential for database storage."""
    return _get_fernet().encrypt(value.encode()).decode()


def decrypt_credential(encrypted_value: str) -> str:
    """Decrypt a service credential from database storage."""
    return _get_fernet().decrypt(encrypted_value.encode()).decode()
