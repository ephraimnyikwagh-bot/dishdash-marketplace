import { useCallback, useEffect, useState } from "react";
import api, { getErrorMessage } from "../api.js";
import Loading from "../components/Loading.jsx";
import Notice from "../components/Notice.jsx";
import { formatPrice } from "../money.js";

export default function WalletPage() {
  const [wallet, setWallet] = useState(null);
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/ledger/wallet");
      setWallet(data);
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Could not load your wallet."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function requestPayout(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api.post("/ledger/wallet/payouts", {
        amountCents: Math.round(Number(amount) * 100),
        idempotencyKey: crypto.randomUUID()
      });
      setAmount("");
      setNotice("Payout request submitted. Admin approval is required.");
      await load();
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Could not request a payout."));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Loading label="Loading seller wallet..." />;
  return (
    <main className="mx-auto max-w-7xl px-4 pb-16 pt-8 sm:px-6">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-link">Seller</p>
      <h1 className="mt-2 text-3xl font-black">Wallet</h1>
      <Notice className="mt-5">{error}</Notice>
      <Notice className="mt-3" kind="success">{notice}</Notice>
      <section className="mt-6 grid gap-4 sm:grid-cols-3">
        {[
          ["Pending in escrow", wallet?.pendingCents],
          ["Available", wallet?.availableCents],
          ["Paid out", wallet?.paidOutCents]
        ].map(([label, value]) => (
          <article className="glass-strong p-5" key={label}>
            <p className="text-sm font-semibold text-slate-600">{label}</p>
            <p className="mt-2 text-2xl font-black">{formatPrice(value || 0)}</p>
          </article>
        ))}
      </section>
      <section className="mt-6 grid items-start gap-6 lg:grid-cols-[360px_1fr]">
        <form className="glass-strong p-5" onSubmit={requestPayout}>
          <h2 className="text-lg font-extrabold">Request a payout</h2>
          <p className="mt-1 text-sm text-slate-600">Payouts are simulated and require an admin to mark them paid.</p>
          <label className="field-label mt-4">
            Amount (₦)
            <input
              className="field-input"
              min="0.01"
              onChange={(event) => setAmount(event.target.value)}
              required
              step="0.01"
              type="number"
              value={amount}
            />
          </label>
          <button className="button-primary mt-4 w-full" disabled={busy} type="submit">
            {busy ? "Submitting..." : "Request payout"}
          </button>
        </form>
        <section className="glass-strong p-5">
          <h2 className="text-lg font-extrabold">Wallet transactions</h2>
          <div className="mt-4 divide-y divide-slate-200">
            {(wallet?.transactions || []).map((entry) => (
              <div className="flex flex-wrap items-center justify-between gap-3 py-3" key={entry._id}>
                <div>
                  <p className="font-semibold">{entry.account.replaceAll("_", " ")}</p>
                  <p className="text-xs text-slate-500">{new Date(entry.createdAt).toLocaleString()}</p>
                </div>
                <p className="font-bold">{entry.direction === "debit" ? "−" : "+"}{formatPrice(entry.amountCents, entry.currency)}</p>
              </div>
            ))}
            {(wallet?.transactions || []).length === 0 && (
              <p className="py-6 text-sm text-slate-500">No released wallet transactions yet.</p>
            )}
          </div>
          <h3 className="mt-5 font-bold">Payout requests</h3>
          <div className="mt-2 divide-y divide-slate-200">
            {(wallet?.payouts || []).map((payout) => (
              <div className="flex justify-between gap-3 py-3 text-sm" key={payout._id}>
                <span>{new Date(payout.createdAt).toLocaleDateString()}</span>
                <span className="font-semibold">{formatPrice(payout.amountCents)} · {payout.status}</span>
              </div>
            ))}
            {(wallet?.payouts || []).length === 0 && <p className="py-3 text-sm text-slate-500">No payout requests.</p>}
          </div>
        </section>
      </section>
    </main>
  );
}
