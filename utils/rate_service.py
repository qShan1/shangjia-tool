"""闲鱼买家评价服务。

本模块参考上游项目的 RateService，但适配当前单体项目结构：
- 直接调用闲鱼 mtop.taobao.idle.rate.create 接口；
- 不再依赖外部 auto_comment_api_url；
- 令牌过期时尝试合并响应 Set-Cookie 并更新本地 cookies 表后重试一次。
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
RATE_API_URL = "https://h5api.m.goofish.com/h5/mtop.taobao.idle.rate.create/4.0/"
RATE_API_NAME = "mtop.taobao.idle.rate.create"
MERCHANT_RATE_LIST_API_URL = "https://h5api.m.goofish.com/h5/mtop.taobao.idle.merchant.rate.list/1.0/"
MERCHANT_RATE_LIST_API_NAME = "mtop.taobao.idle.merchant.rate.list"


class RateService(_MtopSignedService):
    """闲鱼评价服务。"""

    _api_label = "评价"

    @classmethod
    def _is_already_rated(cls, ret: Any, result: Any) -> bool:
        text = cls._ret_to_text(ret) + " " + json.dumps(result, ensure_ascii=False, default=str)
        return any(keyword in text for keyword in ("已评价", "已经评价", "不能重复评价", "重复评价"))

    async def rate_buyer(self, trade_id: str, feedback: str = "不错的买家", is_retry: bool = False) -> Dict[str, Any]:
        """评价买家。

        Args:
            trade_id: 闲鱼订单号。
            feedback: 评价内容。
            is_retry: token 过期后内部重试标记。
        """
        trade_id = str(trade_id or "").strip()
        feedback = str(feedback or "").strip()
        if not trade_id:
            return {"success": False, "message": "缺少订单号"}
        if not feedback:
            return {"success": False, "message": "评价内容不能为空"}
        if not self.cookie_string:
            return {"success": False, "message": "账号 Cookie 为空"}

        m_h5_tk = self.cookies_dict.get("_m_h5_tk", "")
        token = m_h5_tk.split("_", 1)[0] if m_h5_tk else ""
        if not token:
            return {"success": False, "message": "Cookie 中缺少 _m_h5_tk，无法生成评价签名"}

        timestamp = str(int(time.time() * 1000))
        data_obj = {
            "tradeId": trade_id,
            "rate": 1,
            "feedback": feedback,
            "createOrAppend": 0,
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
            "api": RATE_API_NAME,
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
            timeout = aiohttp.ClientTimeout(total=20)
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.post(RATE_API_URL, params=params, headers=headers, data={"data": data_val}) as response:
                    try:
                        result = await response.json(content_type=None)
                    except Exception:
                        body = await response.text()
                        return {
                            "success": False,
                            "message": f"评价接口返回非 JSON: HTTP {response.status}",
                            "raw": body[:1000],
                        }

                    ret = result.get("ret", []) if isinstance(result, dict) else []
                    ret_text = self._ret_to_text(ret) or str(result)
                    retry_tag = "[令牌过期重试] " if is_retry else ""

                    if "SUCCESS" in ret_text:
                        logger.info(
                            f"【{self.account_id or '未知账号'}】{retry_tag}评价成功: trade_id={trade_id}"
                        )
                        return {"success": True, "message": "评价成功", "raw": result}

                    if self._is_already_rated(ret, result):
                        logger.info(
                            f"【{self.account_id or '未知账号'}】订单已评价，按成功处理: trade_id={trade_id}, ret={ret}"
                        )
                        return {"success": True, "already_rated": True, "message": "订单已评价", "raw": result}

                    if not is_retry and self._is_token_expired(ret):
                        has_new_cookie, new_cookie_string = self._merge_response_cookies(response)
                        if has_new_cookie:
                            await self._persist_cookie_if_needed(new_cookie_string)
                            self.cookie_string = new_cookie_string
                            self.cookies_dict = self._parse_cookies(new_cookie_string)
                            return await self.rate_buyer(trade_id, feedback, is_retry=True)
                        return {"success": False, "message": "令牌过期且响应未返回新 Cookie", "raw": result}

                    if self._is_session_expired(ret):
                        return {"success": False, "session_expired": True, "message": ret_text, "raw": result}

                    logger.warning(
                        f"【{self.account_id or '未知账号'}】{retry_tag}评价失败: trade_id={trade_id}, ret={ret}"
                    )
                    return {"success": False, "message": ret_text, "raw": result}
        except asyncio.TimeoutError:  # type: ignore[name-defined]
            return {"success": False, "message": "评价接口请求超时"}
        except Exception as exc:
            logger.error(f"【{self.account_id or '未知账号'}】评价异常: trade_id={trade_id}, error={exc}")
            return {"success": False, "message": str(exc)}


async def fetch_merchant_rate_list(
    cookie_string: str,
    account_id: str | None = None,
    page: int = 1,
    page_size: int = 20,
    max_retries: int = 3,
) -> Dict[str, Any]:
    """获取商家待评价订单列表。"""
    current_cookie = str(cookie_string or "").strip()
    if not current_cookie:
        return {
            "success": False,
            "items": [],
            "total_count": 0,
            "message": "账号 Cookie 为空",
            "cookies_str": current_cookie,
        }

    safe_page = max(1, int(page or 1))
    safe_page_size = max(1, min(int(page_size or 20), 100))
    safe_retries = max(1, min(int(max_retries or 3), 5))

    for attempt in range(safe_retries):
        service = RateService(current_cookie, account_id=account_id)
        token = service.cookies_dict.get("_m_h5_tk", "").split("_", 1)[0] if service.cookies_dict.get("_m_h5_tk") else ""
        if not token:
            return {
                "success": False,
                "items": [],
                "total_count": 0,
                "message": "Cookie 中缺少 _m_h5_tk，无法获取待评价列表",
                "cookies_str": current_cookie,
            }

        timestamp = str(int(time.time() * 1000))
        data_obj = {
            "pageNumber": safe_page,
            "rowsPerPage": safe_page_size,
            "queryType": "ORDER",
            "rateSearchParam": {
                "sellerRateStatus": "5",
            },
        }
        data_val = json.dumps(data_obj, separators=(",", ":"), ensure_ascii=False)
        sign = service._generate_sign(timestamp, token, data_val)
        params = {
            "jsv": "2.7.2",
            "appKey": APP_KEY,
            "t": timestamp,
            "sign": sign,
            "v": "1.0",
            "type": "json",
            "accountSite": "xianyu",
            "dataType": "json",
            "timeout": "20000",
            "api": MERCHANT_RATE_LIST_API_NAME,
            "valueType": "string",
            "sessionOption": "AutoLoginOnly",
        }
        headers = {
            "accept": "application/json",
            "content-type": "application/x-www-form-urlencoded",
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "referer": "https://seller.goofish.com/?site=COMMONPRO",
            "origin": "https://seller.goofish.com",
            "cookie": current_cookie,
        }

        try:
            timeout = aiohttp.ClientTimeout(total=20)
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.post(
                    MERCHANT_RATE_LIST_API_URL,
                    params=params,
                    headers=headers,
                    data={"data": data_val},
                ) as response:
                    try:
                        result = await response.json(content_type=None)
                    except Exception:
                        body = await response.text()
                        return {
                            "success": False,
                            "items": [],
                            "total_count": 0,
                            "message": f"待评价列表接口返回非 JSON: HTTP {response.status}",
                            "cookies_str": current_cookie,
                            "raw": body[:1000],
                        }

                    ret = result.get("ret", []) if isinstance(result, dict) else []
                    ret_text = service._ret_to_text(ret) or str(result)

                    if "SUCCESS" in ret_text:
                        module = result.get("data", {}).get("module", {}) if isinstance(result, dict) else {}
                        items = module.get("items", [])
                        if not isinstance(items, list):
                            items = []
                        try:
                            total_count = int(module.get("totalCount") or len(items) or 0)
                        except Exception:
                            total_count = len(items)
                        logger.info(
                            f"账号 {account_id or '未知'} 获取待评价列表成功: 共 {total_count} 条，本页 {len(items)} 条"
                        )
                        return {
                            "success": True,
                            "items": items,
                            "total_count": total_count,
                            "message": "获取成功",
                            "cookies_str": current_cookie,
                            "raw": result,
                        }

                    if service._is_token_expired(ret):
                        logger.warning(
                            f"账号 {account_id or '未知'} 获取待评价列表令牌过期 (尝试 {attempt + 1}/{safe_retries})"
                        )
                        has_new_cookie, new_cookie_string = service._merge_response_cookies(response)
                        if has_new_cookie:
                            await service._persist_cookie_if_needed(new_cookie_string)
                            current_cookie = new_cookie_string
                            continue
                        if attempt < safe_retries - 1:
                            await asyncio.sleep(1)
                            continue
                        return {
                            "success": False,
                            "items": [],
                            "total_count": 0,
                            "message": f"令牌过期且无法刷新: {ret_text}",
                            "cookies_str": current_cookie,
                            "raw": result,
                        }

                    if service._is_session_expired(ret):
                        if account_id:
                            try:
                                from db_manager import db_manager

                                db_manager.update_cookie_status_note(account_id, "Session过期，待重新登录")
                            except Exception as mark_exc:
                                logger.warning(f"账号 {account_id} 标记 Session 过期失败: {mark_exc}")
                        return {
                            "success": False,
                            "items": [],
                            "total_count": 0,
                            "session_expired": True,
                            "message": f"Session过期: {ret_text}",
                            "cookies_str": current_cookie,
                            "raw": result,
                        }

                    logger.warning(
                        f"账号 {account_id or '未知'} 获取待评价列表失败 (尝试 {attempt + 1}/{safe_retries}): {ret_text}"
                    )
                    if attempt < safe_retries - 1:
                        await asyncio.sleep(1)
                        continue
                    return {
                        "success": False,
                        "items": [],
                        "total_count": 0,
                        "message": ret_text,
                        "cookies_str": current_cookie,
                        "raw": result,
                    }
        except asyncio.TimeoutError:  # type: ignore[name-defined]
            if attempt < safe_retries - 1:
                await asyncio.sleep(1)
                continue
            return {
                "success": False,
                "items": [],
                "total_count": 0,
                "message": "获取待评价列表请求超时",
                "cookies_str": current_cookie,
            }
        except Exception as exc:
            logger.error(
                f"账号 {account_id or '未知'} 获取待评价列表异常 (尝试 {attempt + 1}/{safe_retries}): {exc}"
            )
            if attempt < safe_retries - 1:
                await asyncio.sleep(1)
                continue
            return {
                "success": False,
                "items": [],
                "total_count": 0,
                "message": str(exc),
                "cookies_str": current_cookie,
            }

    return {
        "success": False,
        "items": [],
        "total_count": 0,
        "message": "重试次数已用尽",
        "cookies_str": current_cookie,
    }
