export type WarehouseId = 'kochi' | 'bengaluru' | 'mumbai'
export type OrderStage = 'awaiting' | 'ready' | 'packed' | 'shipped' | 'cancelled'
export type PreviewState = 'populated' | 'loading' | 'empty' | 'error'

export interface Product {
  sku: string
  name: string
  category: string
  price: number
  image: string
  color: string
}
export interface Warehouse {
  id: WarehouseId
  name: string
  city: string
  code: string
  address: string
  lead: string
}
export interface OrderItem {
  sku: string
  quantity: number
}
export interface Order {
  id: string
  customer: string
  email: string
  initials: string
  avatarColor: string
  warehouse: WarehouseId
  stage: OrderStage
  items: OrderItem[]
  createdAt: string
  address: string
}
export interface StockItem {
  id: string
  sku: string
  warehouse: WarehouseId
  onHand: number
  reserved: number
  threshold: number
  adjustments: { quantity: number; reason: string; time: string }[]
}

export const demoDate = new Date('2026-11-18T15:00:00+05:30')
export const warehouses: Warehouse[] = [
  {
    id: 'kochi',
    name: 'Kochi Central',
    city: 'Kochi',
    code: 'KOC-01',
    address: 'Kalamassery, Kochi, Kerala',
    lead: 'Arjun Nair',
  },
  {
    id: 'bengaluru',
    name: 'Bengaluru East',
    city: 'Bengaluru',
    code: 'BLR-02',
    address: 'Whitefield, Bengaluru, Karnataka',
    lead: 'Priya Rao',
  },
  {
    id: 'mumbai',
    name: 'Mumbai North',
    city: 'Mumbai',
    code: 'MUM-03',
    address: 'Bhiwandi, Mumbai, Maharashtra',
    lead: 'Rohan Shah',
  },
]

export const products: Product[] = [
  {
    sku: 'AUD-001',
    name: 'Studio Headphones',
    category: 'Electronics',
    price: 499900,
    image: '/images/headphones.jpg',
    color: '#f4e6b8',
  },
  {
    sku: 'BAG-002',
    name: 'Everyday Tote',
    category: 'Accessories',
    price: 249900,
    image: '/images/backpack.jpg',
    color: '#e8ded3',
  },
  {
    sku: 'SHO-003',
    name: 'Trail Runner',
    category: 'Footwear',
    price: 399900,
    image: '/images/sneakers.jpg',
    color: '#f4dddd',
  },
  {
    sku: 'BOT-004',
    name: 'Steel Bottle',
    category: 'Home & living',
    price: 79900,
    image: '/images/bottle.jpg',
    color: '#dfe9e7',
  },
  {
    sku: 'WAT-005',
    name: 'Everyday Watch',
    category: 'Accessories',
    price: 329900,
    image: '/images/watch.jpg',
    color: '#e3e5e6',
  },
  {
    sku: 'SUN-006',
    name: 'Acetate Sunglasses',
    category: 'Accessories',
    price: 149900,
    image: '/images/sunglasses.jpg',
    color: '#ece2d7',
  },
  {
    sku: 'MUG-007',
    name: 'Ceramic Mug',
    category: 'Home & living',
    price: 59900,
    image: '/images/mug.jpg',
    color: '#e3e8df',
  },
  {
    sku: 'BAG-008',
    name: 'Weekender Backpack',
    category: 'Accessories',
    price: 129900,
    image: '/images/weekender.jpg',
    color: '#e9e1d9',
  },
]

const customers = [
  ['Aditi Menon', 'AM', '#e6e4f2'],
  ['Rahul Sharma', 'RS', '#dfebe5'],
  ['Neha Patel', 'NP', '#f5e6dc'],
  ['Vikram Rao', 'VR', '#e0e8f2'],
  ['Sara Thomas', 'ST', '#f1e1e8'],
  ['Dev Iyer', 'DI', '#e9eadb'],
  ['Maya Joseph', 'MJ', '#e2e9f1'],
  ['Arun Kapoor', 'AK', '#e7e1db'],
  ['Isha Shah', 'IS', '#e7e4f0'],
  ['Kiran Das', 'KD', '#deece5'],
  ['Riya Nair', 'RN', '#f0e5dd'],
  ['Nikhil Bose', 'NB', '#e1e8f0'],
  ['Ananya Roy', 'AR', '#f0e1e6'],
  ['Rohan Mehta', 'RM', '#e5e8db'],
  ['Leah George', 'LG', '#e5e3f0'],
  ['Anil Kumar', 'AK', '#e0e9e4'],
]
const stages: OrderStage[] = [
  'ready',
  'packed',
  'awaiting',
  'shipped',
  'ready',
  'shipped',
  'ready',
  'packed',
  'shipped',
  'ready',
  'awaiting',
  'shipped',
  'packed',
  'shipped',
  'shipped',
  'cancelled',
]

