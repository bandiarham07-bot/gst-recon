import json
from pathlib import Path
from typing import Optional, Dict, Tuple, List

try:
    from rapidfuzz import fuzz
    HAS_RAPIDFUZZ = True
except ImportError:
    HAS_RAPIDFUZZ = False

ALIAS_PATH = Path("config/alias_registry.json")

_alias_registry: Optional[Dict[str, List[str]]] = None


def _load_registry() -> Dict[str, List[str]]:
    global _alias_registry
    if _alias_registry is None:
        with open(ALIAS_PATH, "r", encoding="utf-8") as f:
            _alias_registry = json.load(f)
    return _alias_registry


def normalise(text: str) -> str:
    return text.lower().strip().replace("\n", " ").replace("  ", " ")


def map_column(raw: str) -> Tuple[Optional[str], float]:
    registry = _load_registry()
    norm_raw = normalise(raw)

    for canonical, aliases in registry.items():
        for alias in aliases:
            if norm_raw == normalise(alias):
                return canonical, 1.0

    if HAS_RAPIDFUZZ:
        best_canonical = None
        best_score = 0.0
        for canonical, aliases in registry.items():
            for alias in aliases:
                score = fuzz.token_sort_ratio(norm_raw, normalise(alias)) / 100.0
                if score > best_score:
                    best_score = score
                    best_canonical = canonical
        if best_score >= 0.75:
            return best_canonical, best_score
        return None, best_score

    return None, 0.0


def map_columns(raw_columns: List[str]) -> List[dict]:
    results = []
    for raw in raw_columns:
        if not raw or str(raw).strip() == "":
            continue
        canonical, score = map_column(str(raw))
        results.append({
            "raw": raw,
            "canonical": canonical,
            "score": score,
            "status": "auto" if score >= 0.75 else ("low_confidence" if score >= 0.50 else "unmatched")
        })
    return results
