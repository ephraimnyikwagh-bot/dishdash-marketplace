import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState
} from "react";
import api from "./api.js";

const CartContext = createContext(null);

export function CartProvider({ children }) {
  const [cart, setCart] = useState({ items: [], totalCents: 0 });

  const refreshCart = useCallback(async () => {
    const stored = window.localStorage.getItem("dishdash.session");
    if (!stored) {
      setCart({ items: [], totalCents: 0 });
      return;
    }
    try {
      const { data } = await api.get("/cart");
      setCart({ items: data.items || [], totalCents: data.totalCents || 0 });
    } catch {
      setCart({ items: [], totalCents: 0 });
    }
  }, []);

  const count = useMemo(
    () => cart.items.reduce((sum, item) => sum + item.quantity, 0),
    [cart.items]
  );

  const value = useMemo(
    () => ({ cart, setCart, count, refreshCart }),
    [cart, count, refreshCart]
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) throw new Error("useCart must be used within a CartProvider");
  return context;
}
