"""上架工具桌面启动器：启动本地服务并打开管理台。"""
import os
import subprocess
import sys
import time
import urllib.request
import webbrowser
from pathlib import Path

APP_NAME = "上架工具"
ROOT = Path(__file__).resolve().parent
PORT = int(os.environ.get("SHANGJIA_PORT", "8090"))
DATA_ROOT = Path(os.environ.get("SHANGJIA_DATA_DIR", Path(os.environ.get("LOCALAPPDATA", ROOT)) / "ShangjiaTool"))

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
