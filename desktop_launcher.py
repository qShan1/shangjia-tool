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
_WINDOW = None
# 更新清单：从 GitHub 仓库 raw 文件读取，raw 直链不受 API 限流（避免 GitHub API 403 rate limit）。
UPDATE_MANIFEST_URL = os.environ.get(
    "SHANGJIA_UPDATE_MANIFEST_URL",
    "https://raw.githubusercontent.com/qShan1/shangjia-tool/main/update-manifest.json",
)


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


AUTOSTART_REGKEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
AUTOSTART_VALUE = "ShangjiaTool"


def autostart_enabled():
    """Return whether the desktop launcher is registered to auto-start with Windows."""
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, AUTOSTART_REGKEY, 0, winreg.KEY_READ) as key:
            winreg.QueryValueEx(key, AUTOSTART_VALUE)
            return True
    except FileNotFoundError:
        return False
    except OSError:
        return False


def set_autostart_enabled(enabled):
    """Write/delete the HKCU Run entry pointing at the desktop launcher exe."""
    try:
        import winreg
        value = str(ROOT / "ShangjiaTool.exe")
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, AUTOSTART_REGKEY, 0, winreg.KEY_SET_VALUE) as key:
            if enabled:
                winreg.SetValueEx(key, AUTOSTART_VALUE, 0, winreg.REG_SZ, value)
            else:
                try:
                    winreg.DeleteValue(key, AUTOSTART_VALUE)
                except FileNotFoundError:
                    pass
        return {"success": True, "enabled": bool(enabled), "path": value}
    except Exception as error:
        return {"success": False, "error": str(error)}


class _DesktopApi:
    """Exposed to the webview page as window.pywebview.api (desktop-only)."""

    def get_autostart(self):
        return {"enabled": autostart_enabled()}

    def set_autostart(self, enabled):
        return set_autostart_enabled(bool(enabled))


def _version_key(value):
    return tuple(int(part) for part in str(value).lstrip("vV").split(".") if part.isdigit())


def show_question(message):
    try:
        import ctypes
        return ctypes.windll.user32.MessageBoxW(None, message, APP_NAME, 0x24) == 6
    except Exception:
        return False


def release_update():
    """从更新清单文件读取最新版本与下载地址。

    清单是仓库里的 raw JSON（如 update-manifest.json），内容形如：
      {"latest": "v2.4.0", "zip_url": "https://.../ShangjiaTool-v2.4.0-windows-x64.zip",
       "digest": "", "force": true}
    使用 raw 而非 GitHub API，可避开 API 速率限制(403)。
    """
    request = urllib.request.Request(UPDATE_MANIFEST_URL, headers={"User-Agent": "ShangjiaTool"})
    try:
        with urllib.request.urlopen(request, timeout=3) as response:
            manifest = json.load(response)
    except Exception as error:
        with desktop_log_path().open("a", encoding="utf-8") as output:
            output.write(f"Update check skipped: {error}\n")
        return None
    if not isinstance(manifest, dict):
        return None
    tag = str(manifest.get("latest") or "").strip()
    if not tag or _version_key(tag) <= _version_key(current_version()):
        return None
    # zip 文件名：清单可给 zip_url，否则按命名规则拼接
    name = str(manifest.get("name") or f"ShangjiaTool-{tag}-windows-x64.zip").strip()
    url = str(manifest.get("zip_url") or "").strip()
    if not url:
        url = f"https://github.com/qShan1/shangjia-tool/releases/download/{tag}/{name}"
    mirrors = manifest.get("mirrors") if isinstance(manifest.get("mirrors"), list) else []
    mirrors = [str(m).strip() for m in mirrors if str(m).strip()]
    force = bool(manifest.get("force", False))
    digest = str(manifest.get("digest") or "")
    return {"tag": tag, "name": name, "url": url, "mirrors": mirrors, "digest": digest, "force": force}


