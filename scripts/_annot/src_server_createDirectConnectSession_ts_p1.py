# -*- coding: utf-8 -*-
# 第 167 批：src/server/createDirectConnectSession.ts 批注数据
ANNOTATIONS = [
    (1, 'after', '''eslint 禁用 node-builtins 规则：本文件用到 Node 内置能力，先关掉那条 lint。'''),
    (7, 'after', '''依赖：错误文案、JSON 序列化、直连配置类型、响应 schema。'''),
    (11, 'after', '''DirectConnectError：业务错误类型，固定 name 方便上层区分网络、HTTP、解析失败。'''),
    (39, 'after', '''主函数签名收尾：serverUrl、token、cwd、跳过权限四参，返回 config 与可选 workDir。'''),
    (45, 'after', '''鉴权头：有 token 就加 Bearer，否则留空，统一从 headers 表取值。'''),
    (63, 'after', '''网络层：fetch 失败包成 DirectConnectError，带服务器地址与底层错误。'''),
    (69, 'after', '''HTTP 状态：非 2xx 也抛错，文案含状态码与状态文本。'''),
    (76, 'after', '''响应解析：zod 安全解析，失败报「非法响应」并附错误信息。'''),
    (88, 'after', '''收尾：映射出 config（sessionId、wsUrl、authToken）与 workDir 返回；所有异常路径都走 DirectConnectError，调用方只需 try/catch 一类错误。'''),
]
