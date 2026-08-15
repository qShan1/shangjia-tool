"""闲鱼求小红花服务。

参考上游 red_flower_task 的核心请求逻辑，适配当前单体项目：
- 调用 mtop.taobao.idlemessage.red.flower；
- 令牌过期时合并响应 Set-Cookie、保存 Cookie 后重试一次；
- 返回统一结果供实时接口、手动接口和后台补偿任务复用。
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import time
from typing import Any, Dict, Tuple

import aiohttp
from loguru import logger
from utils._mtop_signed_service import _MtopSignedService
from utils.taobao_keys import get_h5_app_key


APP_KEY = get_h5_app_key()
RED_FLOWER_API_URL = "https://h5api.m.goofish.com/h5/mtop.taobao.idlemessage.red.flower/1.0/"
RED_FLOWER_API_NAME = "mtop.taobao.idlemessage.red.flower"


class RedFlowerService(_MtopSignedService):
    """闲鱼求小红花服务。"""

    _api_label = "求小红花"

    @classmethod
    def _is_already_requested(cls, ret: Any, result: Any) -> bool:
        text = cls._ret_to_text(ret) + " " + json.dumps(result, ensure_ascii=False, default=str)
        return any(keyword in text for keyword in (
            "已送出小红花", "已收下", "已求过", "已赠送", "已经送", "重复", "不能重复",
        ))

    async def request_red_flower(self, order_id: str, is_retry: bool = False) -> Dict[str, Any]:
        """对指定订单发送求小红花请求。"""
        order_id = str(order_id or "").strip()
        if not order_id:
            return {"success": False, "message": "缺少订单号"}
        if not self.cookie_string:
            return {"success": False, "message": "账号 Cookie 为空"}

        m_h5_tk = self.cookies_dict.get("_m_h5_tk", "")
        token = m_h5_tk.split("_", 1)[0] if m_h5_tk else ""
        if not token:
            return {"success": False, "message": "Cookie 中缺少 _m_h5_tk，无法生成求小红花签名"}

        timestamp = str(int(time.time() * 1000))
        data_obj = {
            "orderId": order_id,
            "channel": "list",
        }
        data_val = json.dumps(data_obj, separators=(",", ":"), ensure_ascii=False)
        sign = self._generate_sign(timestamp, token, data_val)

        params = {
            "jsv": "2.7.2",
            "appKey": APP_KEY,
            "t": timestamp,
            "sign": sign,
            "v": "4.0",
            "type": "originaljson",
            "accountSite": "xianyu",
            "dataType": "json",
            "timeout": "20000",
            "api": RED_FLOWER_API_NAME,
            "sessionOption": "AutoLoginOnly",
        }
        headers = {
            "accept": "application/json",
            "content-type": "application/x-www-form-urlencoded",
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "referer": "https://www.goofish.com/",
            "origin": "https://www.goofish.com",
            "cookie": self.cookie_string,
        }

        try:
            timeout = aiohttp.ClientTimeout(total=30)
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.post(RED_FLOWER_API_URL, params=params, headers=headers, data={"data": data_val}) as response:
                    try:
                        result = await response.json(content_type=None)
                    except Exception:
                        body = await response.text()
                        return {
                            "success": False,
                            "message": f"求小红花接口返回非 JSON: HTTP {response.status}",
                            "raw": body[:1000],
                        }

                    # 无论是否成功，先合并响应中的新 Cookie，供后续请求使用。
                    has_cookie_update, merged_cookie_string = self._merge_response_cookies(response)
                    if has_cookie_update:
                        await self._persist_cookie_if_needed(merged_cookie_string)
                        self.cookie_string = merged_cookie_string
                        self.cookies_dict = self._parse_cookies(merged_cookie_string)

                    ret = result.get("ret", []) if isinstance(result, dict) else []
                    ret_text = self._ret_to_text(ret) or str(result)
                    retry_tag = "[令牌过期重试] " if is_retry else ""

                    if ret_text == "SUCCESS::调用成功" or "SUCCESS" in ret_text:
                        logger.info(
                            f"【{self.account_id or '未知账号'}】{retry_tag}求小红花成功: order_id={order_id}"
                        )
                        return {"success": True, "message": "求小红花成功", "raw": result}

                    if self._is_already_requested(ret, result):
                        logger.info(
                            f"【{self.account_id or '未知账号'}】订单已求过小红花，按成功处理: order_id={order_id}, ret={ret}"
                        )
                        return {"success": True, "already_red_flower": True, "message": "订单已求过小红花", "raw": result}

                    if not is_retry and self._is_token_expired(ret):
                        if has_cookie_update:
                            return await self.request_red_flower(order_id, is_retry=True)
                        return {"success": False, "message": "令牌过期且响应未返回新 Cookie", "raw": result}

                    if self._is_session_expired(ret):
                        return {"success": False, "session_expired": True, "message": ret_text, "raw": result}

                    logger.warning(
                        f"【{self.account_id or '未知账号'}】{retry_tag}求小红花失败: order_id={order_id}, ret={ret}"
                    )
                    return {"success": False, "message": ret_text, "raw": result}
        except asyncio.TimeoutError:
            return {"success": False, "message": "求小红花接口请求超时"}
        except Exception as exc:
            logger.error(f"【{self.account_id or '未知账号'}】求小红花异常: order_id={order_id}, error={exc}")
            return {"success": False, "message": str(exc)}
