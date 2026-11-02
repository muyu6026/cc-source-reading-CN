# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'after', '''进程内队友的运行时上下文：用 AsyncLocalStorage 承载身份，使同一进程里的多个队友并发执行也不会互相串味。'''),
    (16, 'after', '''AsyncLocalStorage 是关键：上下文随异步调用链自动传播，不必把 agentId 一层层显式传进每个函数。'''),
    (39, 'after', '''字段刻意做成扁平结构：agentId 是全名（名字@团队），agentName 是显示名，二者分开是为了日志里能直接读、UI 里能只显示短名。'''),
    (41, 'after', '''模块级单例即上下文容器：一个 store 就够，因为 ALS 按调用链隔离，不需要按队友建多个实例。'''),
    (49, 'after', '''getTeammateContext 返回 undefined 表示当前不在任何队友上下文里，调用方据此回退到进程级身份（环境变量或 dynamicTeamContext）。'''),
    (64, 'after', '''runWithTeammateContext 用 run 而不是 enterWith：run 的作用域在函数返回时自动退出，不会把上下文泄漏到调用者后续的异步任务里。'''),
    (72, 'after', '''isInProcessTeammate 只做存在性判断：比先取值再比较快，适合放在热路径上（每条工具调用都会查一次）。'''),
    (96, 'after', '''createTeammateContext 只补 isInProcess 标记：其余字段原样展开，调用方传什么就是什么，避免这里再维护一份默认值。'''),
]
