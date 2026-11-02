ANNOTATIONS = [
    (1, 'before', '''文件级批注：`managedPlugins.ts` 从组织策略设置（`policySettings.enabledPlugins`）中读出被锁定的插件名集合，供强制启用/禁用插件的策略使用。'''),
    (9, 'before', '''函数签名：返回被策略锁定的插件名集合（`Set<string>`），若策略未声明任何插件项则返回 `null`（常见情况：无策略生效）。'''),
    (27, 'after', '''函数收尾：仅保护 `plugin@marketplace` 布尔条目（true/false 均算），旧式 owner/repo 数组形式不保护；集合为空也返回 `null`。'''),
]
