# 数据文件：source/src/commands/upgrade/upgrade.tsx
ANNOTATIONS = [
    (1, 'after', """/upgrade 命令：已是最高的 Max 20x 订阅则提示无需升级；否则打开浏览器到升级页，并用登录组件完成切换 API 计费账户。"""),
    (9, 'after', """命令入口：先检查是否已是最高档 Max 订阅。"""),
    (12, 'after', """仅对 Claude AI 订阅用户做最高档判断。"""),
    (15, 'after', """从令牌字段或 OAuth profile 判断是否为 max + 20x 档。"""),
    (21, 'after', """已是 20x 则延迟回调提示并返回，不打浏览器。"""),
    (26, 'after', """否则打开升级页并渲染登录组件，登录成功后切换 API 密钥。"""),
    (32, 'after', """失败则提示手动访问升级链接。"""),
]
