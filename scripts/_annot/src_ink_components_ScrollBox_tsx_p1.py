# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (62, 'after', '''// 这个接口的注释密度（12 个方法，8 个带多行说明）本身就是文档：
// **每个方法的注释都在解释一个踩过的坑**。
//
// 三个最典型的：
//   scrollToElement  为什么不能烘焙数字（渲染时读才准）
//   getFreshScrollHeight  为什么需要「新鲜」版本（缓存值最多 16ms 旧）
//   isSticky         为什么不能靠 scrollTop + viewportH >= scrollHeight 判断
//
// 读法建议：先读这个类型，再读实现。实现里那些看起来绕的地方，
// 大半是为了满足这里某条注释里的约束。'''),
    (70, 'after', '''// 把 overflow 三个键从 Props 里排除，是因为它们被**写死**成 scroll
// （第 226-227 行）。留着的话调用方传 overflow="hidden" 会以为生效，
// 实际上被覆盖 —— 又是一个「宁可编译报错」的取舍。
//
// stickyScroll 是唯一暴露的行为开关，而且它是**双向**的：
// props 通过 DOM attribute 传（首帧生效），scrollTo/scrollBy 通过
// `el.stickyScroll = false` 打断（运行期生效）。第 187 行的
// `el.stickyScroll ?? Boolean(el.attributes['stickyScroll'])`
// 就是这两种来源的优先级：**命令式的覆盖优先于声明式的**。'''),
    (81, 'after', '''// 结构说明在这里一次讲完：
//
//   ink-box（视口，overflow: scroll，高度被约束）
//     └─ Box（内容，flexGrow 1 / flexShrink 0，至少填满视口）
//          └─ children
//
// 关键在 flexShrink: 0 —— 内容**不许被压缩**，于是一个高 200 行的
// 列表在 30 行的视口里仍然是 200 行（yoga 用 Overflow.Scroll 阻止
// 视口跟着内容长高）。视口裁掉看不见的部分，靠的是渲染期按
// scrollTop 剔除子节点（viewport culling），不是 yoga 的裁剪。'''),
    (96, 'after', '''// 【为什么绕过 React】
//
// 滚轮是最典型的高频事件：一次拨动可能几十个事件。走 React state 的话
// 每个事件一次重渲染 + 一次完整 yoga 布局，主线程直接卡住。
//
// 所以这里改成命令式：直接改 DOM 节点上的 scrollTop → 标脏 → 调
// 根节点的节流渲染。**React 完全不参与**，一次 reconciler 工作都不做。
//
// 代价（也是这段注释在说的）：既然不经过 React，就不能指望
// 「setState 之后自动重渲染」。所以：
//   · 滚动位置由渲染器从 DOM 节点读（不是从 state 读）
//   · 需要 React 重渲染的情况（sticky 变化、虚拟滚动的挂载范围）
//     必须显式 forceRender，见第 160 行'''),
    (117, 'after', '''// 这个函数是「一次滚动改动」的完整副作用清单，顺序和内容都有理由：
//
//   markScrollActivity()  通知后台轮询（IDE 轮询、LSP、GCS 拉取）跳过
//                         下一 tick。注释里的数字很具体：滚动排空期间
//                         最大帧间隔到过 1402ms —— 就是这些后台任务
//                         和滚动抢事件循环造成的
//   markDirty(el)         标脏，渲染器据此重画这一支
//   markCommitStart()     告诉 reconciler「一次提交开始了」（计时用）
//   notify()              通知订阅者（虚拟滚动用它重算挂载范围）
//
// 最后那段 microtask 合并是重点：`scheduleRenderFrom` 有自己的
// leading edge（第一次调用立刻渲染），如果每个 scrollBy 都直接调，
// 第一个事件就触发渲染，而它后面还有一批事件在改 scrollTop ——
// 渲染出来的是「中途状态」。推到微任务里，一次输入批（discreteUpdates）
// 内的所有 scrollBy 合成一次。'''),
    (128, 'after', '''// 三个赋值分别是「切断」三样东西：
//
//   stickyScroll = false   显式关掉粘底（覆盖 DOM attribute）
//   pendingScrollDelta     丢掉还没排空的累加量
//   scrollAnchor           丢掉正在进行的锚点寻位
//
// 少切任何一个都会打架：比如滚轮正在累加时调 scrollTo，累加量会在
// 渲染时又把它推开；锚点没清掉的话渲染器会用锚点覆盖 scrollTop。
//
// 这类「命令式状态有四个字段，改一个必须清另外三个」的设计，
// 是绕过 React 的必然代价 —— 没有 reducer 帮你保证一致性。'''),
    (152, 'after', '''// 【累加器，不是位置】
//
// scrollBy 累加的是**位移**（pendingScrollDelta），不是直接改 scrollTop。
// 两个原因：
//   · 一次拨动的几十个事件天然合并（第 150 行加法）
//   · 滚上再滚下自然抵消 —— 用户快速来回拨，净位移接近 0，
//     不会出现「滚了 10 格又滚回来，内容却跳了一下」
//
// 真正的 scrollTop 由渲染器在 drain 时按**上限速率**推进（所以快速
// 拨动能看到中间帧，而不是瞬间到底）。这也是 getPendingDelta 存在的
// 原因：虚拟滚动要知道「还没排空的位移」，才能预挂载即将进入视口的
// 子节点，否则中间帧会是空白。'''),
    (160, 'after', '''// scrollToBottom 是唯一**走 React** 的滚动操作，因为 stickyScroll
// 是 DOM attribute（声明式的），改它必须经过 React 的 props 流。
//
// 顺带：这里不调 scrollMutated（那个会 markDirty + 排渲染），
// 而是自己 markDirty + notify + forceRender。forceRender 会引发一次
// 完整渲染，渲染器在那一轮里读到新的 stickyScroll 属性并自己算位置 ——
// 所以不需要提前写 scrollTop。'''),
    (176, 'after', '''// 【为什么需要「新鲜」版本】
//
// scrollHeight 是渲染器写回 DOM 节点的缓存值，而渲染是节流的（最多
// 16ms 一次）。所以刚提交完一次「内容变高了」的更新、在 layout effect
// 里读它，读到的是**上一次渲染的值** —— 差一个内容块的高度。
//
// 这个函数的做法是直接问 yoga：内容节点（childNodes[0]）的
// getComputedHeight()。贵一点（一次原生调用），但那一轮布局已经算完了，
// 值是准的。
//
// 两个都存在的意义：常规路径用缓存（便宜），「刚变大就要读到」的
// 场景用这个。典型的双 API 设计 —— 代价是调用方得知道什么时候用哪个。'''),
    (219, 'after', '''// 【首帧的 stickyScroll 为什么走 DOM 属性】
//
// ref 回调在**首次 commit 之后**才跑 —— 也就是说第一帧渲染时，
// 渲染器还不知道这个盒子是粘底的，会把内容画在顶部。
// 用户看到的是「刚打开时列表在顶部，下一帧才跳到底部」。
//
// 所以 stickyScroll 通过 ink-box 的 attribute 传（`{...stickyScroll ?
// {stickyScroll: true} : {}}`，第 228 行），attribute 在 createInstance
// 那一刻就存在，首帧就生效。
//
// 注意这里还顺手 `el.scrollTop ??= 0`：让「没滚动过」和「滚到 0」
// 在类型上都是数字，省掉下游的 undefined 判断（但 isSticky 那边
// 仍然要处理 undefined，因为命令式赋值会覆盖它）。'''),
    (231, 'after', '''// 内层 Box 的三个属性各有理由：
//
//   flexDirection="column"  内容默认竖排（列表/聊天记录的唯一常见布局）
//   flexGrow={1}            至少填满视口 —— 于是子元素可以用 Spacer
//                           把东西顶到底部（内容比视口短时的常见需求）
//   flexShrink={0}          不许压缩 —— 内容比视口长时保持完整高度
//
// width="100%" 而不是 flexGrow 在横轴上：横向不滚动，宽度就是视口宽。'''),
]
