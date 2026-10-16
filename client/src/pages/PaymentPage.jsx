import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import api, { getErrorMessage } from "../api.js";
import { useAuth } from "../auth.jsx";
import Loading from "../components/Loading.jsx";
import Notice from "../components/Notice.jsx";
import { formatPrice } from "../money.js";

export function PaymentReturnPage() {
  return (
    <main className="mx-auto max-w-xl px-4 pb-16 pt-10 sm:px-6">
      <section className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-100 sm:p-9">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-orange-600">
          Payment submitted
        </p>
        <h1 className="mt-2 text-3xl font-black">We&apos;re confirming your order</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Flutterwave sent you back from its hosted checkout. The order will be
          marked paid after the server verifies the payment notification.
        </p>
        <Link className="button-primary mt-6 inline-flex" to="/orders">
          Check order status
        </Link>
      </section>
    </main>
  );
}

export default function PaymentPage() {
  const { paymentId } = useParams();
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [payment, setPayment] = useState(location.state?.payment || null);
  const [order, setOrder] = useState(location.state?.order || null);
  const [loading, setLoading] = useState(!location.state?.payment);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (payment && order) return;
    let active = true;
    api
      .get(`/payments/${paymentId}`)
      .then(({ data }) => {
        if (!active) return;
        setPayment(data.payment);
        setOrder(data.order);
      })
      .catch((requestError) => {
        if (active) setError(getErrorMessage(requestError, "Could not load payment."));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [order, payment, paymentId]);

  async function simulate(outcome) {
    setBusy(true);
    setError("");
    try {
      await api.post(`/payments/${paymentId}/simulate`, { outcome });
      window.localStorage.removeItem(`dishdash.checkout-key:${user.id}`);
      navigate(`/orders/${order._id}`, {
        replace: true,
        state: { paymentOutcome: outcome }
      });
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Could not simulate payment."));
    } finally {
      setBusy(false);
    }
  }

  function openFlutterwave() {
    if (payment?.paymentUrl) window.location.assign(payment.paymentUrl);
  }

  if (loading) return <Loading label="Loading payment..." />;

  return (
    <main className="mx-auto max-w-xl px-4 pb-16 pt-10 sm:px-6">
      <section className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-100 sm:p-9">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-orange-600">
          Payment
        </p>
        <h1 className="mt-2 text-3xl font-black">Complete your order</h1>
        <p className="mt-3 text-sm text-slate-500">
          Order {order?._id}
        </p>
        <div className="mt-6 flex justify-between border-y border-slate-100 py-4">
          <span className="font-semibold text-slate-600">Amount due</span>
          <span className="text-xl font-black">
            {formatPrice(payment?.amountCents)}
          </span>
        </div>
        <Notice className="mt-5">{error}</Notice>

        {payment?.provider === "mock" ? (
          <>
            <p className="mt-5 rounded-xl bg-orange-50 px-4 py-3 text-sm leading-6 text-orange-900">
              Mock payment is enabled. No payment credentials or card details
              are required.
            </p>
            {import.meta.env.DEV ? (
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <button
                  className="button-primary"
                  disabled={busy}
                  onClick={() => simulate("succeeded")}
                  type="button"
                >
                  {busy ? "Processing..." : "Simulate success"}
                </button>
                <button
                  className="rounded-xl border border-red-200 bg-white px-5 py-3 text-sm font-bold text-red-700 hover:bg-red-50 disabled:opacity-60"
                  disabled={busy}
                  onClick={() => simulate("failed")}
                  type="button"
                >
                  {busy ? "Processing..." : "Simulate failure"}
                </button>
              </div>
            ) : (
              <p className="mt-5 text-sm text-slate-500">
                Mock simulation is available only in development.
              </p>
            )}
          </>
        ) : (
          <>
            <p className="mt-5 text-sm leading-6 text-slate-600">
              Payment is hosted securely by Flutterwave. Your card details are
              entered directly with the payment provider.
            </p>
            <button
              className="button-primary mt-5 w-full"
              disabled={!payment?.paymentUrl}
              onClick={openFlutterwave}
              type="button"
            >
              Pay with Flutterwave test
            </button>
          </>
        )}

        <Link
          className="mt-6 block text-center text-sm font-bold text-slate-500 hover:text-orange-700"
          to="/orders"
        >
          View my orders
        </Link>
      </section>
    </main>
  );
}
