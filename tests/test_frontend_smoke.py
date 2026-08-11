# -*- coding: utf-8 -*-
"""前端冒烟测试：登录 → 仪表盘 → 销售额图表 → 用户管理与账号页面。

使用临时数据目录 + uvicorn 启动完整 FastAPI 服务，再通过 Playwright Chromium
驱动前端页面验证关键链路可渲染。不会触碰真实 data/ 目录。

前置（项目 venv 已满足）：playwright + chromium
  - PLAYWRIGHT_BROWSERS_PATH 默认 D:\\Path\\ms-playwright

运行：
    venv\\Scripts\\python.exe -m pytest tests/test_frontend_smoke.py -v
"""
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
PYTHON = sys.executable
PLAYWRIGHT_BROWSERS_PATH = os.environ.get(
    "PLAYWRIGHT_BROWSERS_PATH", r"D:\Path\ms-playwright"
)
ADMIN_USER = "admin"
ADMIN_PASS = "SmokePass123!"


# Chromium 禁止访问的端口（不安全端口），_free_port 需避开
_CHROMIUM_BLOCKED_PORTS = {
    1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69,
    77, 79, 87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119,
    123, 135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515,
    526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990,
    993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 5060, 5061, 6000, 6566,
    6665, 6666, 6667, 6668, 6669, 6697, 10080,
}


def _free_port() -> int:
    for _ in range(100):
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            port = s.getsockname()[1]
        if port not in _CHROMIUM_BLOCKED_PORTS:
            return port
    raise RuntimeError("无法找到可用的非禁用端口")


def _file_logger_path(tmp_name: str) -> str:
    return Path(tmp_name) / "smoke_test.log"


