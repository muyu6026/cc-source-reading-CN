# -*- coding: utf-8 -*-
# src/utils/plugins/lspPluginIntegration.ts（387 行）批注数据
ANNOTATIONS = [
    (23, 'after', '''导入 zod、LSP 类型、插件类型与若干工具函数。'''),

    (28, 'after', '''`validatePathWithinPlugin` 防止通过 `..` 或绝对路径越权访问插件目录外。'''),

    (33, 'after', '''把插件路径与文件路径都解析为绝对路径以便比较。'''),

    (40, 'after', '''若相对路径以 `..` 开头或本身是绝对路径，判定为越界并返回 null。'''),

    (45, 'after', '''越界检查通过后返回插件内的绝对文件路径。'''),

    (57, 'after', '''`loadPluginLspServers` 从 `.lsp.json` 或清单 `lspServers` 字段加载服务器配置。'''),

    (64, 'after', '''先尝试读取插件目录下的 `.lsp.json` 文件。'''),

    (72, 'after', '''用 `LspServerConfigSchema` 校验解析结果，成功则并入服务器表。'''),

    (84, 'after', '''校验失败时记录错误并推入 `lsp-config-invalid` 错误条目。'''),

    (109, 'after', '''再检查清单里的 `lspServers` 字段并合并其服务器。'''),

    (121, 'after', '''有服务器时返回映射，否则返回 undefined。'''),

    (127, 'after', '''`loadLspServersFromManifest` 支持字符串/对象/数组多种声明格式。'''),

    (139, 'after', '''把声明归一化为数组逐个处理。'''),

    (142, 'after', '''字符串声明视为要加载的配置文件路径。'''),

    (144, 'after', '''先校验路径，阻断目录穿越尝试。'''),

    (160, 'after', '''加载并校验被引用的配置文件。'''),

    (201, 'after', '''内联配置直接逐项用 schema 校验。'''),

    (221, 'after', '''返回聚合后的服务器表或 undefined。'''),

    (229, 'after', '''`resolvePluginLspEnvironment` 解析插件 LSP 的环境变量。'''),

    (239, 'after', '''先替换插件专属变量。'''),

    (247, 'after', '''最后展开通用环境变量并记录缺失项。'''),

    (256, 'after', '''解析命令路径。'''),

    (261, 'after', '''解析参数数组。'''),

    (269, 'after', '''注入 `CLAUDE_PLUGIN_ROOT` 与 `CLAUDE_PLUGIN_DATA` 到环境变量。'''),

    (284, 'after', '''发现缺失环境变量时记录警告。'''),

    (291, 'after', '''返回完整解析后的配置。'''),

    (298, 'after', '''`addPluginScopeToLspServers` 给服务器名加插件前缀避免冲突。'''),

    (315, 'after', '''返回带作用域的服务器映射。'''),

    (322, 'after', '''`getPluginLspServers` 在激活时解析并加作用域。'''),

    (326, 'after', '''跳过被禁用的插件。'''),

    (332, 'after', '''优先使用已缓存的服务器，否则现加载。'''),

    (345, 'after', '''仅在清单声明 `userConfig` 时才加载用户配置，避免无谓的钥匙串读取与异常。'''),

    (354, 'after', '''逐个解析服务器环境。'''),

    (357, 'after', '''加作用域后返回。'''),

    (363, 'after', '''`extractLspServersFromPlugins` 跨插件聚合所有 LSP 服务器。'''),

    (370, 'after', '''跳过被禁用的插件。'''),

    (378, 'after', '''把服务器缓存回插件对象并记录加载数量。'''),

    (387, 'after', '''返回聚合后的全部服务器。'''),
]
