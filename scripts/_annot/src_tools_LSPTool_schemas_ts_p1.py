# -*- coding: utf-8 -*-
# LSPTool/schemas.ts 批注数据
ANNOTATIONS = [
    (7, 'after', '''判别联合是本工具真正使用的 schema——LSPTool.ts 里的普通 strictObject 只是工具框架的兼容壳，真正校验在这里做，按 operation 分支给出精确报错。'''),
    (190, 'after', '''九个操作共享同一组字段（filePath/line/character），唯独 operation 字面量不同——判别联合的标准形态，zod 能按 literal 直接定位到具体分支。'''),
    (215, 'after', '''isValidLSPOperation 是给非 zod 场景（UI、日志等）用的字符串白名单守卫，与上面的联合保持同一份清单——手工同步，没有从 schema 反推。'''),
]
