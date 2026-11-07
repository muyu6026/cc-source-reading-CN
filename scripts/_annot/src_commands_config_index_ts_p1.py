# 批注数据：src/commands/config/index.ts
ANNOTATIONS = [
    (1, 'after', '''`/config` 命令的注册入口，元数据在此声明，面板实现在 `config.tsx` 中懒加载。'''),
    (4, 'after', '''`aliases` 列表含 `settings` 这个别名，输入 `/settings` 也能打开同一配置面板。'''),
    (9, 'after', '''`type` 取值 `local-jsx` 配合 `satisfies Command`，保证命令字段在编译期就被类型系统校验。'''),
]
