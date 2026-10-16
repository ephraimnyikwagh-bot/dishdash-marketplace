import { useCallback, useEffect, useState } from "react";
import api, { getErrorMessage } from "../api.js";
import { useCart } from "../cart.jsx";
import Loading from "../components/Loading.jsx";
import Notice from "../components/Notice.jsx";
import ProductImage from "../components/ProductImage.jsx";
import { formatPrice } from "../money.js";

const PAGE_SIZE = 8;

export default function CatalogPage() {
  const { refreshCart } = useCart();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [catalog, setCatalog] = useState({
    items: [],
    total: 0,
    totalPages: 0
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [addingId, setAddingId] = useState("");

  const loadProducts = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get("/products", {
        params: { q: query || undefined, page, limit: PAGE_SIZE }
      });
      setCatalog(data);
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Could not load the menu."));
    } finally {
      setLoading(false);
    }
  }, [page, query]);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  async function addToCart(product) {
    setAddingId(product._id);
    setError("");
    setNotice("");
    try {
      await api.post("/cart/items", { productId: product._id, quantity: 1 });
      await refreshCart();
      setNotice(`${product.name} added to your cart.`);
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Could not add this item."));
    } finally {
      setAddingId("");
    }
  }

  function submitSearch(event) {
    event.preventDefault();
    setPage(1);
    setQuery(search.trim());
  }

  return (
    <main className="mx-auto max-w-7xl px-4 pb-16 pt-8 sm:px-6">
      <section className="mb-8 overflow-hidden rounded-3xl bg-slate-900 px-6 py-8 text-white sm:px-10 sm:py-11">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-orange-300">
          Made nearby, delivered happily
        </p>
        <div className="mt-3 flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <div>
            <h1 className="text-3xl font-black sm:text-4xl">
              Find your next favorite.
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-slate-300">
              Browse local kitchens and fresh picks made just for you.
            </p>
          </div>
          <form
            className="flex w-full gap-2 md:max-w-md"
            onSubmit={submitSearch}
          >
            <label className="sr-only" htmlFor="catalog-search">
              Search the menu
            </label>
            <input
              className="min-w-0 flex-1 rounded-xl border border-white/15 bg-white px-4 py-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-orange-400"
              id="catalog-search"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search dishes..."
              value={search}
            />
            <button
              className="rounded-xl bg-orange-600 px-5 py-3 text-sm font-bold hover:bg-orange-500"
              type="submit"
            >
              Search
            </button>
          </form>
        </div>
      </section>

      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-black">The menu</h2>
          <p className="mt-1 text-sm text-slate-500">
            {catalog.total} {catalog.total === 1 ? "dish" : "dishes"} to
            discover
          </p>
        </div>
      </div>
      <Notice>{error}</Notice>
      <Notice className="mt-3" kind="success">
        {notice}
      </Notice>

      {loading ? (
        <Loading label="Finding something delicious..." />
      ) : catalog.items.length === 0 ? (
        <div className="mt-6 rounded-3xl border border-dashed border-orange-200 bg-white px-6 py-16 text-center">
          <div className="text-5xl">🍽️</div>
          <h3 className="mt-4 text-lg font-bold">Nothing on the menu yet</h3>
          <p className="mt-2 text-sm text-slate-500">
            {query
              ? "Try a different search."
              : "Check back soon for local favorites."}
          </p>
        </div>
      ) : (
        <>
          <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {catalog.items.map((product) => (
              <article
                className="group overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-100 transition hover:-translate-y-1 hover:shadow-lg"
                key={product._id}
              >
                <ProductImage name={product.name} src={product.imageUrl} />
                <div className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wider text-orange-600">
                        {product.category}
                      </p>
                      <h3 className="mt-1 font-bold leading-snug">
                        {product.name}
                      </h3>
                    </div>
                    <span className="shrink-0 font-extrabold">
                      {formatPrice(product.priceCents)}
                    </span>
                  </div>
                  <p className="mt-2 line-clamp-2 min-h-10 text-sm leading-5 text-slate-500">
                    {product.description || "Made fresh by a local kitchen."}
                  </p>
                  <div className="mt-4 flex items-center justify-between gap-3">
                    <span
                      className={`text-xs font-semibold ${product.stock > 0 ? "text-emerald-700" : "text-red-600"}`}
                    >
                      {product.stock > 0
                        ? `${product.stock} available`
                        : "Sold out"}
                    </span>
                    <button
                      className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-white hover:bg-orange-600 disabled:cursor-not-allowed disabled:bg-slate-300"
                      disabled={product.stock < 1 || addingId === product._id}
                      onClick={() => addToCart(product)}
                      type="button"
                    >
                      {addingId === product._id ? "Adding..." : "Add to cart"}
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
          <div className="mt-8 flex items-center justify-center gap-4">
            <button
              className="button-secondary"
              disabled={page <= 1}
              onClick={() => setPage((current) => current - 1)}
              type="button"
            >
              Previous
            </button>
            <span className="text-sm font-semibold text-slate-600">
              Page {page} of {Math.max(1, catalog.totalPages)}
            </span>
            <button
              className="button-secondary"
              disabled={page >= catalog.totalPages}
              onClick={() => setPage((current) => current + 1)}
              type="button"
            >
              Next
            </button>
          </div>
        </>
      )}
    </main>
  );
}
