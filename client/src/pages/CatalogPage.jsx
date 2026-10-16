import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import api, { getErrorMessage } from "../api.js";
import { useAuth } from "../auth.jsx";
import { useCart } from "../cart.jsx";
import Loading from "../components/Loading.jsx";
import Notice from "../components/Notice.jsx";
import ProductImage from "../components/ProductImage.jsx";
import { formatPrice } from "../money.js";

const PAGE_SIZE = 12;
const categories = [
  "Phones and Tablets", "Electronics", "Fashion", "Home and Garden",
  "Vehicles", "Beauty and Health", "Sports and Fitness", "Books and Education"
];
const conditions = ["New", "Like new", "Used"];
const states = [
  "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue",
  "Borno", "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu", "FCT",
  "Gombe", "Imo", "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi", "Kogi",
  "Kwara", "Lagos", "Nasarawa", "Niger", "Ogun", "Ondo", "Osun", "Oyo",
  "Plateau", "Rivers", "Sokoto", "Taraba", "Yobe", "Zamfara"
];

export default function CatalogPage() {
  const { user } = useAuth();
  const { refreshCart } = useCart();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get("q") || "");
  const [filters, setFilters] = useState({
    category: searchParams.get("category") || "",
    condition: "",
    state: "",
    city: "",
    minPrice: "",
    maxPrice: "",
    sort: "newest"
  });
  const [page, setPage] = useState(1);
  const [catalog, setCatalog] = useState({ items: [], total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [addingId, setAddingId] = useState("");
  const [query, setQuery] = useState(searchParams.get("q") || "");

  const loadListings = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = Object.fromEntries(
        Object.entries({ ...filters, q: query, page, limit: PAGE_SIZE })
          .filter(([, value]) => value !== "")
      );
      const { data } = await api.get("/public/listings", { params });
      setCatalog(data);
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Could not load listings."));
    } finally {
      setLoading(false);
    }
  }, [filters, page, query]);

  useEffect(() => { loadListings(); }, [loadListings]);
  useEffect(() => {
    setSearch(searchParams.get("q") || "");
    setQuery(searchParams.get("q") || "");
    setFilters((current) => ({ ...current, category: searchParams.get("category") || "" }));
  }, [searchParams]);

  async function addToCart(listing) {
    if (!user) {
      window.location.assign("/login");
      return;
    }
    setAddingId(listing._id);
    setError("");
    setNotice("");
    try {
      await api.post("/cart/items", { productId: listing._id, quantity: 1 });
      await refreshCart();
      setNotice(`${listing.title} added to your cart.`);
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Could not add this listing."));
    } finally {
      setAddingId("");
    }
  }

  function submitSearch(event) {
    event.preventDefault();
    setPage(1);
    setQuery(search.trim());
    const next = new URLSearchParams(searchParams);
    if (search.trim()) next.set("q", search.trim());
    else next.delete("q");
    setSearchParams(next);
  }

  function updateFilter(name, value) {
    setFilters((current) => ({ ...current, [name]: value }));
    setPage(1);
  }

  return (
    <main className="mx-auto max-w-7xl px-4 pb-16 pt-8 sm:px-6">
      <section className="mb-8 overflow-hidden rounded-3xl bg-ink px-6 py-8 text-white sm:px-10 sm:py-11">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary">
          Buy and sell with confidence
        </p>
        <div className="mt-3 flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <div>
            <h1 className="text-3xl font-black sm:text-4xl">Find your next great find.</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-slate-300">
              Shop quality items from sellers in your community.
            </p>
          </div>
          <form className="flex w-full gap-2 md:max-w-md" onSubmit={submitSearch}>
            <label className="sr-only" htmlFor="catalog-search">Search listings</label>
            <input
              className="min-w-0 flex-1 rounded-xl border border-white/15 bg-white px-4 py-3 text-sm text-ink outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-primary"
              id="catalog-search"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search items..."
              value={search}
            />
            <button className="rounded-xl bg-primary px-5 py-3 text-sm font-bold text-ink hover:bg-primary-dark" type="submit">
              Search
            </button>
          </form>
        </div>
      </section>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-black">Browse listings</h2>
          <p className="mt-1 text-sm text-slate-500">{catalog.total} items to discover</p>
        </div>
      </div>
      <section aria-label="Listing filters" className="mb-6 grid gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100 sm:grid-cols-2 lg:grid-cols-4">
        <label className="field-label">Category
          <select className="field-input" onChange={(event) => updateFilter("category", event.target.value)} value={filters.category}>
            <option value="">All categories</option>{categories.map((category) => <option key={category}>{category}</option>)}
          </select>
        </label>
        <label className="field-label">Condition
          <select className="field-input" onChange={(event) => updateFilter("condition", event.target.value)} value={filters.condition}>
            <option value="">Any condition</option>{conditions.map((condition) => <option key={condition}>{condition}</option>)}
          </select>
        </label>
        <label className="field-label">Nigerian state
          <select className="field-input" onChange={(event) => updateFilter("state", event.target.value)} value={filters.state}>
            <option value="">Anywhere</option>{states.map((state) => <option key={state}>{state}</option>)}
          </select>
        </label>
        <label className="field-label">City
          <input className="field-input" maxLength={100} onChange={(event) => updateFilter("city", event.target.value)} placeholder="Any city" value={filters.city} />
        </label>
        <label className="field-label">Minimum price (₦)
          <input className="field-input" min="0" onChange={(event) => updateFilter("minPrice", event.target.value)} type="number" value={filters.minPrice} />
        </label>
        <label className="field-label">Maximum price (₦)
          <input className="field-input" min="0" onChange={(event) => updateFilter("maxPrice", event.target.value)} type="number" value={filters.maxPrice} />
        </label>
        <label className="field-label">Sort by
          <select className="field-input" onChange={(event) => updateFilter("sort", event.target.value)} value={filters.sort}>
            <option value="newest">Newest</option><option value="price_asc">Price: low to high</option><option value="price_desc">Price: high to low</option>
          </select>
        </label>
      </section>
      <Notice>{error}</Notice><Notice className="mt-3" kind="success">{notice}</Notice>
      {loading ? <Loading label="Finding listings..." /> : catalog.items.length === 0 ? (
        <div className="mt-6 rounded-3xl border border-dashed border-primary/40 bg-white px-6 py-16 text-center">
          <h3 className="text-lg font-bold">No listings found</h3>
          <p className="mt-2 text-sm text-slate-500">{query || Object.values(filters).some(Boolean) ? "Try changing your search or filters." : "Check back soon for new items."}</p>
        </div>
      ) : (
        <>
          <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {catalog.items.map((listing) => (
              <article className="group overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-100 transition hover:-translate-y-1 hover:shadow-lg" key={listing._id}>
                <Link aria-label={`View ${listing.title}`} to={`/listings/${listing._id}`}>
                  <ProductImage name={listing.title} src={listing.images?.[0] || listing.imageUrl} />
                </Link>
                <div className="p-4">
                  <p className="text-xs font-bold uppercase tracking-wider text-link">{listing.category}</p>
                  <div className="mt-1 flex items-start justify-between gap-3">
                    <Link className="font-bold leading-snug hover:text-link" to={`/listings/${listing._id}`}>{listing.title || listing.name}</Link>
                    <span className="shrink-0 font-extrabold">{formatPrice(listing.priceCents)}</span>
                  </div>
                  <p className="mt-2 line-clamp-2 min-h-10 text-sm leading-5 text-slate-500">{listing.description || "View this item from a local seller."}</p>
                  <p className="mt-2 text-xs text-slate-500">{listing.condition} · {listing.location?.city}, {listing.location?.state}</p>
                  <p className="mt-1 text-xs text-slate-500">Seller: {listing.seller?.name || "Local seller"}</p>
                  <p className="mt-1 text-xs font-semibold text-amber-700">{(listing.seller?.ratingAverage || 0).toFixed(1)} ★ ({listing.seller?.ratingCount || 0})</p>
                  <div className="mt-4 flex items-center justify-between gap-3">
                    <span className="text-xs font-semibold text-emerald-700">{listing.quantity ?? listing.stock} available</span>
                    {user?.role === "buyer" && <button className="rounded-xl bg-ink px-3 py-2 text-xs font-bold text-white hover:bg-primary hover:text-ink disabled:opacity-50" disabled={(listing.quantity ?? listing.stock) < 1 || addingId === listing._id} onClick={() => addToCart(listing)} type="button">{addingId === listing._id ? "Adding..." : "Add to cart"}</button>}
                  </div>
                </div>
              </article>
            ))}
          </div>
          <div className="mt-8 flex items-center justify-center gap-4">
            <button className="button-secondary" disabled={page <= 1} onClick={() => setPage((current) => current - 1)} type="button">Previous</button>
            <span className="text-sm font-semibold text-slate-600">Page {page} of {Math.max(1, catalog.totalPages)}</span>
            <button className="button-secondary" disabled={page >= catalog.totalPages} onClick={() => setPage((current) => current + 1)} type="button">Next</button>
          </div>
        </>
      )}
    </main>
  );
}
