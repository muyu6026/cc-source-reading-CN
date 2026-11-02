# 批注数据：src/utils/bufferedWriter.ts
ANNOTATIONS = [
    (3, 'after', '''BufferedWriter 形态：write 追加内容、flush 立即落盘、dispose 收尾。'''),
    (9, 'after', '''工厂函数：把零散 write 聚合成批，按时间、条数、字节数阈值触发落盘。'''),
    (37, 'after', '''flush 同步把缓冲与溢出内容交给 writeFn，并清空计时器。'''),
    (60, 'after', '''flushDeferred 把缓冲同步摘离：writeFn 可能阻塞，故用 setImmediate 延后真正写入，保持当前 tick 短小。'''),
    (100, 'after', '''本工厂用闭包维护缓冲与计时器，返回的对象对外只暴露 write / flush / dispose。'''),
]
