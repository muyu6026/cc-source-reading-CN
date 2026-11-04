# 向导上下文 hook
ANNOTATIONS = [
    (5, 'before', '泛型 hook：上下文里 data 的形状由调用方声明，hook 自身不做任何断言'),
    (9, 'after', '缺 Provider 直接抛错：向导状态没有合理默认值，早失败好过让各处拿到 undefined 后再炸'),
]
