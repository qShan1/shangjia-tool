# -*- coding: utf-8 -*-
"""闲鱼/淘宝 H5 mtop 客户端 appKey 统一入口。

说明: 这两个 key 均为 Taobao 官方 H5 客户端（goofish/taobao 前端 bundle）
公开发布的值，并非服务端密钥，泄露不构成凭证风险。此处集中管理是为了:
  1. 消除散落在 14 个文件里的硬编码副本（改一处即可全部生效）;
  2. 支持环境变量覆盖，部署时可整体替换而不改代码:

      TAOBAO_APP_KEY     -> 闲鱼 idlemessage/登录体系 appKey
                            默认 444e9908a51d1cb236a27862abc769c9
      TAOBAO_H5_APP_KEY  -> 通用 mtop H5 体系 appKey
                            默认 34839810
"""

import os

TB_IDLE_APP_KEY_DEFAULT = "444e9908a51d1cb236a27862abc769c9"
TB_H5_APP_KEY_DEFAULT = "34839810"

_TAOBAO_APP_KEY_ENV = "TAOBAO_APP_KEY"
_TAOBAO_H5_APP_KEY_ENV = "TAOBAO_H5_APP_KEY"


def get_idle_app_key() -> str:
    """闲鱼 idlemessage 体系 appKey（mtop.taobao.idlemessage.*）。"""
    return os.environ.get(_TAOBAO_APP_KEY_ENV, "").strip() or TB_IDLE_APP_KEY_DEFAULT


def get_h5_app_key() -> str:
    """通用 mtop H5 体系 appKey（mtop.* / h5api.m.goofish.com）。"""
    return os.environ.get(_TAOBAO_H5_APP_KEY_ENV, "").strip() or TB_H5_APP_KEY_DEFAULT