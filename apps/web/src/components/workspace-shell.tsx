import { useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Command as CommandMenu } from 'cmdk'
import { ArrowCounterClockwise } from '@phosphor-icons/react/dist/csr/ArrowCounterClockwise'
import { ArrowRight } from '@phosphor-icons/react/dist/csr/ArrowRight'
import { Bell } from '@phosphor-icons/react/dist/csr/Bell'
import { CaretDown } from '@phosphor-icons/react/dist/csr/CaretDown'
import { Check } from '@phosphor-icons/react/dist/csr/Check'
import { Command } from '@phosphor-icons/react/dist/csr/Command'
import { CreditCard } from '@phosphor-icons/react/dist/csr/CreditCard'
import { Cube } from '@phosphor-icons/react/dist/csr/Cube'
import { GearSix } from '@phosphor-icons/react/dist/csr/GearSix'
import { House } from '@phosphor-icons/react/dist/csr/House'
import { List } from '@phosphor-icons/react/dist/csr/List'
import { MagnifyingGlass } from '@phosphor-icons/react/dist/csr/MagnifyingGlass'
import { Package } from '@phosphor-icons/react/dist/csr/Package'
import { Pulse } from '@phosphor-icons/react/dist/csr/Pulse'
import { Question } from '@phosphor-icons/react/dist/csr/Question'
import { Receipt } from '@phosphor-icons/react/dist/csr/Receipt'
import { Warehouse } from '@phosphor-icons/react/dist/csr/Warehouse'
import { X } from '@phosphor-icons/react/dist/csr/X'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useWorkspace } from '@/hooks/use-workspace'
import { useDemo } from '@/lib/demo-context'
import { getProduct, isLow, products, warehouses } from '@/data/demo'
import { Hint } from '@/components/shared'

const navigation = [
  { path: '/', label: 'Overview', icon: House },
  { path: '/inventory', label: 'Inventory', icon: Cube },
  { path: '/warehouses', label: 'Warehouses', icon: Warehouse },
  { path: '/orders', label: 'Orders', icon: Receipt },
  { path: '/payments', label: 'Payments', icon: CreditCard },
  { path: '/activity', label: 'Activity', icon: Pulse },
  { path: '/settings', label: 'Settings', icon: GearSix },
]

