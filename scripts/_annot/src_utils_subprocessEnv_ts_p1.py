# 批注数据：src/utils/subprocessEnv.ts
ANNOTATIONS = [
    (15, 'after', '''GitHub Actions 场景下需从子进程环境剥离的敏感变量清单：Anthropic 凭证、OTLP 导出头、云厂商密钥、OIDC 与运行时令牌等。'''),
    (67, 'after', '''由 init.ts 在 upstreamproxy 懒加载后注册代理环境函数，子进程启动前必须调用。'''),
    (73, 'after', '''注册函数：把代理环境函数挂到内部变量，供 subprocessEnv 调用。'''),
    (79, 'after', '''子进程环境组装：注入 CCR 代理变量；未开启清洗时原样透传，开启时剔除敏感变量及其 INPUT_ 副本。'''),
    (92, 'after', '''开启清洗时逐条删除机密与对应的 INPUT_ 形式（GitHub 自动为 with 输入生成的副本）。'''),
]
