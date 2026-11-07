# 批注数据：src/commands/diff/index.ts
ANNOTATIONS = [
    (1, 'after', '''`/diff` 命令的注册入口，既看未提交的改动，也看逐轮对话产生的差异。'''),
    (6, 'after', '''描述点明命令的双重职责：查看工作区未提交变更，以及按对话轮次回看 diff。'''),
    (8, 'after', '''`export default { ... } satisfies Command` 直接导出匿名命令对象并用 `satisfies` 校验形状。'''),
]
