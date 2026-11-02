ANNOTATIONS = [
    (1, 'after', '''文件级摘要：这份模块只做一件事——在 React 之外也能拿到 REPL 的两个 setter。
进程内队友（in-process teammate）跑在非 React 上下文里，拿不到 hooks，
于是用模块级单例当桥：REPL 挂载时注册，卸载时注销，队友需要时取。'''),
    (18, 'after', '''确认队列 setter 的类型：接收一个 updater 函数（旧队列转新队列），而不是直接接收数组。
用 updater 形式能让多次并发请求按顺序叠加，避免后写覆盖先写。'''),
    (23, 'after', '权限上下文 setter 的类型。第二个参数 preserveMode 决定是否保留当前权限模式——切换工具权限时不一定要连带改模式。'),
    (26, 'after', '两个模块级单例，默认 null 表示尚未注册。null 与函数引用并存，调用方据此判断桥是否可用。'),
    (32, 'after', '注册入口。REPL 在副作用里调用一次，把自身的 setState 包装成 updater 形式塞进来。'),
    (36, 'after', '取值入口。返回 null 时调用方应回退到别的确认路径（例如直接走 worker 权限徽章）。'),
    (54, 'after', '注销时把单例置回 null 而不是留一个失效引用——否则队友在 REPL 卸载后调用会打到已卸载组件的 setState 上。'),
]
