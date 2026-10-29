# -*- coding: utf-8 -*-
SOURCE_PATH = 'src/utils/model/validateModel.ts'
ANNOTATIONS = [
    (12, 'after', '''validateModel 通过一次真实 API 调用验证模型是否有效，结果按模型名缓存，避免重复请求。'''),
    (15, 'after', '''validModelCache 是模型名到有效性的内存缓存。'''),
    (20, 'before', '''validateModel 主流程：先空串检查，再对照可用模型白名单，再处理别名与用户预置的自定义模型，最后才发真实请求。'''),
    (82, 'after', '''validateModel 结束：请求成功即标记缓存有效并返回 true，失败交给 handleValidationError 归类。'''),
    (84, 'before', '''handleValidationError 把各类异常翻译成用户可读的错误信息。'''),
    (138, 'after', '''handleValidationError 结束：404 给「未找到」并附 3P 回退建议，鉴权/连接错误分别提示，未知错误保守地拒绝。'''),
    (159, 'after', '''get3PFallbackSuggestion 为三方用户在模型不可用时推荐上一版本等价模型（opus-4-6 对应 opus4.1、sonnet-4-6 对应 sonnet4.5 等），一方用户不提供建议。'''),
]
