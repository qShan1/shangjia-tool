import unittest

from item_polish_module import ItemPolishModule


class _FakeRuntime:
    cookie_id = "TEST_ACCOUNT"

    def __init__(self, items):
        self._items = items

    async def get_all_items(self):
        return {"success": True, "items": self._items}


class ItemPolishSummaryTests(unittest.IsolatedAsyncioTestCase):
    async def test_all_platform_calls_failed_is_not_reported_as_success(self):
        module = ItemPolishModule(_FakeRuntime([{"id": "ITEM_1"}]))

        async def fail_polish(_item_id):
            return {"success": False, "item_id": "ITEM_1", "error": "API_NOT_FOUND"}

        module.polish_item = fail_polish
        result = await module.polish_all_items()

        self.assertFalse(result["success"])
        self.assertFalse(result["complete_success"])
        self.assertFalse(result["partial_success"])
        self.assertEqual(result["polished"], 0)
        self.assertEqual(result["failed"], 1)

    async def test_one_platform_success_is_reported_as_success(self):
        module = ItemPolishModule(_FakeRuntime([{"id": "ITEM_1"}]))

        async def succeed_polish(_item_id):
            return {"success": True, "item_id": "ITEM_1"}

        module.polish_item = succeed_polish
        result = await module.polish_all_items()

        self.assertTrue(result["success"])
        self.assertTrue(result["complete_success"])
        self.assertFalse(result["partial_success"])
        self.assertEqual(result["polished"], 1)
        self.assertEqual(result["failed"], 0)


if __name__ == "__main__":
    unittest.main()
