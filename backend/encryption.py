import os
import json
import hashlib
import base64
from pathlib import Path

KEYSTORE_PATH = Path("config/keystore.json")

def _load_keystore() -> dict:
    if KEYSTORE_PATH.exists():
        with open(KEYSTORE_PATH, "r") as f:
            return json.load(f)
    return {}

def _save_keystore(data: dict):
    KEYSTORE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(KEYSTORE_PATH, "w") as f:
        json.dump(data, f, indent=2)

def derive_key(master_password: str, gstin: str) -> str:
    salt = hashlib.sha256(gstin.encode()).hexdigest().encode()
    key = hashlib.pbkdf2_hmac(
        "sha256",
        (master_password + gstin).encode(),
        salt,
        iterations=260000
    )
    return base64.b64encode(key).decode()

def store_key(gstin: str, key: str):
    ks = _load_keystore()
    ks[gstin] = key
    _save_keystore(ks)

def get_key(gstin: str) -> str:
    ks = _load_keystore()
    return ks.get(gstin)

def delete_key(gstin: str):
    ks = _load_keystore()
    if gstin in ks:
        del ks[gstin]
        _save_keystore(ks)

def key_exists(gstin: str) -> bool:
    return get_key(gstin) is not None
