ANNOTATIONS = [
    (1, 'after', '''本文件定义状态栏通知（status notice）的各类声明与渲染逻辑，均面向 Ink 终端 UI。'''),
    (17, 'after', '''StatusNoticeType 区分通知语义为警告或普通信息。'''),
    (22, 'after', '''StatusNoticeContext 聚合通知判断与渲染所需的配置、智能体定义与内存文件信息。'''),
    (28, 'after', '''StatusNoticeDefinition 描述单条通知：唯一 id、类型、是否激活的判定函数与 Ink 渲染函数。'''),
    (52, 'after', '''largeMemoryFilesNotice：当存在超大内存文件时发出性能警告，提示用 `/memory` 编辑。'''),
    (71, 'after', '''claudeAiSubscriberExternalTokenNotice：当订阅用户却用外部 token 鉴权时提示冲突。'''),
    (97, 'after', '''apiKeyConflictNotice：当同时存在 API key 与订阅 token 时提示用 Claude 账户订阅 token 的冲突。'''),
    (139, 'after', '''bothAuthMethodsNotice：当 token 与 API key 同时设置时给出分情形处理建议的冲突提示。'''),
    (159, 'after', '''largeAgentDescriptionsNotice：累计智能体描述过大（超阈值）时提示影响性能，引导用 `/agents` 管理。'''),
    (189, 'after', '''jetbrainsPluginNotice：在 JetBrains 内置终端且未装插件时，提示从市场安装对应插件。'''),
    (192, 'after', '''statusNoticeDefinitions 汇总全部通知定义，供运行时筛选与渲染。'''),
    (197, 'after', '''getActiveNotices 收尾：根据上下文过滤出当前应当展示的通知列表。'''),
]
