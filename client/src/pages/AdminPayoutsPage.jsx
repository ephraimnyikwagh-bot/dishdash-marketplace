import { useCallback, useEffect, useState } from "react";
import api, { getErrorMessage } from "../api.js";
import Loading from "../components/Loading.jsx";
import Notice from "../components/Notice.jsx";
import { formatPrice } from "../money.js";

export default function AdminPayoutsPage() {
  const [payouts, setPayouts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/ledger/admin/payouts");
      setPayouts(data.payouts);
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Could not load payout requests."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function markPaid(payoutId) {
    setBusyId(payoutId);
    setError("");
    try {
      await api.patch(`/ledger/admin/payouts/${payoutId}`, { status: "Paid out" });
      await load();
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Could not mark this payout as paid."));
    } finally {
      setBusyId("");
    }
  }

  if (loading) return <Loading label="Loading payout requests..." />;
  return (
    <main className="mx-auto max-w-7xl px-4 pb-16 pt-8 sm:px-6">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-link">Administration</p>
      <h1 className="mt-2 text-3xl font-black">Payout requests</h1>
      <Notice className="mt-5">{error}</Notice>
      <section className="mt-6 overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-100">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr><th className="px-4 py-3">Seller</th><th className="px-4 py-3">Requested</th><th className="px-4 py-3">Amount</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Action</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {payouts.map((payout) => (
              <tr key={payout._id}>
                <td className="px-4 py-3">{payout.seller?.name || payout.seller?.email || "Seller"}</td>
                <td className="px-4 py-3">{new Date(payout.createdAt).toLocaleString()}</td>
                <td className="px-4 py-3 font-bold">{formatPrice(payout.amountCents)}</td>
                <td className="px-4 py-3">{payout.status}</td>
                <td className="px-4 py-3">
                  {payout.status === "Requested" && (
                    <button className="button-primary !py-2" disabled={busyId === payout._id} onClick={() => markPaid(payout._id)} type="button">
                      {busyId === payout._id ? "Updating..." : "Mark paid out"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {payouts.length === 0 && <tr><td className="px-4 py-8 text-center text-slate-500" colSpan="5">No payout requests.</td></tr>}
          </tbody>
        </table>
      </section>
    </main>
  );
}
