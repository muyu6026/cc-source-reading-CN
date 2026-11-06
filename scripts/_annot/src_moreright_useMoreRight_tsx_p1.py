# 源文件: src/moreright/useMoreRight.tsx
ANNOTATIONS = [
    (1, 'after_block', '''外部构建用的占位文件：真正的 useMoreRight Hook 只在内部仓库，这里只给一个空壳，让外部类型检查能过。'''),
    (8, 'after', '''把内部复杂的消息类型抹成 any（外部构建无需真实类型），为此关掉 no-explicit-any 规则。'''),
    (19, 'after', '''占位 Hook 的签名——参数形状照搬内部实现，但实现是空的。'''),
    (25, 'after', '''空实现：三个回调都返回空或 true，render 返回 null；外部构建不依赖任何真实逻辑。'''),
]
