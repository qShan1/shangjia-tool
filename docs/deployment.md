# 部署说明

## 源码运行

要求：Python 3.11+、Node.js（部分 JavaScript 能力需要）和 Playwright Chromium。

```powershell
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
playwright install chromium
python Start.py
```

默认地址：

- 管理台：`http://127.0.0.1:8890/admin`
- API 文档：`http://127.0.0.1:8890/docs`
- 健康检查：`http://127.0.0.1:8890/health`

## 升级原则

先备份运行数据，再更新代码。完成升级后检查 `/health`，然后在管理台确认账号状态和业务数据；本地服务成功启动不代表第三方平台会话仍然有效。
