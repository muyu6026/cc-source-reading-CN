ANNOTATIONS = [
    (1, 'after', """成本汇总 Hook：进程退出时把当前会话总成本打印到终端并落盘，供状态栏与退出日志使用。"""),
    (8, 'after', """`useCostSummary`：接收可选帧率指标获取器，逻辑全包在 `useEffect` 里、空依赖只跑一次。"""),
    (12, 'after', """有控制台计费权限时才把总成本写入标准输出。"""),
    (15, 'after', """同时把当前会话成本保存下来，供后续状态栏读取。"""),
]
ANNOTATIONS.sort(key=lambda a: a[0])
