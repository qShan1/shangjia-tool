"""上架工具桌面启动器：启动本地服务并打开管理台。"""
import os
import subprocess
import sys
import time
import urllib.request
import webbrowser
import shutil
import atexit
import hashlib
import json
import threading
from pathlib import Path

APP_NAME = "上架工具"
if getattr(sys, "frozen", False):
    ROOT = Path(sys.executable).resolve().parent
else:
    ROOT = Path(__file__).resolve().parent
PORT = int(os.environ.get("SHANGJIA_PORT", "8090"))
DATA_ROOT = Path(os.environ.get("SHANGJIA_DATA_DIR", Path(os.environ.get("LOCALAPPDATA", ROOT)) / "ShangjiaTool"))
_LOCK_HANDLE = None
_SERVICE_PROCESS = None
_EXIT_REQUESTED = False
_TRAY_ICON = None
GITHUB_RELEASE_URL = "https://api.github.com/repos/qShan1/shangjia-tool/releases/latest"


def current_version():
    for path in (ROOT / "static" / "version.txt", ROOT / "_internal" / "static" / "version.txt"):
        try:
            version = path.read_text(encoding="utf-8").strip()
            if version:
                return version
        except OSError:
            pass
    return "v0.0.0"


def desktop_settings_path():
    return DATA_ROOT / "desktop-settings.json"


