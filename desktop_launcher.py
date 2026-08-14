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
import re
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
_DIALOG_EVENT = None
_DIALOG_RESULT = None
# 关闭流程防重入锁：pywebview 的 closing 事件在主线程同步回调，连续点标题栏 X
# 会重复触发 allow_window_close；配合弹窗按钮的异步动作线程，可能在窗口 hide/destroy
# 时产生竞态导致整个界面卡死。用该标志保证同一时间只有一个关闭动作在执行。
_CLOSE_LOCK = threading.Lock()
_CLOSE_ACTIVE = False
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

    def resolve_desktop_dialog(self, result):
        """接收网页弹窗的选择，供关闭/更新后台线程继续执行。

        result 为网页端传回的 JSON 字符串：关闭弹窗传 {"value": "tray"/"exit", "remember": bool}，
        更新/通知弹窗仅传字符串。remember=True 时持久化关闭行为（下次不再弹窗）。

        pywebview 的 JS bridge 回调运行在内部线程，直接在此调用 window.destroy()/
        request_exit() 会在窗口销毁流程中死锁，导致界面无响应且后续 stop_service()
        不执行、服务残留。因此把"托盘/退出"动作放到独立线程异步执行。
        """
        global _DIALOG_RESULT, _DIALOG_EVENT
        payload = str(result or "")
        choice = payload
        remember = False
        try:
            parsed = json.loads(payload)
            if isinstance(parsed, dict):
                choice = str(parsed.get("value") or "")
                remember = bool(parsed.get("remember"))
        except (ValueError, TypeError):
            pass
        _DIALOG_RESULT = choice

        if remember and choice in ("tray", "exit"):
            try:
                settings = desktop_settings()
                settings["close_behavior"] = choice
                settings["remember_close_choice"] = True
                desktop_settings_path().parent.mkdir(parents=True, exist_ok=True)
                desktop_settings_path().write_text(json.dumps(settings, ensure_ascii=False, indent=2), encoding="utf-8")
            except Exception as error:
                with desktop_log_path().open("a", encoding="utf-8") as output:
                    output.write(f"save close choice failed: {error}\n")

        if _DIALOG_EVENT is not None:
            _DIALOG_EVENT.set()
        elif _WINDOW is not None:
            def _act():
                try:
                    if choice == "tray":
                        minimize_to_tray(_WINDOW)
                    elif choice == "exit":
                        request_exit(_WINDOW)
                    elif choice == "cancel":
                        # 用户点了弹窗右上角 ✕ 或背景：仅关闭弹窗，不执行任何关闭动作。
                        pass
                except Exception as error:
                    with desktop_log_path().open("a", encoding="utf-8") as output:
                        output.write(f"resolve_desktop_dialog action failed: {error}\n")
                finally:
                    # 动作结束后释放关闭防重入锁，确保后续再次点关闭仍可正常弹窗。
                    global _CLOSE_ACTIVE
                    _CLOSE_ACTIVE = False

            threading.Thread(target=_act, name="shangjia-dialog-action", daemon=True).start()
        else:
            global _CLOSE_ACTIVE
            _CLOSE_ACTIVE = False
        return {"success": True}


def _version_key(value):
    # 防御性解析：去掉 BOM、前导空白、v/V 前缀，以及任何非数字/点字符，
    # 避免 version.txt 意外带 BOM/空白导致解析失败误判"有更新"而反复下载。
    s = str(value).strip().lstrip("\ufeff").lstrip("vV")
    parts = []
    for part in s.split("."):
        digits = "".join(ch for ch in part if ch.isdigit())
        if digits:
            parts.append(int(digits))
    return tuple(parts)


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
    # 远程可控文件名：只允许 [A-Za-z0-9._-]，拦截 / \ 与 . .. 等路径成分，防路径穿越。
    name = str(update.get("name") or "").strip()
    if not name or re.fullmatch(r"[A-Za-z0-9._-]+", name) is None or name in (".", ".."):
        raise RuntimeError(f"Invalid update archive name: {name!r}")
    archive = staging / name
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
        "} finally {\n"
        "  if (Test-Path $incoming) { Remove-Item -LiteralPath $incoming -Recurse -Force -ErrorAction SilentlyContinue }\n"
        "  $stagingDir = Split-Path -Parent $Archive\n"
        "  if (Test-Path $stagingDir) { Get-ChildItem -LiteralPath $stagingDir -Filter '*.zip' -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue }\n"
        "}\n",
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