def _download_update(update):
    staging = DATA_ROOT / "updates" / "staging"
    staging.mkdir(parents=True, exist_ok=True)
    archive = staging / update["name"]
    # 下载源优先级：镜像列表 → 原始 zip_url → 兜底失败
    sources = list(update.get("mirrors") or [])
    if update.get("url"):
        sources.append(update["url"])
    last_error = None
    for src in sources:
        try:
            request = urllib.request.Request(src, headers={"User-Agent": "ShangjiaTool"})
            with urllib.request.urlopen(request, timeout=300) as response, archive.open("wb") as target:
                shutil.copyfileobj(response, target)
            with desktop_log_path().open("a", encoding="utf-8") as output:
                output.write(f"Update downloaded from: {src}\n")
            last_error = None
            break
        except Exception as e:
            last_error = e
            with desktop_log_path().open("a", encoding="utf-8") as output:
                output.write(f"Update source failed ({src}): {e}\n")
            try:
                archive.unlink(missing_ok=True)
            except Exception:
                pass
    if last_error is not None:
        with desktop_log_path().open("a", encoding="utf-8") as output:
            output.write(f"Update download failed: {last_error}\n")
        raise last_error
    digest = str(update.get("digest") or "")
    if digest.startswith("sha256:"):
        actual = hashlib.sha256(archive.read_bytes()).hexdigest()
        if actual != digest.split(":", 1)[1]:
            archive.unlink(missing_ok=True)
            raise RuntimeError("Update archive checksum verification failed")
    return archive


def _apply_update_in_background(update):
    """后台下载并应用更新；下载前提示，避免同步下载让启动流程“假死”。"""
    try:
        show_info(f"正在下载新版本 {update['tag']}，请稍候...\n\n"
                  "下载完成后将自动安装并重启软件，现有数据不会丢失。")
        archive = _download_update(update)
        _schedule_install_script(archive, update)
    except Exception as error:
        try:
            show_error(f"更新下载失败：{error}\n\n当前版本将继续运行。")
        except Exception:
            pass
        with desktop_log_path().open("a", encoding="utf-8") as output:
            output.write(f"Background update failed: {error}\n")


def _schedule_install_script(archive, update):
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


def schedule_desktop_update(update):
    """旧入口：直接同步下载并应用（保留，供手动/测试路径）。"""
    _apply_update_in_background(update)


def _auto_check_updates_background():
    """后台检测更新；有更新再提示并安装，全程不阻塞桌面窗口打开。"""
    try:
        update = release_update()
        if not update:
            return
        if update.get("force"):
            # 强制更新：不询问，直接下载安装并重启，避免旧版本继续运行造成数据/接口不兼容
            show_info(f"检测到新版本 {update['tag']}，正在自动更新...\n\n更新将安装到当前目录并自动重启，现有数据不会丢失。")
            try:
                schedule_desktop_update(update)
            except Exception as error:
                show_error(f"更新下载失败：{error}\n当前版本将继续运行。")
            return
        if not show_question(f"A new version {update['tag']} is available.\n\nDownload, install, and restart now? Existing data will not be modified."):
            return
        try:
            schedule_desktop_update(update)
        except Exception as error:
            show_error(f"Update download failed: {error}\n\nThe current version will continue to start.")
    except Exception:
        pass


def _manual_install_background():
    """手动请求的更新：后台下载安装（安装脚本会等本进程退出后替换并重启）。"""
    clear_desktop_update_request()
    try:
        update = release_update()
        if not update:
            show_info("当前已是最新版本，无需更新。")
            return
        try:
            schedule_desktop_update(update)
        except Exception as error:
            show_error(f"更新下载失败：{error}\n当前版本将继续运行。")
    except Exception:
        pass


def offer_desktop_update():
    """启动时的更新处理。

    关键：强制更新(force)必须同步执行并退出进程，否则安装脚本无法替换正在运行的
    exe（Wait-Process 会一直等）。非强制更新才后台化，不阻塞窗口打开。
    返回 True 表示正在更新/已进入更新流程，调用方(main)应直接返回，让进程退出以便安装。
    """
    if not getattr(sys, "frozen", False):
        return False
    manually_requested = desktop_update_requested()
    if not desktop_auto_update_enabled() and not manually_requested:
        return False
    if manually_requested:
        threading.Thread(target=_manual_install_background, name="shangjia-startup-update", daemon=True).start()
        return False
    # 自动检查：先同步读一次清单（超时短），判断是否强制更新
    update = _safe_release_update()
    if not update:
        return False
    if update.get("force"):
        # 强制更新：提示后下载安装，并退出本进程让安装脚本执行
        try:
            _apply_update_in_background(update)
        except Exception as error:
            show_error(f"更新下载失败：{error}\n当前版本将继续运行。")
            return False
        return True
    # 非强制更新：后台检查，提示用户确认，不阻塞窗口
    threading.Thread(target=_auto_check_updates_background, name="shangjia-startup-update", daemon=True).start()
    return False


