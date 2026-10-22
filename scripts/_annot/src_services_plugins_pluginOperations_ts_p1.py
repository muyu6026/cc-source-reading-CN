# 批注数据：source/src/services/plugins/pluginOperations.ts
# 格式：(行号, 'before'/'after'/'after_block', '中文批注')
# 行号一律指 source/ 原文；批注正文不写反斜杠。
# 注意：本文件多处 `const X =` 赋值跨多行（isOverride/isCurrentlyEnabled/isUpToDate），
# 锚点一律落在整条语句的末尾行，避免把赋值劈开（check-fidelity 硬判据）。
ANNOTATIONS = [
    (72, 'after',
     "可安装的三个 scope：user / project / local。注意不含 managed —— managed 插件只能由 managed-settings.json（企业下发）安装，用户命令装不了。这是 installable 与可更新 scope 的关键区别。"),

    (92, 'after',
     "assertInstallableScope：运行期校验 scope。TypeScript 的类型到这里就没了（用户从命令行传字符串），所以必须在入口处用 asserts 把非法 scope 挡下来，fail-fast。"),

    (106, 'after',
     "isInstallableScope：类型守卫版，用在条件块里做 narrowing。与上面那个 throw 版互补——一个用于入口校验，一个用于分支内收窄。"),

    (114, 'after',
     "getProjectPathForScope：project / local scope 是「跟着项目走」的，需要 original cwd 来区分同一插件在不同项目的安装；user scope 全局唯一，返回 undefined。"),

    (128, 'after',
     "isPluginEnabledAtProjectScope：卸载 UI 必须查这一项。V2 的 installed_plugins.json 记录「从哪装的」，但同一个插件还能在 project scope 被 settings 启用——「在 user scope 装、在 project scope 启用」时，卸载 user 安装会成功，而 project 启用还在，插件照跑。所以卸载前要单独查 settings 侧的启用态。"),

    (183, 'after',
     "findPluginInSettings：在所有可编辑 scope 里按名字找插件。带 @ 的输入当完整 pluginId 精确匹配；裸名字则匹配任意 `{name}@` 前缀的 key。返回「最具体的 scope」——优先级 local > project > user，先命中先返回。"),

    (209, 'after',
     "findPluginByIdentifier：在已加载插件列表里按标识找。先试裸名精确匹配；带了 marketplace 时再校验 p.source 里含 `@marketplace`，避免同名插件张冠李戴。"),

    (232, 'after',
     "resolveDelistedPluginId：插件被市场下架后的兜底。市场查不到时回退到 V2 installed_plugins.json——这份文件独立于市场状态，仍留有安装记录。先精确匹配，再按裸名模糊找。"),

    (261, 'after',
     "getPluginInstallationFromV2：从 V2 数据里挑「最相关」的那份安装。优先级：匹配当前项目的 local > 匹配当前项目的 project > user > 兜底第一份（可能是 managed）。project/local 的安装要按 projectPath 区分，同一插件在不同项目是不同的安装。"),

    (324, 'after',
     "installPluginOp：settings-first 的安装。顺序是 1)在市场里搜到插件 2)写 settings（这才是「声明意图」的那个动作）3)缓存插件 + 记版本提示（物化）。市场对账不是本函数的职责——声明了但没物化的市场由启动期 reconcile 兜；市场没搜到，「not found」就是正确报错。"),

    (372, 'after',
     "canonical pluginId 格式 = `{name}@{marketplace}`。这是插件在全系统里的唯一身份：settings 的 key、V2 installed_plugins.json 的 key、缓存目录名都用它。"),

    (431, 'after',
     "uninstallPluginOp：卸载。注意 deleteDataDir 默认 true（CLI 的 --keep-data 会翻成 false）。卸载不仅是删文件，还要把 settings、V2 记录、缓存孤儿、存储的 options/secrets 全部收口。"),

    (511, 'after',
     "从 settings 删 key 的技巧：置 undefined 而不是 delete。updateSettingsForSource 内部用 mergeWith 合并，undefined 是「删除」的信号——直接 delete 会在深层合并时失效。"),

    (536, 'after',
     "isLastScope 时的三重清理：deletePluginOptions（清 settings.pluginConfigs，含 MCPB Configure 流程遗留的 mcpServers 子键，以及 keychain 里的 pluginSecrets）+ deleteDataDir。这里故意不加 feature gate——pluginConfigs.mcpServers 当初是不门控写入的，清理也必须不门控，否则永远清不掉。"),

    (546, 'after',
     "反向依赖只警告不阻断。阻断卸载会造出「墓碑」——图里有个已下架插件时根本拆不动。真正的兜底在加载期 verifyAndDemote，那里才负责把跑不起来的依赖降级。"),

    (577, 'after',
     "setPluginEnabledOp：enable/disable 的共同实现。核心是「从 settings 解析 pluginId 与 scope」——不预检 installed_plugins.json：settings 声明意图，插件还没缓存的话下次加载自会缓存。"),

    (582, 'after',
     "内置插件走捷径：永远写 user scope settings，绕过整套 scope 解析 + installed_plugins 查找（它们根本不是「安装」的，是随 CLI 一起来的）。"),

    (653, 'after',
     "策略护栏：组织拉黑的插件在任何 scope 都不能启用。放在 pluginId 解析之后，才能同时抓住「完整标识」和「裸名查找」两种入口。"),

    (676, 'after',
     "isOverride：用户在写一个「更高优先级」的 scope 来盖住更低 scope 的启用态（例：disable --scope local 去压住 project 启用，而不动团队共享的 .claude/settings.json）。这时不算「写错 scope」，不该报错。"),

    (701, 'after',
     "isCurrentlyEnabled 的取值分三种情况：给了显式 scope 且非 override 时查那个 scope 的 settings 值（合并态会骗人——插件在别处启用、这里禁用时会误判）；否则用合并后的有效态。override 场景也必须用合并态，否则会读成「本就禁用」，而 override 的整个意义正是写一个显式 false 去盖住下面的 true。"),

    (712, 'after',
     "disable 时要在「写 settings、清记忆化缓存之前」抓一份反向依赖快照。清完缓存再查就查不到了——所以这个顺序不能反。"),

    (782, 'after',
     "disableAllPluginsOp：遍历所有可编辑 scope 里的启用项逐个 disable。注意它是「尽力而为」——收集失败项、统计成功数，最后统一汇报，不是全有或全无。"),

    (832, 'after',
     "updatePluginOp：更新。与 install/uninstall/enable/disable 不同，它允许 managed scope——托管插件也要能更新。"),

    (912, 'after',
     "performPluginUpdate：真正的「非原地更新」。远程插件先下到临时目录算版本；本地插件从市场源算。版本变了才拷进新的版本化缓存目录，然后更新磁盘 JSON（内存里的状态要到重启才变），旧版本没人引用时标孤儿。整个流程用 try/finally 保证临时目录一定清掉。"),

    (922, 'after',
     "远程 vs 本地分叉：entry.source 是字符串 = 本地路径，直接用市场目录拼；非字符串 = 远程源（git/zip 等），先 cachePlugin 下载到临时目录，并顺手记下 gitCommitSha——git-subdir 源的 .git 在提取子目录时被丢掉，不在这里抓住 SHA，后面 calculatePluginVersion 的 installPath 兜底就找不回来了。"),

    (1020, 'after',
     "isUpToDate 的三重判等：版本号相同、installPath 已是版本化目录、或 installPath 已是 zip 缓存——任一命中就报「已是最新」，不重复拷贝。这是更新操作的幂等短路。"),
]
