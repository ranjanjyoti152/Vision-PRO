"""
User Pydantic models.
"""
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field, EmailStr
from enum import Enum


class UserRole(str, Enum):
    ADMIN = "admin"
    VIEWER = "viewer"


class UserCreate(BaseModel):
    """Schema for user registration."""
    username: str = Field(..., min_length=3, max_length=50)
    email: str = Field(..., min_length=5, max_length=100)
    password: str = Field(..., min_length=6, max_length=100)
    role: UserRole = UserRole.VIEWER


class UserLogin(BaseModel):
    """Schema for user login."""
    username: str
    password: str


class UserUpdate(BaseModel):
    """Schema for updating user profile."""
    email: Optional[str] = None
    password: Optional[str] = None
    role: Optional[UserRole] = None


class UserResponse(BaseModel):
    """Schema for user API responses (no password)."""
    id: str
    username: str
    email: str
    role: UserRole
    must_change_password: bool = False
    created_at: datetime
    updated_at: datetime


class TokenResponse(BaseModel):
    """Schema for JWT token response."""
    access_token: str
    token_type: str = "bearer"
    user: UserResponse
