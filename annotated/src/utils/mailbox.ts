// `Mailbox` 是一个轻量消息信箱，用于多智能体或后台任务之间的点对点通信：发送方入队或唤醒等待方，接收方可轮询或挂起等待。
import { createSignal } from './signal.js'

// `MessageSource` 区分消息来源：用户、队友、系统、心跳或任务。
export type MessageSource = 'user' | 'teammate' | 'system' | 'tick' | 'task'

// `Message` 是信箱里流转的单位，携带来源、内容、发送者与颜色等元信息。
export type Message = {
  id: string
  source: MessageSource
  content: string
  from?: string
  color?: string
  timestamp: string
}

type Waiter = {
  fn: (msg: Message) => boolean
  resolve: (msg: Message) => void
}

// `Mailbox` 类内部用队列存放未消费消息、用等待者列表存放挂起读取，并借信号通知订阅者。
export class Mailbox {
  private queue: Message[] = []
  private waiters: Waiter[] = []
  private changed = createSignal()
  private _revision = 0

  get length(): number {
    return this.queue.length
  }

  get revision(): number {
    return this._revision
  }

// `send` 先尝试用匹配函数唤醒一个等待者（命中即兑现并通知），否则把消息压入队列并通知订阅者。
  send(msg: Message): void {
    this._revision++
    const idx = this.waiters.findIndex(w => w.fn(msg))
    if (idx !== -1) {
      const waiter = this.waiters.splice(idx, 1)[0]
      if (waiter) {
        waiter.resolve(msg)
        this.notify()
        return
      }
    }
    this.queue.push(msg)
    this.notify()
  }

// `poll` 同步地从队列里取走第一条匹配消息，不匹配则返回空；不阻塞、不等待。
  poll(fn: (msg: Message) => boolean = () => true): Message | undefined {
    const idx = this.queue.findIndex(fn)
    if (idx === -1) return undefined
    return this.queue.splice(idx, 1)[0]
  }

// `receive` 若队列已有匹配消息立即返回，否则把解析回调压入等待者列表，待 `send` 唤醒后才兑现 Promise。
  receive(fn: (msg: Message) => boolean = () => true): Promise<Message> {
    const idx = this.queue.findIndex(fn)
    if (idx !== -1) {
      const msg = this.queue.splice(idx, 1)[0]
      if (msg) {
        this.notify()
        return Promise.resolve(msg)
      }
    }
    return new Promise<Message>(resolve => {
      this.waiters.push({ fn, resolve })
    })
  }

  subscribe = this.changed.subscribe

  private notify(): void {
    this.changed.emit()
  }
}
