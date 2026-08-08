import hashlib
import importlib.util
import json
import sys
from pathlib import Path
from unittest.mock import patch


def load_launcher():
    module_path = Path(__file__).resolve().parents[1] / "desktop_launcher.py"
    spec = importlib.util.spec_from_file_location("desktop_launcher_test", module_path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_release_update_uses_newer_windows_archive(tmp_path):
    launcher = load_launcher()
    launcher.DATA_ROOT = tmp_path
    payload = {
        "tag_name": "v2.1.4",
        "assets": [{
            "name": "ShangjiaTool-v2.1.4-windows-x64.zip",
            "browser_download_url": "https://example.invalid/update.zip",
            "digest": "sha256:abc",
        }],
    }

    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def read(self, *args):
            return json.dumps(payload).encode("utf-8")

    with patch.object(launcher, "current_version", return_value="v2.1.3"), patch.object(launcher.urllib.request, "urlopen", return_value=Response()):
        update = launcher.release_update()

    assert update["tag"] == "v2.1.4"
    assert update["name"] == "ShangjiaTool-v2.1.4-windows-x64.zip"


def test_download_update_rejects_bad_checksum(tmp_path):
    launcher = load_launcher()
    launcher.DATA_ROOT = tmp_path
    content = b"desktop-update"

    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def read(self, size=-1):
            if hasattr(self, "done"):
                return b""
            self.done = True
            return content

    update = {"name": "ShangjiaTool-v2.1.4-windows-x64.zip", "url": "https://example.invalid/update.zip", "digest": "sha256:" + "0" * 64}
    with patch.object(launcher.urllib.request, "urlopen", return_value=Response()):
        try:
            launcher._download_update(update)
        except RuntimeError as error:
            assert "checksum" in str(error)
        else:
            raise AssertionError("checksum mismatch must fail")


def test_download_update_accepts_matching_checksum(tmp_path):
    launcher = load_launcher()
    launcher.DATA_ROOT = tmp_path
    content = b"desktop-update"

    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def read(self, size=-1):
            if hasattr(self, "done"):
                return b""
            self.done = True
            return content

    update = {"name": "ShangjiaTool-v2.1.4-windows-x64.zip", "url": "https://example.invalid/update.zip", "digest": "sha256:" + hashlib.sha256(content).hexdigest()}
    with patch.object(launcher.urllib.request, "urlopen", return_value=Response()):
        archive = launcher._download_update(update)

    assert archive.read_bytes() == content


def test_stop_service_terminates_only_launcher_child():
    launcher = load_launcher()

    class Process:
        def __init__(self):
            self.terminated = False
            self.waits = []

        def poll(self):
            return None

        def terminate(self):
            self.terminated = True

        def wait(self, timeout):
            self.waits.append(timeout)

    process = Process()
    launcher._SERVICE_PROCESS = process
    launcher.stop_service()

    assert process.terminated
    assert process.waits == [8]
    assert launcher._SERVICE_PROCESS is None


def test_title_bar_close_allows_real_exit():
    launcher = load_launcher()
    assert launcher.allow_window_close() is True


def test_minimize_to_tray_hides_window():
    launcher = load_launcher()
    launcher._EXIT_REQUESTED = False

    class Window:
        def __init__(self):
            self.hidden = False

        def hide(self):
            self.hidden = True

    window = Window()
    with patch.object(launcher, "_start_tray", return_value=True):
        launcher.minimize_to_tray(window)

    assert window.hidden is True


def test_desktop_update_preferences_persist_outside_install_directory(tmp_path):
    launcher = load_launcher()
    launcher.DATA_ROOT = tmp_path
    launcher.desktop_settings_path().write_text('{"auto_check_updates": false, "manual_update_check": true}', encoding='utf-8')

    assert launcher.desktop_auto_update_enabled() is False
    assert launcher.desktop_update_requested() is True

    launcher.clear_desktop_update_request()

    assert launcher.desktop_update_requested() is False
