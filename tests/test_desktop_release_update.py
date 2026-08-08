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
