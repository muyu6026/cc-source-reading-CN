ANNOTATIONS = [
    (1, 'after', """模块总述：proper-lockfile 的惰性访问封装。该依赖会在首次 require 时通过 graceful-fs 猴补丁改写所有 fs 方法（约 8ms），直接静态导入会把这笔开销拖进启动路径；本模块改为首次实际调用锁函数时才加载底层包。"""),
    (18, 'before', """私有 getLockfile：惰性 require 封装，只在第一次调用锁函数时加载 proper-lockfile 并缓存到模块级变量，避免启动期代价。"""),
    (26, 'before', """公开 lock：异步获取锁，返回的是一个「解锁器」函数，调用它即可释放，便于用 try/finally 管理生命周期。"""),
    (33, 'before', """公开 lockSync：lock 的同步版本，供需要在启动早期同步持锁的场景使用。"""),
    (37, 'before', """公开 unlock：显式释放指定文件的锁。"""),
    (41, 'before', """公开 check：探测某文件当前是否已被加锁，返回布尔值。"""),
]
