"""批注数据：src/tools/GlobTool/GlobTool.ts（198 行）"""

ANNOTATIONS = [
    (59, 'after', "只读三件套的最后定位补齐：Read 读单文件、Grep 按内容找、Glob 按「名字模式」找。底层是 utils/glob.js 的封装，返回结果按修改时间排序（新改的排前面）——这样模型拿到的前几条大概率就是刚动过的文件。"),
    (60, 'after', "结果体积上限 100,000 字符，是 GrepTool（20,000）的五倍。原因很直接：glob 结果一行一个路径、天然短小，不像 grep content 模式会带回整行代码，所以阈值可以放宽。超过上限的结果会落盘（同 Read 的机制）。"),
    (78, 'after', "isConcurrencySafe = true：只读、无副作用，可以和其他工具并行执行，调度器不必为它串行排队。isReadOnly 同样为 true——这两开关合在一起，决定了它不会触发权限弹窗确认以外的任何用户交互。"),
    (87, 'after', "isSearchOrReadCommand 给自动分类器打标：这是一次「搜索」而非「读取」。分类结果会影响 UI 呈现与缓存策略（搜索结果不值得像读取那样做去重桩）。"),
    (93, 'after', "preparePermissionMatcher 把输入里的 pattern 交给 matchWildcardPattern——也就是说 Glob 的路径权限复用了 shell 通配规则那一套（如 Read(./src/**) 这类规则可以同时约束住 Glob 的搜索范围），不用为 glob 单写一套权限语义。"),
    (94, 'after', "validateInput 这里是有 I/O 的（stat），和 FileReadTool 的「五道零 I/O 检查」不同——因为这里的检查对象是用户给的目录参数本身，不做 stat 就没法给出「目录不存在 / 不是目录」的精确报错。UNC 检查仍然排在第一个 stat 之前。"),
    (103, 'after', "UNC 路径在任何 fs 操作之前短路——理由与 FileReadTool / FileEditTool 完全相同：Windows 上 stat 一个 \\\\server\\share 会主动发起 SMB 认证、泄露 NTLM 哈希。这里同时覆盖 \\\\ 与 // 两种写法。注意短路是「直接放行」，把校验责任推给了后续 glob 执行。"),
    (110, 'after', "ENOENT 时的补救与 FileReadTool 同思路：调 suggestPathUnderCwd 在 cwd 下找相近路径，拼进报错让模型自己纠正（「Did you mean …?」）。模型常见的毛病是拿绝对路径或编造目录，这句提示能省一轮重试。"),
    (130, 'after', "路径存在但不是目录 → errorCode 2。注意 GrepTool 的 validateInput 没有这一步——因为 rg 的 PATH 参数允许直接指向单个文件，而 glob 的基准必须是目录。两个孪生工具在这类细节上的分化都是有意的。"),
    (153, 'after', "extractSearchText 直接返回 filenames 换行拼接。上方英文注释说明了复用关系：Glob 的结果渲染直接用 GrepTool 的实现（UI.tsx 里一行赋值），durationMs / numFiles 属于「Found 3 files」这类装饰性统计，漏掉不算幻影计数（under-count, fine）。"),
    (157, 'after', "默认上限 100 个文件（globLimits 可覆盖）。截断信息放进输出（truncated 字段），让模型知道该收窄 pattern 而不是以为「就这么多文件」。"),
    (166, 'after', "结果路径转相对路径省 token——注释明说「same as GrepTool」，两个搜索工具在这条省钱规矩上保持一致（cwd 下的路径去掉前缀）。"),
    (184, 'after', "空结果是文本「No files found」而不是空串——给模型一个明确的「搜到了但没匹配」信号，和 Grep 三个模式的空结果文案保持同一措辞习惯。"),
    (197, 'after', "截断时在文件列表末尾追加一句提示：建议收窄 path 或 pattern。这句是给模型看的行动指引，不是给人看的报错——「告诉模型下一步该做什么」是工具结果设计的通用套路。"),
]
