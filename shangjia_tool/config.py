import os
import sys
import time
import yaml
from pathlib import Path
from typing import Dict, Any

class Config:
    """配置管理类
    
    用于加载和管理全局配置文件(global_config.yml)。
    支持配置的读取、修改和保存。
    """
    
    _instance = None
    _config = {}

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(Config, cls).__new__(cls)
            cls._instance._load_config()
        return cls._instance

    def _load_config(self):
        """加载配置文件
        
        从global_config.yml文件中加载配置信息。
        兼容 PyInstaller 打包：优先读 _MEIPASS 内的打包副本，
        其次读用户可写的持久化副本；仍不存在则抛出FileNotFoundError。
        """
        config_path = self._find_config_path()
        with open(config_path, 'r', encoding='utf-8') as f:
            self._config = yaml.safe_load(f) or {}

        # 有持久化目录时，把加载到的配置落一份副本，避免后续启动时
        # 因 onefile 临时解包目录被清理/复用而找不到配置文件而崩溃。
        self._mirror_to_persistent(config_path)

    def get(self, key: str, default: Any = None) -> Any:
        """获取配置项
        
        Args:
            key: 配置项的键，支持点号分隔的多级键
            default: 当配置项不存在时返回的默认值
            
        Returns:
            配置项的值或默认值
        """
        keys = key.split('.')
        value = self._config
        for k in keys:
            if isinstance(value, dict):
                value = value.get(k)
            else:
                return default
            if value is None:
                return default
        return value

    def set(self, key: str, value: Any) -> None:
        """设置配置项
        
        Args:
            key: 配置项的键，支持点号分隔的多级键
            value: 要设置的值
        """
        keys = key.split('.')
        config = self._config
        for k in keys[:-1]:
            if k not in config:
                config[k] = {}
            config = config[k]
        config[keys[-1]] = value

    def save(self) -> None:
        """保存配置到文件

        写回到用户可写的持久化配置目录，避免 onefile 临时目录丢失导致配置无法持久化。
        """
        self._write(_persistent_config_path(), self._config)

    @staticmethod
    def _runtime_base() -> Path:
        if getattr(sys, 'frozen', False):
            return Path(sys._MEIPASS)
        return Path(__file__).resolve().parent.parent

    @staticmethod
    def _persistent_config_path() -> Path:
        base = os.environ.get('SHANGJIA_CONFIG_DIR') or os.environ.get('APP_DATA_DIR')
        if base:
            return Path(base) / 'global_config.yml'
        local = os.environ.get('LOCALAPPDATA') or str(Path.home())
        return Path(local) / 'ShangjiaTool' / 'global_config.yml'

    @classmethod
    def _write(cls, path: Path, payload: Dict[str, Any]) -> None:
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            with open(path, 'w', encoding='utf-8') as f:
                yaml.safe_dump(payload, f, allow_unicode=True, default_flow_style=False)
        except OSError:
            pass


    def _find_config_path(self) -> Path:
        bundled = self._runtime_base() / 'global_config.yml'
        persistent = self._persistent_config_path()

        # onefile 解包存在瞬时竞态：临时目录可能正被上一实例清理/复用，
        # 短暂重试可避免误判。
        for _ in range(5):
            if bundled.exists():
                return bundled
            if persistent.exists():
                return persistent
            time.sleep(0.5)

        # 兜底：若打包副本恢复可用则用之
        if bundled.exists():
            return bundled

        raise FileNotFoundError(
            "配置文件不存在: " + "; ".join(str(p) for p in (bundled, persistent))
        )

    def _mirror_to_persistent(self, loaded_path: Path) -> None:
        if not self._config:
            return
        persistent = self._persistent_config_path()
        if loaded_path != persistent:
            try:
                persistent.parent.mkdir(parents=True, exist_ok=True)
                if not persistent.exists():
                    self._write(persistent, self._config)
            except OSError:
                pass

    @property
    def config(self) -> Dict[str, Any]:
        """获取完整配置
        
        Returns:
            包含所有配置项的字典
        """
        return self._config

# 创建全局配置实例
config = Config()

