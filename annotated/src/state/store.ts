type Listener = () => void
// 极简通用状态仓库：提供 getState/setState/subscribe；setState 用 Object.is 判等跳过无变化，并通知所有订阅者。
type OnChange<T> = (args: { newState: T; oldState: T }) => void

export type Store<T> = {
// Store 类型：读状态、更新状态、订阅变更（返回取消订阅函数）。
  getState: () => T
  setState: (updater: (prev: T) => T) => void
  subscribe: (listener: Listener) => () => void
}

export function createStore<T>(
// 工厂：持有 state 与监听器集合，返回操作闭包。
  initialState: T,
  onChange?: OnChange<T>,
): Store<T> {
  let state = initialState
  const listeners = new Set<Listener>()

  return {
    getState: () => state,

    setState: (updater: (prev: T) => T) => {
// 更新器：先算 next，Object.is 相等则跳过，否则写回并触发 onChange 与所有监听器。
      const prev = state
      const next = updater(prev)
      if (Object.is(next, prev)) return
      state = next
      onChange?.({ newState: next, oldState: prev })
      for (const listener of listeners) listener()
    },

    subscribe: (listener: Listener) => {
// 订阅：加入集合并返回移除函数。
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
