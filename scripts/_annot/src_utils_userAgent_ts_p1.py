# 批注数据：source/src/utils/userAgent.ts
ANNOTATIONS = [
    (1, 'before', '''文件级。User-Agent 字符串辅助，刻意保持零依赖，方便桥接层和传输层引用而不牵动 `auth.ts` 那一整棵依赖树。'''),
    (10, 'after', '''返回形如 `claude-code/<版本号>` 的标识串，版本来自编译期宏 `MACRO.VERSION`。'''),
]
