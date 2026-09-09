import { useState, type JSX } from 'react'
import {
  CATEGORY_LABELS,
  FILE_CATEGORIES,
  type CategoryBreakdown,
  type FileCategory
} from '@shared/types'
import { formatBytes, formatCount, formatPercent } from '@/lib/format'
import { cn } from '@/lib/utils'

/**
 * 색은 카테고리에 고정으로 붙는다. 정렬 순서나 항목 개수가 바뀌어도 '이미지'는 늘 같은 색이다.
 * (순위에 색을 붙이면 필터를 걸 때마다 색이 뒤바뀌어 읽는 사람이 매번 다시 익혀야 한다)
 */
const CATEGORY_COLOR: Record<FileCategory, string> = {
  document: 'var(--chart-document)',
  image: 'var(--chart-image)',
  video: 'var(--chart-video)',
  audio: 'var(--chart-audio)',
  archive: 'var(--chart-archive)',
  installer: 'var(--chart-installer)',
  code: 'var(--chart-code)',
  other: 'var(--chart-other)'
}

interface CategoryChartProps {
  breakdown: CategoryBreakdown[]
  totalBytes: number
}

/**
 * 파일 종류별 구성.
 *
 * 위쪽 띠는 전체 대비 비율(부분-전체)을, 아래 목록은 정확한 수치를 보여준다.
 * 목록이 곧 범례이자 표라서, 색만으로 정보를 전달하는 구간이 없다.
 *
 * 띠의 순서는 크기순이 아니라 카테고리 고정 순서다. 인접한 색끼리 구별되도록
 * 검증된 배치를 유지하려면 순서가 데이터에 따라 흔들리면 안 되기 때문이다.
 */
export function CategoryChart({ breakdown, totalBytes }: CategoryChartProps): JSX.Element {
  const [hovered, setHovered] = useState<FileCategory | null>(null)

  if (breakdown.length === 0 || totalBytes <= 0) {
    return <p className="text-muted-foreground text-xs">표시할 파일이 없습니다.</p>
  }

  const byCategory = new Map(breakdown.map((b) => [b.category, b]))

  // 띠: 카테고리 고정 순서
  const stacked = FILE_CATEGORIES.map((category) => byCategory.get(category)).filter(
    (b): b is CategoryBreakdown => b !== undefined
  )

  // 목록: 용량 큰 순서
  const ranked = [...breakdown].sort((a, b) => b.bytes - a.bytes)

  const hoveredItem = hovered ? byCategory.get(hovered) : undefined

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        {/* 마우스를 올린 조각의 값. 목록에도 같은 값이 늘 떠 있어 이건 거들기만 한다 */}
        <div
          className={cn(
            'text-muted-foreground mb-1.5 h-4 text-xs transition-opacity',
            hoveredItem ? 'opacity-100' : 'opacity-0'
          )}
        >
          {hoveredItem && (
            <>
              <span className="text-foreground font-medium">
                {CATEGORY_LABELS[hoveredItem.category]}
              </span>{' '}
              {formatBytes(hoveredItem.bytes)} · {formatPercent(hoveredItem.bytes / totalBytes)}
            </>
          )}
        </div>

        <div className="flex h-2.5 gap-[2px] overflow-hidden">
          {stacked.map((item) => (
            <div
              key={item.category}
              // 아주 작은 조각도 최소 3px은 보이게 한다
              style={{
                flexGrow: Math.max(item.bytes, 1),
                flexBasis: 0,
                minWidth: 3,
                backgroundColor: CATEGORY_COLOR[item.category]
              }}
              className={cn(
                'h-full rounded-[2px] transition-opacity',
                hovered !== null && hovered !== item.category && 'opacity-35'
              )}
              onMouseEnter={() => setHovered(item.category)}
              onMouseLeave={() => setHovered(null)}
              title={`${CATEGORY_LABELS[item.category]} ${formatBytes(item.bytes)}`}
            />
          ))}
        </div>
      </div>

      <ul className="flex flex-col gap-1.5">
        {ranked.map((item) => (
          <li
            key={item.category}
            className={cn(
              'flex items-center gap-2 text-xs transition-opacity',
              hovered !== null && hovered !== item.category && 'opacity-45'
            )}
            onMouseEnter={() => setHovered(item.category)}
            onMouseLeave={() => setHovered(null)}
          >
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-[2px]"
              style={{ backgroundColor: CATEGORY_COLOR[item.category] }}
            />
            <span className="w-14 shrink-0">{CATEGORY_LABELS[item.category]}</span>
            <span className="text-muted-foreground w-16 shrink-0 text-right tabular-nums">
              {formatCount(item.count)}개
            </span>
            <span className="w-20 shrink-0 text-right tabular-nums">{formatBytes(item.bytes)}</span>
            <span className="text-muted-foreground ml-auto tabular-nums">
              {formatPercent(item.bytes / totalBytes)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
