ANNOTATIONS = [
    (1, 'before', '''文件级摘要：把 cli-highlight 做成懒加载的单例 Promise，并借它顺带拿到 highlight.js 的语言注册表。
第 1 到 5 行的注释解释了那行 triple-slash 库引用指令为何不能删：
tsconfig 只开了 ESNext 库，别处用到的 DOM 类型全靠 highlight.js 的类型定义顺手带进来。'''),
    (13, 'after', '对外暴露的类型只保留两个真正被调用的入口。类型用 `typeof import(...)` 动态取，避免在类型层引入运行时依赖。'),
    (19, 'after', '单例 Promise，供多个调用方共享：代码块渲染、markdown 处理、事件上报、语言名查询都走这一份。'),
    (21, 'after', '''语言查询函数的缓存位。它在 loadCliHighlight 里被赋值，之后 getLanguageName 直接读，
这样调用方不必再持有 highlight.js 的模块对象。'''),
    (36, 'after', '加载失败一律吞成 null，不向上抛——高亮是可降级能力，缺了只影响观感，不该让调用链断掉。'),
    (41, 'after', '`??=` 保证只加载一次：并发调用方拿到的是同一个 Promise，不会各自触发一次动态 import。'),
    (49, 'after', '''取语言名的入参是文件路径，先 await 共享加载，再从扩展名反查。
调用方全是遥测类场景（计数器属性、权限弹窗事件），都不阻塞，因此这里返回 Promise 没有问题。'''),
    (54, 'after', '取不到扩展名或注册表里没有该语言时统一返回 unknown，调用方无需再判空。'),
]
