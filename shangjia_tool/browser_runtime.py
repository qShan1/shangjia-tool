"""Resolve a browser only when a platform automation flow needs one."""
import os
from pathlib import Path


def find_system_browser() -> Path | None:
    candidates = []
    for variable in ("PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"):
        base = os.environ.get(variable)
        if base:
            candidates.extend((
                Path(base) / "Microsoft" / "Edge" / "Application" / "msedge.exe",
                Path(base) / "Google" / "Chrome" / "Application" / "chrome.exe",
            ))
    return next((path for path in candidates if path.is_file()), None)


def launch_options(args, headless: bool) -> dict:
    """Prefer the user's maintained Edge/Chrome; fall back to Playwright Chromium."""
    options = {"headless": headless, "args": args}
    browser = find_system_browser()
    if browser:
        options["executable_path"] = str(browser)
    return options
