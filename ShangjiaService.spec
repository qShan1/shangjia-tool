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
    pathex=['shangjia_tool'],
    binaries=[],
    datas=static_datas() + [
        ('global_config.yml', '.'),
        ('announcement.json', '.'),
    ],
    hiddenimports=[
        'shangjia_tool.reply_server',
        'shangjia_tool.cookie_manager',
        'shangjia_tool.db_manager',
        'shangjia_tool.config',
        'shangjia_tool.ai_reply_engine',
        'shangjia_tool.XianyuAutoAsync',
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
        'shangjia_tool.api_captcha_remote',
        'shangjia_tool.chat_event_hub',
        'shangjia_tool.item_polish_module',
        'shangjia_tool.auto_rate_task',
        'shangjia_tool.file_log_collector',
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
    icon=os.path.join(SPECPATH, 'static', 'ShangjiaTool.ico'),
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
