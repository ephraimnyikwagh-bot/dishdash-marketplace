import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import api, { getErrorMessage } from "../api.js";
import Loading from "../components/Loading.jsx";
import Notice from "../components/Notice.jsx";
import ProductImage from "../components/ProductImage.jsx";
import { formatPrice } from "../money.js";
import { useAuth } from "../auth.jsx";
import ReviewList from "../components/ReviewList.jsx";

export default function SellerProfilePage() {
  const { sellerId } = useParams();
  const { user } = useAuth();
  const [reviewPage, setReviewPage] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api.get(`/public/sellers/${sellerId}`, { params: { reviewPage, reviewLimit: 10 } })
      .then(({ data }) => { if (active) setProfile(data); })
      .catch((requestError) => { if (active) setError(getErrorMessage(requestError, "Could not load this seller.")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [sellerId, reviewPage, refreshKey]);

  if (loading) return <Loading label="Loading seller profile..." />;
  if (!profile) return <main className="mx-auto max-w-4xl px-4 py-10"><Notice>{error || "Seller not found."}</Notice></main>;
  return (
    <main className="mx-auto max-w-7xl px-4 pb-16 pt-8 sm:px-6">
      <section className="rounded-3xl bg-ink p-8 text-white">
        <p className="text-sm font-bold uppercase tracking-wider text-primary">Seller profile</p>
        <h1 className="mt-2 text-3xl font-black">{profile.seller.name}</h1>
        <p className="mt-2 text-slate-300">{profile.total} active {profile.total === 1 ? "listing" : "listings"}</p>
        <p className="mt-2 font-semibold text-primary">{profile.seller.ratingAverage.toFixed(1)} / 5 · {profile.seller.ratingCount} verified reviews</p>
      </section>
      {profile.items.length ? <div className="mt-7 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">{profile.items.map((listing) => <Link className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-100" key={listing._id} to={`/listings/${listing._id}`}><ProductImage name={listing.title} src={listing.images?.[0]} /><div className="p-4"><p className="text-xs font-bold uppercase tracking-wide text-link">{listing.category}</p><h2 className="mt-1 font-bold">{listing.title}</h2><p className="mt-2 font-extrabold">{formatPrice(listing.priceCents)}</p><p className="mt-1 text-xs font-semibold text-amber-700">{profile.seller.ratingAverage.toFixed(1)} ★ ({profile.seller.ratingCount})</p></div></Link>)}</div> : <p className="mt-7 rounded-2xl bg-white p-10 text-center text-slate-500">This seller has no active listings yet.</p>}
      <ReviewList reviews={profile.reviews.items} sellerId={sellerId} user={user} onChange={() => {
        setRefreshKey((current) => current + 1);
      }} />
      {profile.reviews.totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-4">
          <button className="button-secondary" disabled={reviewPage <= 1} onClick={() => setReviewPage((current) => current - 1)} type="button">Previous reviews</button>
          <span className="text-sm text-slate-600">Page {reviewPage} of {profile.reviews.totalPages}</span>
          <button className="button-secondary" disabled={reviewPage >= profile.reviews.totalPages} onClick={() => setReviewPage((current) => current + 1)} type="button">More reviews</button>
        </div>
      )}
    </main>
  );
}