def _safe_release_update():
    """读取更新清单；网络失败时返回 None 不阻塞启动。"""
    try:
        return release_update()
    except Exception:
        return None


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


def _port_owner_pid():
    """Return the PID currently LISTENING on PORT, or None."""
    try:
        result = subprocess.run(
            ["netstat", "-ano", "-p", "TCP"],
            capture_output=True,
            text=True,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            timeout=15,
        )
        for line in result.stdout.splitlines():
            fields = line.split()
            if len(fields) >= 5 and fields[0] == "TCP" and fields[1].endswith(f":{PORT}"):
                if fields[3] == "LISTENING":
                    return fields[4]
    except Exception:
        pass
    return None


def _taskkill_all_services():
    """kill every ShangjiaService.exe by image name (walks the whole process tree)."""
    try:
        subprocess.run(
            ["taskkill", "/IM", "ShangjiaService.exe", "/T", "/F"],
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            capture_output=True,
            timeout=15,
        )
    except Exception:
        pass


def clean_stale_services():
    """清除上一次会话残留的服务进程。

    旧版退出不干净会让 ShangjiaService.exe 长期存活并独占 8090 端口；再次启动时启动器
    检测到端口已通就不起新服务，而旧实例所属 PyInstaller onefile 的临时解压目录(_MEI)
    被系统清理后，其 index.html 静态资源会消失，界面报 'No front-end found'。单实例
    应用同一时间只应有一个服务，启动前统一清扫是安全的。
    """
    _taskkill_all_services()
    # 给刚被杀的进程一点时间释放 8090 端口，避免新服务绑定冲突。
    time.sleep(0.2)


def stop_service():
    """Stop the service and guarantee no ShangjiaService.exe remains or port is held."""
    global _SERVICE_PROCESS
    process = _SERVICE_PROCESS
    _SERVICE_PROCESS = None

    if process is not None and process.poll() is None:
        # TerminateProcess: graceful teardown when the process is still alive.
        try:
            process.terminate()
            process.wait(timeout=8)
        except (subprocess.TimeoutExpired, OSError):
            pass
        # terminate() only kills the parent; orphan children can linger and hold the
        # port. taskkill /T walks the whole process tree.
        pid = process.pid
        try:
            subprocess.run(
                ["taskkill", "/PID", str(pid), "/T", "/F"],
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                capture_output=True,
                timeout=15,
            )
        except Exception:
            pass

    # /IM 全量兜底：PyInstaller onefile 父引导进程可能先于 Python 子进程退出导致登记
    # 的 pid 失效，这里统一清理本工具的全部服务进程（单实例，同一时刻只应有一个服务）。
    _taskkill_all_services()

    # 等端口真正被释放；超时后强杀任何仍占用 8090 的残留进程，确保退出后无残留。
    deadline = time.time() + 10
    while time.time() < deadline and _port_owner_pid() is not None:
        time.sleep(0.2)
    owner = _port_owner_pid()
    if owner is not None:
        try:
            subprocess.run(
                ["taskkill", "/PID", owner, "/T", "/F"],
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                capture_output=True,
                timeout=15,
            )
        except Exception:
            pass
        with desktop_log_path().open("a", encoding="utf-8") as output:
            output.write(f"Service stopped; force-killed leftover port owner (pid={owner})\n")


def request_exit(window=None):
    """Leave tray mode and close both the window and its local service."""
    global _EXIT_REQUESTED
    _EXIT_REQUESTED = True
    if _TRAY_ICON is not None:
        try:
            # pystray 不允许在图标自身的菜单回调线程里直接 stop()（会阻塞），
            # 放到独立线程执行，避免“退出”流程卡死导致服务残留。
            threading.Thread(target=_TRAY_ICON.stop, name="shangjia-tray-stop", daemon=True).start()
        except Exception:
            pass
    if window is not None:
        try:
            window.destroy()
        except Exception:
            pass
    # 直接结束后台服务，不再依赖 webview.start() 返回后的 finally，
    # 确保点“退出”立即清掉服务进程并释放端口。
    stop_service()


