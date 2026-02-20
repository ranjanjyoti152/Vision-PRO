"""
Authentication routes – Login, signup, user management.
"""
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, status, Depends
from bson import ObjectId

from app.database import users_collection
from app.core.security import (
    hash_password,
    verify_password,
    create_access_token,
    get_current_user,
    require_admin,
)
from app.models.user import (
    UserCreate,
    UserLogin,
    UserUpdate,
    UserResponse,
    TokenResponse,
)

router = APIRouter(prefix="/api/auth", tags=["Authentication"])


def _user_doc_to_response(user: dict) -> UserResponse:
    """Convert MongoDB user document to response model."""
    return UserResponse(
        id=str(user["_id"]),
        username=user["username"],
        email=user["email"],
        role=user["role"],
        must_change_password=user.get("must_change_password", False),
        created_at=user["created_at"],
        updated_at=user.get("updated_at", user["created_at"]),
    )


@router.post("/login", response_model=TokenResponse)
async def login(credentials: UserLogin):
    """Authenticate user and return JWT token."""
    user = await users_collection().find_one({"username": credentials.username})
    if not user or not verify_password(credentials.password, user["password_hash"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
        )

    token = create_access_token(data={"sub": user["username"]})
    return TokenResponse(
        access_token=token,
        user=_user_doc_to_response(user),
    )


@router.post("/signup", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def signup(user_data: UserCreate):
    """Register a new user."""
    # Check if username or email already exists
    existing = await users_collection().find_one(
        {"$or": [{"username": user_data.username}, {"email": user_data.email}]}
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Username or email already exists",
        )

    now = datetime.now(timezone.utc)

    # First user is always admin, subsequent users default to viewer
    user_count = await users_collection().count_documents({})
    role = "admin" if user_count == 0 else "viewer"

    user_doc = {
        "username": user_data.username,
        "email": user_data.email,
        "password_hash": hash_password(user_data.password),
        "role": role,
        "must_change_password": False,
        "created_at": now,
        "updated_at": now,
    }

    result = await users_collection().insert_one(user_doc)
    user_doc["_id"] = result.inserted_id

    token = create_access_token(data={"sub": user_data.username})
    return TokenResponse(
        access_token=token,
        user=_user_doc_to_response(user_doc),
    )


@router.get("/me", response_model=UserResponse)
async def get_current_user_profile(user: dict = Depends(get_current_user)):
    """Get current authenticated user's profile."""
    return _user_doc_to_response(user)


@router.get("/users", response_model=list[UserResponse])
async def list_users(admin: dict = Depends(require_admin)):
    """List all users (admin only)."""
    cursor = users_collection().find()
    users = await cursor.to_list(length=100)
    return [_user_doc_to_response(u) for u in users]


@router.put("/users/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: str,
    update: UserUpdate,
    admin: dict = Depends(require_admin),
):
    """Update a user (admin only)."""
    update_dict = {}
    if update.email is not None:
        update_dict["email"] = update.email
    if update.password is not None:
        update_dict["password_hash"] = hash_password(update.password)
    if update.role is not None:
        update_dict["role"] = update.role.value

    if not update_dict:
        raise HTTPException(status_code=400, detail="No fields to update")

    update_dict["updated_at"] = datetime.now(timezone.utc)

    result = await users_collection().find_one_and_update(
        {"_id": ObjectId(user_id)},
        {"$set": update_dict},
        return_document=True,
    )
    if not result:
        raise HTTPException(status_code=404, detail="User not found")

    return _user_doc_to_response(result)


@router.delete("/users/{user_id}")
async def delete_user(user_id: str, admin: dict = Depends(require_admin)):
    """Delete a user (admin only)."""
    result = await users_collection().delete_one({"_id": ObjectId(user_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"message": "User deleted successfully"}
