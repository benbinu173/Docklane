import { lazy } from 'react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from 'sonner'
import { Routes, Route, useParams } from 'react-router-dom'
import { IdentityProvider } from '@/lib/identity-context'
import { CartProvider } from '@/lib/cart-context'
import { Authentication } from './authentication'
import {
  Protected,
  ConnectedLayout,
  ConnectedOrders,
  ConnectedOrderDetail,
  Team,
  Account,
} from './connected'
import '@/identity.css'
import '@/phase3.css'
import '@/phase4.css'
import '@/phase5.css'
import '@/phase6.css'
import '@/phase7.css'
import ConnectedOverview from './connected-overview'

const InventoryWorkspace = lazy(() =>
  import('./inventory-workspace').then((module) => ({ default: module.InventoryWorkspace })),
)
const ProductsWorkspace = lazy(() => import('./products-workspace'))
const WarehousesWorkspace = lazy(() => import('./warehouses-workspace'))
const WarehouseDetail = lazy(() =>
  import('./warehouses-workspace').then((module) => ({ default: module.WarehouseDetail })),
)
const CustomerCatalog = lazy(() => import('./customer-catalog'))
const CatalogDetail = lazy(() =>
  import('./customer-catalog').then((module) => ({ default: module.CatalogDetail })),
)
const CustomerBag = lazy(() =>
  import('./customer-checkout').then((module) => ({ default: module.CustomerBag })),
)
const CustomerCheckout = lazy(() =>
  import('./customer-checkout').then((module) => ({ default: module.CustomerCheckout })),
)
const Operations = lazy(() => import('./operations'))

export default function IdentityApp() {
  return (
    <TooltipProvider delayDuration={250}>
      <IdentityProvider>
        <CartProvider>
          <Routes>
            <Route path="/auth/:view" element={<AuthRoute />} />
            <Route
              element={
                <Protected staff>
                  <ConnectedLayout />
                </Protected>
              }
            >
              <Route path="/workspace" element={<ConnectedOverview />} />
              <Route path="/workspace/orders" element={<ConnectedOrders />} />
              <Route path="/workspace/operations" element={<Operations />} />
              <Route path="/workspace/orders/:identifier" element={<ConnectedOrderDetail />} />
              <Route path="/workspace/team" element={<Team />} />
              <Route path="/workspace/products" element={<ProductsWorkspace />} />
              <Route path="/workspace/inventory" element={<InventoryWorkspace />} />
              <Route path="/workspace/warehouses" element={<WarehousesWorkspace />} />
              <Route path="/workspace/warehouses/:id" element={<WarehouseDetail />} />
            </Route>
            <Route
              element={
                <Protected>
                  <ConnectedLayout />
                </Protected>
              }
            >
              <Route path="/account" element={<Account />} />
              <Route path="/account/orders" element={<ConnectedOrders />} />
              <Route path="/account/orders/:identifier" element={<ConnectedOrderDetail />} />
              <Route path="/account/catalog" element={<CustomerCatalog />} />
              <Route path="/account/catalog/:sku" element={<CatalogDetail />} />
              <Route path="/account/cart" element={<CustomerBag />} />
              <Route path="/account/checkout" element={<CustomerCheckout />} />
            </Route>
            <Route path="*" element={<Authentication />} />
          </Routes>
        </CartProvider>
      </IdentityProvider>
      <Toaster
        position="bottom-right"
        richColors
        closeButton
        toastOptions={{ className: 'docklane-toast' }}
      />
    </TooltipProvider>
  )
}

function AuthRoute() {
  const { view } = useParams()
  return <Authentication key={view} />
}