def _check_update_from_tray(window=None):
    """从托盘手动检查并安装更新（提示 → 点击安装 → 自动重启）。

    在独立线程中执行：网络请求和原生 MessageBox 都不阻塞 pystray 的回调线程，
    避免“点检查更新后弹窗卡住 / 无法关闭”的现象。
    """
    def _run():
        try:
            update = release_update()
            if not update:
                show_info("当前已是最新版本，无需更新。")
                return
            if not show_question(
                f"发现新版本 {update['tag']}。\n\n"
                "点击「是」将自动下载并安装到当前安装目录，"
                "安装完成后会自动关闭窗口并重新启动软件。现有数据不会丢失。"
            ):
                return
            schedule_desktop_update(update)
            request_exit(window)
        except Exception as error:
            try:
                show_error(f"更新下载失败：{error}\n当前版本将继续运行。")
            except Exception:
                pass

    threading.Thread(target=_run, name="shangjia-tray-update", daemon=True).start()


def _start_tray(window):
    """Create a Windows tray menu after the user closes the main window."""
    global _TRAY_ICON, _WINDOW
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
                window.focus()
            except Exception:
                pass

        def check_update(_icon, _item):
            _check_update_from_tray(window)

        def exit_app(_icon, _item):
            request_exit(window)

        _TRAY_ICON = pystray.Icon(
            "ShangjiaTool",
            image,
            APP_NAME,
            menu=pystray.Menu(
                pystray.MenuItem("打开商家工具", show_window, default=True),
                pystray.MenuItem("检查更新", check_update),
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


def desktop_close_behavior():
    """关闭按钮行为：prompt(弹窗选择) / tray(最小化托盘) / exit(直接退出)。"""
    behavior = desktop_settings().get("close_behavior", "prompt")
    if behavior not in ("prompt", "tray", "exit"):
        return "prompt"
    return behavior


def desktop_remember_close_choice():
    return desktop_settings().get("remember_close_choice", False) is not False


def _prompt_close_choice():
    """弹出选择提示：最小化到托盘 / 直接退出，附带“记住本次选择”勾选框。
    返回 (choice, remember)；choice 为 'tray' 或 'exit'，remember 为是否勾选记住。
    """
    try:
        import ctypes
        from ctypes import POINTER, Structure, c_int, c_longlong, c_wchar_p
        import ctypes.wintypes as wt

        ID_TRAY = 1001
        ID_EXIT = 1002

        class TASKDIALOG_BUTTON(Structure):
            _fields_ = [("nButtonID", c_int), ("pszButtonText", c_wchar_p)]

        class TASKDIALOGCONFIG(Structure):
            _fields_ = [
                ("cbSize", c_int),
                ("hwndParent", wt.HWND),
                ("hInstance", wt.HINSTANCE),
                ("dwFlags", c_int),
                ("dwCommonButtons", c_int),
                ("pszWindowTitle", c_wchar_p),
                ("hMainIcon", c_longlong),
                ("pszMainInstruction", c_wchar_p),
                ("pszContent", c_wchar_p),
                ("cButtons", c_int),
                ("pButtons", POINTER(TASKDIALOG_BUTTON)),
                ("nDefaultButton", c_int),
                ("cRadioButtons", c_int),
                ("pRadioButtons", POINTER(TASKDIALOG_BUTTON)),
                ("nDefaultRadioButton", c_int),
                ("pszVerificationText", c_wchar_p),
                ("pszExpandedInformation", c_wchar_p),
                ("pszExpandedControlText", c_wchar_p),
                ("pszCollapsedControlText", c_wchar_p),
                ("hFooterIcon", c_longlong),
                ("pszFooter", c_wchar_p),
                ("pfCallback", c_longlong),
                ("lpCallbackData", c_longlong),
                ("cxWidth", c_int),
            ]

        buttons = (TASKDIALOG_BUTTON * 2)(
            TASKDIALOG_BUTTON(ID_TRAY, "最小化到系统托盘后台运行"),
            TASKDIALOG_BUTTON(ID_EXIT, "直接退出软件"),
        )
        config = TASKDIALOGCONFIG()
        config.cbSize = ctypes.sizeof(TASKDIALOGCONFIG)
        config.pszWindowTitle = APP_NAME
        config.pszMainInstruction = "关闭软件后希望如何操作？"
        config.pszContent = (
            "· 最小化到系统托盘后台运行：主窗口隐藏，软件在右下角通知区域常驻，"
            "双击托盘图标可重新打开窗口。\n"
            "· 直接退出软件：完全关闭后台服务与进程。"
        )
        config.pszVerificationText = "记住本次选择，后续不再弹窗提醒"
        config.cButtons = 2
        config.pButtons = buttons
        config.nDefaultButton = ID_TRAY

        pnButton = c_int(0)
        pnRadio = c_int(0)
        pfVerification = c_int(0)
        comctl = ctypes.windll.comctl32.TaskDialogIndirect
        comctl.restype = ctypes.c_long
        hr = comctl(
            ctypes.byref(config),
            ctypes.byref(pnButton),
            ctypes.byref(pnRadio),
            ctypes.byref(pfVerification),
        )
        if hr != 0:
            raise RuntimeError(f"TaskDialogIndirect hr=0x{hr & 0xFFFFFFFF:x}")
        remember = pfVerification.value != 0
        choice = "exit" if pnButton.value == ID_EXIT else "tray"
        return choice, remember
    except Exception as error:
        with desktop_log_path().open("a", encoding="utf-8") as output:
            output.write(f"Close-prompt dialog failed, defaulting to tray: {error}\n")
        return "tray", False


def allow_window_close():
    """标题栏关闭按钮 → 依据配置：弹窗选择 / 最小化托盘 / 直接退出。"""
    if _EXIT_REQUESTED or _WINDOW is None:
        return True
    behavior = desktop_close_behavior()
    if behavior == "exit":
        request_exit(_WINDOW)
        return True
    if behavior == "tray":
        minimize_to_tray(_WINDOW)
        return False
    # prompt：弹出选择提示（带“记住选择”），首次无记忆时始终弹窗。
    choice, remember = _prompt_close_choice()
    if remember:
        try:
            settings = desktop_settings()
            settings["close_behavior"] = choice
            settings["remember_close_choice"] = True
            desktop_settings_path().parent.mkdir(parents=True, exist_ok=True)
            desktop_settings_path().write_text(json.dumps(settings, ensure_ascii=False, indent=2), encoding="utf-8")
        except Exception as error:
            with desktop_log_path().open("a", encoding="utf-8") as output:
                output.write(f"Persist close choice failed: {error}\n")
    if choice == "exit":
        request_exit(_WINDOW)
        return True
    minimize_to_tray(_WINDOW)
    return False

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
        # 已有实例在运行：若服务尚未就绪则稍等，随后直接打开管理台，避免误报“已在启动”。
        for _ in range(40):
            if healthy():
                webbrowser.open(f"http://127.0.0.1:{PORT}/admin")
                return
            time.sleep(0.75)
        show_info("上架工具已在启动中，请稍候再试")
        return
    # 兜底：无论主流程走哪条路径退出（含异常），都确保后台服务被清理。
    atexit.register(stop_service)
    # 清掉上次会话残留的服务进程，避免其占用端口/静态资源导致二次启动报错。
    clean_stale_services()
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
        # 窗口/任务栏图标跟随 EXE 图标（由 PyInstaller spec 的 static/ShangjiaTool.ico 指定），
        # pywebview 的 create_window 不支持 icon 参数，不要传入。
        window = webview.create_window(
            APP_NAME,
            f"http://127.0.0.1:{PORT}/admin",
            width=1440,
            height=900,
            js_api=_DesktopApi(),
        )
        window.events.closing += allow_window_close
        # 最小化按钮 → 普通任务栏最小化（不进入托盘）。仅标题栏 X 进入托盘后台。
        global _WINDOW
        _WINDOW = window
        # private_mode=False + storage_path：把 localStorage 持久化到磁盘，
        # 使“记住我/自动登录”的 token 与界面偏好（主题、折叠状态等）跨重启保留。
        webview.start(
            private_mode=False,
            storage_path=str(DATA_ROOT / "webview"),
        )
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
    finally:
        # 兜底：无论 main() 以何种路径退出，都确保后台服务被彻底清掉，避免残留
        # ShangjiaService.exe / 占用 8090 端口。os._exit 只用于托盘“退出”的硬退出链路。
        try:
            stop_service()
        except Exception:
            pass
        # 再次确认没有残留服务进程；若有则用 taskkill 补杀，并等其真正退出。
        try:
            _taskkill_all_services()
            time.sleep(0.5)
        except Exception:
            pass
        if _EXIT_REQUESTED:
            os._exit(0)
