# -*- coding: utf-8 -*-
"""FileReadTool.ts 批注数据（源行号，锚点全部落在语句边界）"""

ANNOTATIONS = [
    (97, 'after',
     "设备黑名单，判据是「**读它会不会挂住进程**」，不是「它是不是特殊文件」。两类必拦：无限输出（`/dev/zero`、`/dev/random`、`/dev/full` 永远读不到 EOF，`readFile` 会一直吃内存直到 OOM）和阻塞等待输入（`/dev/stdin`、`/dev/tty`、`/dev/console` 会让工具调用永久卡住，而工具调用卡住 = 整个 agent 主循环卡住，用户只能 Ctrl-C）。`/dev/null` 故意不列 —— 它立即 EOF，读它无害。这就是为什么这里用「显式名单」而不是「`/dev/` 前缀全拦」：前缀全拦会误伤大量安全设备。"),

    (128, 'after',
     "两条规则：① 精确名单（`BLOCKED_DEVICE_PATHS.has`）；② 前缀 + 后缀组合匹配 —— `/proc/self/fd/0`、`/proc/1234/fd/1` 这类是 Linux 上 stdin/stdout/stderr 的另一种写法，PID 可变所以不能进精确名单。整个判定**纯字符串、零 I/O**，这点是刻意的：它在 `validateInput` 里跑，而 `validateInput` 的契约是「不碰文件系统」（见后面 `validateInput` 结尾的批注）。"),

    (146, 'after',
     "macOS 截图路径的字符级陷阱。同一个 macOS 版本不同，截图文件名里 AM/PM 前面的那个空格可能是普通空格 U+0020，也可能是窄不换行空格 U+202F —— 肉眼在终端里完全看不出区别，但 `stat` 会直接 ENOENT。所以模型从用户那里抄来的路径有一半概率打不开，而错误信息只会说「文件不存在」，看起来像模型编了个路径。"),

    (163, 'after',
     "文件读监听器。这不是通用扩展点，目前**只有 `MagicDocs` 用**：Magic Doc 的「零配置登记」全靠它 —— 用户不用声明任何东西，只要这个文件被 Read 过一次，MagicDocs 就知道它该被维护（见 `services/MagicDocs/magicDocs.ts` 的 `registerFileReadListener` 调用）。所以这个数组为空是常态，不要以为没人用就删掉。"),

    (185, 'after',
     "token 超限错误的文案本身就是**操作指南**：说清「当前多少 token / 上限多少」，然后给三条出路（用 offset+limit 读片段、或者干脆改用搜索而不是整读）。错误信息写得好不好，直接决定模型下一步是「换个方法」还是「原地重试同一个调用」。"),

    (194, 'after',
     "这个函数只为**遥测**服务，不参与任何逻辑分支 —— 它的产出只有 `is_session_memory` / `is_session_transcript` 两个布尔。两道前置限制：① 必须在 `~/.claude` 配置目录内（否则用户项目里恰好有个 `projects/xxx.jsonl` 也会被算成会话转录）；② 路径先归一成正斜杠再匹配（Windows 上 `win32.sep` 是反斜杠，不归一则 `/session-memory/` 永远匹配不上）。"),

    (243, 'after',
     "入参只有四个，但每个都带**条件说明**而不是干巴巴的类型：`offset` / `limit` 都写着「只在文件太大时提供」——因为默认行为（整读）才是最优路径，一旦模型养成每次都带 offset 的习惯，就会为了「保险」把文件切成七八段读，反而多烧 token。`pages` 只对 PDF 有效，上限 20 页写进了描述里。`semanticNumber` 包一层是因为模型有时会把数字写成字符串（`\"100\"`），这个包装做宽松解析。"),

    (332, 'after',
     "输出是**六型判别联合**（`text` / `image` / `notebook` / `pdf` / `parts` / `file_unchanged`）。这个联合类型不是摆设，后面 `mapToolResultToToolResultBlockParam` 的 switch 必须穷举六支，TypeScript 会在漏分支时报错。特别注意 `file_unchanged`：它不是错误、也不是空文件，而是「去重命中」的专用出口 —— 它有独立的一支渲染（灰色 `Unchanged since last read`），绝不会被当成读取失败。"),

    (341, 'after',
     "`maxResultSizeChars: Infinity` 是**故意关掉落盘**。通用机制是「工具结果太大就写进临时文件，让模型自己 Read 回来」，但对 Read 工具这个策略是循环的：它读出来的东西再写盘、再读回，等于把同一份内容过两遍，还多一次工具调用。而 Read 的输出本来就有 `maxTokens`（默认 25,000）兜底，尺寸天然有界，所以这里直接声明「永不落盘」。"),

    (360, 'after',
     "prompt 是**运行时拼**的，不是常量字符串：① `maxSizeInstruction` 只在开关打开时出现（告诉模型 256KB 上限，让它知道该用 offset）；② `offsetInstruction` 有两套文案 —— 默认版说「建议整读」，targeted 版说「已知要哪段就只读那段」，由 GrowthBook 按用户行为切；③ 行号格式那行永远是固定的 `cat -n`。三段都塞进 `renderPromptTemplate` 的插值位。"),

    (413, 'after',
     "`extractSearchText` 返回空串，且上面那七行注释专门解释为什么。UI 层（`UI.tsx`）对所有类型只渲染摘要 chrome —— `Read 42 lines`、`Read image (42KB)` —— **从不渲染文件内容**。而模型侧序列化（下面 `mapToolResultToToolResultBlockParam`）发的是内容 + 行号前缀 + 安全提醒。两者用的根本不是同一份数据，所以这里没有「可索引的文本」。注释里记着：最初这里返回 `file.content`，被 render-fidelity 测试抓出来了。"),

    (462, 'after',
     "**安全补丁，顺序敏感**：UNC 路径（`\\\\server\\share` 或 `//server/share`）必须在**任何文件系统操作之前**短路返回。原因写在注释里 —— Windows 上对 UNC 路径做 `stat`，系统会主动向那台服务器发起 SMB 认证，把当前用户的 NTLM 哈希发出去。一个模型随手编的路径就能变成凭据泄露，所以这里宁可「放行到后面再报错」，也绝不在这里碰文件。"),

    (492, 'after',
     "`validateInput` 的五道检查全部**零 I/O**，这是这份文件最重要的架构约束：pages 格式（纯字符串解析）→ deny 规则（查内存里的权限配置）→ UNC 短路（前缀判断）→ 二进制扩展名（`path.extname`）→ 设备文件（集合查询）。一行文件系统调用都没有，所以它能在「用户还没授权」的阶段安全执行完。真正的 `stat` / `read` 全部推迟到 `call()`，也就是授权之后。"),

    (520, 'after',
     "`expandPath` 必须和 `FileEditTool` / `Write` 用同一个，注释点明了两件事：**空白裁剪**（用户复制路径时常带尾随空格或换行）和 **Windows 路径分隔符**。这不是代码复用的洁癖 —— `readFileState` 的 key 就是 `expandPath` 的结果，三个工具如果归一化方式不一致，同一次读取会存成两个 key，`Edit` 的「必须先 Read」检查就会误判成「没读过」。"),

    (535, 'after',
     "去重开关 + 一整套数据支撑，注释里全是实测数字，很值得看这种「用遥测算收益」的写法：BQ 代理数据显示 **约 18% 的 Read 调用是同文件碰撞**，最多占整个舰队 `cache_creation` 的 2.64% —— 因为上一次的 `tool_result` 还在上下文里，再发一份全文等于每轮都多付一次缓存写入。内部 soak 2 小时命中 1,734 次、无 Read 报错回归。所以默认**开启**，但留了 GrowthBook killswitch：万一外部模型被这个桩消息搞糊涂，可以远程关掉（客户端逻辑，Bedrock/Vertex/Foundry 都能用）。"),

    (546, 'after',
     "去重前必须确认「这条状态是 Read 写的」。判据是 `offset !== undefined` —— Read 总是设置 offset（默认 1），而 `Edit` / `Write` 存进 `readFileState` 的条目 offset 是 `undefined`、且 mtime 是**编辑之后**的。如果拿 Edit 的条目来做去重，就会告诉模型「内容没变，去看之前那次 Read 的结果」，而那次 Read 拿到的是**编辑前**的内容。这个 bug 的表现是「模型坚信文件里还是旧代码」。`isPartialView` 也要排除：部分视图本来就不能代表全文。"),

    (573, 'after',
     "命中：先 `stat` 一次拿 mtime，和记录的时间戳**严格相等**才返回桩。三点讲究：① 用 `mtime === 记录值` 而不是「文件没被改过」的模糊判断，宁可多读一次也不能给旧内容；② `stat` 失败时 `fall through` 到完整读取（`catch {}` 里什么都不做）—— 去重是优化，不能因为它失败就让读取失败；③ 返回的 `type` 是 `file_unchanged`，配合 `FILE_UNCHANGED_STUB` 那句「内容还在上下文里，别重读」，让模型自己省下这次调用。"),

    (591, 'after',
     "顺带发现 skills：读一个文件可能触发「这个路径下藏着 skill 目录」的探测。三个细节 —— `CLAUDE_CODE_SIMPLE` 模式下整段跳过（simple 模式没有 skills）；`addSkillDirectories` 是 fire-and-forget（`.catch(() => {})`），技能加载慢不能拖住一次文件读取；`activateConditionalSkillsForPaths` 是按路径模式激活条件技能，这是「读到了某个目录的文件 ⇒ 该目录对应的 skill 生效」的机制。"),

    (650, 'after',
     "ENOENT 的三连补救，按「越可能、越便宜」排序：① **macOS 截图空格**（前面 `getAlternateScreenshotPath`）—— 换一个空格字符重试一次，第二个 catch 里如果不是 ENOENT 就直接上抛，说明是两个不同的问题；② **同目录相似文件名**（`findSimilarFile`，处理拼写错误）；③ **cwd 内的建议路径**（`suggestPathUnderCwd`，处理「模型给了相对路径 / 给了别的项目里的路径」）。最终错误信息里带上当前 cwd —— 模型最常见的错就是假设了一个不存在的 cwd。"),

    (716, 'after',
     "六型映射到这里分道扬镳，这是理解 Read 输出的关键：**image** 直接变成 base64 的 image block（模型真的「看见」图）；**notebook** 走 `mapNotebookCellsToToolResult`；**pdf** 的 `tool_result` 只有一行元数据 —— 真正的 PDF 内容是通过 `newMessages` 里的 document block 附上去的；**parts**（抽页成图）同理，图片在 `newMessages` 里；**file_unchanged** 只有那句桩文案；**text** 才走内容分支，且内容是「新鲜度前缀 + 行号 + 安全提醒」三段拼起来的。"),

    (753, 'after',
     "一个 `WeakMap` 侧信道，解决的问题很具体：`call()` 里知道 auto-memory 文件的 mtime，但 `mapToolResultToToolResultBlockParam` 只有 `data` 对象、拿不到 mtime，而渲染时又要用它生成「这个记忆文件是多久前写的」提示。三条路都不通 —— 加进 output schema 会污染 SDK 类型；在 mapper 里同步 `stat` 会阻塞；塞进模块级变量会串号。所以用 `WeakMap` 以 `data` 对象身份为 key：data 渲染完被 GC，条目自动消失，不会泄漏。"),

    (772, 'after',
     "token 校验的**四级递进**，核心是「别为小文件付一次 API 往返」：① 先用 `roughTokenCountEstimationForFileType` 粗估（本地、免费，按扩展名给不同系数）；② 粗估不超过上限的 1/4 就直接放行 —— 留 4 倍余量是因为粗估对中英混排、压缩代码、base64 都可能低估；③ 超过才调 `countTokensWithAPI` 拿精确值；④ 精确值也拿不到（API 失败返回 null）就退回粗估值。默认上限 25,000。"),

    (863, 'after',
     "notebook 超限时**直接把 jq 命令写进错误信息**，四条现成可用。这是「错误信息即工具推荐」的典型：模型本来不知道 `.ipynb` 是 JSON、更不会想到用 `Bash` + `jq` 分片读，与其让它干瞪眼，不如把命令抄给它。注意这里走的是 `BASH_TOOL_NAME` 常量拼接（不硬编码 `Bash`），因为不同构建里工具名可能变。"),

    (946, 'after',
     "PDF 指定页分支的收尾。三个细节：① 抽出来的页图按**文件名排序**（`.sort()`）—— 抽取工具输出的文件名里带页号，不排序会拿到乱序的图片，模型读出来的故事线就是错的；② 每张都过一遍 `maybeResizeAndDownsampleImageBuffer`，因为单页渲染出来可能是 2000px 宽；③ 所有图一次性塞进**一条** `isMeta: true` 的用户消息，而不是每页一条 —— 后者会让上下文里出现一堆碎消息块。"),

    (1028, 'after',
     "文本分支的唯一一次读盘，参数里有两处容易看漏的逻辑：① `offset === 0 ? 0 : offset - 1` —— 对外的 offset 是 1-indexed，内部是 0-indexed，但 `offset: 0` 被特判成 0（模型给 0 时按「从开头读」处理，而不是算出 -1）；② **只有 `limit === undefined` 时才传 `maxSizeBytes`** —— 因为给了 limit 就说明模型主动要一个片段，这时候再拿「整文件大小」卡它就没意义了（`limits.ts` 里记着这个已知不匹配）。abort signal 也一并传进去，长读可以被 Ctrl-C 打断。"),

    (1044, 'after',
     "遍历前先 `.slice()` 快照，注释解释了原因：监听器回调里如果取消订阅（`registerFileReadListener` 返回的函数就是 `splice`），会就地修改正在被 `forEach` 的数组，**下一个监听器就被跳过了**。这是 JS 里最经典的边遍历边改集合 bug，改法只有两种（倒序遍历或先拷贝），这里选了拷贝。"),

    (1086, 'after',
     "`callInner` 收尾。三条分支（notebook / image / text）在各自返回前都做了同样三件事，这就是它们共同的契约：① `readFileState.set`（去重和 Edit 的前置检查都依赖它，**key 必须是 `expandPath` 后的全路径**）；② `nestedMemoryAttachmentTriggers?.add`（让上层知道该把这个文件挂进嵌套记忆）；③ `logFileOperation`（审计层面的文件操作日志，和遥测是两套）。PDF 分支不写 `readFileState` —— 它不是文本，不参与去重。"),

    (1180, 'after',
     "图片压缩的**三级降级链**，每一级都从同一份 buffer 出发、绝不重读文件：① 标准缩放（`maybeResizeAndDownsampleImageBuffer`），失败则降级成原图（但 `ImageResizeError` 要上抛，那是「这根本不是图片」）；② 估算 `base64.length * 0.125` 超预算，就调 `compressImageBufferWithTokenLimit` 按目标 token 反推质量；③ 那也失败，就 `sharp` 硬压到 400×400 / quality 20。全部失败则返回原图 —— 宁可让模型看一张可能超预算的图，也不能因为压缩失败就说「读不了」。"),
]
