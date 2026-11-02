// 手写实现 TC39 规范里的 Object.groupBy（块注释里留了规范链接），把一个可迭代项集合按 keySelector 的返回值分组到以键为属性的普通对象里。
/**
 * https://tc39.es/ecma262/multipage/fundamental-objects.html#sec-object.groupby
 */
export function objectGroupBy<T, K extends PropertyKey>(
  items: Iterable<T>,
  keySelector: (item: T, index: number) => K,
): Partial<Record<K, T[]>> {
  const result = Object.create(null) as Partial<Record<K, T[]>>
  let index = 0
  for (const item of items) {
    const key = keySelector(item, index++)
    if (result[key] === undefined) {
      result[key] = []
    }
    result[key].push(item)
  }
  return result
}
// 实现要点：用 Object.create(null) 造一个无原型的对象以避免原型键冲突，遍历时按 key 初始化空数组再 push，返回类型声明为 Partial<Record<K, T[]>>。
