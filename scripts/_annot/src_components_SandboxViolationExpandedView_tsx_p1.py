# -*- coding: utf-8 -*-
# annotations for src/components/SandboxViolationExpandedView.tsx (99 lines)
ANNOTATIONS = [
    (12, 'before', '手写 h:mm:ssa 时间格式化：注释明说就是为了避开 date-fns——为一个 format 调用引入 39MB 依赖不划算，为小事手写工具函数是终端产品的常规取舍'),
    (13, 'after', '12 小时制换算的经典写法：getHours()%12 在 0 点和 12 点都得 0，用 ||12 兜底成 12 点'),
    (19, 'after', 'import 语句夹在函数定义后面——打包产物里无所谓（import 会提升），但说明这行是后来补的没挪位置'),
    (29, 'after', 'useState 初始值用 _c 缓存的空数组哨兵而非字面量 []：每次渲染新建数组会破坏引用相等性'),
    (34, 'before', '订阅 SandboxManager 的违规 store：返回的 unsubscribe 作为 effect 清理函数，组件卸载时退订'),
    (37, 'after', 'slice(-10) 只保留最近 10 条——终端高度有限，全量展示没有意义，配合下面的 showing last 提示'),
    (38, 'after', '总数与最近列表分成两个 state：列表截断了但总数要完整展示'),
    (50, 'before', '两个早退条件合并：未启用沙箱或 Linux 平台直接不渲染——这个视图只服务 macOS 沙箱（Seatbelt），Linux 走别的机制'),
    (56, 'after', '单复数处理：1 条用 operation，多条用 operations，英文 UI 的常规细节'),
    (74, 'after', 'Math.min(10, ...) 与订阅处的 slice(-10) 双保险：即使列表意外超长也不超过 10'),
    (96, 'before', '_temp 是编译器提取的列表项渲染函数：key 用时间戳+i 组合保证唯一'),
    (97, 'after', 'command 可选：有命令名时显示「时间 命令: 违规行」，没有就直接显示行内容'),
]