@pytest.fixture(scope="session")
def server_base_url() -> str:
    """启动临时实例并返回 base URL。"""
    tmp = tempfile.TemporaryDirectory(prefix="shangjia_smoke_")
    db_path = Path(tmp.name) / "smoke.db"
    port = _free_port()

    env = dict(os.environ)
    env.update({
        "DB_PATH": str(db_path),
        "API_PORT": str(port),
        "API_HOST": "127.0.0.1",
        "ADMIN_PASSWORD": ADMIN_PASS,
        "PLAYWRIGHT_BROWSERS_PATH": PLAYWRIGHT_BROWSERS_PATH,
    })

    # 预置数据库：关闭登录验证码与开放注册，避免浏览器流程被验证码挡住
    seed_code = (
        "import os, sys, datetime; "
        f"os.environ['DB_PATH'] = r'{db_path}'; "
        f"sys.path.insert(0, r'{REPO_ROOT / 'shangjia_tool'}'); "
        "from db_manager import db_manager; "
        "db_manager.set_system_setting('login_captcha_enabled', 'false'); "
        "db_manager.set_system_setting('registration_enabled', 'false');"
        # 造一条已付款订单，让 /api/sales 返回非空，仪表盘销售额图表演染出实例
        # 注意：订单时间按 UTC 写入（parse_db_timestamp 将无时区字符串按 UTC 解析）
        "db_manager.save_cookie('smoke_cookie_1', 'test_value'); "
        "db_manager.save_item_basic_info('smoke_cookie_1', 'smoke_item_1', item_title='冒烟测试商品', item_price='9.90'); "
        "now_utc = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%d %H:%M:%S'); "
        "db_manager.insert_or_update_order('smoke_order_1', item_id='smoke_item_1', amount='9.90', "
        "order_status='completed', cookie_id='smoke_cookie_1', platform_paid_at=now_utc);"
    )
    subprocess.run(
        [PYTHON, "-c", seed_code],
        check=True,
        cwd=str(REPO_ROOT),
        env=env,
        capture_output=True,
    )

    proc = subprocess.Popen(
        [
            PYTHON, "-m", "uvicorn",
            "shangjia_tool.reply_server:app",
            "--host", "127.0.0.1",
            "--port", str(port),
        ],
        cwd=str(REPO_ROOT),
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    base = f"http://127.0.0.1:{port}"
    try:
        deadline = time.time() + 120
        while time.time() < deadline:
            if proc.poll() is not None:
                raise RuntimeError(f"服务进程提前退出，code={proc.returncode}")
            try:
                with urllib.request.urlopen(base + "/login.html", timeout=3) as resp:
                    if resp.status == 200:
                        break
            except Exception:
                time.sleep(1)
        else:
            raise RuntimeError("服务 120 秒内未就绪")
        yield base
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
        time.sleep(2)
        tmp.cleanup()


@pytest.fixture(scope="session")
def admin_token(server_base_url: str) -> str:
    """通过 API 登录获取管理员 token。"""
    body = json.dumps({"username": ADMIN_USER, "password": ADMIN_PASS}).encode("utf-8")
    req = urllib.request.Request(
        server_base_url + "/login",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    assert data.get("success") is True, f"登录失败: {data}"
    assert data.get("token"), "登录响应缺少 token"
    return data["token"]


@pytest.fixture()
def browser():
    """独立启停的 Playwright（每次测试结束即关闭主线程事件循环，
    避免常驻 loop 污染同进程后续 unittest 异步用例）。"""
    from playwright.sync_api import sync_playwright

    os.environ["PLAYWRIGHT_BROWSERS_PATH"] = PLAYWRIGHT_BROWSERS_PATH
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True)
        try:
            yield b
        finally:
            b.close()


@pytest.fixture()
def admin_page(browser, server_base_url: str, admin_token: str):
    """已注入管理员 token 的 /admin 页面（默认停在仪表盘）。"""
    page = browser.new_page()
    page.add_init_script(f"localStorage.setItem('auth_token', '{admin_token}')")
    page.goto(server_base_url + "/admin", wait_until="domcontentloaded")
    # 等待前端完成初始化并显示仪表盘区块
    page.wait_for_selector("#dashboard-section.active", timeout=20000)
    yield page
    page.close()


def test_login_page_renders(browser, server_base_url: str):
    """登录页可加载，包含用户名与密码输入框。"""
    page = browser.new_page()
    try:
        page.goto(server_base_url + "/login.html", wait_until="domcontentloaded")
        title = page.title()
        assert "登录" in title or "闲鱼" in title or "SHANGJIA" in title.upper()
        assert page.locator("input[type='password']").count() >= 1
        assert page.locator("input[type='text'], input[name='username'], #username").count() >= 1
    finally:
        page.close()


def test_dashboard_and_sales_chart_render(admin_page):
    """仪表盘可见，且销售额图表由本地 Chart.js 渲染出实例。"""
    assert admin_page.locator("#dashboard-section.active").count() == 1
    canvas = admin_page.locator("#salesChart")
    assert canvas.count() == 1
    # chart.js 必须来自本地资源（CDN 离线时不渲染）
    chart_loaded = admin_page.evaluate("typeof Chart !== 'undefined'")
    assert chart_loaded, "Chart.js 未加载（本地化失败？）"
    # loadDashboard 异步链较慢，等待实例真正挂载
    admin_page.wait_for_function(
        "() => { const c = document.getElementById('salesChart'); "
        "return !!c && !!Chart.getChart(c); }",
        timeout=20000,
    )


def test_user_management_section(admin_page):
    """切换到用户管理页，区块应激活（管理员可见）。"""
    admin_page.evaluate("showSection('user-management')")
    admin_page.wait_for_selector("#user-management-section.active", timeout=10000)
    assert admin_page.locator("#user-management-section.active").count() == 1


def test_accounts_section(admin_page):
    """账号管理页面可切换显示。"""
    admin_page.evaluate("showSection('accounts')")
    admin_page.wait_for_selector("#accounts-section.active", timeout=10000)
    assert admin_page.locator("#accounts-section.active").count() == 1


def test_unauth_admin_redirects_to_login(browser, server_base_url: str):
    """未登录访问 /admin 时前端应跳转登录页（或显示登录界面）。"""
    page = browser.new_page()
    try:
        page.goto(server_base_url + "/admin", wait_until="domcontentloaded")
        page.wait_for_timeout(3000)
        url = page.url
        text = page.content()
        assert "/login" in url or "login" in url.lower() or "登录" in text, (
            f"未登录访问 /admin 未跳转登录页，url={url}"
        )
    finally:
        page.close()