def desktop_settings():
    try:
        payload = json.loads(desktop_settings_path().read_text(encoding="utf-8"))
        return payload if isinstance(payload, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def desktop_auto_update_enabled():
    return desktop_settings().get("auto_check_updates", True) is not False


def desktop_update_requested():
    return desktop_settings().get("manual_update_check") is True


def clear_desktop_update_request():
    settings = desktop_settings()
    if not settings.pop("manual_update_check", None):
        return
    try:
        desktop_settings_path().write_text(json.dumps(settings, ensure_ascii=False, indent=2), encoding="utf-8")
    except OSError:
        pass


def mark_tray_notice_seen():
    settings = desktop_settings()
    if settings.get("tray_notice_seen"):
        return False
    settings["tray_notice_seen"] = True
    try:
        desktop_settings_path().parent.mkdir(parents=True, exist_ok=True)
        desktop_settings_path().write_text(json.dumps(settings, ensure_ascii=False, indent=2), encoding="utf-8")
    except OSError:
        return False
    return True


def _version_key(value):
    return tuple(int(part) for part in str(value).lstrip("vV").split(".") if part.isdigit())


def show_question(message):
    try:
        import ctypes
        return ctypes.windll.user32.MessageBoxW(None, message, APP_NAME, 0x24) == 6
    except Exception:
        return False


def release_update():
    request = urllib.request.Request(GITHUB_RELEASE_URL, headers={"User-Agent": "ShangjiaTool"})
    try:
        with urllib.request.urlopen(request, timeout=8) as response:
            release = json.load(response)
    except Exception as error:
        with desktop_log_path().open("a", encoding="utf-8") as output:
            output.write(f"Update check skipped: {error}\n")
        return None
    tag = str(release.get("tag_name") or "").strip()
    if not tag or _version_key(tag) <= _version_key(current_version()):
        return None
    for asset in release.get("assets", []):
        name = str(asset.get("name") or "")
        if name.startswith("ShangjiaTool-") and name.endswith("-windows-x64.zip"):
            return {"tag": tag, "name": name, "url": asset.get("browser_download_url"), "digest": asset.get("digest", "")}
    return None


def _download_update(update):
    staging = DATA_ROOT / "updates" / "staging"
    staging.mkdir(parents=True, exist_ok=True)
    archive = staging / update["name"]
    request = urllib.request.Request(update["url"], headers={"User-Agent": "ShangjiaTool"})
    with urllib.request.urlopen(request, timeout=90) as response, archive.open("wb") as target:
        shutil.copyfileobj(response, target)
    digest = str(update.get("digest") or "")
    if digest.startswith("sha256:"):
        actual = hashlib.sha256(archive.read_bytes()).hexdigest()
        if actual != digest.split(":", 1)[1]:
            archive.unlink(missing_ok=True)
            raise RuntimeError("Update archive checksum verification failed")
    return archive


def schedule_desktop_update(update):
    archive = _download_update(update)
    staging = DATA_ROOT / "updates" / "staging"
    script = staging / "apply-desktop-update.ps1"
    backup = ROOT.parent / f"{ROOT.name}.backup-{current_version().lstrip('v')}"
    log = DATA_ROOT / "logs" / "desktop-update.log"
    script.write_text(
        "param([int]$ProcessId, [string]$Archive, [string]$InstallDir, [string]$BackupDir, [string]$LogFile)\n"
        "$ErrorActionPreference = 'Stop'\n"
        "function Log([string]$message) { Add-Content -LiteralPath $LogFile -Value ((Get-Date -Format s) + ' ' + $message) }\n"
        "Start-Sleep -Seconds 2\n"
        "try { Wait-Process -Id $ProcessId -ErrorAction SilentlyContinue } catch {}\n"
        "$incoming = Join-Path (Split-Path -Parent $InstallDir) ('.shangjia-incoming-' + [guid]::NewGuid().ToString())\n"
        "try {\n"
        "  Log 'Extracting update archive'\n"
        "  Expand-Archive -LiteralPath $Archive -DestinationPath $incoming -Force\n"
        "  $payload = Join-Path $incoming 'ShangjiaTool'\n"
        "  if (-not (Test-Path (Join-Path $payload 'ShangjiaTool.exe'))) { throw 'Update archive does not contain ShangjiaTool.exe' }\n"
        "  if (Test-Path $BackupDir) { Remove-Item -LiteralPath $BackupDir -Recurse -Force }\n"
        "  Move-Item -LiteralPath $InstallDir -Destination $BackupDir\n"
        "  Move-Item -LiteralPath $payload -Destination $InstallDir\n"
        "  Start-Process -FilePath (Join-Path $InstallDir 'ShangjiaTool.exe')\n"
        "  Log 'Update installed and launcher restarted'\n"
        "} catch {\n"
        "  Log ('Update failed: ' + $_.Exception.Message)\n"
        "  if (Test-Path $BackupDir) {\n"
        "    if (Test-Path $InstallDir) { Remove-Item -LiteralPath $InstallDir -Recurse -Force -ErrorAction SilentlyContinue }\n"
        "    Move-Item -LiteralPath $BackupDir -Destination $InstallDir\n"
        "    Log 'Previous desktop bundle restored'\n"
        "  }\n"
        "  if (Test-Path (Join-Path $InstallDir 'ShangjiaTool.exe')) { Start-Process -FilePath (Join-Path $InstallDir 'ShangjiaTool.exe') }\n"
        "} finally { if (Test-Path $incoming) { Remove-Item -LiteralPath $incoming -Recurse -Force -ErrorAction SilentlyContinue } }\n",
        encoding="utf-8",
    )
    subprocess.Popen([
        "powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(script),
        "-ProcessId", str(os.getpid()), "-Archive", str(archive), "-InstallDir", str(ROOT),
        "-BackupDir", str(backup), "-LogFile", str(log),
    ], creationflags=getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0))


def offer_desktop_update():
    if not getattr(sys, "frozen", False):
        return False
    manually_requested = desktop_update_requested()
    if not desktop_auto_update_enabled() and not manually_requested:
        return False
    update = release_update()
    if manually_requested:
        clear_desktop_update_request()
    if not update:
        return False
    if not show_question(f"A new version {update['tag']} is available.\n\nDownload, install, and restart now? Existing data will not be modified."):
        return False
    try:
        schedule_desktop_update(update)
        return True
    except Exception as error:
        show_error(f"Update download failed: {error}\n\nThe current version will continue to start.")
        return False


