"""闲鱼 mtop 签名请求服务的公共基类。

被 RateService 和 RedFlowerService 继承，提供：
- Cookie 解析 / 序列化；
- mtop 请求签名生成；
- 响应 ret 文本解析与令牌/Session 过期判定；
- 响应 Set-Cookie 提取、合并、持久化。

子类通过类属性 `_api_label` 区分接口名称（用于日志），
通过实例属性 `cookie_string` / `account_id` / `cookies_dict` 维护状态。
"""

from __future__ import annotations

import hashlib
from typing import Any, Dict, Tuple

import aiohttp
from loguru import logger
from utils.taobao_keys import get_h5_app_key


APP_KEY = get_h5_app_key()


class _MtopSignedService:
    """闲鱼 mtop 签名请求服务基类。"""

    _api_label = ""

    def __init__(self, cookie_string: str, account_id: str | None = None):
        self.cookie_string = str(cookie_string or "").strip()
        self.account_id = account_id
        self.cookies_dict = self._parse_cookies(self.cookie_string)

    @staticmethod
    def _parse_cookies(cookies_str: str) -> Dict[str, str]:
        cookies: Dict[str, str] = {}
        for part in str(cookies_str or "").replace("\ufeff", "").split(";"):
            part = part.strip()
            if not part or "=" not in part:
                continue
            key, value = part.split("=", 1)
            key = key.strip()
            if key:
                cookies[key] = value.strip()
        return cookies

    @staticmethod
    def _cookie_dict_to_string(cookies: Dict[str, str]) -> str:
        return "; ".join(f"{key}={value}" for key, value in cookies.items())

    @staticmethod
    def _generate_sign(t: str, token: str, data: str) -> str:
        msg = f"{token}&{t}&{APP_KEY}&{data}"
        md5_hash = hashlib.md5()
        md5_hash.update(msg.encode("utf-8"))
        return md5_hash.hexdigest()

    @staticmethod
    def _ret_to_text(ret: Any) -> str:
        if isinstance(ret, list):
            return "; ".join(str(item) for item in ret)
        return str(ret or "")

    @classmethod
    def _is_token_expired(cls, ret: Any) -> bool:
        ret_text = cls._ret_to_text(ret)
        return "FAIL_SYS_TOKEN_EXOIRED" in ret_text or "令牌过期" in ret_text

    @classmethod
    def _is_session_expired(cls, ret: Any) -> bool:
        ret_text = cls._ret_to_text(ret)
        return "FAIL_SYS_SESSION_EXPIRED" in ret_text or "Session过期" in ret_text

    def _extract_set_cookies(self, response: aiohttp.ClientResponse) -> Dict[str, str]:
        new_cookies: Dict[str, str] = {}
        try:
            for cookie_header in response.headers.getall("set-cookie", []):
                first_part = cookie_header.split(";", 1)[0]
                if "=" not in first_part:
                    continue
                name, value = first_part.split("=", 1)
                name = name.strip()
                if name:
                    new_cookies[name] = value.strip()
        except Exception as exc:
            logger.warning(f"提取{self._api_label}接口 Set-Cookie 失败: {exc}")
        return new_cookies

    def _merge_response_cookies(self, response: aiohttp.ClientResponse) -> Tuple[bool, str]:
        new_cookies = self._extract_set_cookies(response)
        if not new_cookies:
            return False, self.cookie_string
        merged = dict(self.cookies_dict)
        merged.update(new_cookies)
        merged_string = self._cookie_dict_to_string(merged)
        logger.info(
            f"【{self.account_id or '未知账号'}】{self._api_label}接口返回新 Cookie，已合并 {len(new_cookies)} 个字段"
        )
        return True, merged_string

    async def _persist_cookie_if_needed(self, new_cookie_string: str) -> None:
        if not self.account_id or not new_cookie_string or new_cookie_string == self.cookie_string:
            return
        try:
            from db_manager import db_manager

            db_manager.save_cookie(self.account_id, new_cookie_string)
            logger.info(f"【{self.account_id}】{self._api_label}接口刷新后的 Cookie 已保存到数据库")
        except Exception as exc:
            logger.warning(f"【{self.account_id}】保存{self._api_label}接口刷新 Cookie 失败: {exc}")
