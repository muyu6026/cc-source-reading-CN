import * as React from 'react'

interface Props {
  children: React.ReactNode
}

interface State {
  hasError: boolean
}

// 整个前端唯一一个类组件：错误边界只能由类实现，函数组件没有对应的钩子
export class SentryErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(): State {
// 只置错误标记，不接住 error 对象——上报交给 Sentry 自己的钩子，边界只负责别让整棵树崩掉
    return { hasError: true }
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
// 出错渲染 null：终端里没有能安全承载报错的容器，静默比半屏乱码更好
      return null
    }

    return this.props.children
  }
}
