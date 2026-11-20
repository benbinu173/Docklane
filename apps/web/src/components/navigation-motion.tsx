import { useId, type ReactNode } from 'react'
import { LayoutGroup, motion } from 'motion/react'
import { useMotionPreference } from '@/hooks/use-motion-preference'

export function NavigationSurface({ label, children }: { label: string; children: ReactNode }) {
  const id = useId()
  return (
    <LayoutGroup id={id}>
      <nav aria-label={label}>{children}</nav>
    </LayoutGroup>
  )
}

export function NavigationHighlight() {
  const reduced = useMotionPreference()
  return (
    <motion.span
      className="nav-active-surface"
      aria-hidden="true"
      layoutId="active-lane"
      transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 35 }}
    />
  )
}
