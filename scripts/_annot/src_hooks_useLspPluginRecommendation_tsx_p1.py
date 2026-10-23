ANNOTATIONS = [
    (2, 'after', '''// LSP 插件推荐钩子：检测到文件编辑时，若扩展名命中某个 LSP 插件、
// 二进制已在系统装好、插件未安装、用户没关过推荐——就推一条推荐。
// 每会话只推一次（hasShownLspRecommendationThisSession）。'''),
    (29, 'after', '''// 28 秒阈值对应菜单 30 秒自动消失：超过 28 秒的「no」
// 大概率是菜单自己超时掉的，不是用户真拒绝——计入 ignored count
// 用来降温推荐频率。'''),
    (36, 'after', '''// 推荐状态五字段；shownAt 专为上面的超时甄别而记。'''),
    (40, 'after', '''// 对外两件套：当前推荐（null = 无）+ 响应用户四选一的回调。'''),
    (43, 'after', '''// 订阅文件历史里的 trackedFiles：用户编辑过的文件集合，
// 推荐的触发源。'''),
    (48, 'after', '''// React Compiler 形态：Symbol.for('react.memo_cache_sentinel')
// 是「本槽还没初始化」的哨兵；首次渲染建 Set，之后复用。'''),
    (54, 'after', '''// checkedFilesRef 防重复检查：同一文件只送一次匹配，
// 反复编辑不重复打扰。'''),
    (59, 'after', '''// usePluginRecommendationBase 是多个推荐共用的基座：
// 提供 recommendation 状态 + tryResolve 互斥解析
//（同一时刻只允许一个推荐链在跑）。'''),
    (64, 'after', '''// tryResolve 的入参是「解析函数」：返回推荐状态或 null。
// 互斥由基座保证，这里只管业务判断。'''),
    (65, 'after', '''// 会话级一次性格子：本会话已推过就永远返回 null。'''),
    (75, 'after', '''// 先差分出新文件（未检查过的），再逐个送匹配——
// 差分在前，避免每轮全量重查。'''),
    (78, 'after', '''// 匹配四条件（扩展名/二进制已装/未安装/未关推荐）都在
// getMatchingLspPlugins 里；matches[0] 取最高优先的那个。'''),
    (88, 'after', '''// 命中即返回：shownAt 记下展示时刻，
// 供 no 分支的超时甄别使用。'''),
    (91, 'after', '''// 单文件匹配失败只记日志继续：一个怪扩展名不该阻断整轮推荐。'''),
    (97, 'after', '''// 全部新文件都没命中 → 返回 null，不打扰。'''),
    (108, 'after', '''// 编译后的 useEffect：依赖 trackedFiles 与 tryResolve——
// 文件集合变了才重新评估。'''),
    (121, 'after', '''// 带标签的 switch（bb60）：四个 case 都要跳到同一个收尾
// clearRecommendation()，用标签 break 避免写四遍。'''),
    (126, 'after', '''// 插件源可能是 marketplace 内的相对路径：join 成绝对路径，
// string 才 join（远程源不落地）。'''),
    (129, 'after', '''// 安装即启用：缓存注册后把 enabledPlugins 里对应项置 true，
// 用户不用再去设置里手动开。'''),
    (137, 'after', '''// yes 分支收尾：installPluginAndNotify 内部走完缓存+注册+
// 设置+通知，然后统一清推荐。'''),
    (141, 'after', '''// no 分支先算 elapsed：区分「用户点的 no」和「菜单超时的 no」。'''),
    (146, 'after', '''// 超时拒绝计 ignored count——推荐系统据此降温；
// 真拒绝不计（那是明确的负反馈，走 never 分支）。'''),
    (150, 'after', '''// never：addToNeverSuggest 把这个插件永久拉黑，
// 比 ignored count 更强。'''),
    (158, 'after', '''// 公共收尾：无论选什么都清掉当前推荐——一次推荐一条，
// 下个文件重新触发。'''),
    (167, 'after', '''// handleResponse 编译后从缓存槽取出，身份随
// addNotification/clearRecommendation/recommendation 变化。'''),
    (180, 'after', '''// 返回对象也进缓存槽：身份稳定，
// 消费者不会因新对象重渲染。'''),
    (182, 'after', '''// disable 分支的配置写入：lspRecommendationDisabled 全局开关，
// 幂等（已是 true 就原样返回）。'''),
    (191, 'after', '''// useAppState 的选择器编译期拆成独立函数：只取
// fileHistory.trackedFiles，窄订阅避免无关 state 变化触发重算。'''),
]