def desktop_log_path():
    path = DATA_ROOT / "logs" / "desktop-launcher.log"
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def show_error(message):
    """Windowed builds have no console, so surface startup failures explicitly."""
    try:
        import ctypes
        ctypes.windll.user32.MessageBoxW(None, message, APP_NAME, 0x10)
    except Exception:
        pass


def show_info(message):
    try:
        import ctypes
        ctypes.windll.user32.MessageBoxW(None, message, APP_NAME, 0x40)
    except Exception:
        pass


def service_executable():
    """Return the service location used by the onedir PyInstaller bundle."""
    candidates = [
        ROOT / "_internal" / "ShangjiaService.exe",
        ROOT / "ShangjiaService.exe",  # Compatibility with early desktop builds.
        Path(getattr(sys, "_MEIPASS", ROOT)) / "ShangjiaService.exe",
    ]
    return next((path for path in candidates if path.exists()), candidates[0])

def acquire_single_instance():
    """Use an exclusive lock file so double-clicking does not spawn another service."""
    global _LOCK_HANDLE
    lock_path = DATA_ROOT / "shangjia-tool.lock"
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    _LOCK_HANDLE = lock_path.open("a+")
    try:
        import msvcrt
        msvcrt.locking(_LOCK_HANDLE.fileno(), msvcrt.LK_NBLCK, 1)
    except (ImportError, OSError):
        _LOCK_HANDLE.close()
        _LOCK_HANDLE = None
        return False
    atexit.register(release_single_instance)
    return True

def release_single_instance():
    global _LOCK_HANDLE
    if _LOCK_HANDLE is None:
        return
    try:
        import msvcrt
        _LOCK_HANDLE.seek(0)
        msvcrt.locking(_LOCK_HANDLE.fileno(), msvcrt.LK_UNLCK, 1)
    except Exception:
        pass
    _LOCK_HANDLE.close()
    _LOCK_HANDLE = None


def stop_service():
    """Stop only the service process launched by this desktop instance."""
    global _SERVICE_PROCESS
    process = _SERVICE_PROCESS
    _SERVICE_PROCESS = None
    if process is None or process.poll() is not None:
        return
    try:
        process.terminate()
        process.wait(timeout=8)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=3)
    except OSError:
        pass


def request_exit(window=None):
    """Leave tray mode and close both the window and its local service."""
    global _EXIT_REQUESTED
    _EXIT_REQUESTED = True
    if _TRAY_ICON is not None:
        try:
            _TRAY_ICON.stop()
        except Exception:
            pass
    if window is not None:
        try:
            window.destroy()
        except Exception:
            pass


def _start_tray(window):
    """Create a Windows tray menu after the user closes the main window."""
    global _TRAY_ICON
    if _TRAY_ICON is not None:
        return True
    try:
        import pystray
        from PIL import Image

        image = None
        for icon_path in (ROOT / "_internal" / "static" / "ShangjiaTool.ico", ROOT / "static" / "ShangjiaTool.ico"):
            if not icon_path.exists():
                continue
            with Image.open(icon_path) as icon_source:
                image = icon_source.convert("RGBA").resize((64, 64), Image.Resampling.LANCZOS)
            break
        if image is None:
            image = Image.new("RGBA", (64, 64), (23, 23, 23, 255))

        def show_window(_icon, _item):
            try:
                window.show()
                window.restore()
            except Exception:
                pass

        def exit_app(_icon, _item):
            request_exit(window)

        _TRAY_ICON = pystray.Icon(
            "ShangjiaTool",
            image,
            APP_NAME,
            menu=pystray.Menu(
                pystray.MenuItem("打开商家工具", show_window, default=True),
                pystray.MenuItem("退出", exit_app),
            ),
        )
        threading.Thread(target=_TRAY_ICON.run, name="shangjia-tray", daemon=True).start()
        return True
    except Exception as error:
        with desktop_log_path().open("a", encoding="utf-8") as output:
            output.write(f"Tray is unavailable: {error}\\n")
        return False


