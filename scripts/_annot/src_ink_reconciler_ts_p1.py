# -*- coding: utf-8 -*-
"""ink/reconciler.ts 批注：React 自定义 renderer 的 host config（1-512）。"""

ANNOTATIONS = [
(1, 'before', '''// ═══════════════════════════════════════════════════════════════
//  自研终端渲染器的第一层：让 React 认得一个「终端 DOM」
// ═══════════════════════════════════════════════════════════════
//
//   react-reconciler 是一个「调度 + 协调」内核，它不知道什么叫 div。
//   renderer 作者提供一组 host config 回调，React 就会在正确的时机调它们：
//   createInstance / appendChild / commitUpdate / resetAfterCommit ...
//
//   所以这个文件的本质是：**把 React 的 mutation 语义翻译成树操作**。
//   它不负责画，也不负责量 —— 画在 render-node-to-output.ts，量在 yoga。
//
// 【三份文件的职责切分】
//
//   reconciler.ts   React 与树之间的适配器（本文件）
//   dom.ts          极简 DOM + yoga 桥（节点、属性、脏标记）
//   ink.tsx         帧循环、终端模式、光标、diff、写屏幕
//
// 【读这个文件的两个技巧】
//
//   ① 大部分方法读一眼就知道在干什么（appendChild 就是 appendChild），
//      真正要细看的只有六个：resetAfterCommit / createInstance / commitUpdate /
//      hideInstance / removeChild* / 末尾那堆 React 19 空实现。
//   ② 每个回调都在 React 的特定阶段被调用，**顺序比内容重要**：
//      createInstance（render 阶段）→ appendChild（commit 阶段）
//      → resetAfterCommit（commit 末尾）→ useLayoutEffect
//      → scheduleRender（微任务）→ onRender（帧）
//      记住这条线，ink.tsx 里那些「为什么不能同步渲染」的注释才读得通。'''),

(33, 'before', '''// 【devtools 只在开发期连，而且必须 try/catch】
//
//   NODE_ENV 判断是编译期常量，生产包里整块被删掉。
//   但即便如此也要 catch：环境变量 DEV=true 是很多第三方工具的习惯用法，
//   用户的项目里可能有，而 react-devtools-core 不一定装了。
//   硬 import 会让一个「和我无关的环境变量」把整个 CLI 搞崩（issue #384）。
//
//   catch 里只吞 ERR_MODULE_NOT_FOUND，其他错误照抛 —— 因为那是我们自己的 bug，
//   不该被伪装成「devtools 没装」。'''),

(62, 'before', '''// 【自己写 diff，因为 React 19 不再给 updatePayload】
//
//   React 18 的 commitUpdate 会拿到一个由 prepareUpdate 算好的变更集；
//   React 19 改成直接给 oldProps / newProps，diff 责任回到 renderer。
//
//   返回 undefined 表示「没有任何变化」，不是返回空对象 ——
//   让调用方写成 `if (props) {...}`，比 `if (Object.keys(props).length)` 干净，
//   也顺手省掉一次分配（这个函数每次更新都会跑）。
//
//   style 被单独 diff 一次（433 行）：因为要给 yoga 的是**完整的新 style**，
//   而不是差异。两套消费者，两种数据形状。'''),

(95, 'before', '''// 【释放顺序不是可选的：yoga 是 WASM，free 之后访问不报错】
//
//   三步的顺序：
//     1. unsetMeasureFunc —— 摘掉回调，避免 free 过程中被调用
//     2. clearYogaNodeReferences —— 递归把整棵子树的 yogaNode 置 undefined
//     3. freeRecursive —— 真正释放 WASM 内存
//
//   若省掉第 2 步：freeRecursive 会连带释放所有子节点，但子节点对象上的
//   yogaNode 引用还指着已释放的内存。之后任何一次 markDirty / calculateLayout
//   都会读到垃圾值 —— 而 WASM 不会抛「use after free」，它会安静地给出错误结果，
//   表现为界面随机错乱或进程段错误。
//
//   这就是为什么第 2 步的注释写着 BEFORE freeing：**顺序即正确性**。'''),

(110, 'before', '''// host context 只携带一个布尔量：当前是否位于 <Text> 内部。
// 它决定两件事：<Box> 能不能创建（不能）、<Text> 要建成实体还是虚拟节点（见 342 行）。'''),

(121, 'before', '''// 【一个 prop 可能同时喂两个消费者】
//
//   style 要喂两份：
//     setStyle(node, style)      → 渲染层用（颜色、边框、背景）
//     applyStyles(yogaNode, style) → 布局层用（宽高、padding、flex）
//
//   yoga 只懂布局相关的那部分，渲染层不懂布局 —— 所以同一份 style
//   被切成两半用。这就是为什么 styles.ts 里那套 Styles 类型被两个模块读。
//
//   textStyles 单独一支：它是「文字样式」（粗体/下划线/颜色），只影响渲染，
//   不参与布局，所以不进 yoga。'''),

(147, 'before', '''// 【摸 React 内部字段，只为一件事：出问题时能说出是谁干的】
//
//   Fiber 不是公开 API。这里读的 _debugOwner / return 都是 react-reconciler
//   的内部字段，随时可能改名。所以：
//     · 只在 CLAUDE_CODE_DEBUG_REPAINTS 打开时才记录（354 行）
//     · 有 50 层上限 + seen 集合防环（Fiber 的 return 链理论上不该成环，
//       但 alternate/current 双树在 debug 构建下真的踩过）
//
//   为什么要这个：终端 UI 最难查的 bug 是「整屏突然重绘」——
//   现象是闪烁，但你不知道是哪段内容变了导致 diff 放弃增量。
//   有了 owner chain，日志能直接写「culprit: ToolUseLoader < Messages < REPL」。
//
//   代价是这个信息只在 debug 构建里有（生产构建的 _debugOwner 是 null）。'''),

(179, 'before', '''// env 读取缓存成模块级变量：isDebugRepaintsEnabled 在热路径上被调用
// （createInstance 每建一个节点问一次），process.env 访问是哈希查找，不值得反复做。'''),

(189, 'before', '''// 【这些计数器是模块级的，不是实例级的】
//
//   因为它们是「临时排障埋点」，不是运行时状态：
//   一个人同时只跑一个 CLI，一份计数器够用。做成实例字段要多传一路参数，
//   而这个文件里的埋点本来就是要被删掉的。
//
//   真正值得注意的是写入条件：只在 gap > 30ms / reconcile > 20ms /
//   creates > 50 / layout > 20ms 时才 appendFileSync。
//   **埋点本身不能成为性能问题** —— 每帧同步写文件会让被测对象更慢，
//   测出来的数据就不可信了。'''),

(224, 'before', '''// 【14 个类型参数，只需要看懂 6 个】
//
//   HostElement        DOMElement        宿主元素类型
//   HostText           TextNode          文本节点类型
//   HostContext        { isInsideText }  跨层级传递的上下文
//   UpdatePayload      null              React 19 不再用，所以是 null；
//                                         留着位置是为了对上签名
//   TimeoutHandle      NodeJS.Timeout    调度用的定时器类型
//   NoTimeout          -1                表示「没有超时」的哨兵值
//
//   剩下的是 React 内部的 Suspense / Transition 相关槽位，这个 renderer 全部
//   声明为「不支持」（472-505 行那一片空实现就是对它们的回答）。'''),

(247, 'before', '''// 【resetAfterCommit 是一帧的起点，做两件事：算布局、渲染】
//
//   为什么布局必须在这里（commit 阶段）算，而不是等微任务：
//   紧接着 React 会跑 useLayoutEffect，而那些 hook 要读「当前布局结果」
//   （比如 useDeclaredCursor 要把光标放到输入框的 caret 上）。
//   布局晚一步，光标就慢一帧 —— 打字时肉眼可见。
//
//   渲染则相反，必须推到微任务（ink.tsx 的 scheduleRender）：
//   因为 layout effect 里可能改状态（光标声明），同步渲染会画出旧值。
//
//   **同一个 commit 里，量要早、画要晚。**'''),

(292, 'before', '''// 测试环境的特殊路径：直接同步渲染，跳过 throttle。
//
//   node NODE_ENV=test 时 React 19 会把 effect 双调用一遍，
//   导致某一刻树是空的 —— 如果用 hasRenderedContent 挡一下，
//   测试里 lastFrame() 就能稳定读到非空结果。
//
//   生产环境不会走这里。所以读这个分支的作用不是理解主流程，
//   而是理解「为什么测试里的行为和生产不一样」。'''),

(316, 'before', '''// 【注意 324 行：值相等时返回父对象本身，而不是新建对象】
//
//   React 用 === 比较 host context 决定要不要重渲染子树。
//   每次新建对象的话，任何一次父级更新都会被判定成「context 变了」，
//   整棵子树全部重渲染 —— 对一个每帧都在更新的终端 UI 是灾难。
//
//   所以只有 isInsideText 真的翻转时才新建对象。
//   这类「值语义的对象要手工做引用复用」的写法，在 React renderer 里是硬性要求。'''),

(331, 'before', '''// 【createInstance 里的两个决定，都是「终端语义」决定的】
//
//   ① Box 不能在 Text 里 —— 直接抛错。
//      DOM 里 div 套在 span 里是合法的（虽然不推荐），但终端里
//      Text 的内容要被展平成一段字符串去测量宽度，中间插一个 Block
//      就再也算不出「这段文字多宽」了。所以这不是风格检查，是能力边界。
//
//   ② Text 套 Text → 建成 ink-virtual-text（342 行）。
//      嵌套的 Text 不创建 yoga 节点、不参与布局，只把文字和样式合并进父级。
//      这样 <Text>前<Text color="red">中</Text>后</Text> 能拼成一行三段样式，
//      而不是三个独立的盒子。
//
//   ③ debugOwnerChain 只在 debug 开关下记录（354 行），理由见 147 行。'''),

(360, 'before', '''// 【裸字符串必须包在 <Text> 里，否则抛错 —— 这是 Ink 与 DOM 最大的差异】
//
//   DOM 里 <div>hello</div> 完全合法，文本节点是匿名的。
//   终端里不行：文字必须有样式（至少要是「默认样式」）才能被测量和绘制，
//   而「无父级的裸文本」不知道自己该继承什么，也不知道该放在哪一行。
//
//   所以这条错误信息不是防御性检查，是在告诉使用者「Ink 的文本模型是显式的」。
//   实际体验上，这是新手写 Ink 最常撞的一堵墙。'''),

(381, 'before', '''// 【隐藏用 display:none，不从树里摘掉】
//
//   React 的 Offscreen/Activity 语义要求「隐藏但保留状态」：
//   组件不卸载，useState 还在，只是不画。
//   如果在这里真的 removeChild，隐藏再显示就等于重新挂载 ——
//   输入框内容、滚动位置、动画进度全部丢失。
//
//   用 yoga 的 display:none 实现，既能省掉绘制，又能让布局跳过它。'''),

(394, 'before', '''// finalizeInitialChildren 的返回值决定 React 要不要给这个节点调 commitMount。
// 整个 renderer 里只有 autoFocus 需要「挂载后立刻做一件事」——
// 这也是唯一需要 commitMount 的场景（见 401 行）。'''),

(420, 'before', '''// 【容器级移除比普通移除多两件事】
//
//   removeChildFromContainer 除了摘节点、释放 yoga，还要通知 focusManager：
//   被删的子树里可能有当前焦点元素，焦点必须转移到别处（否则键盘事件打给空气）。
//
//   普通 removeChild（463 行）用的是反查 root 的写法（getRootNode(node)），
//   因为那时手上只有父节点，而 focusManager 只挂在 ink-root 上。'''),

(425, 'before', '''// 【commitUpdate 是每次更新都会走的热路径】
//
//   两步：
//     1. diff 出变化的 prop，逐个应用（style / textStyles / 事件 / 普通属性）
//     2. 若 style 变了，把**完整新 style** 交给 yoga 重算布局
//
//   为什么不把 yoga 的更新也做成差量：yoga 自己是增量引擎，
//   applyStyles 写进去的每个属性都会标脏对应节点，重算是它自己的事。
//   我们只负责「告诉它新值」，不负责「告诉它变化」。
//
//   这也是整个 renderer 的分工哲学：**我们管数据，库管计算。**'''),

(463, 'before', '''// 普通移除：摘节点 → 释放 yoga → 通知焦点。
// 注意 466 行的 `!== '#text'`：文本节点没有 nodeName 也没有焦点，
// 而 focusManager 的 handleNodeRemoved 会按 DOMElement 处理，传进去会炸。'''),

(472, 'before', '''// 【这一大片空实现不是占位符，是明确回答「不支持」】
//
//   React 19 的 host config 要求实现 Suspense / Transition / 表单 / 事件优先级
//   等一整套接口。终端 UI 一个都不用：
//     maySuspendCommit / suspendInstance  → 不支持 Suspense 的渐进提交
//     trackSchedulerEvent / resolveEventType → 没有浏览器事件模型
//     resetFormInstance                    → 没有表单
//
//   所以返回 false / null / 空函数。**返回 false 是有语义的**：
//   它告诉 React「不要走延迟提交这条路」，而不是「我还没实现」。
//
//   484 行的 HostTransitionContext 是硬凑的：React 要求这里有一个 context 对象，
//   于是手搓了一个 Symbol.for('react.context') 的最小结构。
//   这段代码的存在只说明一件事 —— 我们在和一个不打算对外开放的接口打交道。'''),

(508, 'before', '''// 【用一行赋值打破循环依赖】
//
//   dispatcher.ts 需要在处理事件时调用 reconciler.discreteUpdates（高优先级更新），
//   但它不能 import reconciler —— 因为 reconciler 已经 import 了 dispatcher（187 行）。
//
//   解法：dispatcher 里留一个可写的字段，reconciler 在模块加载完成后把方法塞进去。
//   这叫「装配期注入」，本质是把静态依赖变成一个运行时可变的洞。
//
//   代价：dispatcher 在 reconciler 模块加载完成之前，那个字段是 undefined。
//   读代码时如果看到 dispatcher.discreteUpdates 被调用，要知道它依赖「reconciler 已加载」
//   这个隐含前提。'''),
]
