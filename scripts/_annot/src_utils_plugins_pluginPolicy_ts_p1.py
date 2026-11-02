# -*- coding: utf-8 -*-
# slug: src_utils_plugins_pluginPolicy_ts  | source: src/utils/plugins/pluginPolicy.ts
ANNOTATIONS = [
    (1, 'before', '''本文件用「托管设置」（policySettings）实现插件策略校验，作为组织策略拦截插件的唯一真相来源。'''),
    (9, 'after', '''本模块只引入 settings 一个依赖，保持叶子模块身份，避免与 marketplaceManager 等形成循环依赖。'''),
    (20, 'after', '''isPluginBlockedByPolicy 读取 policySettings 下 enabledPlugins 中该插件的值；若为 false 即被策略强制禁用，任何作用域都不可安装或启用。'''),
]
