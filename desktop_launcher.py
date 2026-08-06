"""上架工具桌面启动器：启动本地服务并打开管理台。"""
import os
import subprocess
import sys
import time
import urllib.request
import webbrowser
import shutil
import atexit
from pathlib import Path

APP_NAME = "上架工具"
ROOT = Path(__file__).resolve().parent
PORT = int(os.environ.get("SHANGJIA_PORT", "8090"))
DATA_ROOT = Path(os.environ.get("SHANGJIA_DATA_DIR", Path(os.environ.get("LOCALAPPDATA", ROOT)) / "ShangjiaTool"))
_LOCK_HANDLE = None

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
    DATA_ROOT.mkdir(parents=True, exist_ok=True)
    if not acquire_single_instance():
        if healthy():
            webbrowser.open(f"http://127.0.0.1:{PORT}/admin")
            return
        raise RuntimeError("上架工具已在启动中，请稍候再试")
    migrate_runtime_data()
    env = os.environ.copy()
    env["APP_DATA_DIR"] = str(DATA_ROOT)
    env["DB_PATH"] = str(DATA_ROOT / "data" / "xianyu_data.db")
    if not healthy():
        if getattr(sys, "frozen", False):
            service = Path(getattr(sys, "_MEIPASS", ROOT)) / "ShangjiaService.exe"
            command = [str(service)]
        else:
            python = ROOT / "venv" / "Scripts" / "python.exe"
            if not python.exists():
                python = Path(sys.executable)
            command = [str(python), str(ROOT / "Start.py")]
        if not Path(command[0]).exists():
            raise RuntimeError("桌面服务组件缺失，请重新构建安装包")
        process = subprocess.Popen(command, cwd=str(ROOT), env=env,
                                   creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        for _ in range(40):
            if healthy():
                break
            time.sleep(0.75)
        else:
            process.terminate()
            raise RuntimeError("本地服务未能在 30 秒内启动，请检查用户数据目录中的 logs")
    # pywebview 是可选依赖；没有时仍保持一键启动体验。
    try:
        import webview
        webview.create_window(APP_NAME, f"http://127.0.0.1:{PORT}/admin", width=1440, height=900)
        webview.start()
    except ImportError:
        webbrowser.open(f"http://127.0.0.1:{PORT}/admin")

if __name__ == "__main__":
    main()
