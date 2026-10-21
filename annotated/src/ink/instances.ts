// ═══════════════════════════════════════════════════════════════
//  一张表，为什么必须单独成一个文件
// ═══════════════════════════════════════════════════════════════
//
//  原注释说得比任何补充都清楚：`render.ts` 负责**创建**实例，
//  `ink.ts` 要在卸载时**删除**自己 —— 如果这张表定义在任一方，
//  另一方 import 它就形成环。
//
//  所以它被抽成第三方文件，成为一个「谁都 import、谁都不拥有」的
//  共享状态。这是 ES 模块里打破循环依赖的标准手法：**把共享状态
//  提升到两个模块之外**。
//
//  代价是它成了一个隐式的全局单例 —— 没有生命周期、没有清理入口
//  （只能靠 `cleanup()` 手动 delete）。测试里跑多个 Ink 实例时要
//  特别小心这一点。
// Store all instances of Ink (instance.js) to ensure that consecutive render() calls
// use the same instance of Ink and don't create a new one
//
// This map has to be stored in a separate file, because render.js creates instances,
// but instance.js should delete itself from the map on unmount

import type Ink from './ink.js'

// 键是 **WriteStream 对象**而不是它的 fd / 路径。
//
//  用对象做键的好处：同一进程里两块不同的 stream 天然分开，
//  不需要给每块流分配 id。坏处：跨进程/跨重连无法复用（也不需要）。
//
//  `Map` 而不是 `WeakMap`：这里**不能**用 WeakMap —— 表本身是唯一
//  持有实例引用的地方，用 WeakMap 会导致实例被回收而渲染循环还在跑
//  （因为循环里的闭包引用着 this，倒是不会回收，但语义上是错的）。
//  对比 node-cache.ts 用 WeakMap：那里的键是 DOM 节点，被回收时
//  缓存就该消失。**同样的「缓存」用不同的 Map，区别在于「谁是所有者」**。
const instances = new Map<NodeJS.WriteStream, Ink>()
export default instances
