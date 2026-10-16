import { useCallback, useEffect, useState } from "react";
import api, { getErrorMessage } from "../api.js";
import Loading from "../components/Loading.jsx";
import Notice from "../components/Notice.jsx";

export default function AdminReviewsPage() {
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/reviews/reported");
      setReviews(data.reviews);
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Could not load reported reviews."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function setHidden(reviewId, hidden) {
    setError("");
    try {
      await api.patch(`/reviews/${reviewId}/moderation`, { hidden });
      await load();
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Could not update review moderation."));
    }
  }

  if (loading) return <Loading label="Loading reported reviews..." />;
  return (
    <main className="mx-auto max-w-6xl px-4 pb-16 pt-8 sm:px-6">
      <h1 className="text-3xl font-black">Review moderation</h1>
      <Notice className="mt-5">{error}</Notice>
      <section className="mt-6 space-y-4">
        {reviews.map((review) => (
          <article className="glass-strong p-5" key={review._id}>
            <div className="flex flex-wrap justify-between gap-3">
              <div>
                <p className="font-bold">{review.rating}/5 · {review.seller?.name || "Seller"}</p>
                <p className="mt-1 text-sm text-slate-600">{review.comment || "No comment"}</p>
                <p className="mt-2 text-xs text-slate-500">{review.reports?.length || 0} report(s) · {review.hidden ? "Hidden" : "Visible"}</p>
              </div>
              <button className="button-secondary self-start" onClick={() => setHidden(review._id, !review.hidden)} type="button">
                {review.hidden ? "Restore review" : "Hide review"}
              </button>
            </div>
            <ul className="mt-3 list-inside list-disc text-xs text-slate-600">
              {(review.reports || []).map((report) => <li key={`${review._id}:${report.reporter}`}>{report.reason}</li>)}
            </ul>
          </article>
        ))}
        {reviews.length === 0 && <p className="rounded-2xl bg-white p-8 text-center text-slate-500">No reviews have been reported.</p>}
      </section>
    </main>
  );
}
