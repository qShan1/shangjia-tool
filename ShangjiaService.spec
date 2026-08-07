# -*- mode: python ; coding: utf-8 -*-
import os


def static_datas():
    """Package application assets but never a user's runtime uploads."""
    files = []
    for directory, subdirs, filenames in os.walk('static'):
        if os.path.basename(directory) == 'uploads':
            subdirs[:] = []
            continue
        destination = os.path.relpath(directory, '.')
        for filename in filenames:
            files.append((os.path.join(directory, filename), destination))
    return files

a = Analysis(
    ['Start.py'],
    pathex=[],
    binaries=[],
    datas=static_datas() + [
        ('global_config.yml', '.'),
    ],
    hiddenimports=[
        'reply_server',
        'cookie_manager',
        'db_manager',
        'config',
        'ai_reply_engine',
        'XianyuAutoAsync',
        'utils.qr_login',
        'utils.qr_login_lite',
        'utils.item_publisher',
        'utils.notification_dispatcher',
        'utils.order_history_sync',
        'utils.rate_service',
        'utils.red_flower_service',
        'utils.refresh_util',
        'utils.build_cookies',
        'utils.xianyu_utils',
        'utils.slider_orchestrator',
        'api_captcha_remote',
        'chat_event_hub',
        'item_polish_module',
        'auto_rate_task',
        'file_log_collector',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='ShangjiaService',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
