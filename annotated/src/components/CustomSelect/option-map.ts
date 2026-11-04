import type { ReactNode } from 'react'
import type { OptionWithDescription } from './select.js'

// 单项条目类型：保存标签、值、说明，以及双向链表指针 previous/next 与序号。
type OptionMapItem<T> = {
  label: ReactNode
  value: T
  description?: string
  previous: OptionMapItem<T> | undefined
  next: OptionMapItem<T> | undefined
  index: number
}

// 选项映射类：在普通 Map 基础上额外维护首/尾指针，便于双向遍历。
export default class OptionMap<T> extends Map<T, OptionMapItem<T>> {
  readonly first: OptionMapItem<T> | undefined
  readonly last: OptionMapItem<T> | undefined

// 构造时遍历入参选项，为每个生成条目并连成双向链表。
  constructor(options: OptionWithDescription<T>[]) {
    const items: Array<[T, OptionMapItem<T>]> = []
// 临时累积键值对数组，最终一次性交给父类 Map。
    let firstItem: OptionMapItem<T> | undefined
    let lastItem: OptionMapItem<T> | undefined
    let previous: OptionMapItem<T> | undefined
    let index = 0

    for (const option of options) {
// 逐个选项生成条目，并接上前一项的 next 与自身的 previous。
      const item = {
        label: option.label,
        value: option.value,
        description: option.description,
        previous,
        next: undefined,
        index,
      }

      if (previous) {
// 若已有前一项，则把当前项接到它的 next 上。
        previous.next = item
      }

      firstItem ||= item
// 首项是第一个被分配的条目；尾项每轮更新为当前项。
      lastItem = item

      items.push([option.value, item])
      index++
      previous = item
    }

    super(items)
// 调用父类构造，把整张键值对数组灌入 Map。
    this.first = firstItem
// 缓存首、尾条目供外部遍历使用。
    this.last = lastItem
  }
}