def minimize_to_tray(window):
    """A minimized desktop window becomes a tray-resident background app."""
    if _EXIT_REQUESTED or not _start_tray(window):
        return
    try:
        window.hide()
        if mark_tray_notice_seen():
            show_info("商家工具仍在后台运行。\n\n请在 Windows 右下角通知区域点击商家工具图标，可打开窗口或选择“退出”。")
    except Exception:
        pass


def allow_window_close():
    """The title-bar close button always performs a real application exit."""
    return True

def migrate_runtime_data():
    """Copy legacy runtime folders once; never remove or overwrite source data."""
    for name in ("data", "browser_data", "logs", "trajectory_history", "update_backup"):
        source = ROOT / name
        target = DATA_ROOT / name
        if not source.exists() or target.exists():
            continue
        shutil.copytree(source, target, dirs_exist_ok=True)
    old_uploads = ROOT / "static" / "uploads"
    new_uploads = DATA_ROOT / "uploads"
    if old_uploads.exists() and not new_uploads.exists():
        shutil.copytree(old_uploads, new_uploads, dirs_exist_ok=True)

def health_url():
    return f"http://127.0.0.1:{PORT}/health"

def healthy():
    try:
        with urllib.request.urlopen(health_url(), timeout=2) as response:
            return response.status == 200
    except Exception:
        return False

def main():
    global _SERVICE_PROCESS
    DATA_ROOT.mkdir(parents=True, exist_ok=True)
    if offer_desktop_update():
        return
    if not acquire_single_instance():
        if healthy():
            webbrowser.open(f"http://127.0.0.1:{PORT}/admin")
            return
        raise RuntimeError("上架工具已在启动中，请稍候再试")
    migrate_runtime_data()
    env = os.environ.copy()
    env["APP_DATA_DIR"] = str(DATA_ROOT)
    env["DB_PATH"] = str(DATA_ROOT / "data" / "xianyu_data.db")
    env["API_PORT"] = str(PORT)
    if not healthy():
        if getattr(sys, "frozen", False):
            service = service_executable()
            command = [str(service)]
        else:
            python = ROOT / "venv" / "Scripts" / "python.exe"
            if not python.exists():
                python = Path(sys.executable)
            if not python.exists():
                raise RuntimeError("未找到 Python 解释器，请检查 venv 目录")
            command = [str(python), str(ROOT / "Start.py")]
        if not Path(command[0]).exists():
            raise RuntimeError("桌面服务组件缺失，请重新构建安装包")
        with desktop_log_path().open("a", encoding="utf-8") as output:
            output.write(f"Starting service: {command[0]} on port {PORT}\n")
            output.flush()
            process = subprocess.Popen(
                command,
                # Frozen services must never create runtime folders beside the app bundle.
                cwd=str(DATA_ROOT if getattr(sys, "frozen", False) else ROOT),
                env=env,
                stdout=output,
                stderr=subprocess.STDOUT,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
            _SERVICE_PROCESS = process
        for _ in range(40):
            if healthy():
                break
            time.sleep(0.75)
        else:
            process.terminate()
            exit_code = process.poll()
            raise RuntimeError(
                "本地服务未能在 30 秒内启动。"
                f"服务退出码: {exit_code}; 诊断日志: {desktop_log_path()}"
            )
    # pywebview 是可选依赖；没有时仍保持一键启动体验。
    try:
        import webview
        # 窗口/任务栏图标：优先取打包后的 _internal/static，其次源码 static
        window_icon = None
        for icon_path in (ROOT / "_internal" / "static" / "ShangjiaTool.ico", ROOT / "static" / "ShangjiaTool.ico"):
            if icon_path.exists():
                window_icon = str(icon_path)
                break
        window = webview.create_window(
            APP_NAME,
            f"http://127.0.0.1:{PORT}/admin",
            width=1440,
            height=900,
            icon=window_icon,
        )
        window.events.closing += allow_window_close
        window.events.minimized += lambda: minimize_to_tray(window)
        webview.start()
    except ImportError:
        webbrowser.open(f"http://127.0.0.1:{PORT}/admin")
    finally:
        stop_service()

if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        show_error(str(error))
        raise
