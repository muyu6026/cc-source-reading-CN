ANNOTATIONS = [
    (8, 'after',
     "这个 23 行的文件是 `claudeAiLimits.ts` 的 **React 绑定**。那个模块对外暴露三样东西：模块级可变对象 `currentLimits`、监听者集合 `statusListeners`、以及一个在收到响应头时更新的函数。React 不认识模块级变量，所以需要这个 hook 把「订阅 + 卸载」包起来——**服务层不依赖 React，UI 层不依赖网络**，两边靠这个薄壳连接。"),
    (9, 'after',
     "初始值 `{ ...currentLimits }` 是**浅拷贝，不是传引用**。原因：`currentLimits` 是模块级对象、原地被改写；如果直接把引用交给 `useState`，React 的 `Object.is` 比较会一直认为「没变」，组件永远不重渲染。"),
    (13, 'after',
     "回调里又拷了一次 `{ ...newLimits }`，同一个理由：让 `setLimits` 收到**新引用**，React 才会重渲染。服务层原地改对象、UI 层靠拷贝制造新引用，是这个组合的既定约定。"),
    (17, 'before',
     "卸载时**必须**从 `statusListeners` 里删掉这个 listener。这个集合是模块级的、活到进程结束：不删的话每次挂载/卸载都留一个闭包（里面钉着 `setLimits` 和已卸载的 fiber），切十几次界面就攒十几个——而且它们还会继续触发对已卸载组件的 `setState`。"),
]
