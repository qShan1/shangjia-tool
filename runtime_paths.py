"""运行期目录解析。

桌面版通过 APP_DATA_DIR 指向用户数据目录；源码运行时仍兼容项目内的旧目录。
"""
import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent
DATA_ROOT = Path(os.environ.get("APP_DATA_DIR", PROJECT_ROOT)).expanduser().resolve()

def runtime_dir(name: str) -> Path:
    path = DATA_ROOT / name
    path.mkdir(parents=True, exist_ok=True)
    return path

def runtime_file(*parts: str) -> str:
    path = DATA_ROOT.joinpath(*parts)
    path.parent.mkdir(parents=True, exist_ok=True)
    return str(path)
