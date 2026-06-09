"""
app/core/plugin_loader.py
─────────────────────────
Runtime plugin loader using Python's importlib.
Reads ACTIVE_METHOD from config and dynamically loads the correct plugin
WITHOUT restarting the system or modifying any other component.

This directly implements the architectural gap identified by Jafar & Aziz (2024):
"no published system implements a plugin interface allowing the tallying method
to be substituted without modifying other system components."
"""

"""
app/core/plugin_loader.py
"""

import importlib
import logging
import time
from pathlib import Path

from app.core.plugin_interface import TallyingPlugin

logger = logging.getLogger(__name__)

# Map config method names → module paths (all lowercase)
PLUGIN_REGISTRY: dict[str, str] = {
    "plurality": "app.plugins.plurality_plugin",
    "borda":     "app.plugins.borda_plugin",
    "stv":       "app.plugins.stv_plugin",
    "liquid":    "app.plugins.liquid_plugin",
}

_active_plugin: TallyingPlugin | None = None
_active_method: str | None = None


def load_plugin(method: str) -> TallyingPlugin:
    """Dynamically load a tallying plugin by method name (lowercase)."""
    global _active_plugin, _active_method

    method = method.lower().strip()

    if method == _active_method and _active_plugin is not None:
        return _active_plugin

    if method not in PLUGIN_REGISTRY:
        raise ValueError(
            f"Unknown tallying method '{method}'. "
            f"Available: {list(PLUGIN_REGISTRY.keys())}"
        )

    start = time.perf_counter()
    module_path = PLUGIN_REGISTRY[method]
    module = importlib.import_module(module_path)
    plugin: TallyingPlugin = module.Plugin()

    elapsed_ms = (time.perf_counter() - start) * 1000
    logger.info(
        "Plugin substitution: %s → %s  (%.2f ms)",
        _active_method or "none",
        method,
        elapsed_ms,
    )

    _active_plugin = plugin
    _active_method = method
    return plugin


def get_active_plugin() -> TallyingPlugin:
    """Return the currently loaded plugin. Raises if none loaded."""
    if _active_plugin is None:
        raise RuntimeError("No plugin loaded. Call load_plugin() first.")
    return _active_plugin