// 文件级。三个不依赖外部状态的小型数组工具函数。
export function intersperse<A>(as: A[], separator: (index: number) => A): A[] {
  return as.flatMap((a, i) => (i ? [separator(i), a] : [a]))
}
// `intersperse` 在元素之间插入分隔值（按索引生成），第一个元素前不加，常用于把列表拼成可读文本。

export function count<T>(arr: readonly T[], pred: (x: T) => unknown): number {
  let n = 0
  for (const x of arr) n += +!!pred(x)
  return n
}
// `count` 统计满足条件的元素个数，用 `+!!pred` 把布尔转成 0/1 累加，写法紧凑。

export function uniq<T>(xs: Iterable<T>): T[] {
  return [...new Set(xs)]
}
// `uniq` 借助 `Set` 去重，返回保留首次出现顺序的数组。
