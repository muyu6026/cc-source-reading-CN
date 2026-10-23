# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (22, 'after', '''// VerificationStatus 五态：loading（待验证，apiKeyHelper 已配置未执行）/ valid / invalid / missing / error；ApiKeyVerificationResult 额外带 reverify 与 error。'''),
    (41, 'after', '''// 初始态：auth 关或 ClaudeAI 订阅者直接 valid；apiKeyHelper 配置但未执行（security：防 trust dialog 前经 settings.json 触发 RCE）则 loading；否则 missing。'''),
    (77, 'after', '''// verify：先 warm apiKeyHelper 缓存（未配置则 no-op）再读全源；无 key → missing / apiKeyHelper 报错 → error；verifyApiKey → valid / invalid；API 报错仍标 error 但记录 error 供展示（比静默更有帮助）。'''),
]
