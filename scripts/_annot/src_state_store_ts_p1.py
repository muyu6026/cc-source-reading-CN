# 数据文件：source/src/state/store.ts
ANNOTATIONS = [
    (1, 'after', """极简通用状态仓库：提供 getState/setState/subscribe；setState 用 Object.is 判等跳过无变化，并通知所有订阅者。"""),
    (4, 'after', """Store 类型：读状态、更新状态、订阅变更（返回取消订阅函数）。"""),
    (10, 'after', """工厂：持有 state 与监听器集合，返回操作闭包。"""),
    (20, 'after', """更新器：先算 next，Object.is 相等则跳过，否则写回并触发 onChange 与所有监听器。"""),
    (29, 'after', """订阅：加入集合并返回移除函数。"""),
]
