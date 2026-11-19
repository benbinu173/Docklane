import { useState, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { BookmarkSimple } from '@phosphor-icons/react/dist/csr/BookmarkSimple'
import { LinkSimple } from '@phosphor-icons/react/dist/csr/LinkSimple'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog'
import { useProfile } from '@/lib/identity-context'

type View = { name: string; query: string }
const keys: Record<string, string[]> = {
  inventory: ['q', 'warehouse', 'category', 'stock', 'archive', 'sort', 'direction'],
  orders: ['q', 'warehouse', 'status', 'payment', 'fulfillment', 'queue', 'from', 'to'],
}
function clean(value: string, kind: string) {
  const parsed = new URLSearchParams(value),
    safe = new URLSearchParams()
  for (const key of keys[kind]) {
    const value = parsed.get(key)
    if (value && value.length <= 100) safe.set(key, value)
  }
  return safe.toString()
}
export function SavedViews({ kind }: { kind: 'inventory' | 'orders' }) {
  const profile = useProfile().data!.data
  return (
    <PersonalViews
      key={`${profile.id}:${kind}`}
      storageKey={`docklane:views:v1:${profile.id}:${kind}`}
      kind={kind}
    />
  )
}
function PersonalViews({ storageKey, kind }: { storageKey: string; kind: 'inventory' | 'orders' }) {
  const [params, setParams] = useSearchParams()
  const [views, setViews] = useState<View[]>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]')
      return Array.isArray(saved)
        ? saved
            .slice(0, 8)
            .filter(
              (v): v is View =>
                typeof v?.name === 'string' &&
                v.name.length <= 40 &&
                typeof v?.query === 'string' &&
                v.query.length <= 2000,
            )
            .map((v) => ({ name: v.name, query: clean(v.query, kind) }))
        : []
    } catch {
      return []
    }
  })
  const [open, setOpen] = useState(false),
    [name, setName] = useState('')
  const returnFocus = useRef<HTMLButtonElement | null>(null)
  const current = clean(params.toString(), kind)
  const selected = views.findIndex((v) => v.query === current)
  function persist(next: View[]) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(next))
      setViews(next)
      return true
    } catch {
      toast.error('Your browser could not save this view. You can still copy its link.')
      return false
    }
  }
  return (
    <div className="p7-saved-views">
      <select
        aria-label={`Saved ${kind} views`}
        value={selected < 0 ? '' : String(selected)}
        onChange={(e) => {
          if (e.target.value !== '') setParams(views[Number(e.target.value)].query)
        }}
      >
        <option value="">Personal views</option>
        {views.map((v, i) => (
          <option key={v.name} value={i}>
            {v.name}
          </option>
        ))}
      </select>
      <Button
        ref={returnFocus}
        className="btn-secondary"
        onClick={() => {
          setName('')
          setOpen(true)
        }}
      >
        <BookmarkSimple size={17} />
        Save view
      </Button>
      <Button
        className="btn-secondary"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(window.location.href)
            toast.success('View link copied.')
          } catch {
            toast.error('Copy the address from your browser to share this view.')
          }
        }}
      >
        <LinkSimple size={17} />
        Copy link
      </Button>
      {selected >= 0 && (
        <button
          className="text-link"
          onClick={() => {
            if (persist(views.filter((_, i) => i !== selected)))
              toast.success('Personal view removed.')
          }}
        >
          Remove saved view
        </button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          onCloseAutoFocus={(e) => {
            e.preventDefault()
            returnFocus.current?.focus()
          }}
        >
          <DialogHeader>
            <DialogTitle>Save this {kind} view</DialogTitle>
            <DialogDescription>
              Keep up to eight named views for your account in this browser. Filters are included;
              the selected record and page are not.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              const trimmed = name.trim()
              if (!trimmed) return
              const existing = views.findIndex(
                (v) => v.name.toLowerCase() === trimmed.toLowerCase(),
              )
              if (existing < 0 && views.length >= 8) {
                toast.error('Remove a saved view before adding another.')
                return
              }
              const next = [...views]
              const view = { name: trimmed, query: current }
              if (existing >= 0) next[existing] = view
              else next.push(view)
              if (persist(next)) {
                setOpen(false)
                toast.success('View saved for this account.')
              }
            }}
          >
            <label htmlFor="view-name">View name</label>
            <Input
              id="view-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
              required
              placeholder="Morning packing queue"
            />
            <div className="p7-dialog-actions">
              <Button type="button" className="btn-secondary" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button className="btn-primary" disabled={!name.trim()}>
                Save personal view
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
