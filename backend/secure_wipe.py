import os
from pathlib import Path


def secure_wipe(file_path: str, passes: int = 3):
    path = Path(file_path)
    if not path.exists():
        return
    size = path.stat().st_size
    with open(file_path, "r+b") as f:
        for _ in range(passes):
            f.seek(0)
            f.write(b'\x00' * size)
            f.flush()
            os.fsync(f.fileno())
            f.seek(0)
            f.write(b'\xFF' * size)
            f.flush()
            os.fsync(f.fileno())
            f.seek(0)
            f.write(os.urandom(size))
            f.flush()
            os.fsync(f.fileno())
    path.unlink()


def file_sha256(file_path: str) -> str:
    import hashlib
    sha256 = hashlib.sha256()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            sha256.update(chunk)
    return sha256.hexdigest()
