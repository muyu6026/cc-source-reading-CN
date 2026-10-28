# 批注数据：source/src/utils/plugins/reconciler.ts（第 66 批）
# 锚点：行号, 位置(before/after/after_block), 中文批注（自带「注：」前缀，禁止 " 与 \）
ANNOTATIONS = [
    (10, 'before', """注：本文件是「市场（Marketplace）对账器」：让 known_marketplaces.json 与设置里声明的意图保持一致。diffMarketplaces 只读比较，reconcileMarketplaces 执行安装且幂等、只增不删。"""),
    (30, 'before', """注：MarketplaceDiff 描述比较结果三类：缺失（声明了但 JSON 没有）、来源变更（两边都用但来源不同，以设置为准）、已同步。"""),
    (50, 'before', """注：diffMarketplaces 把设置里的声明与 JSON 现状逐条比对；相对路径会先规范化；fallback 类来源只要存在即视为已同步，避免重复克隆覆盖。"""),
    (85, 'before', """注：ReconcileOptions/ReconcileProgressEvent/ReconcileResult 分别是执行选项、进度事件与最终结果的类型定义。"""),
    (102, 'before', """注：ReconcileResult 汇总安装/更新/失败/已同步/跳过五类名单，调用方据此给用户反馈。"""),
    (114, 'before', """注：reconcileMarketplaces 是主流程：取声明、加载现状、算出缺失与变更，逐条调用 addMarketplaceSource 安装或更新，失败就记入 failed。"""),
    (134, 'before', """注：WorkItem 是内部工作项，把缺失项标记为 install、来源变更项标记为 update，统一进处理队列。"""),
    (249, 'before', """注：normalizeSource 把设置里的相对目录/文件路径解析成绝对路径；对 git worktree 会解析到主仓库的规范根，避免每个 worktree 互相覆盖共享条目。"""),
]
