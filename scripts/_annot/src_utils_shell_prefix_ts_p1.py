# -*- coding: utf-8 -*-
# src/utils/shell/prefix.ts（367 行）批注数据
ANNOTATIONS = [
    (28, 'after', '''`DANGEROUS_SHELL_PREFIXES` 列出绝不可作为裸前缀接受的 shell 可执行文件，避免绕过权限系统。'''),

    (45, 'after', '''危险前缀集合结束。'''),

    (49, 'after', '''`CommandPrefixResult` 定义命令前缀提取结果结构。'''),

    (59, 'after', '''`CommandSubcommandPrefixResult` 在前者基础上增加子命令前缀映射。'''),

    (78, 'after', '''`PrefixExtractorConfig` 配置提取器：工具名、策略说明、事件名、查询源与可选预检函数。'''),

    (92, 'after', '''`createCommandPrefixExtractor` 工厂，创建带双层记忆化的前缀提取器。'''),

    (122, 'after', '''记忆化仅以命令字符串为键，上限 200 条防止会话中无限增长。'''),

    (126, 'after', '''工厂返回记忆化后的提取函数。'''),

    (138, 'after', '''`createSubcommandPrefixExtractor` 为复合命令构建子命令前缀提取器。'''),

    (170, 'after', '''子命令提取器工厂结束。'''),

    (114, 'after', '''失败时从缓存移除该条目，并用身份守卫防止误删已被新 Promise 占用的键。'''),

    (158, 'after', '''子命令提取器同样在拒绝时清理缓存。'''),

    (181, 'after', '''`getCommandPrefixImpl` 实现：调用 Haiku 大模型提取命令前缀。'''),

    (183, 'after', '''测试环境下直接返回 null，跳过模型调用。'''),

    (187, 'after', '''先执行预检（如 Bash 的 isHelpCommand）以短路 Haiku 调用。'''),

    (194, 'after', '''设置预检超时计时器，耗时过长时输出告警。'''),

    (215, 'after', '''读取特性开关决定是否采用系统提示策略写法。'''),

    (220, 'after', '''调用 queryHaiku 得到候选前缀。'''),

    (245, 'after', '''查询完成后清除超时计时器并记录耗时。'''),

    (254, 'after', '''从响应中取出前缀文本，兼容字符串或数组内容。'''),

    (256, 'after', '''前缀是 API 错误前缀时记录事件并置空。'''),

    (264, 'after', '''模型检测到命令注入特征时按无前缀处理。'''),

    (275, 'after', '''绝不接受裸 git 或 shell 可执行文件作为前缀。'''),

    (289, 'after', '''前缀为 none 时记录并返回空。'''),

    (300, 'after', '''校验前缀确实是指令开头，否则记录并返回空。'''),

    (325, 'after', '''返回最终提取结果。'''),

    (330, 'after', '''`getCommandPrefixImpl` 结束。'''),

    (338, 'after', '''`getCommandSubcommandPrefixImpl` 实现子命令前缀提取。'''),

    (339, 'after', '''先用 splitCommand 拆出子命令。'''),

    (341, 'after', '''并行获取整体与每个子命令的前缀。'''),

    (349, 'after', '''整体无前缀时整体返回 null。'''),

    (361, 'after', '''汇总子命令前缀并返回完整结果。'''),
]
