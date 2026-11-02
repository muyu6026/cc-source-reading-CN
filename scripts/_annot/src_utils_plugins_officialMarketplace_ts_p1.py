ANNOTATIONS = [
    (1, 'before', '''文件级批注：`officialMarketplace.ts` 定义官方 Anthropic 插件市场的常量，包括市场来源配置与显示名，供启动时自动安装与识别使用。'''),
    (15, 'before', '''声明官方市场来源：指向 `anthropics/claude-plugins-official` 这个 GitHub 仓库，并用类型断言锁定结构。'''),
    (18, 'after', '''收尾：以 `satisfies` 校验该对象符合 `MarketplaceSource` 形状，确保来源字段合法。'''),
    (25, 'after', '''收尾：导出官方市场的显示名，用于写入 `known_marketplaces.json` 时的注册键。'''),
]
