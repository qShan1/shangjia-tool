"""测试商品发布多规格（multiSKU）链路：
- ItemPublisher.normalize_sku_list / normalize_spec_list / _apply_sku_settings
- db_manager 素材 skus/specs 存取
- reply_server 单发/素材接口透传 skus/specs
"""
import json
import os
import tempfile

import pytest

from shangjia_tool.db_manager import DBManager


@pytest.fixture()
def db_manager():
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    os.unlink(path)
    manager = DBManager(db_path=path)
    yield manager
    with manager.lock:
        manager.conn.close()
    os.unlink(path)


# ---------------- ItemPublisher 多规格 payload 构建 ----------------

def _build_payload(publisher_cls, *, skus=None, specs=None):
    from utils.item_publisher import ItemPublisher

    payload = {
        "itemPriceDTO": {},
        "defaultPrice": False,
        "quantity": "1",
    }
    ItemPublisher._apply_sku_settings(
        payload=payload,
        skus=skus or [],
        specs=specs,
    )
    return payload


def test_normalize_sku_list_accepts_valid_rows():
    from utils.item_publisher import ItemPublisher

    skus = [
        {"propertyList": [{"propertyText": "颜色", "valueText": "红色"}], "price": 199.9, "quantity": 10},
        {"propertyList": [{"propertyText": "颜色", "valueText": "蓝色"}], "price": "299", "quantity": 5},
    ]
    normalized = ItemPublisher.normalize_sku_list(skus)
    assert len(normalized) == 2
    assert normalized[0]["propertyList"] == [{"propertyText": "颜色", "valueText": "红色"}]
    assert normalized[0]["price"] == 199.9
    assert normalized[0]["quantity"] == 10


def test_normalize_sku_list_rejects_missing_property():
    from utils.item_publisher import ItemPublisher

    with pytest.raises(ValueError):
        ItemPublisher.normalize_sku_list([{"price": 10, "quantity": 1}])


def test_normalize_sku_list_rejects_bad_price():
    from utils.item_publisher import ItemPublisher

    with pytest.raises(ValueError):
        ItemPublisher.normalize_sku_list(
            [{"propertyList": [{"propertyText": "颜色", "valueText": "红"}], "price": "abc"}]
        )


def test_normalize_sku_list_returns_empty_for_none():
    from utils.item_publisher import ItemPublisher

    assert ItemPublisher.normalize_sku_list(None) == []
    assert ItemPublisher.normalize_sku_list([]) == []


def test_apply_sku_settings_writes_item_sku_list():
    from utils.item_publisher import ItemPublisher

    skus = ItemPublisher.normalize_sku_list(
        [{"propertyList": [{"propertyText": "颜色", "valueText": "红色"}], "price": 199.9, "quantity": 10}]
    )
    payload = _build_payload(ItemPublisher, skus=skus)
    assert payload["itemSkuList"] == [
        {
            "priceInCent": "19990",
            "quantity": 10,
            "propertyList": [{"propertyText": "颜色", "valueText": "红色"}],
        }
    ]
    # 多规格发布不设商品级价格
    assert payload["itemPriceDTO"] == {}
    assert payload["defaultPrice"] is False


def test_apply_sku_settings_derives_item_properties():
    from utils.item_publisher import ItemPublisher

    skus = ItemPublisher.normalize_sku_list(
        [
            {"propertyList": [{"propertyText": "颜色", "valueText": "红"}], "price": 10, "quantity": 1},
            {"propertyList": [{"propertyText": "颜色", "valueText": "蓝"}], "price": 20, "quantity": 2},
        ]
    )
    payload = _build_payload(ItemPublisher, skus=skus)
    assert payload["itemProperties"] == [
        {
            "propertyName": "颜色",
            "supportImage": False,
            "propertyValues": [{"propertyValue": "红"}, {"propertyValue": "蓝"}],
        }
    ]


