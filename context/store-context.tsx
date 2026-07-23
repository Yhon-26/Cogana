import { createContext, PropsWithChildren, useContext, useMemo, useState } from 'react';

export type Product = {
  id: string;
  name: string;
  category: string;
  pricePerKg: number;
  stockKg: number;
  minimumKg: number;
  code: string;
};

export type SaleLine = {
  productId: string;
  productName: string;
  quantityKg: number;
  pricePerKg: number;
  total: number;
  saleLabel: string;
};

export type OrderStatus = 'Pendiente' | 'Preparando' | 'Listo' | 'Entregado';

export type Order = {
  id: string;
  customer: string;
  summary: string;
  total: number;
  status: OrderStatus;
  time: string;
};

const INITIAL_PRODUCTS: Product[] = [
  { id: 'lent-can', name: 'Lenteja canadiense', category: 'Menestras', pricePerKg: 8.5, stockKg: 34.6, minimumKg: 8, code: 'MEN-001' },
  { id: 'frej-can', name: 'Frejol canario', category: 'Menestras', pricePerKg: 12.9, stockKg: 21.3, minimumKg: 7, code: 'MEN-002' },
  { id: 'garb', name: 'Garbanzo', category: 'Menestras', pricePerKg: 10.4, stockKg: 5.8, minimumKg: 7, code: 'MEN-003' },
  { id: 'pallar', name: 'Pallar bebé', category: 'Menestras', pricePerKg: 15.8, stockKg: 12.4, minimumKg: 5, code: 'MEN-004' },
  { id: 'arroz', name: 'Arroz superior', category: 'Abarrotes', pricePerKg: 4.6, stockKg: 68.5, minimumKg: 15, code: 'ABR-001' },
  { id: 'azucar', name: 'Azúcar rubia', category: 'Abarrotes', pricePerKg: 4.2, stockKg: 9.2, minimumKg: 12, code: 'ABR-002' },
  { id: 'quinua', name: 'Quinua blanca', category: 'Granos', pricePerKg: 13.5, stockKg: 17.7, minimumKg: 5, code: 'GRA-001' },
];

const INITIAL_ORDERS: Order[] = [
  { id: 'P-1048', customer: 'Bodega San Carlos', summary: 'Arroz superior · 10 kg', total: 46, status: 'Pendiente', time: '10:35 a. m.' },
  { id: 'P-1047', customer: 'María Torres', summary: '3 productos · 4.5 kg', total: 51.3, status: 'Preparando', time: '9:50 a. m.' },
  { id: 'P-1046', customer: 'Restaurante El Buen Sabor', summary: 'Frejol canario · 8 kg', total: 103.2, status: 'Listo', time: '9:15 a. m.' },
];

type StoreContextValue = {
  products: Product[];
  orders: Order[];
  salesToday: number;
  saleCount: number;
  updatePrice: (productId: string, price: number) => void;
  registerSale: (lines: SaleLine[]) => string;
  advanceOrder: (orderId: string) => void;
};

const StoreContext = createContext<StoreContextValue | null>(null);

export function StoreProvider({ children }: PropsWithChildren) {
  const [products, setProducts] = useState(INITIAL_PRODUCTS);
  const [orders, setOrders] = useState(INITIAL_ORDERS);
  const [salesToday, setSalesToday] = useState(286.4);
  const [saleCount, setSaleCount] = useState(12);

  const updatePrice = (productId: string, price: number) => {
    setProducts((current) => current.map((product) => (
      product.id === productId ? { ...product, pricePerKg: price } : product
    )));
  };

  const registerSale = (lines: SaleLine[]) => {
    const total = lines.reduce((sum, line) => sum + line.total, 0);
    const orderId = `V-${String(saleCount + 1).padStart(4, '0')}`;

    setProducts((current) => current.map((product) => {
      const sold = lines
        .filter((line) => line.productId === product.id)
        .reduce((sum, line) => sum + line.quantityKg, 0);
      return sold > 0 ? { ...product, stockKg: Math.max(0, product.stockKg - sold) } : product;
    }));
    setSalesToday((current) => current + total);
    setSaleCount((current) => current + 1);
    return orderId;
  };

  const advanceOrder = (orderId: string) => {
    const flow: OrderStatus[] = ['Pendiente', 'Preparando', 'Listo', 'Entregado'];
    setOrders((current) => current.map((order) => {
      if (order.id !== orderId) return order;
      const nextIndex = Math.min(flow.indexOf(order.status) + 1, flow.length - 1);
      return { ...order, status: flow[nextIndex] };
    }));
  };

  const value = useMemo(() => ({
    products,
    orders,
    salesToday,
    saleCount,
    updatePrice,
    registerSale,
    advanceOrder,
  }), [products, orders, salesToday, saleCount]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const value = useContext(StoreContext);
  if (!value) throw new Error('useStore debe usarse dentro de StoreProvider');
  return value;
}