export const initialOrders: Order[] = customers.map(([customer, initials, avatarColor], index) => ({
  id: `DL-${2048 - index}`,
  customer,
  email: `${customer.toLowerCase().replaceAll(' ', '.')}@example.com`,
  initials,
  avatarColor,
  warehouse: warehouses[index % 3].id,
  stage: stages[index],
  items: [
    { sku: products[index % products.length].sku, quantity: (index % 3) + 1 },
    ...(index % 3 === 0 ? [{ sku: products[(index + 3) % products.length].sku, quantity: 1 }] : []),
  ],
  createdAt: new Date(demoDate.getTime() - (8 + index) * 60_000).toISOString(),
  address: `${12 + index}, Garden Avenue, ${['Kochi, Kerala 682030', 'Bengaluru, Karnataka 560066', 'Mumbai, Maharashtra 400001'][index % 3]}`,
}))

const onHand = [
  [86, 42, 28],
  [64, 18, 32],
  [32, 28, 14],
  [108, 78, 56],
  [24, 16, 10],
  [17, 8, 12],
  [46, 34, 28],
  [18, 12, 0],
]
export const initialStock: StockItem[] = products.flatMap((product, productIndex) =>
  warehouses.map((warehouse, warehouseIndex) => {
    const reserved = initialOrders
      .filter(
        (order) =>
          order.warehouse === warehouse.id && ['awaiting', 'ready', 'packed'].includes(order.stage),
      )
      .reduce(
        (total, order) =>
          total +
          order.items
            .filter((item) => item.sku === product.sku)
            .reduce((sum, item) => sum + item.quantity, 0),
        0,
      )
    return {
      id: `${product.sku}@${warehouse.id}`,
      sku: product.sku,
      warehouse: warehouse.id,
      onHand: Math.max(onHand[productIndex][warehouseIndex], reserved),
      reserved,
      threshold: 12,
      adjustments: [],
    }
  }),
)

export const stageLabels: Record<OrderStage, string> = {
  awaiting: 'Awaiting payment',
  ready: 'Ready to pack',
  packed: 'Packed',
  shipped: 'Shipped',
  cancelled: 'Cancelled',
}
export const getProduct = (sku: string) => products.find((product) => product.sku === sku)!
export const getWarehouse = (id: WarehouseId) =>
  warehouses.find((warehouse) => warehouse.id === id)!
export const available = (item: StockItem) => item.onHand - item.reserved
export const isLow = (item: StockItem) => available(item) <= item.threshold
export const orderTotal = (order: Order) =>
  order.items.reduce((total, item) => total + getProduct(item.sku).price * item.quantity, 0)
export const orderUnits = (order: Order) =>
  order.items.reduce((total, item) => total + item.quantity, 0)
export const money = (paise: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paise / 100)
export const count = (value: number) => new Intl.NumberFormat('en-IN').format(value)
export const time = (date: string) =>
  new Intl.DateTimeFormat('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(date))

export function orderHistory(warehouse: string, orders: Order[], days = 7) {
  const historical = [11, 8, 14, 10, 13, 9, 12, 9, 12, 8, 15, 11, 18]
  const values = [
    ...historical,
    orders.filter((order) => warehouse === 'all' || order.warehouse === warehouse).length,
  ]
  return values.slice(-days).map((value, index) => {
    const date = new Date(demoDate.getTime() - (days - 1 - index) * 86_400_000)
    return {
      day: new Intl.DateTimeFormat('en-IN', {
        day: 'numeric',
        month: 'short',
        timeZone: 'Asia/Kolkata',
      }).format(date),
      orders: warehouse === 'all' || index === days - 1 ? value : Math.round(value / 3),
    }
  })
}
