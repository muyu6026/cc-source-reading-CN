ANNOTATIONS = [
    (1, 'after', """模块总述：自动模式（auto mode）的模块级状态与一组读写器，独立成模块以便调用方在被 `feature` 门控（如 `TRANSCRIPT_CLASSIFIER`）时条件式 require，避免无条件加载。"""),
    (4, 'before', """三个模块级开关变量：当前是否处于自动模式、CLI 是否传入了自动模式标志、以及被踢出后的熔断状态。"""),
    (11, 'before', """setAutoModeActive / isAutoModeActive：自动模式激活态的读写器。"""),
    (19, 'before', """setAutoModeFlagCli / getAutoModeFlagCli：来自 CLI 标志的自动模式开关读写器。"""),
    (27, 'before', """setAutoModeCircuitBroken / isAutoModeCircuitBroken：熔断状态读写器，被踢出后用于阻断 SDK 与显式重入。"""),
    (35, 'before', """_resetForTesting：测试用重置，把三个开关全部清回初始的关闭态。"""),
]
