import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import api, { getErrorMessage } from "../api.js";
import { useAuth } from "../auth.jsx";
import { useCart } from "../cart.jsx";
import Loading from "../components/Loading.jsx";
import Notice from "../components/Notice.jsx";
import ProductImage from "../components/ProductImage.jsx";
import { formatPrice } from "../money.js";

export default function ListingDetailPage() {
  const { listingId } = useParams();
  const { user } = useAuth();
  const { refreshCart } = useCart();
  const [listing, setListing] = useState(null);
  const [imageIndex, setImageIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    api.get(`/public/listings/${listingId}`)
      .then(({ data }) => { if (active) setListing(data.listing); })
      .catch((requestError) => { if (active) setError(getErrorMessage(requestError, "Could not load this listing.")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [listingId]);

  async function addToCart() {
    if (!user) {
      window.location.assign("/login");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api.post("/cart/items", { productId: listing._id, quantity: 1 });
      await refreshCart();
      setNotice("Added to your cart.");
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Could not add this listing."));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Loading label="Loading listing..." />;
  if (!listing) return <main className="mx-auto max-w-3xl px-4 py-10"><Notice>{error || "Listing not found."}</Notice><Link className="button-secondary mt-5" to="/browse">Back to browse</Link></main>;
  const images = listing.images?.length ? listing.images : [""];
  return (
    <main className="mx-auto grid max-w-6xl gap-8 px-4 pb-16 pt-8 sm:px-6 lg:grid-cols-2">
      <section>
        <ProductImage className="aspect-square w-full rounded-3xl bg-white object-cover" name={listing.title} src={images[imageIndex]} />
        {images.length > 1 && <div className="mt-3 flex gap-3">{images.map((image, index) => <button aria-label={`View image ${index + 1}`} className={`w-20 overflow-hidden rounded-xl border-2 ${index === imageIndex ? "border-primary" : "border-transparent"}`} key={image} onClick={() => setImageIndex(index)} type="button"><ProductImage name={listing.title} src={image} /></button>)}</div>}
      </section>
      <section className="h-fit rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-100 sm:p-8">
        <p className="text-sm font-bold uppercase tracking-wider text-link">{listing.category}</p>
        <h1 className="mt-2 text-3xl font-black">{listing.title}</h1>
        <p className="mt-4 text-2xl font-extrabold">{formatPrice(listing.priceCents)}</p>
        <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
          <p className="rounded-xl bg-slate-50 p-3"><span className="block text-xs text-slate-500">Condition</span><strong>{listing.condition}</strong></p>
          <p className="rounded-xl bg-slate-50 p-3"><span className="block text-xs text-slate-500">Available</span><strong>{listing.quantity}</strong></p>
          <p className="col-span-2 rounded-xl bg-slate-50 p-3"><span className="block text-xs text-slate-500">Location</span><strong>{listing.location?.city}, {listing.location?.state}</strong></p>
        </div>
        <h2 className="mt-6 font-extrabold">Description</h2>
        <p className="mt-2 whitespace-pre-line leading-7 text-slate-600">{listing.description || "Contact the seller for more information about this item."}</p>
        <div className="mt-6 rounded-2xl border border-slate-100 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Seller</p>
          <Link className="mt-1 inline-block font-bold text-link hover:underline" to={`/sellers/${listing.seller?._id}`}>{listing.seller?.name || "Local seller"} · View profile</Link>
          <p className="mt-1 text-sm font-semibold text-amber-700">{(listing.seller?.ratingAverage || 0).toFixed(1)} ★ ({listing.seller?.ratingCount || 0} verified reviews)</p>
        </div>
        <Notice className="mt-5">{error}</Notice><Notice className="mt-3" kind="success">{notice}</Notice>
        <button className="button-primary mt-5 w-full" disabled={busy || listing.quantity < 1 || user?.role && user.role !== "buyer"} onClick={addToCart} type="button">
          {busy ? "Adding..." : listing.quantity < 1 ? "Sold out" : user ? "Add to cart" : "Log in to add to cart"}
        </button>
      </section>
    </main>
  );
}
