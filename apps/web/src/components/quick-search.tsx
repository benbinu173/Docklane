import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Command } from 'cmdk'
import { MagnifyingGlass } from '@phosphor-icons/react/dist/csr/MagnifyingGlass'
import { ArrowUpRight } from '@phosphor-icons/react/dist/csr/ArrowUpRight'
import { useIdentity, useProfile } from '@/lib/identity-context'
import { useDebounced } from '@/lib/operations-client'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from './ui/dialog'
import type { SearchResult } from '@docklane/contracts'

export function QuickSearch() {
  const [open, setOpen] = useState(false),
    [text, setText] = useState('')
  const returnFocus = useRef<HTMLElement | null>(null)
  const search = useDebounced(text.trim()),
    { api } = useIdentity(),
    profile = useProfile().data!.data,
    navigate = useNavigate()
  const customer = profile.role === 'CUSTOMER'
  const query = useQuery({
    queryKey: ['connected', 'search', profile.id, search],
    queryFn: () => api<{ data: SearchResult[] }>(`/search?q=${encodeURIComponent(search)}`),
    enabled: open && search.length >= 2 && search.length <= 100,
  })
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        if (!open) returnFocus.current = document.activeElement as HTMLElement | null
        setOpen((value) => !value)
      }
    }
    document.addEventListener('keydown', listener)
    return () => document.removeEventListener('keydown', listener)
  }, [open])
  const routes = customer
    ? [
        ['Collection', '/account/catalog'],
        ['My bag', '/account/cart'],
        ['My orders', '/account/orders'],
        ['My account', '/account'],
      ]
    : [
        ['Overview', '/workspace'],
        ['Products', '/workspace/products'],
        ['Inventory', '/workspace/inventory'],
        ['Warehouses', '/workspace/warehouses'],
        ['Orders', '/workspace/orders'],
        ['Background tasks', '/workspace/operations'],
        ...(profile.role === 'ADMIN' ? [['People & access', '/workspace/team']] : []),
        ['My account', '/account'],
      ]
  const go = (href: string) => {
    setOpen(false)
    navigate(href)
  }
  return (
    <>
      <button
        className="p7-search-trigger"
        aria-label="Open quick search Ctrl K"
        aria-keyshortcuts="Control+k Meta+k"
        onClick={(e) => {
          returnFocus.current = e.currentTarget
          setText('')
          setOpen(true)
        }}
      >
        <MagnifyingGlass size={19} />
        <span>Quick search</span> <kbd aria-hidden="true">Ctrl K</kbd>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="p7-command-dialog"
          onCloseAutoFocus={(e) => {
            e.preventDefault()
            returnFocus.current?.focus()
          }}
        >
          <DialogTitle className="sr-only">Quick search</DialogTitle>
          <DialogDescription className="sr-only">
            Find orders, products, and pages. Use arrow keys to choose a result and Enter to open
            it.
          </DialogDescription>
          <Command shouldFilter={false} label="Search Docklane">
            <Command.Input
              value={text}
              onValueChange={setText}
              maxLength={100}
              placeholder={
                customer
                  ? 'Find your order, product, or page…'
                  : 'Find an order, product, warehouse, or page…'
              }
              aria-label="Search Docklane"
            />
            <Command.List>
              <Command.Group heading="Go to">
                {routes
                  .filter(([name]) => name.toLowerCase().includes(text.toLowerCase()))
                  .map(([label, href]) => (
                    <Command.Item key={href} value={href} onSelect={() => go(href)}>
                      {label}
                      <ArrowUpRight size={16} />
                    </Command.Item>
                  ))}
              </Command.Group>
              {text.trim().length >= 2 && (search !== text.trim() || query.isPending) && (
                <p role="status" className="p7-search-state">
                  Searching saved records…
                </p>
              )}
              {query.isError && search === text.trim() && (
                <div className="p7-search-state" role="alert">
                  <p>{query.error.message}</p>
                  <button
                    className="text-link"
                    onClick={() => {
                      void query.refetch()
                    }}
                  >
                    Retry search
                  </button>
                </div>
              )}
              {search === text.trim() && search.length >= 2 && query.data && (
                <Command.Group heading="Saved records">
                  {query.data.data.map((item) => (
                    <Command.Item
                      key={`${item.kind}:${item.id}`}
                      value={`${item.kind}:${item.id}`}
                      onSelect={() => go(item.href)}
                    >
                      <span>
                        <strong>{item.label}</strong>
                        <small>{item.detail}</small>
                      </span>
                      <span className="muted">{item.kind}</span>
                    </Command.Item>
                  ))}
                  {!query.data.data.length && (
                    <p className="p7-search-state">
                      No saved records match. Try an order number, SKU, or product name.
                    </p>
                  )}
                </Command.Group>
              )}
              {text.trim().length < 2 && (
                <p className="p7-search-state">
                  Type at least two characters to search your saved records.
                </p>
              )}
            </Command.List>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  )
}
