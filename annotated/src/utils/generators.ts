const NO_VALUE = Symbol('NO_VALUE')
// 用一个私有 Symbol 当哨兵：生成器可能合法地产出 undefined，用 null 或 undefined 都无法区分「没产出」与「产出了空值」。

export async function lastX<A>(as: AsyncGenerator<A>): Promise<A> {
  let lastValue: A | typeof NO_VALUE = NO_VALUE
  for await (const a of as) {
    lastValue = a
  }
  if (lastValue === NO_VALUE) {
    throw new Error('No items in generator')
  }
  return lastValue
}
// lastX 只保留最后一个值：适合「流式产出中间状态、只关心终态」的场景，空生成器直接抛错而不是返回 undefined。

export async function returnValue<A>(
  as: AsyncGenerator<unknown, A>,
): Promise<A> {
  let e
  do {
    e = await as.next()
  } while (!e.done)
  return e.value
}
// returnValue 关注的是生成器的返回值而不是产出值：用 do-while 一路 next 到 done，再把 final value 取出来。

type QueuedGenerator<A> = {
  done: boolean | void
  value: A | void
  generator: AsyncGenerator<A, void>
  promise: Promise<QueuedGenerator<A>>
}
// 队列元素自带四件套：done 与 value 来自 next 结果，generator 用于续跑，promise 是它自己的「身份牌」——竞速结束后要靠它把自己从集合里摘掉。

// Run all generators concurrently up to a concurrency cap, yielding values as they come in
export async function* all<A>(
  generators: AsyncGenerator<A, void>[],
  concurrencyCap = Infinity,
): AsyncGenerator<A, void> {
  const next = (generator: AsyncGenerator<A, void>) => {
    const promise: Promise<QueuedGenerator<A>> = generator
      .next()
      .then(({ done, value }) => ({
        done,
        value,
        generator,
        promise,
      }))
    return promise
  }
// next 里先把 promise 声明出来再在 then 里回填自身引用：这样每个队列元素都握着自己那一格的 promise，Promise.race 完成后能精确删除。
  const waiting = [...generators]
  const promises = new Set<Promise<QueuedGenerator<A>>>()

  // Start initial batch up to concurrency cap
  while (promises.size < concurrencyCap && waiting.length > 0) {
    const gen = waiting.shift()!
    promises.add(next(gen))
  }
// 初始批次按并发上限先填满：concurrencyCap 默认 Infinity，等于「全部同时开跑」；限流场景传具体数字即可。

  while (promises.size > 0) {
    const { done, value, generator, promise } = await Promise.race(promises)
    promises.delete(promise)

    if (!done) {
      promises.add(next(generator))
      // TODO: Clean this up
      if (value !== undefined) {
        yield value
      }
    } else if (waiting.length > 0) {
      // Start a new generator when one finishes
      const nextGen = waiting.shift()!
      promises.add(next(nextGen))
    }
  }
// 主循环靠 Promise.race 取最快完成的那个：未完成就续跑同一生成器，已完成就从 waiting 里补一个新的进来，因此并发度始终贴着上限。
}

export async function toArray<A>(
  generator: AsyncGenerator<A, void>,
): Promise<A[]> {
  const result: A[] = []
  for await (const a of generator) {
    result.push(a)
  }
  return result
}
// toArray 是便捷包装：把生成器彻底抽干成数组，用于「上游是流、下游要数组」的接缝。

export async function* fromArray<T>(values: T[]): AsyncGenerator<T, void> {
  for (const value of values) {
    yield value
  }
}
// fromArray 是反向适配器：把现成数组包成异步生成器，好让它和 all 这类只吃生成器的组合器直接对接。
