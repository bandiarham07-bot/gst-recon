import importlib.util
import sqlite3
import json
from pathlib import Path

PLUGINS_CONFIG = Path("config/plugins.json")


def list_plugins() -> list:
    if not PLUGINS_CONFIG.exists():
        return []
    with open(PLUGINS_CONFIG, "r") as f:
        data = json.load(f)
    return data.get("plugins", [])


def register_plugin(name: str, version: str, path: str, entry_point: str = "run"):
    plugins = list_plugins()
    plugins.append({"name": name, "version": version, "path": path, "entry_point": entry_point})
    with open(PLUGINS_CONFIG, "w") as f:
        json.dump({"plugins": plugins}, f, indent=2)


def run_plugin(db_path: str, plugin_path: str, entry_point: str = "run") -> dict:
    if not Path(db_path).exists():
        raise FileNotFoundError(f"Database not found: {db_path}")
    if not Path(plugin_path).exists():
        raise FileNotFoundError(f"Plugin not found: {plugin_path}")

    conn = sqlite3.connect(f"file:{db_path}?mode=rw", uri=True)
    conn.row_factory = sqlite3.Row

    spec = importlib.util.spec_from_file_location("recon_plugin", plugin_path)
    plugin = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(plugin)

    fn = getattr(plugin, entry_point)
    result = fn(conn)
    conn.close()
    return result or {}


def run_plugin_by_name(gstin: str, plugin_name: str) -> dict:
    from backend.database.db_manager import get_db_path
    plugins = list_plugins()
    plugin = next((p for p in plugins if p["name"] == plugin_name), None)
    if not plugin:
        raise ValueError(f"Plugin '{plugin_name}' not registered")
    db_path = str(get_db_path(gstin))
    return run_plugin(db_path, plugin["path"], plugin.get("entry_point", "run"))
