# -*- coding: utf-8 -*-
"""路由鉴权审计脚本（Phase 4 交付物）。

用法:
    python scripts/audit_routes.py            # 输出审计表
    python scripts/audit_routes.py --check    # CI 模式: 有未保护路由时退出码 1

规则:
    - AST 解析 shangjia_tool/reply_server.py 中所有 @app.xxx(...) 路由;
    - 函数签名中存在 Depends(verify_token / require_auth / get_current_user /
      require_admin / verify_admin_token / get_current_user_optional)
      即视为已保护;
    - PUBLIC whitelist 内的未保护路由被判定为"有意公开"（登录/注册页
      在鉴权前必须读取的开关状态类接口），其余未保护路由需要人工复核。
"""

import ast
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SERVER_FILE = REPO_ROOT / "shangjia_tool" / "reply_server.py"
CAPTCHA_ROUTER_FILE = REPO_ROOT / "shangjia_tool" / "api_captcha_remote.py"

AUTH_DEPS = (
    "verify_token",
    "require_auth",
    "get_current_user",
    "require_admin",
    "verify_admin_token",
    "get_current_user_optional",
    "security",
)

# 有意公开的端点（登录/注册页及首次安装引导在鉴权前必须读取/调用的接口，
# 仅返回布尔开关/静态文案，不含业务数据）
PUBLIC_WHITELIST = {
    ("/health",),
    ("/",),
    ("/login.html",),
    ("/register.html",),
    ("/admin",),
    ("/login",),
    ("/verify-captcha",),
    ("/register",),
    ("/captcha/generate",),
    ("/generate-captcha",),
    ("/captcha/check-required",),
    ("/send-verification-code",),
    ("/registration-status",),
    ("/login-info-status",),
    ("/api/login-captcha-enabled",),
    ("/api/system/benefits",),
    ("/api/system/init-status",),
    ("/api/system/init-password",),
    ("/api/system/welcome-status",),
    ("/api/system/chromium-status",),
}

# 独立 API 密钥认证的集成面（外部 AI/自动化服务调用，无 Web 会话 JWT，
# 凭据存于系统设置 qq_reply_secret_key，未配置时拒绝请求）
APIKEY_AUTH_WHITELIST = {
    "/send-message",
}

# 外部 AI 回复服务 webhook：仅匹配回复模板并返回文本（不发消息），
# 真正发消息的 /send-message 有 API Key 校验；依赖本地/内网部署。
WEBHOOK_PUBLIC_WHITELIST = {
    "/xianyu/reply",
}


def _def_is_auth(d: ast.AST) -> bool:
    if not (isinstance(d, ast.Call) and isinstance(d.func, ast.Name) and d.func.id == "Depends"):
        return False
    if not d.args:
        return False
    a = d.args[0]
    return (isinstance(a, ast.Name) and a.id in AUTH_DEPS) or \
           (isinstance(a, ast.Attribute) and a.attr in AUTH_DEPS)


def _fn_auth(node: ast.FunctionDef) -> bool:
    for d in node.args.defaults:
        if _def_is_auth(d):
            return True
    for d in node.args.kw_defaults:
        if d and _def_is_auth(d):
            return True
    return False


def _route_fns(tree: ast.AST):
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            yield node


def audit() -> list:
    src = SERVER_FILE.read_text(encoding="utf-8")
    tree = ast.parse(src)
    rows = []
    for node in _route_fns(tree):
        routes = []
        for dec in node.decorator_list:
            if isinstance(dec, ast.Call) and isinstance(dec.func, ast.Attribute) and \
                    dec.func.attr in ("get", "post", "put", "delete", "patch", "websocket"):
                path = dec.args[0].value if dec.args and isinstance(dec.args[0], ast.Constant) else "?"
                routes.append((dec.func.attr.upper(), path))
        if not routes:
            continue
        protected = _fn_auth(node)
        for meth, path in routes:
            apikey = path in APIKEY_AUTH_WHITELIST
            webhook = path in WEBHOOK_PUBLIC_WHITELIST
            pub = (path,) in PUBLIC_WHITELIST or (f"/{meth.lower()}", path) in PUBLIC_WHITELIST
            rows.append({
                "line": node.lineno,
                "method": meth,
                "path": path,
                "status": "PROTECTED" if protected else (
                    "APIKEY-AUTH" if apikey else (
                        "WEBHOOK-PUBLIC" if webhook else (
                            "PUBLIC-EXPECTED" if pub else "UNPROTECTED"))),
                "handler": node.name,
            })
            if "UNPROTECTED" == rows[-1]["status"]:
                print(f"[AUDIT] 未保护路由: {meth} {path}", file=sys.stderr)
    # 滑块远程控制子系统（/n/*）: 独立 Router，服务于本地/远程滑块自动化，
    # 不读写任何业务数据；挂载于 reply_server 的 include_router。
    cap_src = CAPTCHA_ROUTER_FILE.read_text(encoding="utf-8")
    cap_tree = ast.parse(cap_src)
    for node in _route_fns(cap_tree):
        routes = []
        for dec in node.decorator_list:
            if isinstance(dec, ast.Call) and isinstance(dec.func, ast.Attribute) and \
                    dec.func.attr in ("get", "post", "put", "delete", "patch", "websocket"):
                path = dec.args[0].value if dec.args and isinstance(dec.args[0], ast.Constant) else "?"
                routes.append((dec.func.attr.upper(), path))
        for meth, path in routes:
            rows.append({
                "line": node.lineno,
                "method": meth,
                "path": "/n" + path,
                "status": "SUBSYSTEM-PUBLIC",
                "handler": node.name,
            })
    rows.sort(key=lambda r: (r["status"] != "PROTECTED", r["line"]))
    return rows


def main() -> int:
    rows = audit()
    by_status = {}
    for r in rows:
        by_status.setdefault(r["status"], []).append(r)

    print(f"路由总数: {len(rows)}")
    print(f"  已保护(PROTECTED):           {len(by_status.get('PROTECTED', []))}")
    print(f"  公开白名单(PUBLIC-EXPECTED):  {len(by_status.get('PUBLIC-EXPECTED', []))}")
    print(f"  独立APIKey认证(APIKEY-AUTH): {len(by_status.get('APIKEY-AUTH', []))}")
    print(f"  AI回复Webhook(WEBHOOK-PUBLIC): {len(by_status.get('WEBHOOK-PUBLIC', []))}")
    print(f"  子系统公开(SUBSYSTEM-PUBLIC): {len(by_status.get('SUBSYSTEM-PUBLIC', []))}")
    unprot = by_status.get("UNPROTECTED", [])
    print(f"  未保护(UNPROTECTED):        {len(unprot)}")
    for r in rows:
        print(f"{r['line']:>5}  {r['method']:<6} {r['path']:<55} {r['status']:<16} {r['handler']}")

    if "--check" in sys.argv:
        return 1 if unprot else 0
    return 0


if __name__ == "__main__":
    sys.exit(main())