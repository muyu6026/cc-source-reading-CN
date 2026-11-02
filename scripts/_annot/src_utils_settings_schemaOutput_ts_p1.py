# 批注数据：source/src/utils/settings/schemaOutput.ts
ANNOTATIONS = [
    (1, 'before', '''文件级。把设置对象的结构（`SettingsSchema`）转成 JSON Schema 字符串，供 UI 或外部工具读取设置字段定义。'''),
    (8, 'after', '''调用 `toJSONSchema` 生成 schema 后用 `jsonStringify` 美化（两空格缩进）输出。'''),
]
