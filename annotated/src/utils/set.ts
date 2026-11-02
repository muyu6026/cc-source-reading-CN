// 文件级摘要：四个集合运算的小工具，全部手写循环而不用展开语法。
// 文件头的注释写明「这段代码在热路径上，为速度优化」——所以别顺手改成 `[...a].filter(...)` 那种写法。
/**
 * Note: this code is hot, so is optimized for speed.
 */
export function difference<A>(a: Set<A>, b: Set<A>): Set<A> {
  const result = new Set<A>()
  for (const item of a) {
    if (!b.has(item)) {
      result.add(item)
    }
  }
  return result
}
// 差集：遍历 a 逐个判 b，命中就跳过。手写循环省掉了中间数组的分配。

/**
 * Note: this code is hot, so is optimized for speed.
 */
export function intersects<A>(a: Set<A>, b: Set<A>): boolean {
  if (a.size === 0 || b.size === 0) {
    return false
  }
  for (const item of a) {
    if (b.has(item)) {
      return true
    }
  }
  return false
}
// 交集判定：任一集合为空立刻返回 false，避免进入无意义的遍历。找到第一个共同元素就短路返回。

/**
 * Note: this code is hot, so is optimized for speed.
 */
export function every<A>(a: ReadonlySet<A>, b: ReadonlySet<A>): boolean {
  for (const item of a) {
    if (!b.has(item)) {
      return false
    }
  }
  return true
}
// 子集判定：a 里只要有一个元素不在 b 中就否。注意入参是 ReadonlySet，调用方可以传冻结集合。

/**
 * Note: this code is hot, so is optimized for speed.
 */
export function union<A>(a: Set<A>, b: Set<A>): Set<A> {
  const result = new Set<A>()
  for (const item of a) {
    result.add(item)
  }
  for (const item of b) {
    result.add(item)
  }
  return result
}
// 并集：两个循环分别灌入同一个新集合，重复元素由 Set 自身去重，不需要额外判重。
