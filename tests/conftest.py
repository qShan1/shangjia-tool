"""Test compatibility for the package reorganization.

The application now lives in ``shangjia_tool``; legacy tests still import
module names that were historically located at repository root.
"""
from pathlib import Path
import sys

PACKAGE_DIR = str(Path(__file__).resolve().parents[1] / "shangjia_tool")
if PACKAGE_DIR not in sys.path:
    sys.path.insert(0, PACKAGE_DIR)
