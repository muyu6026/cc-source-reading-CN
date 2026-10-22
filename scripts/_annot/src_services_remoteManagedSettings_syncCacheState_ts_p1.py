ANNOTATIONS = [
    (23, 'after',
     "这个文件是纯叶子：只 import path / envUtils / file / json / settingsCache 这些不碰 auth 的模块。\n"
     "拆出来的动机写在文件头——settings.ts → syncCache.ts → auth.ts → settings.ts 这个环，\n"
     "auth.ts 坐在大的 settings SCC 里，从 settings.ts 自己的依赖链 import 它会把几百个模块\n"
     "拉进启动期（eagerly-evaluated）的 SCC。拆开后 settings.ts 从叶子读缓存，环就断了。"),

    (33, 'after',
     "缓存文件名 remote-settings.json，放在 Claude config home 下（~/.claude/ 一类）。\n"
     "两个模块级状态：sessionCache（本次进程的设置快照）和 eligible（三态资格镜像）。"),

    (35, 'after',
     "eligible 是三态而不是布尔：undefined = 还没判定过（读取时返回 null，不瞎猜）、\n"
     "false = 判定不合格、true = 放行。为什么需要 undefined：\n"
     "managedEnv.ts 在 policySettings 读取前一刻才调 isRemoteManagedSettingsEligible()，\n"
     "那时 userSettings/flagSettings 的环境变量已经应用，检查能看到 config 提供的\n"
     "CLAUDE_CODE_USE_BEDROCK / ANTHROPIC_BASE_URL——判定时机比「启动时」晚，是有意的。"),

    (49, 'after',
     "setEligibility 把判定结果 mirror 进叶子并原样返回——就是为了让 syncCache.ts 能写\n"
     "return (cached = setEligibility(x)) 这种一行双存的惯用法（见该文件 112 行）。"),

    (53, 'after',
     "getSettingsPath 每次现拼（不缓存）——config home 可能被测试改来改去，缓存路径会踩到别的水准下。"),

    (68, 'after',
     "loadSettings 是同步 IO：settings 管线整体是同步的（getSettings() 到处被同步调用），\n"
     "异步化代价太大。注释点明了为什么用 fileRead/jsonRead 而不是 file.ts/json.ts——\n"
     "后两个坐在 settings SCC 里，从叶子 import 它们等于把环再请回来。\n"
     "任何异常（不存在/坏 JSON/不是对象）都归一到 null：缓存读不出来就当没有。"),

    (70, 'before',
     "getRemoteManagedSettingsSyncFromCache 是全子系统唯一的读取入口，settings.ts 和 index.ts 都走它。\n"
     "内部顺序：三态门 → 进程内缓存 → 读盘 → 首次命中时冲合并缓存。"),

    (71, 'after',
     "三态门：eligible 不是 true 就返回 null。undefined（没判定过）和 false（不合格）对读取方是同一回事——\n"
     "都表示「现在没有远程设置可用」。注意这句也防了「判定前误读」。"),

    (96, 'after',
     "第一次从磁盘读到远程设置时，必须 resetSettingsCache() 冲掉已合并的缓存。原因：\n"
     "在此之前（eligible 还不是 true）任何 getSettings_DEPRECATED() 的合并结果都缺 policySettings 这一层，\n"
     "不冲掉的话下游会一直用那份「缺层」的合并结果。\n"
     "最多触发一次（之后命中上面的 sessionCache 分支）。\n"
     "注释里记了 gh-23085：isBridgeEnabled() 在 main.tsx Commander 定义阶段（早于 preAction → init() →\n"
     "isRemoteManagedSettingsEligible()）就在 auth.ts:115 调了 getSettings_DEPRECATED()，\n"
     "bridgeEnabled 的 try/catch 吞了后来 getGlobalConfig() 的抛错，但合并缓存已被污染——\n"
     "这个 reset 就是堵这个洞的补丁，回归测试在 managedSettingsHeadless.int.test.ts。"),
]
