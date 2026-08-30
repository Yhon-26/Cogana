import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import type { SubstitutionPolicy } from '@/database/models';
import {
  addCartItem,
  calculateCartSubtotal,
  updateCartQuantity,
  updateCartSubstitution,
} from '@/online/cart';
import { persistCart, readPersistedCart } from '@/online/checkout-storage';
import type { CartItem, OnlineProduct } from '@/online/contracts';

type CartContextValue = {
  items: CartItem[];
  itemCount: number;
  subtotalCents: number;
  isHydrated: boolean;
  addItem: (product: OnlineProduct, quantity: number) => void;
  setQuantity: (productId: string, quantity: number) => void;
  setSubstitutionPolicy: (
    productId: string,
    policy: SubstitutionPolicy
  ) => void;
  removeItem: (productId: string) => void;
  clear: () => void;
};

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: PropsWithChildren) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [isHydrated, setIsHydrated] = useState(false);
  const changedBeforeHydration = useRef(false);

  useEffect(() => {
    let active = true;
    void readPersistedCart()
      .then((stored) => {
        if (active && !changedBeforeHydration.current) setItems(stored);
      })
      .finally(() => {
        if (active) setIsHydrated(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!isHydrated) return;
    void persistCart(items).catch(() => {
      // El carrito sigue utilizable en memoria si el almacenamiento local falla.
    });
  }, [isHydrated, items]);

  const addItem = useCallback((product: OnlineProduct, quantity: number) => {
    changedBeforeHydration.current = true;
    setItems((current) => addCartItem(current, product, quantity));
  }, []);

  const setQuantity = useCallback((productId: string, quantity: number) => {
    changedBeforeHydration.current = true;
    setItems((current) => updateCartQuantity(current, productId, quantity));
  }, []);

  const setSubstitutionPolicy = useCallback(
    (productId: string, substitutionPolicy: SubstitutionPolicy) => {
      changedBeforeHydration.current = true;
      setItems((current) =>
        updateCartSubstitution(current, productId, substitutionPolicy)
      );
    },
    []
  );

  const removeItem = useCallback((productId: string) => {
    changedBeforeHydration.current = true;
    setItems((current) =>
      current.filter((item) => item.product.id !== productId)
    );
  }, []);
  const clear = useCallback(() => {
    changedBeforeHydration.current = true;
    setItems([]);
  }, []);

  const value = useMemo<CartContextValue>(
    () => ({
      items,
      itemCount: items.length,
      subtotalCents: calculateCartSubtotal(items),
      isHydrated,
      addItem,
      setQuantity,
      setSubstitutionPolicy,
      removeItem,
      clear,
    }),
    [addItem, clear, isHydrated, items, removeItem, setQuantity, setSubstitutionPolicy]
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const value = useContext(CartContext);
  if (!value) throw new Error('useCart debe usarse dentro de CartProvider.');
  return value;
}