def _stop_service_and_exit():
    """停服务并等端口释放后退出进程。

    更新安装脚本通过 Wait-Process 等待本进程退出后才替换安装目录，
    下载完成后必须先清掉服务子进程（否则 Move-Item 会因 exe 被占用而失败），再 os._exit。
    stop_service 内部已处理终止进程树并等待端口真正释放。
    """
    try:
        stop_service()
    except Exception:
        pass
    try:
        os._exit(0)
    except Exception:
        pass


def _auto_check_updates_background():
    """后台检测更新；有更新再提示并安装，全程不阻塞桌面窗口打开。"""
    try:
        update = release_update()
        if not update:
            return
        if update.get("force"):
            # 强制更新：不询问，直接下载安装并重启，避免旧版本继续运行造成数据/接口不兼容。
            # 安装脚本会 Wait-Process 等待本进程退出后替换 exe，因此下载完成后必须退出进程。
            notice = f"检测到新版本 {update['tag']}，正在自动更新...\n\n更新将安装到当前目录并自动重启，现有数据不会丢失。"
            if not _show_web_notice("软件更新", notice):
                show_info(notice)
            try:
                schedule_desktop_update(update)
            except Exception as error:
                show_error(f"更新下载失败：{error}\n当前版本将继续运行。")
                return
            _stop_service_and_exit()
            return
        if not show_question(f"检测到新版本 {update['tag']}。\n\n是否立即下载并自动重启更新？现有数据不会丢失。"):
            return
        try:
            schedule_desktop_update(update)
        except Exception as error:
            show_error(f"更新下载失败：{error}\n当前版本将继续运行。")
            return
        _stop_service_and_exit()
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

    强制更新(force)与非强制更新都在后台线程完成，不阻塞窗口打开。
    force 更新在下载安装后由后台线程 os._exit 退出进程，安装脚本随即替换并重启。
    返回 True 表示正在更新/已进入更新流程，调用方(main)应直接返回（当前恒为 False，
    仅保留返回值契约以兼容历史调用）。
    """
    if not getattr(sys, "frozen", False):
        return False
    manually_requested = desktop_update_requested()
    if not desktop_auto_update_enabled() and not manually_requested:
        return False
    if manually_requested:
        threading.Thread(target=_manual_install_background, name="shangjia-startup-update", daemon=True).start()
    else:
        threading.Thread(target=_auto_check_updates_background, name="shangjia-startup-update", daemon=True).start()
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
            message = (
                f"发现新版本 {update['tag']}。\n\n"
                "立即下载并安装到当前目录？安装完成后会自动重启，现有数据不会丢失。"
            )
            decision = _ask_web_question(message)
            if decision is None:
                decision = show_question(message)
            if not decision:
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
            # pystray 回调线程不能直接销毁窗口/停服务（会阻塞），放独立线程执行
            def _exit_thread():
                try:
                    request_exit(window)
                except Exception:
                    pass
            threading.Thread(target=_exit_thread, name="shangjia-tray-exit", daemon=True).start()

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


def _desktop_dialog_script(title, message, buttons, remember_label=None, dismissable=True):
    payload = json.dumps({"title": title, "message": message, "buttons": buttons}, ensure_ascii=False)
    remember = json.dumps(remember_label, ensure_ascii=False)
    return f"""(() => {{
        const data = {payload};
        document.getElementById('__desktopDialog')?.remove();
        const root = document.createElement('div');
        root.id = '__desktopDialog';
        root.innerHTML = `<div class=\"desktop-dialog-backdrop\"><div class=\"desktop-dialog-card\" role=\"dialog\" aria-modal=\"true\"><button type=\"button\" class=\"desktop-dialog-close\" aria-label=\"关闭\" data-dismiss>✕</button><div class=\"desktop-dialog-head\"><div class=\"desktop-dialog-mark\">上架</div><h3 class=\"desktop-dialog-title\"></h3></div><p></p><div class=\"desktop-dialog-actions\"></div></div></div>`;
        const card = root.querySelector('.desktop-dialog-card');
        card.querySelector('.desktop-dialog-title').textContent = data.title;
        card.querySelector('.desktop-dialog-card p').textContent = data.message;
        const actions = card.querySelector('.desktop-dialog-actions');
        const rememberEl = {remember};
        let rememberChecked = false;
        const close = (value) => {{
            const send = rememberEl ? JSON.stringify({{value, remember: rememberChecked}}) : value;
            window.pywebview?.api?.resolve_desktop_dialog(send);
            root.remove();
        }};
        const dismissEl = {str(dismissable).lower()};
        card.querySelector('[data-dismiss]')?.addEventListener('click', () => {{
            if (dismissEl) close('cancel');
        }});
        if (dismissEl) {{
            root.querySelector('.desktop-dialog-backdrop').addEventListener('click', (ev) => {{
                if (ev.target === ev.currentTarget) close('cancel');
            }});
        }}
        data.buttons.forEach(item => {{
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = item.label;
            button.className = item.primary ? 'desktop-dialog-primary' : 'desktop-dialog-secondary';
            button.onclick = () => close(item.value);
            actions.appendChild(button);
        }});
        if (rememberEl) {{
            const row = document.createElement('label');
            row.className = 'desktop-dialog-remember';
            const box = document.createElement('input');
            box.type = 'checkbox';
            box.checked = false;
            box.onchange = () => {{ rememberChecked = box.checked; }};
            row.appendChild(box);
            row.appendChild(document.createTextNode(rememberEl));
            actions.insertBefore(row, actions.firstChild);
        }}
        document.body.appendChild(root);
        card.querySelector('button:not(.desktop-dialog-close)')?.focus();
    }})()"""


def _show_web_close_prompt(window):
    if window is None:
        return False
    try:
        window.run_js(_desktop_dialog_script(
            "关闭上架工具",
            "请选择关闭后的操作。最小化会继续在右下角托盘运行，退出会完全停止本地服务。",
            [
                {"value": "tray", "label": "最小化到托盘", "primary": True},
                {"value": "exit", "label": "退出软件", "primary": False},
            ],
            remember_label="记住我的选择，下次不再询问",
        ))
        return True
    except Exception as error:
        with desktop_log_path().open("a", encoding="utf-8") as output:
            output.write(f"Web close dialog failed: {error}\n")
        return False


def _ask_web_question(message):
    global _DIALOG_EVENT, _DIALOG_RESULT
    if _WINDOW is None:
        return None
    event = threading.Event()
    _DIALOG_EVENT = event
    _DIALOG_RESULT = None
    try:
        _WINDOW.run_js(_desktop_dialog_script(
            "软件更新",
            message,
            [
                {"value": "yes", "label": "立即更新", "primary": True},
                {"value": "no", "label": "暂不更新", "primary": False},
            ],
        ))
        event.wait(120)
        return _DIALOG_RESULT == "yes"
    except Exception:
        return None
    finally:
        _DIALOG_EVENT = None


def _show_web_notice(title, message):
    global _DIALOG_EVENT, _DIALOG_RESULT
    if _WINDOW is None:
        return False
    event = threading.Event()
    _DIALOG_EVENT = event
    _DIALOG_RESULT = None
    try:
        _WINDOW.run_js(_desktop_dialog_script(
            title,
            message,
            [{"value": "ok", "label": "知道了", "primary": True}],
        ))
        event.wait(60)
        return True
    except Exception:
        return False
    finally:
        _DIALOG_EVENT = None


def _prompt_close_choice():
    """弹出选择提示：最小化到托盘 / 直接退出。
    返回 (choice, remember)；choice 为 'tray' 或 'exit'，remember 恒为 False。
    使用 MessageBoxW 而非 TaskDialogIndirect——后者在 ctypes 结构体布局错误时会返回
    0x80070057 静默失败，导致关闭直接回退到托盘而不弹窗。
    """
    try:
        import ctypes
        # MB_YESNO：是 → 最小化托盘；否 → 直接退出
        wants_tray = ctypes.windll.user32.MessageBoxW(
            None,
            "关闭软件后希望如何操作？\n\n"
            "[是] 最小化到系统托盘后台运行（主窗口隐藏，右下角常驻，双击图标恢复）\n"
            "[否] 直接退出软件（完全关闭后台服务与进程）",
            APP_NAME,
            0x24,
        ) == 6
        return ("tray" if wants_tray else "exit"), False
    except Exception as error:
        with desktop_log_path().open("a", encoding="utf-8") as output:
            output.write(f"Close-prompt dialog failed, defaulting to tray: {error}\n")
        return "tray", False


def allow_window_close():
    """标题栏关闭按钮 → 依据配置：弹窗选择 / 最小化托盘 / 直接退出。"""
    global _CLOSE_ACTIVE
    if _EXIT_REQUESTED or _WINDOW is None:
        return True
    behavior = desktop_close_behavior()
    if behavior == "exit":
        request_exit(_WINDOW)
        return True
    if behavior == "tray":
        minimize_to_tray(_WINDOW)
        return False
    # 防重入：closing 事件可能被连续触发，避免重复弹窗/并发操作窗口导致卡死。
    with _CLOSE_LOCK:
        if _CLOSE_ACTIVE:
            return False
        _CLOSE_ACTIVE = True
    try:
        # prompt：使用当前页面的玻璃弹窗，避免原生 MessageBox 与应用视觉割裂。
        if _show_web_close_prompt(_WINDOW):
            return False
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
    finally:
        _CLOSE_ACTIVE = False

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
            if response.status != 200:
                return False
            payload = json.loads(response.read().decode("utf-8"))
            return payload.get("status") == "healthy"
    except Exception:
        return False


def service_ready():
    """确认健康接口和管理台页面都由当前服务正常提供，避免首屏短暂 403。"""
    if not healthy():
        return False
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/admin", timeout=2) as response:
            return response.status == 200
    except Exception:
        return False


def loading_page() -> str:
    """返回内联加载页 HTML，在服务就绪前显示，避免开屏白等。

    配色与设计对齐主应用（亮色玻璃风格，青色 primary）：
    - 浅灰 canvas 背景 + 玻璃质感卡片
    - 内联复刻 shangjia-mark.svg 的 logo（加载页是 NavigateToString 纯 HTML，
      不能引用外部图片——pywebview 会把 data: URL 当本地路径交给内置 HTTP server
      serve 导致 404，因此 logo/样式全部内联）
    - 青色进度条动画，与主应用 app-splash 一致

    直接返回纯 HTML 字符串（create_window 的 html= 参数走 NavigateToString），
    不要拼成 data: URL。
    """
    mark = (
        "<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240' viewBox='0 0 240 240' fill='none'>"
        "<path d='M52 68H146L217 139L139 217L52 130V68Z' stroke='#0a7c66' stroke-width='17' stroke-linejoin='round'/>"
        "<circle cx='92' cy='103' r='12' fill='#0a7c66'/>"
        "<path d='M120 132H179M120 164H161' stroke='#0a7c66' stroke-width='15' stroke-linecap='round'/>"
        "</svg>"
    )
    return (
        "<!doctype html><html><head><meta charset='utf-8'>"
        "<style>"
        "html,body{height:100%;margin:0;display:flex;align-items:center;justify-content:center;"
        "background:#e9edef;color:#1d1d1f;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',sans-serif;}"
        "body{background-image:linear-gradient(135deg,rgba(71,85,105,.06),transparent 42%),"
        "linear-gradient(315deg,rgba(148,163,184,.06),transparent 48%);}"
        ".box{text-align:center;animation:in 300ms cubic-bezier(.22,1,.36,1) both;}"
        "@keyframes in{from{opacity:0;transform:translateY(10px) scale(.98)}to{opacity:1;transform:translateY(0) scale(1)}}"
        ".logo{width:76px;height:76px;margin:0 auto 18px;border-radius:22px;display:flex;align-items:center;justify-content:center;"
        "background:rgba(255,255,255,.85);border:1px solid rgba(255,255,255,1);"
        "box-shadow:0 14px 34px rgba(25,39,52,.18),inset 0 1px rgba(255,255,255,.95);"
        "backdrop-filter:blur(24px) saturate(1.5);-webkit-backdrop-filter:blur(24px) saturate(1.5);}"
        ".logo svg{width:46px;height:46px}"
        ".title{font-size:20px;font-weight:700;letter-spacing:.02em;color:#1d1d1f}"
        ".sub{margin-top:4px;font-size:10px;font-weight:600;letter-spacing:.22em;color:#6e6e73}"
        ".bar{width:164px;height:4px;margin:22px auto 0;border-radius:999px;background:rgba(118,118,128,.18);overflow:hidden}"
        ".bar span{display:block;width:40%;height:100%;border-radius:999px;"
        "background:linear-gradient(90deg,#0a7c66,#5ecbb0);animation:slide 1.1s cubic-bezier(.22,1,.36,1) infinite}"
        "@keyframes slide{0%{transform:translateX(-120%)}60%{transform:translateX(220%)}100%{transform:translateX(220%)}}"
        ".tip{margin-top:20px;font-size:13px;color:#6e6e73}"
        "</style></head><body><div class='box'>"
        f"<div class='logo'>{mark}</div>"
        "<div class='title'>上架工具</div><div class='sub'>SHANGJIA TOOL</div>"
        "<div class='bar'><span></span></div>"
        "<div class='tip'>正在启动本地服务，请稍候...</div>"
        "</div></body></html>"
    )

def main():
    global _SERVICE_PROCESS
    DATA_ROOT.mkdir(parents=True, exist_ok=True)
    if offer_desktop_update():
        return
    if not acquire_single_instance():
        # 已有实例在运行：若服务尚未就绪则稍等，随后直接打开管理台，避免误报“已在启动”。
        for _ in range(40):
            if service_ready():
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
    # pywebview 是可选依赖；没有时仍保持一键启动体验。
    try:
        import webview
        # 窗口/任务栏图标跟随 EXE 图标（由 PyInstaller spec 的 static/ShangjiaTool.ico 指定），
        # pywebview 的 create_window 不支持 icon 参数，不要传入。
        # 先加载内联加载页让窗口立即出现，服务就绪后由后台线程切换到管理台，避免开屏白等。
        window = webview.create_window(
            APP_NAME,
            None,
            html=loading_page(),
            width=1440,
            height=900,
            js_api=_DesktopApi(),
        )
        window.events.closing += allow_window_close
        # 最小化按钮 → 普通任务栏最小化（不进入托盘）。仅标题栏 X 进入托盘后台。
        global _WINDOW
        _WINDOW = window

        def _wait_service_and_load():
            for _ in range(40):
                if service_ready():
                    try:
                        window.load_url(f"http://127.0.0.1:{PORT}/admin")
                    except Exception as error:
                        with desktop_log_path().open("a", encoding="utf-8") as output:
                            output.write(f"Load admin failed: {error}\n")
                    return
                time.sleep(0.75)
            try:
                import ctypes
                ctypes.windll.user32.MessageBoxW(
                    None, "本地服务未能在 30 秒内启动，请查看日志后重试。", APP_NAME, 0x10)
            except Exception:
                pass

        threading.Thread(target=_wait_service_and_load, name="shangjia-wait-service", daemon=True).start()

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
