import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Elements } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import api, { getErrorMessage } from "../api.js";
import { useCart } from "../cart.jsx";
import { useAuth } from "../auth.jsx";
import Loading from "../components/Loading.jsx";
import Notice from "../components/Notice.jsx";
import ProductImage from "../components/ProductImage.jsx";
import StripePaymentForm from "../components/StripePaymentForm.jsx";

const publishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
const isSandboxKey = publishableKey?.startsWith("pk_test_") ?? false;
const stripePromise = isSandboxKey ? loadStripe(publishableKey) : null;

function formatPrice(cents) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format((cents || 0) / 100);
}

export default function CartPage() {
  const { user } = useAuth();
  const { cart, setCart, refreshCart } = useCart();
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [startingCheckout, setStartingCheckout] = useState(false);
  const [checkout, setCheckout] = useState(null);
  const [paymentComplete, setPaymentComplete] = useState(false);
  const [paymentFailed, setPaymentFailed] = useState(false);
  const [recoveringCheckout, setRecoveringCheckout] = useState(() =>
    Boolean(window.localStorage.getItem(`dishdash.checkout-key:${user.id}`))
  );

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

  useEffect(() => {
    const key = window.localStorage.getItem(`dishdash.checkout-key:${user.id}`);
    if (!key) return undefined;

    let active = true;
    api
      .post("/checkout", {}, { headers: { "Idempotency-Key": key } })
      .then(({ data }) => {
        if (!active) return;
        setCart({ items: [], totalCents: 0 });
        if (data.payment?.status === "succeeded") {
          window.localStorage.removeItem(`dishdash.checkout-key:${user.id}`);
          setPaymentComplete(true);
        } else if (data.payment?.status === "failed") {
          window.localStorage.removeItem(`dishdash.checkout-key:${user.id}`);
          setPaymentFailed(true);
        } else {
          setCheckout(data);
        }
      })
      .catch((requestError) => {
        if (active) {
          setError(
            getErrorMessage(requestError, "Could not resume your checkout.")
          );
        }
      })
      .finally(() => {
        if (active) setRecoveringCheckout(false);
      });

    return () => {
      active = false;
    };
  }, [setCart, user.id]);

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
      const checkoutKeyStorage = `dishdash.checkout-key:${user.id}`;
      let idempotencyKey = window.localStorage.getItem(checkoutKeyStorage);
      if (!idempotencyKey) {
        idempotencyKey = window.crypto?.randomUUID
          ? window.crypto.randomUUID()
          : `checkout-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        window.localStorage.setItem(checkoutKeyStorage, idempotencyKey);
      }
      const { data } = await api.post(
        "/checkout",
        {},
        { headers: { "Idempotency-Key": idempotencyKey } }
      );
      setCart({ items: [], totalCents: 0 });
      if (data.payment?.status === "succeeded") {
        window.localStorage.removeItem(checkoutKeyStorage);
        setPaymentComplete(true);
      } else if (data.payment?.status === "failed") {
        window.localStorage.removeItem(checkoutKeyStorage);
        setPaymentFailed(true);
      } else {
        setCheckout(data);
      }
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Could not start checkout."));
    } finally {
      setStartingCheckout(false);
    }
  }

  function handlePaymentComplete() {
    window.localStorage.removeItem(`dishdash.checkout-key:${user.id}`);
    setPaymentComplete(true);
    setCheckout(null);
    refreshCart();
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
      {paymentComplete ? (
        <div className="rounded-3xl bg-white px-6 py-16 text-center shadow-sm ring-1 ring-slate-100">
          <div className="text-5xl">✅</div>
          <h2 className="mt-4 text-2xl font-black">Payment submitted</h2>
          <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-500">
            Stripe confirmed the payment. Your order will be marked paid once
            the verified webhook arrives.
          </p>
          <Link className="button-primary mt-6 inline-flex" to="/catalog">
            Back to menu
          </Link>
        </div>
      ) : paymentFailed ? (
        <div className="rounded-3xl bg-white px-6 py-16 text-center shadow-sm ring-1 ring-slate-100">
          <div className="text-5xl">⚠️</div>
          <h2 className="mt-4 text-2xl font-black">Checkout was canceled</h2>
          <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-500">
            Reserved stock has been released. Add the items to your cart again
            if you would like to place another order.
          </p>
          <Link className="button-primary mt-6 inline-flex" to="/catalog">
            Back to menu
          </Link>
        </div>
      ) : checkout ? (
        <section className="mx-auto max-w-xl rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100 sm:p-7">
          <p className="text-xs font-bold uppercase tracking-wider text-orange-600">
            Secure sandbox checkout
          </p>
          <h2 className="mt-2 text-2xl font-black">Complete your payment</h2>
          <p className="mt-2 text-sm text-slate-500">
            Order {checkout.order?._id} ·{" "}
            {formatPrice(checkout.payment?.amountCents)}
          </p>
          {stripePromise ? (
            <Elements
              options={{
                clientSecret: checkout.clientSecret,
                appearance: { theme: "stripe" }
              }}
              stripe={stripePromise}
            >
              <StripePaymentForm
                clientSecret={checkout.clientSecret}
                onPaid={handlePaymentComplete}
              />
            </Elements>
          ) : (
            <Notice className="mt-5">
              Set VITE_STRIPE_PUBLISHABLE_KEY in client/.env to enable the
              Stripe payment form.
            </Notice>
          )}
        </section>
      ) : recoveringCheckout ? (
        <Loading label="Resuming your secure checkout..." />
      ) : loading ? (
        <Loading label="Loading your cart..." />
      ) : cart.items.length === 0 ? (
        <div className="rounded-3xl bg-white px-6 py-16 text-center shadow-sm ring-1 ring-slate-100">
          <div className="text-5xl">🛍️</div>
          <h2 className="mt-4 text-xl font-bold">
            Your cart is looking hungry
          </h2>
          <p className="mt-2 text-sm text-slate-500">
            Add a few local favorites to get started.
          </p>
          <Link className="button-primary mt-6 inline-flex" to="/catalog">
            Browse the menu
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
                          disabled={
                            busyId === product._id || item.quantity <= 1
                          }
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
              disabled={startingCheckout || !stripePromise}
              onClick={beginCheckout}
              type="button"
            >
              {startingCheckout
                ? "Starting checkout..."
                : "Continue to payment"}
            </button>
            <p className="mt-3 text-center text-xs font-medium text-slate-500">
              {stripePromise
                ? "Sandbox payment securely processed by Stripe"
                : "Add a Stripe publishable test key (pk_test_...) to enable checkout"}
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
