ANNOTATIONS = [
    (1, 'after', '''// 这个组件只做一件事：把全局快捷键 handler 注册进 keybinding 上下文。
// 必须渲染在 KeybindingSetup 之内（否则拿不到 context），自身返回 null。'''),
    (27, 'after', '''// Props 全是 REPL 的透传：screen/setScreen 管视图切换，
// showAllInTranscript/messageCount 供埋点，
// 两个 onEnter/onExit 是 transcript 模式的进出钩子。'''),
    (29, 'after', '''// 注册的全局键：ctrl+t 任务列表、ctrl+o 记录模式、
// ctrl+e 展开全部消息、ctrl+c/esc 退出记录模式
// （另有 ctrl+shift+b brief 视图，KAIROS 门下）。'''),
    (46, 'after', '''// 返回 null：纯注册组件，不渲染任何 Ink 节点。'''),
    (48, 'after', '''// expandedView 进依赖是为了在回调里读最新值，
// 判断 is_expanded 埋点字段。'''),
    (60, 'after', '''// 运行时 require（eslint 特批）：InProcessTeammateTask 所在的
// 模块图会绕回本组件，静态 import 会形成循环依赖。'''),
    (88, 'after', '''// ctrl+t 三态循环（有队友时）：none → tasks → teammates → none；
// 无队友时退化成 none 与 tasks 两态。埋点 is_expanded 记的是切换前状态。'''),
    (91, 'after', '''// ctrl+o 与 ctrl+shift+b 的分工：前者管 prompt/transcript
// 两个主视图，后者只管 brief 过滤显示。'''),
    (94, 'after', '''// biome 特批说明：feature() 是编译期常量，这里的条件调用在产物里
// 实际恒定成立或不成立，不违反 hooks 规则。'''),
    (99, 'after', '''// kill-switch 逃生舱：GB 开关可以在 defaultView=chat 已持久化之后
// 再把 isBriefOnly 关掉，用户会看到空白的 filterForBriefTool 视图——
// 此时用户会本能按 ctrl+o，先把卡死的状态清掉再正常切换。'''),
    (107, 'after', '''// 三个条件：brief 功能已死 + 状态卡在 on + 当前不在 transcript
// （transcript 模式本来就不过滤 isBriefOnly，无需清）。'''),
    (132, 'after', '''// 依赖里放 isBriefOnly：逃生舱分支要读它判断是否卡死。
// setShowAllInTranscript(false) 是刻意重置：每次进 transcript
// 都从「只看工具调用」的默认视图开始。'''),
    (141, 'after', '''// ctrl+e 只切显示不过滤数据：showAllInTranscript 控制 transcript
// 里是否铺开全部消息（含工具结果）。'''),
    (154, 'after', '''// ctrl+c/esc 退出 transcript：无条件 setScreen('prompt')，
// 与进入路径对称。'''),
    (167, 'after', '''// 非对称闸门：OFF 永远允许（进来的键必须能出去），
// ON 需要功能还活着——GB 中途关开关后不让人进得去。'''),
    (182, 'after', '''// 纯显示过滤切换：不动 opt-in 状态，
// 埋点 gated:false 标明来源是按键。'''),
    (196, 'after', '''// toggleBrief 的注册整段被 feature 门控包住：编译期消除后
// 连 useKeybinding 调用都不存在。'''),
    (206, 'after', '''// 队友消息预览开关：只翻一个布尔，
// 供 teammate 消息裁剪显示用。'''),
    (209, 'after', '''// meta+j 开关内置终端面板：toggle() 内部 spawnSync 会一直阻塞
// 到用户从 tmux detach——所以它是同步调用而不是异步触发。'''),
    (217, 'after', '''// 空依赖：handler 只读 GB 缓存值和单例面板，不需要重注册。'''),
    (224, 'after', '''// ctrl+l 强制全量重画：外部清屏（macOS Cmd+K）后 Ink 的差分引擎
// 认为未变化的格子不用重画，屏幕就停在旧内容上——
// forceRedraw 是这种情况的恢复路径。'''),
    (236, 'after', '''// transcript:toggleShowAll 的 isActive 带 !virtualScrollActive：
// 虚拟滚动开启时 ctrl+e 另有归属（展开/收起全部由滚动视图自理）。'''),
    (244, 'after', '''// Esc 的双重人格仲裁：搜索栏「打开」是模式态（独占按键），
// Esc 归它；只是「导航中」（有高亮、栏关闭）不是模式，
// Esc 直接退 transcript——与 less 的 q 一致。
// 没有这层门控，useSearchInput 的 onCancel 和本 handler 会在同一次
// Esc 上双双触发（子组件先注册先触发，然后冒泡）。'''),
    (246, 'after', '''// 注册顺序即触发顺序：子组件（如搜索栏）先注册先触发，
// 上面的 isActive 门控就是按这个前提设计的。'''),
]
