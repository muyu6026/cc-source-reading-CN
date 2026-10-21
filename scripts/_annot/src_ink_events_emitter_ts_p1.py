# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''// 继承 Node 自带的 EventEmitter，只补一件事：让 emit 认
// stopImmediatePropagation()。
//
// 为什么非补不可：Node 的 emit 会把所有监听者无条件叫一遍，没有
// 「停下」的接口。而 ink 的输入事件需要它 —— useInput 的文档里明写
// 「多个 useInput 同时存在时用 isActive 避免重复处理」，可一旦有人
// 想「这个按键我处理了，后面的别管」，Node 的 emitter 给不了这个能力。
//
// 补的方式很轻：不重写 _events 结构，只在 emit 里换成手动循环。'''),
    (10, 'after', '''// 默认上限 10，超了 Node 会打一行 warning。React 里「很多组件同时
// 监听同一个事件」是正常的（每个 useInput 一个监听者），
// 所以直接把上限关掉，而不是调大到某个数 —— 调大只是把问题推后。'''),
    (17, 'after', '''// error 必须交回 Node 处理：它有特殊语义（没有监听者时抛出、
// 有监听者时不当成普通事件）。自己循环会把这个语义弄丢。'''),
    (21, 'after', '''// rawListeners 而不是 listeners：once() 注册的监听者，listeners()
// 返回的是**原函数**，rawListeners() 返回的是包装器。
// 包装器自己负责「先摘掉自己再调用」，直接调原函数会漏掉摘除，
// 于是 once 变成 every。'''),
    (27, 'after', '''// 只认第一个参数。这是 ink 的约定（事件对象永远是 args[0]），
// 不是通用实现 —— 如果哪天有人 emit('x', a, event)，这里会判成
// 「没有事件对象」，停止传播就失效了。'''),
]
