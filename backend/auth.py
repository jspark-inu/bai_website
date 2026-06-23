import secrets
from werkzeug.security import generate_password_hash, check_password_hash


def hash_password(plain):
    # hai_2 currently uses Apple's system Python 3.9 build, where hashlib.scrypt
    # is unavailable. Werkzeug 3 defaults to scrypt, so pin a broadly compatible
    # method for the collaborator/staging runtime.
    return generate_password_hash(plain, method="pbkdf2:sha256")


def verify_password(plain, hashed):
    return check_password_hash(hashed, plain)


def make_api_key():
    return secrets.token_urlsafe(24)


def authenticate_web(db, name, password):
    """이름+비밀번호 검증. 성공 시 멤버 dict, 실패 시 None."""
    m = db.get_member_by_name(name)
    if not m:
        return None
    if not verify_password(password, m["password_hash"]):
        return None
    return m


def member_from_api_key(db, api_key):
    if not api_key:
        return None
    return db.get_member_by_api_key(api_key)
