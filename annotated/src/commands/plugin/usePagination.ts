import { useCallback, useMemo, useRef } from 'react'

// 默认可见五行：插件列表一屏放得下，再多就进入滚动
const DEFAULT_MAX_VISIBLE = 5

type UsePaginationOptions = {
  totalItems: number
  maxVisible?: number
  selectedIndex?: number
}

// 返回值里保留「页」这套命名只为兼容旧调用方，实际语义是连续滚动
type UsePaginationResult<T> = {
  // For backwards compatibility with page-based terminology
  currentPage: number
  totalPages: number
  startIndex: number
  endIndex: number
  needsPagination: boolean
  pageSize: number
  // Get visible slice of items
  getVisibleItems: (items: T[]) => T[]
  // Convert visible index to actual index
  toActualIndex: (visibleIndex: number) => number
  // Check if actual index is visible
  isOnCurrentPage: (actualIndex: number) => boolean
  // Navigation (kept for API compatibility)
  goToPage: (page: number) => void
  nextPage: () => void
  prevPage: () => void
  // Handle selection - just updates the index, scrolling is automatic
  handleSelectionChange: (
    newIndex: number,
    setSelectedIndex: (index: number) => void,
  ) => void
  // Page navigation - returns false for continuous scrolling (not needed)
  handlePageNavigation: (
    direction: 'left' | 'right',
    setSelectedIndex: (index: number) => void,
  ) => boolean
  // Scroll position info for UI display
  scrollPosition: {
    current: number
    total: number
    canScrollUp: boolean
    canScrollDown: boolean
  }
}

// 分页 Hook 的核心只有一件事：让选中项始终落在可见窗口内
export function usePagination<T>({
  totalItems,
  maxVisible = DEFAULT_MAX_VISIBLE,
  selectedIndex = 0,
}: UsePaginationOptions): UsePaginationResult<T> {
  const needsPagination = totalItems > maxVisible

  // Use a ref to track the previous scroll offset for smooth scrolling
// 用引用记住上次偏移：滚动是增量的，每帧从零重算会跳
  const scrollOffsetRef = useRef(0)

  // Compute the scroll offset based on selectedIndex
  // This ensures the selected item is always visible
// 偏移在渲染期算而不是放进副作用：返回值要当帧可用，晚一帧画面就会闪
  const scrollOffset = useMemo(() => {
    if (!needsPagination) return 0

    const prevOffset = scrollOffsetRef.current

    // If selected item is above the visible window, scroll up
// 选中项跑到窗口上方就整体上移
    if (selectedIndex < prevOffset) {
      scrollOffsetRef.current = selectedIndex
      return selectedIndex
    }

    // If selected item is below the visible window, scroll down
// 跑到下方就下移，下移量刚好让选中项贴到最后一行
    if (selectedIndex >= prevOffset + maxVisible) {
      const newOffset = selectedIndex - maxVisible + 1
      scrollOffsetRef.current = newOffset
      return newOffset
    }

    // Selected item is within visible window, keep current offset
    // But ensure offset is still valid
// 落在窗口内时保持偏移，但要夹住上限——列表变短后旧偏移会越界
    const maxOffset = Math.max(0, totalItems - maxVisible)
    const clampedOffset = Math.min(prevOffset, maxOffset)
    scrollOffsetRef.current = clampedOffset
    return clampedOffset
  }, [selectedIndex, maxVisible, needsPagination, totalItems])

  const startIndex = scrollOffset
  const endIndex = Math.min(scrollOffset + maxVisible, totalItems)

// 不溢出就原样返回，别做多余切片
  const getVisibleItems = useCallback(
    (items: T[]): T[] => {
      if (!needsPagination) return items
      return items.slice(startIndex, endIndex)
    },
    [needsPagination, startIndex, endIndex],
  )

  const toActualIndex = useCallback(
    (visibleIndex: number): number => {
      return startIndex + visibleIndex
    },
    [startIndex],
  )

  const isOnCurrentPage = useCallback(
    (actualIndex: number): boolean => {
      return actualIndex >= startIndex && actualIndex < endIndex
    },
    [startIndex, endIndex],
  )

  // These are mostly no-ops for continuous scrolling but kept for API compatibility
// 三个翻页函数是空实现：连续滚动下位置只由选中项决定，留着只为调用方不用改
  const goToPage = useCallback((_page: number) => {
    // No-op - scrolling is controlled by selectedIndex
  }, [])

  const nextPage = useCallback(() => {
    // No-op - scrolling is controlled by selectedIndex
  }, [])

  const prevPage = useCallback(() => {
    // No-op - scrolling is controlled by selectedIndex
  }, [])

  // Simple selection handler - just updates the index
  // Scrolling happens automatically via the useMemo above
// 选中变更只做夹取，滚动交给上面那段偏移计算
  const handleSelectionChange = useCallback(
    (newIndex: number, setSelectedIndex: (index: number) => void) => {
      const clampedIndex = Math.max(0, Math.min(newIndex, totalItems - 1))
      setSelectedIndex(clampedIndex)
    },
    [totalItems],
  )

  // Page navigation - disabled for continuous scrolling
  const handlePageNavigation = useCallback(
    (
      _direction: 'left' | 'right',
      _setSelectedIndex: (index: number) => void,
    ): boolean => {
      return false
    },
    [],
  )

  // Calculate page-like values for backwards compatibility
// 页数按可见行数向上取整，至少一页，免得界面上出现零页
  const totalPages = Math.max(1, Math.ceil(totalItems / maxVisible))
  const currentPage = Math.floor(scrollOffset / maxVisible)

  return {
    currentPage,
    totalPages,
    startIndex,
    endIndex,
    needsPagination,
    pageSize: maxVisible,
    getVisibleItems,
    toActualIndex,
    isOnCurrentPage,
    goToPage,
    nextPage,
    prevPage,
    handleSelectionChange,
    handlePageNavigation,
// 滚动位置从一数起，界面直接显示，不用再各加一
    scrollPosition: {
      current: selectedIndex + 1,
      total: totalItems,
      canScrollUp: scrollOffset > 0,
      canScrollDown: scrollOffset + maxVisible < totalItems,
    },
  }
}
