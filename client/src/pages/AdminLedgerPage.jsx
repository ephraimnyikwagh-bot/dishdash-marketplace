import { useCallback, useEffect, useState } from "react";
import api, { getErrorMessage } from "../api.js";
import Loading from "../components/Loading.jsx";
import Notice from "../components/Notice.jsx";

function money(cents, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency
  }).format((cents || 0) / 100);
}

export default function AdminLedgerPage() {
  const [integrity, setIntegrity] = useState(null);
  const [entries, setEntries] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [orderId, setOrderId] = useState("");
  const [filters, setFilters] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [integrityResponse, entriesResponse] = await Promise.all([
        api.get("/ledger/integrity"),
        api.get("/ledger/entries", {
          params: { page, limit: 25, ...filters }
        })
      ]);
      setIntegrity(integrityResponse.data);
      setEntries(entriesResponse.data.entries);
      setTotalPages(Math.max(1, entriesResponse.data.totalPages));
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Could not load ledger audit."));
    } finally {
      setLoading(false);
    }
  }, [filters, page]);

  useEffect(() => {
    load();
  }, [load]);

  function applyFilters(event) {
    event.preventDefault();
    setPage(1);
    setFilters({
      ...(from ? { from: new Date(`${from}T00:00:00`).toISOString() } : {}),
      ...(to ? { to: new Date(`${to}T23:59:59.999`).toISOString() } : {}),
      ...(orderId.trim() ? { orderId: orderId.trim() } : {})
    });
  }

  if (loading) return <Loading label="Loading ledger audit..." />;
  return (
    <main className="mx-auto max-w-7xl px-4 pb-16 pt-8 sm:px-6">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-orange-600">Administration</p>
      <h1 className="mt-2 text-3xl font-black">Ledger audit</h1>
      <Notice className="mt-5">{error}</Notice>
      <section className="mt-6 grid gap-4 sm:grid-cols-2">
        {(integrity?.currencies || []).map((currency) => (
          <article className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100" key={currency.currency}>
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-extrabold">{currency.currency} totals</h2>
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${currency.balanced ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}>
                {currency.balanced ? "Balanced" : "Not balanced"}
              </span>
            </div>
            <div className="mt-4 flex justify-between text-sm"><span>Debits</span><strong>{money(currency.debitsCents, currency.currency)}</strong></div>
            <div className="mt-2 flex justify-between text-sm"><span>Credits</span><strong>{money(currency.creditsCents, currency.currency)}</strong></div>
          </article>
        ))}
        {integrity?.currencies?.length === 0 && (
          <article className="rounded-2xl bg-white p-5 text-sm text-slate-500">No ledger entries have been recorded.</article>
        )}
      </section>
      <form className="mt-6 grid gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100 sm:grid-cols-4" onSubmit={applyFilters}>
        <label className="field-label">From<input className="field-input" onChange={(event) => setFrom(event.target.value)} type="date" value={from} /></label>
        <label className="field-label">To<input className="field-input" onChange={(event) => setTo(event.target.value)} type="date" value={to} /></label>
        <label className="field-label">Order ID<input className="field-input" onChange={(event) => setOrderId(event.target.value)} placeholder="Optional" value={orderId} /></label>
        <button className="button-primary self-end" type="submit">Apply filters</button>
      </form>
      <div className="mt-6 overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-100">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-4 py-3">Date</th><th className="px-4 py-3">Order</th><th className="px-4 py-3">Account</th><th className="px-4 py-3">Direction</th><th className="px-4 py-3">Amount</th><th className="px-4 py-3">Idempotency key</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {entries.map((entry) => (
              <tr key={entry._id}>
                <td className="px-4 py-3">{new Date(entry.createdAt).toLocaleString()}</td>
                <td className="px-4 py-3 font-mono text-xs">{String(entry.order?._id || entry.order).slice(-8)}</td>
                <td className="px-4 py-3">{entry.account}</td>
                <td className="px-4 py-3 capitalize">{entry.direction}</td>
                <td className="px-4 py-3">{money(entry.amountCents, entry.currency)}</td>
                <td className="max-w-64 truncate px-4 py-3 font-mono text-xs">{entry.idempotencyKey}</td>
              </tr>
            ))}
            {entries.length === 0 && <tr><td className="px-4 py-8 text-center text-slate-500" colSpan="6">No ledger entries match these filters.</td></tr>}
          </tbody>
        </table>
        <div className="flex items-center justify-center gap-4 px-5 py-4">
          <button className="button-secondary" disabled={page <= 1} onClick={() => setPage((current) => current - 1)} type="button">Previous</button>
          <span className="text-sm text-slate-500">Page {page} of {totalPages}</span>
          <button className="button-secondary" disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)} type="button">Next</button>
        </div>
      </div>
    </main>
  );
}
