import type { JSX } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Menu, MenuLabel } from '@/components/ui/menu'
import { CARD_FIELD_LABELS, type CardFields } from '@/hooks/useCardFields'

interface CardFieldsMenuProps {
  fields: CardFields
  onChange: (key: keyof CardFields, value: boolean) => void
}

/** 헤더의 "표시 항목" — 카드에 이름 말고 무엇을 더 보여줄지 체크한다 */
export function CardFieldsMenu({ fields, onChange }: CardFieldsMenuProps): JSX.Element {
  return (
    <Menu
      trigger={({ toggle, 'aria-expanded': expanded }) => (
        <Button variant="outline" size="sm" onClick={toggle} aria-expanded={expanded}>
          <SlidersHorizontal />
          표시 항목
        </Button>
      )}
    >
      {() => (
        <>
          <MenuLabel>카드에 보여줄 것</MenuLabel>
          {(Object.keys(CARD_FIELD_LABELS) as (keyof CardFields)[]).map((key) => (
            <label
              key={key}
              className="hover:bg-accent flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-xs"
            >
              <Checkbox checked={fields[key]} onChange={(e) => onChange(key, e.target.checked)} />
              {CARD_FIELD_LABELS[key]}
            </label>
          ))}
          <p className="text-muted-foreground px-2 pt-1 pb-0.5 text-[11px]">이름은 항상 보입니다</p>
        </>
      )}
    </Menu>
  )
}
