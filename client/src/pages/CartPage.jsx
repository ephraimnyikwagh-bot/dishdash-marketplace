import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api, { getErrorMessage } from "../api.js";
import { useCart } from "../cart.jsx";
import Loading from "../components/Loading.jsx";
import Notice from "../components/Notice.jsx";
import ProductImage from "../components/ProductImage.jsx";
import { formatPrice } from "../money.js";

export default function CartPage() {
  const navigate = useNavigate();
  const { cart, setCart, refreshCart } = useCart();
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [startingCheckout, setStartingCheckout] = useState(false);
  const [deliveryMethod, setDeliveryMethod] = useState("delivery");
  const [error, setError] = useState("");

  const loadCart = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const { data } = await api.get("/cart");
      setCart({ items: data.items || [], totalCents: data.totalCents || 0 });
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Could not load your cart."));
    } finally {
      setLoading(false);
    }
  }, [setCart]);

  useEffect(() => {
    loadCart();
  }, [loadCart]);

  async function updateQuantity(productId, quantity) {
    if (quantity < 1) return;
    setBusyId(productId);
    setError("");
    try {
      const { data } = await api.patch(`/cart/items/${productId}`, {
        quantity
      });
      setCart({ items: data.items || [], totalCents: data.totalCents || 0 });
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Could not update quantity."));
    } finally {
      setBusyId("");
    }
  }

  async function removeItem(productId) {
    setBusyId(productId);
    setError("");
    try {
      const { data } = await api.delete(`/cart/items/${productId}`);
      setCart({ items: data.items || [], totalCents: data.totalCents || 0 });
      await refreshCart();
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Could not remove that item."));
    } finally {
      setBusyId("");
    }
  }

  async function beginCheckout() {
    setStartingCheckout(true);
    setError("");
    try {
      const checkoutKey = `dishdash.checkout-key:${JSON.parse(
        window.localStorage.getItem("dishdash.session")
      ).user.id}`;
      let key = window.localStorage.getItem(checkoutKey);
      if (!key) {
        key = window.crypto?.randomUUID
          ? window.crypto.randomUUID()
          : `checkout-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        window.localStorage.setItem(checkoutKey, key);
      }
      const { data } = await api.post(
        "/checkout",
        { deliveryMethod },
        { headers: { "Idempotency-Key": key } }
      );
      setCart({ items: [], totalCents: 0 });
      await refreshCart();
      navigate(`/payment/${data.payment.id}`, {
        state: { payment: data.payment, order: data.order }
      });
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Could not start checkout."));
    } finally {
      setStartingCheckout(false);
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-4 pb-16 pt-8 sm:px-6">
      <div className="mb-7">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-orange-600">
          Your picks
        </p>
        <h1 className="mt-2 text-3xl font-black">Shopping cart</h1>
      </div>
      <Notice>{error}</Notice>
      {loading ? (
        <Loading label="Loading your cart..." />
      ) : cart.items.length === 0 ? (
        <div className="rounded-3xl bg-white px-6 py-16 text-center shadow-sm ring-1 ring-slate-100">
          <div className="text-5xl">🛍️</div>
          <h2 className="mt-4 text-xl font-bold">
            Your cart is empty
          </h2>
          <p className="mt-2 text-sm text-slate-500">
            Add a few listings to get started.
          </p>
          <Link className="button-primary mt-6 inline-flex" to="/catalog">
            Browse listings
          </Link>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <section className="space-y-3">
            {cart.items.map((item) => {
              const product = item.product;
              if (!product) return null;
              return (
                <article
                  className="flex gap-4 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-100 sm:p-4"
                  key={product._id}
                >
                  <div className="w-24 shrink-0 overflow-hidden rounded-xl sm:w-32">
                    <ProductImage name={product.name} src={product.imageUrl} />
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col justify-between gap-3 sm:flex-row sm:items-center">
                    <div className="min-w-0">
                      <p className="text-xs font-bold uppercase tracking-wide text-orange-600">
                        {product.category}
                      </p>
                      <h2 className="mt-1 truncate font-bold">
                        {product.name}
                      </h2>
                      <p className="mt-1 text-sm text-slate-500">
                        {formatPrice(product.priceCents)} each
                      </p>
                    </div>
                    <div className="flex items-center justify-between gap-4 sm:justify-end">
                      <div className="flex items-center rounded-xl border border-slate-200">
                        <button
                          aria-label={`Decrease quantity of ${product.name}`}
                          className="px-3 py-2 text-lg text-slate-600 hover:text-orange-600 disabled:opacity-40"
                          disabled={busyId === product._id || item.quantity <= 1}
                          onClick={() =>
                            updateQuantity(product._id, item.quantity - 1)
                          }
                          type="button"
                        >
                          −
                        </button>
                        <span className="min-w-7 text-center text-sm font-bold">
                          {item.quantity}
                        </span>
                        <button
                          aria-label={`Increase quantity of ${product.name}`}
                          className="px-3 py-2 text-lg text-slate-600 hover:text-orange-600 disabled:opacity-40"
                          disabled={
                            busyId === product._id ||
                            item.quantity >= product.stock ||
                            item.quantity >= 99
                          }
                          onClick={() =>
                            updateQuantity(product._id, item.quantity + 1)
                          }
                          type="button"
                        >
                          +
                        </button>
                      </div>
                      <button
                        className="text-sm font-semibold text-red-600 hover:underline"
                        disabled={busyId === product._id}
                        onClick={() => removeItem(product._id)}
                        type="button"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </section>
          <aside className="h-fit rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
            <h2 className="text-lg font-extrabold">Order summary</h2>
            <fieldset className="mt-5 space-y-3">
              <legend className="mb-2 text-sm font-bold">Receive your order</legend>
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3">
                <input checked={deliveryMethod === "delivery"} className="mt-1 accent-emerald-700" name="deliveryMethod" onChange={() => setDeliveryMethod("delivery")} type="radio" />
                <span><strong className="block text-sm">Delivery</strong><span className="text-xs text-slate-500">A courier will deliver your order.</span></span>
              </label>
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3">
                <input checked={deliveryMethod === "pickup"} className="mt-1 accent-emerald-700" name="deliveryMethod" onChange={() => setDeliveryMethod("pickup")} type="radio" />
                <span><strong className="block text-sm">Pickup</strong><span className="text-xs text-slate-500">Collect directly from the seller.</span></span>
              </label>
            </fieldset>
            <div className="mt-5 flex justify-between border-b border-slate-100 pb-4 text-sm text-slate-600">
              <span>Subtotal</span>
              <span>{formatPrice(cart.totalCents)}</span>
            </div>
            <div className="mt-4 flex justify-between text-base font-extrabold">
              <span>Total</span>
              <span>{formatPrice(cart.totalCents)}</span>
            </div>
            <button
              className="button-primary mt-6 w-full"
              disabled={startingCheckout}
              onClick={beginCheckout}
              type="button"
            >
              {startingCheckout ? "Starting checkout..." : "Checkout"}
            </button>
            <p className="mt-3 text-center text-xs font-medium text-slate-500">
              Secure demo payment
            </p>
            <Link
              className="mt-5 block text-center text-sm font-bold text-orange-700 hover:underline"
              to="/catalog"
            >
              Continue shopping
            </Link>
          </aside>
        </div>
      )}
    </main>
  );
}