def test_apply_sku_settings_uses_explicit_specs():
    from utils.item_publisher import ItemPublisher

    skus = ItemPublisher.normalize_sku_list(
        [{"propertyList": [{"propertyText": "容量", "valueText": "64G"}], "price": 10, "quantity": 1}]
    )
    specs = [{"propertyName": "容量", "propertyValues": [{"propertyValue": "64G"}]}]
    payload = _build_payload(ItemPublisher, skus=skus, specs=specs)
    assert payload["itemProperties"] == [
        {"propertyName": "容量", "supportImage": False, "propertyValues": [{"propertyValue": "64G"}]}
    ]


def test_no_skus_keeps_payload_unchanged():
    from utils.item_publisher import ItemPublisher

    payload = _build_payload(ItemPublisher, skus=[])
    assert "itemSkuList" not in payload
    assert "itemProperties" not in payload


# ---------------- db_manager 素材 skus/specs 存取 ----------------

def _material_payload():
    return {
        "title": "多规格手机",
        "description": "测试多规格发布素材",
        "price": 100,
        "images": [{"url": "https://x/a.jpg"}],
        "delivery_method": "包邮",
        "brand": "华为",
        "skus": [
            {
                "propertyList": [{"propertyText": "颜色", "valueText": "红色"}],
                "price": 199,
                "quantity": 10,
            },
            {
                "propertyList": [{"propertyText": "颜色", "valueText": "蓝色"}],
                "price": 299,
                "quantity": 5,
            },
        ],
        "specs": [
            {"propertyName": "颜色", "supportImage": False, "propertyValues": [{"propertyValue": "红色"}, {"propertyValue": "蓝色"}]}
        ],
    }


def test_material_skus_specs_roundtrip(db_manager):
    material_id = db_manager.add_product_material(1, _material_payload())
    assert material_id is not None

    material = db_manager.get_product_material(material_id, 1)
    assert len(material["skus"]) == 2
    assert material["skus"][0]["propertyList"][0]["propertyText"] == "颜色"
    assert material["skus"][1]["price"] == 299
    assert material["specs"][0]["propertyName"] == "颜色"


def test_material_skus_in_list_and_by_ids(db_manager):
    material_id = db_manager.add_product_material(1, _material_payload())
    page = db_manager.list_product_materials(user_id=1)
    assert page["total"] == 1
    assert len(page["list"][0]["skus"]) == 2

    by_ids = db_manager.list_product_materials_by_ids([material_id], user_id=1)
    assert len(by_ids) == 1
    assert by_ids[0]["skus"][0]["price"] == 199


def test_material_update_skus(db_manager):
    material_id = db_manager.add_product_material(1, _material_payload())
    assert db_manager.update_product_material(material_id, 1, {"skus": []})
    material = db_manager.get_product_material(material_id, 1)
    assert material["skus"] == []


# ---------------- reply_server 透传 ----------------

class _FakePublisher:
    """最小可发布对象：记录传入参数并返回成功响应。"""

    def __init__(self, cookies_str, cookie_id, proxy_config=None):
        self.cookies_str = cookies_str
        self.calls = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def publish_item(self, **kwargs):
        self.calls.append(kwargs)
        return {"ret": ["SUCCESS::调用成功"], "data": {"itemId": "998877"}}

    def extract_published_item_id(self, result):
        return (result.get("data") or {}).get("itemId")

    def is_success_response(self, result):
        return any(str(r).startswith("SUCCESS") for r in (result.get("ret") or []))

    def extract_error_message(self, result):
        return str(result.get("ret"))

    def is_category_path_error(self, result):
        return False

    def build_category_path_error_message(self, result):
        return ""


def _install_temp_db(manager):
    """将临时 DB 接入模块级 db_manager 引用，使 app 使用测试库。"""
    import db_manager as dbm_legacy
    import shangjia_tool.db_manager as dbm_module
    import shangjia_tool.reply_server as rs

    dbm_legacy.db_manager = manager
    dbm_module.db_manager = manager
    rs.db_manager = manager