export function WarehouseSelect() {
  const { warehouse, update } = useWorkspace()
  return (
    <Select value={warehouse} onValueChange={(value) => update({ warehouse: value })}>
      <SelectTrigger className="warehouse-select" aria-label="Filter by warehouse">
        <Warehouse size={16} />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All warehouses</SelectItem>
        {warehouses.map((item) => (
          <SelectItem key={item.id} value={item.id}>
            {item.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function HelpDialog({ children }: { children: ReactNode }) {
  const { go } = useWorkspace()
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="guide-dialog">
        <DialogHeader>
          <div className="guide-symbol">
            <Package size={30} weight="duotone" />
          </div>
          <DialogTitle>A little less searching. A lot more moving.</DialogTitle>
          <DialogDescription>
            Welcome to Docklane’s interactive prototype. Explore your sample business from stock to
            shipment.
          </DialogDescription>
        </DialogHeader>
        <div className="guide-links">
          {[
            [
              '/',
              'See the big picture',
              'Your orders, warehouse activity, and items needing attention.',
            ],
            [
              '/inventory',
              'Get to know your stock',
              'Search, combine filters, inspect history, and try a demo adjustment.',
            ],
            ['/orders', 'Follow an order', 'Open details and try packing a paid sample order.'],
          ].map(([path, label, text]) => (
            <button
              key={path}
              onClick={() => {
                setOpen(false)
                go(path)
              }}
            >
              <div>
                <strong>{label}</strong>
                <span>{text}</span>
              </div>
              <ArrowRight size={20} />
            </button>
          ))}
        </div>
        <p className="guide-note">
          <Command size={16} />
          Use Ctrl+K or Cmd+K to jump anywhere.
        </p>
        <div className="demo-note">
          All records are sample data. Demo changes reset when you reload. Live inventory and
          payments arrive in later phases.
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Sidebar({ close }: { close?: () => void }) {
  const location = useLocation()
  const { go } = useWorkspace()
  const { orders } = useDemo()
  const openOrders = orders.filter(
    (order) => !['shipped', 'cancelled'].includes(order.stage),
  ).length
  return (
    <aside className="sidebar">
      <button
        className="brand"
        aria-label="Docklane overview"
        onClick={() => {
          go('/')
          close?.()
        }}
      >
        <img src="/favicon.svg" alt="" width={36} height={36} />
        <span>
          docklane<span className="brand-period">.</span>
        </span>
      </button>
      <div className="workspace-card">
        <span className="workspace-avatar">N</span>
        <div>
          <strong>Northstar Supply</strong>
          <span>Operations workspace</span>
        </div>
        <span className="workspace-lock" aria-hidden="true">
          <Check size={14} weight="bold" />
        </span>
      </div>
      <p className="nav-label">WORKSPACE</p>
      <nav aria-label="Main navigation">
        {navigation.map(({ path, label, icon: Icon }) => (
          <button
            key={path}
            className={`nav-item ${location.pathname === path ? 'active' : ''}`}
            aria-current={location.pathname === path ? 'page' : undefined}
            onClick={() => {
              go(path)
              close?.()
            }}
          >
            <Icon size={20} weight={location.pathname === path ? 'fill' : 'regular'} />
            <span>{label}</span>
            {path === '/orders' && <span className="nav-count">{openOrders}</span>}
          </button>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <Link
          className="guide-button prototype-signin"
          to="/auth/sign-in"
          onClick={() => close?.()}
        >
          Sign in to Docklane
          <ArrowRight size={16} />
        </Link>
        <div className="sidebar-help">
          <div className="help-icon">
            <Question size={22} weight="duotone" />
          </div>
          <h3>Find your next move.</h3>
          <p>A quick guide to your workspace.</p>
          <HelpDialog>
            <button className="guide-button">
              Explore Docklane
              <ArrowRight size={16} />
            </button>
          </HelpDialog>
        </div>
        <div className="sidebar-demo">
          <span className="demo-signal" />
          Demo workspace<span className="demo-tag">PHASE 01</span>
        </div>
        <div className="sidebar-user">
          <span className="avatar ben-avatar">BT</span>
          <div>
            <strong>Ben Thomas</strong>
            <span>Workspace admin</span>
          </div>
          <Hint label="Workspace settings">
            <button
              className="sidebar-icon"
              aria-label="Workspace settings"
              onClick={() => {
                go('/settings')
                close?.()
              }}
            >
              <GearSix size={19} />
            </button>
          </Hint>
        </div>
      </div>
    </aside>
  )
}

function SearchDialog({ open, setOpen }: { open: boolean; setOpen: (open: boolean) => void }) {
  const { go } = useWorkspace()
  const { orders } = useDemo()
  const [query, setQuery] = useState('')
  const select = (path: string, values: Record<string, string> = {}) => {
    setOpen(false)
    setQuery('')
    go(path, values)
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        setOpen(value)
        if (!value) setQuery('')
      }}
    >
      <DialogContent className="command-dialog" showCloseButton={false}>
        <DialogTitle className="sr-only">Search Docklane</DialogTitle>
        <DialogDescription className="sr-only">
          Search pages, products, and sample orders. Use arrow keys to select a result and Enter to
          open it.
        </DialogDescription>
        <CommandMenu loop>
          <div className="command-input-wrap">
            <MagnifyingGlass size={22} />
            <CommandMenu.Input
              autoFocus
              value={query}
              onValueChange={setQuery}
              placeholder="Where would you like to go?"
              aria-label="Search pages, products, and orders"
            />
            <button aria-label="Esc, close search" className="key" onClick={() => setOpen(false)}>
              Esc
            </button>
          </div>
          <CommandMenu.List>
            <CommandMenu.Empty>
              No results. Try a product name, SKU, customer, or order ID.
            </CommandMenu.Empty>
            <CommandMenu.Group heading="Workspace">
              {navigation.map(({ path, label, icon: Icon }) => (
                <CommandMenu.Item key={path} value={`page ${label}`} onSelect={() => select(path)}>
                  <Icon size={19} />
                  <span>{label}</span>
                  <ArrowRight size={16} className="command-arrow" />
                </CommandMenu.Item>
              ))}
            </CommandMenu.Group>
            <CommandMenu.Group heading="Products">
              {products.map((product) => (
                <CommandMenu.Item
                  key={product.sku}
                  value={`${product.name} ${product.sku}`}
                  onSelect={() => select('/inventory', { q: product.sku })}
                >
                  <Cube size={19} />
                  <span>{product.name}</span>
                  <span className="mono tiny muted">{product.sku}</span>
                </CommandMenu.Item>
              ))}
            </CommandMenu.Group>
            <CommandMenu.Group heading="Orders">
              {orders.map((order) => (
                <CommandMenu.Item
                  key={order.id}
                  value={`${order.id} ${order.customer} ${order.items.map((item) => getProduct(item.sku).name).join(' ')}`}
                  onSelect={() => select('/orders', { order: order.id })}
                >
                  <Receipt size={19} />
                  <span>{order.customer}</span>
                  <span className="mono tiny muted">{order.id}</span>
                </CommandMenu.Item>
              ))}
            </CommandMenu.Group>
          </CommandMenu.List>
          <div className="command-footer">
            <span>
              <kbd>↑</kbd>
              <kbd>↓</kbd> to navigate
            </span>
            <span>
              <kbd>↵</kbd> to open
            </span>
            <span>Search your demo workspace</span>
          </div>
        </CommandMenu>
      </DialogContent>
    </Dialog>
  )
}

export function WorkspaceShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const { go } = useWorkspace()
  const { stock, orders, resetDemo, previewState, setPreviewState } = useDemo()
  const [searchOpen, setSearchOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [notificationsRead, setNotificationsRead] = useState(false)
  const currentPage = navigation.find((page) => page.path === pathname)?.label ?? 'Workspace'
  const alertCount =
    stock.filter(isLow).length + orders.filter((order) => order.stage === 'awaiting').length
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setSearchOpen((value) => !value)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <div className="desktop-sidebar">
        <Sidebar />
      </div>
      <Dialog open={menuOpen} onOpenChange={setMenuOpen}>
        <DialogContent className="mobile-sidebar" showCloseButton={false} centered={false}>
          <DialogTitle className="sr-only">Main navigation</DialogTitle>
          <DialogDescription className="sr-only">
            Navigate your Docklane workspace.
          </DialogDescription>
          <button
            className="mobile-menu-close"
            aria-label="Close navigation"
            onClick={() => setMenuOpen(false)}
          >
            <X size={20} />
          </button>
          <Sidebar close={() => setMenuOpen(false)} />
        </DialogContent>
      </Dialog>
      <div className="workspace-main">
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              className="icon-button mobile-menu-button"
              aria-label="Open navigation"
              onClick={() => setMenuOpen(true)}
            >
              <List size={22} />
            </button>
            <span className="breadcrumb-root">Workspace</span>
            <span className="breadcrumb-slash">/</span>
            <strong>{currentPage}</strong>
          </div>
          <div className="topbar-right">
            <button
              className="global-search"
              aria-label="Search Docklane ⌘ K"
              aria-keyshortcuts="Control+k Meta+k"
              onClick={() => setSearchOpen(true)}
            >
              <MagnifyingGlass size={17} />
              <span>Search Docklane </span>
              <kbd aria-hidden="true">⌘ K</kbd>
            </button>
            <div className="topbar-separator" />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="icon-button notification-button"
                  aria-label={`Notifications${notificationsRead ? ', all read' : `, ${alertCount} items need attention`}`}
                >
                  <Bell size={21} />
                  {!notificationsRead && alertCount > 0 && <span className="notification-dot" />}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="notification-menu">
                <DropdownMenuLabel className="notification-title">
                  Your attention queue
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => go('/inventory', { stock: 'low' })}>
                  <Cube size={20} />
                  <div>
                    <strong>{stock.filter(isLow).length} stock levels need attention</strong>
                    <span>Review items at or below their threshold.</span>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => go('/orders', { stage: 'awaiting' })}>
                  <Receipt size={20} />
                  <div>
                    <strong>
                      {orders.filter((order) => order.stage === 'awaiting').length} orders await
                      payment
                    </strong>
                    <span>Open the reservation queue.</span>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setNotificationsRead(true)}>
                  <Check size={16} />
                  {notificationsRead ? 'All notifications read' : 'Mark all as read'}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="profile-trigger" aria-label="BT, Ben Thomas account menu">
                  <span className="avatar ben-avatar">BT</span>
                  <CaretDown size={13} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>
                  <div className="account-label">
                    <strong>Ben Thomas</strong>
                    <span>Admin · demo account</span>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => go('/settings')}>
                  <GearSix size={17} />
                  Workspace settings
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={resetDemo}>
                  <ArrowCounterClockwise size={17} />
                  Reset sample data
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        {previewState !== 'populated' && (
          <div className="preview-banner" role="status">
            <span>
              Previewing the{' '}
              <strong>{previewState === 'error' ? 'unavailable' : previewState}</strong> state.
            </span>
            <button onClick={() => setPreviewState('populated')}>
              Return to demo
              <X size={14} />
            </button>
          </div>
        )}
        <main id="main-content" className="main-content">
          {children}
          <footer className="workspace-footer">
            <span>
              Docklane<span className="footer-dot">·</span>Every order, moving forward.
            </span>
            <button onClick={() => go('/settings')}>
              Sample data<span className="footer-dot">·</span>18 Nov 2026
            </button>
          </footer>
        </main>
      </div>
      <SearchDialog open={searchOpen} setOpen={setSearchOpen} />
    </div>
  )
}
