# 发布检查

发布前执行：

```powershell
pip install -r requirements-dev.txt
pytest -q
python release_precheck.py
git status
git diff --cached --stat
```

确认暂存区只包含源码、公开文档和必要的静态资源。以下内容不得进入公开发布：数据库、Cookie、Token、密钥、浏览器档案、日志、验证截图、上传文件、导出物和本机构建产物。

桌面端发布必须分发完整的 `ShangjiaTool` 目录，并在干净的用户数据目录中完成启动和 `/health` 验证。构建成功不等同于第三方平台账号已连接或业务操作已成功。
