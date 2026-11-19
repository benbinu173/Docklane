import { useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  productCreateSchema,
  productUpdateSchema,
  warehouseCreateSchema,
  warehouseUpdateSchema,
  type ProductRecord,
  type WarehouseRecord,
} from '@docklane/contracts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { useIdentity } from '@/lib/identity-context'
import { useRefreshStock } from '@/lib/inventory-client'
import { ApiError } from '@/lib/auth-client'

function SaveFailure({ error }: { error: Error }) {
  return (
    <>
      <p className="auth-error" role="alert">
        {error.message}
      </p>
      {error instanceof ApiError && error.code === 'STALE_VERSION' && (
        <p className="p3-form-note">
          Close this form and open it again to review the latest saved details. Your current entries
          are kept until you close.
        </p>
      )}
    </>
  )
}

export function ProductEditor({
  product,
  close,
}: {
  product: ProductRecord | null
  close: () => void
}) {
  const { api } = useIdentity(),
    refresh = useRefreshStock()
  const [validation, setValidation] = useState('')
  const mutation = useMutation({
    mutationFn: (body: unknown) =>
      api(product ? `/products/${encodeURIComponent(product.sku)}` : '/products', {
        method: product ? 'PATCH' : 'POST',
        body,
      }),
    onError: async (error) => {
      if (error instanceof ApiError && error.code === 'STALE_VERSION') await refresh()
    },
    onSuccess: async () => {
      await refresh()
      toast.success(
        product
          ? 'Product updated. Existing order prices stay unchanged.'
          : 'Product created. Give it a warehouse to start tracking stock.',
      )
      close()
    },
  })
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget),
      price = String(form.get('price'))
    if (!/^\d+(\.\d{1,2})?$/.test(price)) {
      setValidation('Enter a price with at most two decimal places.')
      return
    }
    const fields = {
      name: String(form.get('name')),
      category: String(form.get('category')),
      pricePaise: Math.round(Number(price) * 100),
      image: String(form.get('image')) || '/product-placeholder.svg',
      color: String(form.get('color')),
    }
    const parsed = product
      ? productUpdateSchema.safeParse({ ...fields, expectedVersion: product.version })
      : productCreateSchema.safeParse({ ...fields, sku: String(form.get('sku')) })
    if (!parsed.success) {
      setValidation(parsed.error.issues[0].message)
      return
    }
    setValidation('')
    mutation.mutate(parsed.data)
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) close()
      }}
    >
      <DialogContent className="p3-editor">
        <DialogHeader>
          <span className="auth-eyebrow">THE START OF EVERY ORDER</span>
          <DialogTitle>
            {product ? 'Make the details count.' : 'Meet your next product.'}
          </DialogTitle>
          <DialogDescription>
            {product
              ? 'Update the catalog details. The SKU stays fixed so stock and history remain connected.'
              : 'Create a product with a unique SKU and a price in INR. Stock is tracked separately at each warehouse.'}
          </DialogDescription>
        </DialogHeader>
        <form className="p3-form" onSubmit={submit}>
          <fieldset disabled={mutation.isPending}>
            <label>
              Product name
              <Input
                name="name"
                defaultValue={product?.name}
                required
                minLength={2}
                maxLength={100}
                placeholder="e.g. Field notes notebook"
              />
            </label>
            <div className="p3-two-fields">
              <label>
                SKU
                <Input
                  name="sku"
                  defaultValue={product?.sku}
                  readOnly={!!product}
                  required
                  minLength={2}
                  maxLength={32}
                  placeholder="e.g. NOTE-001"
                  className="mono"
                />
              </label>
              <label>
                Category
                <Input
                  name="category"
                  defaultValue={product?.category}
                  required
                  minLength={2}
                  maxLength={60}
                  placeholder="e.g. Stationery"
                />
              </label>
            </div>
            <div className="p3-two-fields">
              <label>
                Price (INR)
                <Input
                  name="price"
                  type="number"
                  min="0.01"
                  max="20000000"
                  step="0.01"
                  required
                  defaultValue={product ? (product.pricePaise / 100).toFixed(2) : undefined}
                  placeholder="499.00"
                />
              </label>
              <label>
                Product backdrop
                <input name="color" type="color" defaultValue={product?.color ?? '#EDF2E8'} />
              </label>
            </div>
            <label>
              Image URL <span className="muted">(optional)</span>
              <Input
                name="image"
                defaultValue={product?.image === '/product-placeholder.svg' ? '' : product?.image}
                maxLength={500}
                placeholder="https://… or /images/…"
              />
            </label>
            <p className="p3-form-note">
              Leave the image blank to use Docklane’s parcel illustration.
            </p>
            {validation && (
              <p className="auth-error" role="alert">
                {validation}
              </p>
            )}
            {mutation.isError && <SaveFailure error={mutation.error} />}
            <div className="p3-form-actions">
              <Button type="button" className="btn-secondary" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" className="btn-primary">
                {mutation.isPending ? 'Saving…' : product ? 'Save product' : 'Create product'}
              </Button>
            </div>
          </fieldset>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function WarehouseEditor({
  warehouse,
  close,
}: {
  warehouse: WarehouseRecord | null
  close: () => void
}) {
  const { api } = useIdentity(),
    refresh = useRefreshStock()
  const [validation, setValidation] = useState('')
  const mutation = useMutation({
    mutationFn: (body: unknown) =>
      api(warehouse ? `/warehouses/${encodeURIComponent(warehouse.id)}` : '/warehouses', {
        method: warehouse ? 'PATCH' : 'POST',
        body,
      }),
    onError: async (error) => {
      if (error instanceof ApiError && error.code === 'STALE_VERSION') await refresh()
    },
    onSuccess: async () => {
      await refresh()
      toast.success(
        warehouse
          ? 'Warehouse details updated.'
          : 'Warehouse created. Your network has a new place.',
      )
      close()
    },
  })
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const fields = {
      name: String(form.get('name')),
      code: String(form.get('code')),
      city: String(form.get('city')),
      address: String(form.get('address')),
      lead: String(form.get('lead')),
      priority: Number(form.get('priority')),
    }
    const parsed = warehouse
      ? warehouseUpdateSchema.safeParse({ ...fields, expectedVersion: warehouse.version })
      : warehouseCreateSchema.safeParse(fields)
    if (!parsed.success) {
      setValidation(parsed.error.issues[0].message)
      return
    }
    setValidation('')
    mutation.mutate(parsed.data)
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) close()
      }}
    >
      <DialogContent className="p3-editor">
        <DialogHeader>
          <span className="auth-eyebrow">A PLACE FOR WHAT’S NEXT</span>
          <DialogTitle>
            {warehouse ? 'Keep your site in sync.' : 'Grow your warehouse network.'}
          </DialogTitle>
          <DialogDescription>
            A warehouse represents a physical site. Keep its address, site lead, and fulfillment
            priority up to date.
          </DialogDescription>
        </DialogHeader>
        <form className="p3-form" onSubmit={submit}>
          <fieldset disabled={mutation.isPending}>
            <label>
              Warehouse name
              <Input
                name="name"
                defaultValue={warehouse?.name}
                required
                minLength={2}
                maxLength={100}
                placeholder="e.g. Kochi Harbour"
              />
            </label>
            <div className="p3-two-fields">
              <label>
                Site code
                <Input
                  name="code"
                  defaultValue={warehouse?.code}
                  required
                  minLength={2}
                  maxLength={20}
                  placeholder="COK-01"
                />
              </label>
              <label>
                City
                <Input
                  name="city"
                  defaultValue={warehouse?.city}
                  required
                  minLength={2}
                  maxLength={80}
                  placeholder="Kochi"
                />
              </label>
            </div>
            <label>
              Street address
              <Input
                name="address"
                defaultValue={warehouse?.address}
                required
                minLength={5}
                maxLength={300}
                placeholder="Building, road, area, postal code"
              />
            </label>
            <div className="p3-two-fields">
              <label>
                Site lead
                <Input
                  name="lead"
                  defaultValue={warehouse?.lead}
                  required
                  minLength={2}
                  maxLength={80}
                  placeholder="Full name"
                />
              </label>
              <label>
                Fulfillment priority
                <Input
                  name="priority"
                  type="number"
                  min={0}
                  max={1000}
                  step={1}
                  defaultValue={warehouse?.priority ?? 0}
                  required
                />
              </label>
            </div>
            <p className="p3-form-note">
              Lower priorities will be considered first during warehouse selection in checkout.
            </p>
            {validation && (
              <p className="auth-error" role="alert">
                {validation}
              </p>
            )}
            {mutation.isError && <SaveFailure error={mutation.error} />}
            <div className="p3-form-actions">
              <Button type="button" className="btn-secondary" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" className="btn-primary">
                {mutation.isPending ? 'Saving…' : warehouse ? 'Save warehouse' : 'Create warehouse'}
              </Button>
            </div>
          </fieldset>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function ArchiveResource({
  resource,
  kind,
  close,
}: {
  resource: ProductRecord | WarehouseRecord
  kind: 'product' | 'warehouse'
  close: () => void
}) {
  const { api } = useIdentity(),
    refresh = useRefreshStock()
  const restoring = resource.archived
  const id = 'sku' in resource ? resource.sku : resource.id
  const mutation = useMutation({
    mutationFn: () =>
      api(`/${kind === 'product' ? 'products' : 'warehouses'}/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: { archived: !restoring, expectedVersion: resource.version },
      }),
    onSuccess: async () => {
      await refresh()
      toast.success(`${resource.name} ${restoring ? 'restored' : 'archived'}.`)
      close()
    },
  })
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) close()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {restoring ? 'Restore' : 'Archive'} {resource.name}?
          </DialogTitle>
          <DialogDescription>
            {restoring
              ? `Make this ${kind} active again.`
              : kind === 'product'
                ? 'Hide this product from the customer catalog. Products with reserved stock must stay active; their order history is preserved.'
                : 'Remove this site from the active warehouse network. Its stock must be empty and its open orders complete. History is preserved.'}
          </DialogDescription>
        </DialogHeader>
        {mutation.isError && (
          <p className="auth-error" role="alert">
            {mutation.error.message}
          </p>
        )}
        <div className="p3-form-actions">
          <Button className="btn-secondary" disabled={mutation.isPending} onClick={close}>
            Cancel
          </Button>
          <Button
            className={restoring ? 'btn-primary' : 'p3-danger-button'}
            disabled={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Saving…' : `${restoring ? 'Restore' : 'Archive'} ${kind}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