def _bootstrap(db_manager):
    """写入测试 Cookie 并设置已知的 admin 密码、关闭验证码。"""
    _install_temp_db(db_manager)
    db_manager.update_user_password("admin", "SkuPass123!")
    db_manager.save_cookie("sku_cookie_1", "cookie_value_abc")
    db_manager.set_system_setting("login_captcha_enabled", "false")
    db_manager.set_system_setting("registration_enabled", "false")
    return db_manager


def _login_admin(client):
    login = client.post("/login", json={"username": "admin", "password": "SkuPass123!"})
    assert login.status_code == 200, login.text
    return {"Authorization": f"Bearer {login.json()['token']}"}


def test_single_publish_passes_skus_to_publisher(db_manager):
    from utils.item_publisher import ItemPublisher

    captured = {}

    async def fake_publish_item(self, **kwargs):
        captured.update(kwargs)
        return {"ret": ["SUCCESS::调用成功"], "data": {"itemId": "998877"}}

    ItemPublisher.publish_item = fake_publish_item

    import shangjia_tool.reply_server as rs

    rs.ItemPublisher = ItemPublisher

    async def _sync_stub(*args, **kwargs):
        return {
            "success": True,
            "message": "已同步",
            "published_item_id": kwargs.get("published_item_id"),
            "item_synced": False,
            "page_sync": {"success": True, "current_count": 0, "saved_count": 0, "error": None},
            "full_sync": {"used": False, "success": False, "total_count": 0, "total_saved": 0, "error": None},
        }

    rs._sync_items_after_publish = _sync_stub

    _bootstrap(db_manager)
    from shangjia_tool.reply_server import app

    from fastapi.testclient import TestClient

    client = TestClient(app)
    headers = _login_admin(client)

    payload = {
        "account_id": "sku_cookie_1",
        "title": "多规格测试机",
        "description": "多规格发布描述",
        "images": [{"url": "https://x/a.jpg"}],
        "delivery_method": "包邮",
        "skus": [
            {"propertyList": [{"propertyText": "颜色", "valueText": "红"}], "price": 199, "quantity": 10},
            {"propertyList": [{"propertyText": "颜色", "valueText": "蓝"}], "price": 299, "quantity": 5},
        ],
        "specs": [{"propertyName": "颜色", "propertyValues": [{"propertyValue": "红"}, {"propertyValue": "蓝"}]}],
    }
    resp = client.post("/product-publish", json=payload, headers=headers)
    assert resp.status_code == 200, resp.text
    assert captured["skus"][0]["propertyList"][0]["propertyText"] == "颜色"
    assert captured["skus"][1]["price"] == 299
    assert captured["specs"][0]["propertyName"] == "颜色"


def test_single_publish_rejects_bad_sku(db_manager):
    import shangjia_tool.reply_server as rs

    _bootstrap(db_manager)
    from shangjia_tool.reply_server import app

    from fastapi.testclient import TestClient

    client = TestClient(app)
    headers = _login_admin(client)

    payload = {
        "account_id": "sku_cookie_1",
        "title": "多规格测试机",
        "description": "多规格发布描述",
        "images": [{"url": "https://x/a.jpg"}],
        "delivery_method": "包邮",
        "skus": [{"price": 199, "quantity": 10}],  # 缺少规格名/值
    }
    resp = client.post("/product-publish", json=payload, headers=headers)
    assert resp.status_code == 400
    assert "规格" in resp.json()["detail"]


def test_material_create_with_skus(db_manager):
    _bootstrap(db_manager)
    from shangjia_tool.reply_server import app

    from fastapi.testclient import TestClient

    client = TestClient(app)
    headers = _login_admin(client)

    payload = _material_payload()
    resp = client.post("/product-materials", json=payload, headers=headers)
    assert resp.status_code == 200, resp.text
    material = resp.json()["material"]
    assert len(material["skus"]) == 2
    assert material["specs"][0]["propertyName"] == "颜色"

    # 读取回显同样带 skus
    list_resp = client.get("/product-materials", headers=headers)
    assert list_resp.status_code == 200
    assert len(list_resp.json()["list"][0]["skus"]) == 2
