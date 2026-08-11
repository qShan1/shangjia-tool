"""测试 update_item_extra_fields 的手动库存保护与 sku_info 存储逻辑。"""
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
    # 写入一条测试商品
    with manager.lock:
        cursor = manager.conn.cursor()
        cursor.execute(
            """
            INSERT INTO item_info (cookie_id, item_id, item_title)
            VALUES (?, ?, ?)
            """,
            ("test_cookie", "test_item", "测试商品"),
        )
        manager.conn.commit()
    yield manager
    with manager.lock:
        manager.conn.close()
    os.unlink(path)


def _get_stock(manager):
    with manager.lock:
        cursor = manager.conn.cursor()
        cursor.execute(
            "SELECT item_stock, stock_manual, sku_info FROM item_info WHERE cookie_id = ? AND item_id = ?",
            ("test_cookie", "test_item"),
        )
        row = cursor.fetchone()
    return row


def test_manual_stock_sets_manual_flag(db_manager):
    assert db_manager.update_item_extra_fields(
        "test_cookie", "test_item", item_stock=99, stock_manual=True
    )
    row = _get_stock(db_manager)
    assert row[0] == 99
    assert row[1] == 1


def test_auto_sync_does_not_override_manual_stock(db_manager):
    assert db_manager.update_item_extra_fields(
        "test_cookie", "test_item", item_stock=50, stock_manual=True
    )
    # 自动同步尝试覆盖手动库存，应被跳过（无字段变更，返回 False）
    assert not db_manager.update_item_extra_fields(
        "test_cookie", "test_item", item_stock=1, stock_from_sync=True
    )
    row = _get_stock(db_manager)
    assert row[0] == 50
    assert row[1] == 1


def test_auto_sync_overrides_when_not_manual(db_manager):
    assert db_manager.update_item_extra_fields(
        "test_cookie", "test_item", item_stock=50, stock_manual=False
    )
    assert db_manager.update_item_extra_fields(
        "test_cookie", "test_item", item_stock=7, stock_from_sync=True
    )
    row = _get_stock(db_manager)
    assert row[0] == 7


def test_sync_updates_other_fields_but_keeps_manual_stock(db_manager):
    assert db_manager.update_item_extra_fields(
        "test_cookie", "test_item", item_stock=80, stock_manual=True
    )
    # 自动同步：手动库存被保留，但多规格/规格明细仍应更新
    assert db_manager.update_item_extra_fields(
        "test_cookie", "test_item", item_stock=2, is_multi_spec=True,
        sku_info='[{"name": "红色", "quantity": 8, "price": "12"}]', stock_from_sync=True,
    )
    row = _get_stock(db_manager)
    assert row[0] == 80          # 手动库存保持不变
    assert row[1] == 1           # 仍是手动标记
    assert row[2] is not None    # sku_info 已更新


def test_restore_sync_then_auto_sync_overrides(db_manager):
    assert db_manager.update_item_extra_fields(
        "test_cookie", "test_item", item_stock=60, stock_manual=True
    )
    # 恢复自动同步：清除手动标记
    assert db_manager.update_item_extra_fields("test_cookie", "test_item", stock_manual=False)
    assert db_manager.update_item_extra_fields(
        "test_cookie", "test_item", item_stock=3, stock_from_sync=True
    )
    row = _get_stock(db_manager)
    assert row[0] == 3
    assert row[1] == 0


def test_sku_info_stored_and_returned(db_manager):
    sku_info = json.dumps(
        [
            {"name": "红色 / 32码", "quantity": 5, "price": "12"},
            {"name": "蓝色 / 32码", "quantity": 3, "price": "12"},
        ],
        ensure_ascii=False,
    )
    assert db_manager.update_item_extra_fields(
        "test_cookie", "test_item", is_multi_spec=True, item_stock=8, sku_info=sku_info, stock_from_sync=True
    )
    row = _get_stock(db_manager)
    assert row[0] == 8
    assert json.loads(row[2]) == [
        {"name": "红色 / 32码", "quantity": 5, "price": "12"},
        {"name": "蓝色 / 32码", "quantity": 3, "price": "12"},
    ]

    items = db_manager.get_items_by_cookie("test_cookie")
    assert len(items) == 1
    assert items[0]["sku_info"] == sku_info
    assert items[0]["is_multi_spec"] == 1
