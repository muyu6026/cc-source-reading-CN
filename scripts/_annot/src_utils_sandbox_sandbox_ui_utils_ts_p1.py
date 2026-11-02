# 批注数据：source/src/utils/sandbox/sandbox-ui-utils.ts
ANNOTATIONS = [
    (1, 'before', '''文件级。沙箱违规信息的 UI 展示辅助：把包裹在标签里的违规内容清掉，便于把报错原文干净地呈现给用户。'''),
    (11, 'after', '''用正则把 `<sandbox_violations>...</sandbox_violations>` 整段删掉（含换行），只留真正有用的报错信息。'''),
]