# 导出常用配置项
COOKIES_STR = config.get('COOKIES.value', '')
COOKIES_LAST_UPDATE = config.get('COOKIES.last_update_time', '')
WEBSOCKET_URL = config.get('WEBSOCKET_URL', 'wss://wss-goofish.dingtalk.com/')
HEARTBEAT_INTERVAL = config.get('HEARTBEAT_INTERVAL', 15)
HEARTBEAT_TIMEOUT = config.get('HEARTBEAT_TIMEOUT', 30)
TOKEN_REFRESH_INTERVAL = config.get('TOKEN_REFRESH_INTERVAL', 72000)
TOKEN_RETRY_INTERVAL = config.get('TOKEN_RETRY_INTERVAL', 7200)
SESSION_KEEPALIVE_INTERVAL = config.get('SESSION_KEEPALIVE_INTERVAL', 600)
SESSION_KEEPALIVE_RETRY_INTERVAL = config.get('SESSION_KEEPALIVE_RETRY_INTERVAL', 180)
MESSAGE_EXPIRE_TIME = config.get('MESSAGE_EXPIRE_TIME', 300000)
SLIDER_VERIFICATION = config.get('SLIDER_VERIFICATION', {
    'max_concurrent': 3,
    'wait_timeout': 60
})
API_ENDPOINTS = config.get('API_ENDPOINTS', {})
DEFAULT_HEADERS = config.get('DEFAULT_HEADERS', {})
WEBSOCKET_HEADERS = config.get('WEBSOCKET_HEADERS', {})
APP_CONFIG = config.get('APP_CONFIG', {})
# app_key 支持环境变量覆盖（TAOBAO_APP_KEY），优先级高于 global_config.yml
_env_app_key = os.environ.get("TAOBAO_APP_KEY", "").strip()
if _env_app_key:
    APP_CONFIG["app_key"] = _env_app_key
AUTO_REPLY = config.get('AUTO_REPLY', {
    'enabled': True,
    'default_message': '亲爱的"{send_user_name}" 老板你好！所有宝贝都可以拍，秒发货的哈~不满意的话可以直接申请退款哈~',
    'api': {
        'enabled': False,
        'url': 'http://localhost:8890/xianyu/reply',
        'timeout': 10
    }
})
MANUAL_MODE = config.get('MANUAL_MODE', {})
LOG_CONFIG = config.get('LOG_CONFIG', {})
YIFAN_API = config.get('YIFAN_API', {
    'callback_url': '',  # 默认空，需用户在配置文件中指定自己的回调地址
    'query_url': ''      # 默认空，需用户在配置文件中指定自己的查询地址
})
RISK_CONTROL = config.get('RISK_CONTROL', {
    'night_mode_enabled': False,
    'night_start_hour': 1,
    'night_end_hour': 6,
    # 扫码后的短暂 Cookie 稳定化窗口。扫码成功后立即进入可观测的认证探测，
    # 不再让账号静默等待 15 分钟；命中风控时仍由退避策略接管。
    'qr_login_grace_seconds': 30,
    'night_keepalive_multiplier': 3,
    'night_cookie_refresh_multiplier': 2,
    'backoff_escalation_factor': 1.5,
    'backoff_max_cap_seconds': 3600,
    'consecutive_failure_protection_threshold': 5,
    'post_slider_retry_delay_min': 5.0,
    'post_slider_retry_delay_max': 10.0,
    'token_refresh_dedup_window_seconds': 60,
    'token_retry_min_wait_seconds': 180,
    'max_post_slider_session_retries': 1,
    'soft_auth_token_preflight_enabled': True,
    'soft_auth_token_preflight_timeout_seconds': 5.0,
    'soft_auth_token_preflight_qr_enabled': False,
})
_cookies_raw = config.get('COOKIES', [])
if isinstance(_cookies_raw, list):
    COOKIES_LIST = _cookies_raw
else:
    # 兼容旧格式，仅有 value 字段
    val = _cookies_raw.get('value') if isinstance(_cookies_raw, dict) else None
    COOKIES_LIST = [{'id': 'default', 'value': val}] if val else []
