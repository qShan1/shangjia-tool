"""Optional, read-only AI audit for the local Xianyu management system."""

import asyncio
import json
import re
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.request import Request, urlopen

from loguru import logger

from db_manager import db_manager
from ai_reply_engine import ai_reply_engine


class AISiteAuditService:
    """Run one read-only audit at a configured interval and save each report."""

    MIN_INTERVAL_HOURS = 1
    MAX_INTERVAL_HOURS = 168
    MAX_REPORTS = 30

    def __init__(self):
        from runtime_paths import PROJECT_ROOT, runtime_dir
        self.project_root = PROJECT_ROOT
        self.report_dir = runtime_dir("ai_site_audit_reports")
        self.report_dir.mkdir(parents=True, exist_ok=True)
        self.task: Optional[asyncio.Task] = None
        self.stop_event: Optional[asyncio.Event] = None
        self.state: Dict[str, Any] = {
            "status": "idle",
            "started_at": None,
            "ends_at": None,
            "schedule_enabled": False,
            "interval_hours": 8,
            "next_run_at": None,
            "last_run_at": None,
            "last_report_id": None,
            "error": None,
        }

    def _redact(self, value: Any) -> str:
        text = str(value or "")
        patterns = [
            (r"(?i)(api[_-]?key|token|cookie|password|secret|proxy_pass)\s*[=:]\s*[^\s,;]+", r"\1=[REDACTED]"),
            (r"(?i)(authorization\s*:\s*bearer\s+)[^\s]+", r"\1[REDACTED]"),
        ]
        for pattern, replacement in patterns:
            text = re.sub(pattern, replacement, text)
        return text[-4000:]

    def _health_snapshot(self) -> Dict[str, Any]:
        result: Dict[str, Any] = {"status": "unknown"}
        try:
            request = Request("http://127.0.0.1:8090/health", method="GET")
            with urlopen(request, timeout=5) as response:
                result = {"status": response.status, "body": self._redact(response.read().decode("utf-8", "replace"))}
        except Exception as exc:
            result = {"status": "error", "error": self._redact(exc)}
        return result

    def _database_snapshot(self) -> Dict[str, Any]:
        tables = ["cookies", "orders", "chat_messages", "ai_conversations", "system_settings"]
        counts: Dict[str, Any] = {}
        with db_manager.lock:
            cursor = db_manager.conn.cursor()
            for table in tables:
                try:
                    cursor.execute(f"SELECT COUNT(*) FROM {table}")
                    counts[table] = int(cursor.fetchone()[0])
                except Exception as exc:
                    counts[table] = f"error: {self._redact(exc)}"
            try:
                cursor.execute("""
                    SELECT direction, COALESCE(NULLIF(reply_source, ''), '未标记'), COUNT(*)
                    FROM chat_messages
                    WHERE datetime(created_at) >= datetime('now', '-24 hours')
                    GROUP BY direction, COALESCE(NULLIF(reply_source, ''), '未标记')
                """)
                counts["chat_messages_24h_by_source"] = [list(row) for row in cursor.fetchall()]
                cursor.execute("""
                    SELECT order_status, COUNT(*) FROM orders
                    GROUP BY order_status ORDER BY COUNT(*) DESC
                """)
                counts["orders_by_status"] = [list(row) for row in cursor.fetchall()]
                cursor.execute("""
                    SELECT task_type, status, COUNT(*) FROM scheduled_task_logs
                    WHERE datetime(created_at) >= datetime('now', '-24 hours')
                    GROUP BY task_type, status ORDER BY COUNT(*) DESC
                """)
                counts["task_logs_24h"] = [list(row) for row in cursor.fetchall()]
            except Exception as exc:
                counts["operational_metrics_error"] = self._redact(exc)
        return counts

    def _log_snapshot(self) -> Dict[str, Any]:
        result: Dict[str, Any] = {}
        for name in ("startup.log", "realtime.log", "startup-error.log"):
            path = self.project_root / name
            try:
                lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
                result[name] = [self._redact(line) for line in lines[-30:]]
            except Exception as exc:
                result[name] = [f"read error: {self._redact(exc)}"]
        return result

    def collect_snapshot(self) -> Dict[str, Any]:
        static_dir = self.project_root / "static"
        return {
            "captured_at": datetime.now().isoformat(timespec="seconds"),
            "health": self._health_snapshot(),
            "database_counts": self._database_snapshot(),
            "frontend": {
                "index_bytes": (static_dir / "index.html").stat().st_size if (static_dir / "index.html").exists() else 0,
                "app_js_bytes": (static_dir / "js" / "app.js").stat().st_size if (static_dir / "js" / "app.js").exists() else 0,
            },
            "logs": self._log_snapshot(),
        }

    def _fallback_report(self, snapshots: List[Dict[str, Any]], error: Optional[str] = None) -> str:
        last = snapshots[-1] if snapshots else {}
        health = last.get("health", {})
        counts = last.get("database_counts", {})
        source_counts = counts.get("chat_messages_24h_by_source") or []
        order_counts = counts.get("orders_by_status") or []

        def format_pairs(rows: List[Any]) -> str:
            formatted = []
            for row in rows:
                if isinstance(row, (list, tuple)) and len(row) >= 2:
                    formatted.append(f"{row[0]}={row[1]}")
            return "、".join(formatted) or "暂无数据"

        lines = [
            "# AI系统巡检报告",
            "",
            f"采样次数：{len(snapshots)}",
            f"服务健康状态：{health.get('status', 'unknown')}",
            "",
            "## 总体结论",
            "本次使用本地规则完成巡检。报告可以确认本机服务和数据链路的现状，但不能代替闲鱼平台登录、验证码或风控状态的判断。",
            "",
            "## 服务与页面可用性",
            f"- 健康接口：{health.get('status', 'unknown')}",
            f"- 账号记录：{counts.get('cookies', '暂无数据')}",
            f"- 订单记录：{counts.get('orders', '暂无数据')}",
            f"- 近24小时消息：{counts.get('chat_messages', '暂无数据')}",
            "",
            "## AI与消息链路",
            f"- AI会话记录：{counts.get('ai_conversations', '暂无数据')}",
            f"- 近24小时消息来源：{format_pairs(source_counts)}",
            "",
            "## 订单与任务",
            f"- 订单状态分布：{format_pairs(order_counts)}",
            f"- 近24小时任务：{format_pairs(counts.get('task_logs_24h') or [])}",
            "",
            "## 按优先级行动清单",
            "1. 先确认服务健康状态为 200，再处理账号会话或平台验证。",
            "2. 对照消息来源统计，检查AI、默认回复和人工消息是否出现异常比例。",
            "3. 对照任务日志处理失败任务，不因本地报告直接修改订单或发送消息。",
        ]
        if error:
            lines.extend([
                "",
                "## AI分析状态",
                "本次AI扩展分析未在规定时间内返回，已自动降级为以上本地规则报告。未把连接异常原文展示在业务报告中。",
            ])
        return "\n".join(lines)

    def _generate_report_sync(self, cookie_id: Optional[str], snapshots: List[Dict[str, Any]]) -> str:
        settings = db_manager.get_ai_reply_settings(cookie_id) if cookie_id else None
        if not settings or not settings.get("api_key"):
            return self._fallback_report(snapshots, "未找到可用的AI配置")

        prompt = {
            "task": "分析本地 SHANGJIA TOOL 的运行质量，输出可直接执行的中文运维巡检报告",
            "rules": [
                "只根据提供的快照判断，不要臆测外部平台状态",
                "报告必须分为：1总体结论 2服务/页面可用性 3账号与消息链路 4AI回复质量 5订单/发货/评价任务 6已确认问题 7风险与影响 8按优先级排列的行动清单",
                "明确指出当前快照能证明什么、不能证明什么；没有数据时写‘无法判断’，不要编造指标",
                "根据chat_messages_24h_by_source比较AI、默认、关键词和手动回复，指出AI是否被默认回复兜底；根据task_logs_24h指出失败任务",
                "区分代码证据、运行证据和推测，不要输出任何密钥、Cookie、账号密码或完整用户隐私",
                "不要建议绕过平台风控，不要自动修改业务数据",
            ],
            "snapshots": snapshots[-8:],
        }
        messages = [
            {"role": "system", "content": "你是一个严谨的本地软件运维审计助手。"},
            {"role": "user", "content": json.dumps(prompt, ensure_ascii=False)},
        ]
        api_type = ai_reply_engine._resolve_api_type(settings)
        if api_type == "gemini":
            return ai_reply_engine._call_gemini_api(settings, messages, max_tokens=1200, temperature=0.2)
        if api_type == "anthropic":
            return ai_reply_engine._call_anthropic_api(settings, messages, max_tokens=1200, temperature=0.2)
        if api_type == "azure_openai":
            return ai_reply_engine._call_azure_openai_api(settings, messages, max_tokens=1200, temperature=0.2)
        if api_type == "openai_responses":
            return ai_reply_engine._call_openai_responses_api(settings, messages, max_tokens=1200, temperature=0.2)
        return ai_reply_engine._call_openai_chat_api(settings, messages, max_tokens=1200, temperature=0.2)

    def _save_report(self, report: Dict[str, Any]) -> None:
        path = self.report_dir / f"{report['id']}.json"
        path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        (self.report_dir / f"{report['id']}.md").write_text(report["report"], encoding="utf-8")
        files = sorted(self.report_dir.glob("*.json"), key=lambda item: item.stat().st_mtime, reverse=True)
        for old_file in files[self.MAX_REPORTS:]:
            old_file.unlink(missing_ok=True)

    async def start(self, interval_hours: int, cookie_id: Optional[str] = None, persist: bool = True) -> Dict[str, Any]:
        if self.task and not self.task.done():
            raise ValueError("巡检任务已在运行")
        interval_hours = max(self.MIN_INTERVAL_HOURS, min(int(interval_hours), self.MAX_INTERVAL_HOURS))
        if persist:
            db_manager.set_system_setting('ai_site_audit_enabled', 'true', '是否开启AI系统定时巡检')
            db_manager.set_system_setting('ai_site_audit_interval_hours', str(interval_hours), 'AI系统巡检周期（小时）')
            db_manager.set_system_setting('ai_site_audit_cookie_id', str(cookie_id or ''), 'AI系统巡检使用的账号')
        self.stop_event = asyncio.Event()
        now = time.time()
        self.state.update({
            "status": "running",
            "schedule_enabled": True,
            "started_at": datetime.fromtimestamp(now).isoformat(timespec="seconds"),
            "interval_hours": interval_hours,
            "next_run_at": datetime.fromtimestamp(now).isoformat(timespec="seconds"),
            "last_run_at": None,
            "last_report_id": None,
            "error": None,
        })
        self.task = asyncio.create_task(self._run(interval_hours, cookie_id))
        return self.get_status()

    async def _run(self, interval_hours: int, cookie_id: Optional[str]) -> None:
        try:
            while not self.stop_event.is_set():
                self.state["status"] = "running"
                snapshot = await asyncio.to_thread(self.collect_snapshot)
                self.state["status"] = "generating"
                try:
                    report_text = await asyncio.to_thread(self._generate_report_sync, cookie_id, [snapshot])
                except Exception as exc:
                    logger.exception("AI系统巡检报告生成失败")
                    report_text = self._fallback_report([snapshot], str(exc))
                report = {
                    "id": uuid.uuid4().hex,
                    "created_at": datetime.now().isoformat(timespec="seconds"),
                    "sample_count": 1,
                    "report": report_text,
                }
                await asyncio.to_thread(self._save_report, report)
                now = time.time()
                next_run = now + interval_hours * 3600
                self.state.update({
                    "status": "scheduled",
                    "last_report_id": report["id"],
                    "last_run_at": datetime.fromtimestamp(now).isoformat(timespec="seconds"),
                    "next_run_at": datetime.fromtimestamp(next_run).isoformat(timespec="seconds"),
                    "error": None,
                })
                try:
                    await asyncio.wait_for(self.stop_event.wait(), timeout=interval_hours * 3600)
                except asyncio.TimeoutError:
                    pass
        except asyncio.CancelledError:
            self.state.update({"status": "stopped", "schedule_enabled": False, "error": None})
            raise
        except Exception as exc:
            logger.exception("AI系统巡检任务失败")
            self.state.update({"status": "failed", "schedule_enabled": False, "error": self._redact(exc)})

    async def stop(self, persist: bool = True) -> Dict[str, Any]:
        if persist:
            db_manager.set_system_setting('ai_site_audit_enabled', 'false', '是否开启AI系统定时巡检')
        if self.task and not self.task.done() and self.stop_event:
            self.stop_event.set()
            await self.task
        self.state.update({"status": "stopped", "schedule_enabled": False, "next_run_at": None})
        return self.get_status()

    async def restore_schedule(self) -> Dict[str, Any]:
        enabled = (db_manager.get_system_setting('ai_site_audit_enabled') or '').lower() == 'true'
        if not enabled:
            return self.get_status()
        try:
            interval_hours = int(db_manager.get_system_setting('ai_site_audit_interval_hours') or 8)
        except (TypeError, ValueError):
            interval_hours = 8
        cookie_id = db_manager.get_system_setting('ai_site_audit_cookie_id') or None
        return await self.start(interval_hours, cookie_id, persist=False)

    def get_status(self) -> Dict[str, Any]:
        return dict(self.state)

    def list_reports(self) -> List[Dict[str, Any]]:
        reports = []
        for path in sorted(self.report_dir.glob("*.json"), key=lambda item: item.stat().st_mtime, reverse=True):
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                reports.append({key: data.get(key) for key in ("id", "created_at", "sample_count")})
            except Exception:
                continue
        return reports

    def get_report(self, report_id: str) -> Optional[Dict[str, Any]]:
        path = self.report_dir / f"{report_id}.json"
        if not path.exists():
            return None
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return None


ai_site_audit_service = AISiteAuditService()
