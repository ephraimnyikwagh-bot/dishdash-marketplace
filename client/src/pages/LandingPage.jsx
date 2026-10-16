import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api, { getErrorMessage } from "../api.js";
import Loading from "../components/Loading.jsx";
import Notice from "../components/Notice.jsx";
import ProductImage from "../components/ProductImage.jsx";
import { formatPrice } from "../money.js";

const categories = [
  "Phones and Tablets", "Electronics", "Fashion", "Home and Garden",
  "Vehicles", "Beauty and Health", "Sports and Fitness", "Books and Education"
];

export default function LandingPage() {
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    document.title = "Carted | Buy and sell safely";
    const description = "Discover local listings and buy or sell safely on Carted, a Nigerian online marketplace.";
    document.querySelector('meta[name="description"]')?.setAttribute("content", description);
    document.querySelector('meta[property="og:title"]')?.setAttribute("content", "Carted | Buy and sell safely");
    document.querySelector('meta[property="og:description"]')?.setAttribute("content", description);
    let active = true;
    api.get("/public/featured", { params: { limit: 8 } })
      .then(({ data }) => { if (active) setListings(data.listings || []); })
      .catch((requestError) => {
        if (active) setError(getErrorMessage(requestError, "Featured listings are unavailable right now."));
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  return (
    <main>
      <section className="hero-glow relative overflow-hidden text-white">
        <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <span className="inline-flex rounded-full bg-primary/15 px-4 py-2 text-sm font-semibold text-primary">Nigeria&apos;s trusted community marketplace</span>
            <h1 className="mt-6 max-w-3xl text-4xl font-black leading-tight sm:text-6xl">Buy and sell safely, right here.</h1>
            <p className="mt-5 max-w-xl text-lg leading-8 text-slate-300">Find useful things from local sellers, list what you no longer need, and shop with protected payments and clear order records.</p>
            <form className="mt-8 flex max-w-xl gap-2" onSubmit={(event) => {
              event.preventDefault();
              window.location.assign(`/browse?q=${encodeURIComponent(search.trim())}`);
            }}>
              <label className="sr-only" htmlFor="hero-search">Search listings</label>
              <input className="min-w-0 flex-1 rounded-xl bg-white px-4 py-3 text-ink outline-none focus:ring-2 focus:ring-primary" id="hero-search" onChange={(event) => setSearch(event.target.value)} placeholder="What are you looking for?" value={search} />
              <button className="rounded-xl bg-primary px-5 py-3 font-bold text-ink hover:bg-primary-dark" type="submit">Search</button>
            </form>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link className="button-primary" to="/browse">Start shopping</Link>
              <Link className="inline-flex items-center justify-center rounded-xl border border-white/30 px-5 py-3 text-sm font-bold text-white hover:border-primary hover:text-primary" to="/register?role=vendor">Start selling</Link>
            </div>
          </div>
          <div className="glass-dark mx-auto w-full max-w-lg p-5 sm:p-7">
            <img alt="Carted" className="mx-auto min-h-32 w-full max-w-md object-contain sm:min-h-48" src="/logo-dark.png" />
            <div className="mt-5 grid grid-cols-2 gap-3">
              {["Phones & tablets", "Home essentials", "Fashion finds", "Tools & gear"].map((label) => (
                <div className="glass-dark p-4" key={label}>
                  <p className="text-xs font-semibold uppercase tracking-wide text-primary">Explore</p>
                  <p className="mt-1 font-bold text-white">{label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div><p className="text-sm font-bold uppercase tracking-wider text-link">Find what you need</p><h2 className="mt-2 text-3xl font-black">Browse categories</h2></div>
          <Link className="font-bold text-link hover:underline" to="/browse">Browse all listings →</Link>
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          {categories.map((category) => <Link className="glass rounded-full px-4 py-2 text-sm font-semibold text-slate-800 transition hover:border-primary hover:bg-primary/20" key={category} to={`/browse?category=${encodeURIComponent(category)}`}>{category}</Link>)}
        </div>
      </section>
      <section className="bg-slate-50 py-14">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div><p className="text-sm font-bold uppercase tracking-wider text-link">Fresh finds</p><h2 className="mt-2 text-3xl font-black">Featured listings</h2></div>
            <Link className="font-bold text-link hover:underline" to="/browse">See everything →</Link>
          </div>
          <Notice className="mt-5">{error}</Notice>
          {loading ? <Loading label="Loading featured listings..." /> : listings.length === 0 ? (
            <p className="mt-6 rounded-2xl bg-white p-8 text-center text-slate-500">New listings are on their way. Check back soon.</p>
          ) : (
            <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {listings.map((listing) => (
                <Link className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-100 transition hover:-translate-y-1 hover:shadow-lg" key={listing._id} to={`/listings/${listing._id}`}>
                  <ProductImage name={listing.title} src={listing.images?.[0]} />
                  <div className="p-4"><p className="text-xs font-bold uppercase tracking-wide text-link">{listing.category}</p><h3 className="mt-1 font-bold">{listing.title}</h3><p className="mt-2 font-extrabold">{formatPrice(listing.priceCents)}</p><p className="mt-1 text-xs text-slate-500">{listing.location?.city}, {listing.location?.state}</p><p className="mt-1 text-xs font-semibold text-amber-700">{(listing.sellerRating?.average || 0).toFixed(1)} ★ ({listing.sellerRating?.count || 0})</p></div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <div className="text-center"><p className="text-sm font-bold uppercase tracking-wider text-link">Simple and secure</p><h2 className="mt-2 text-3xl font-black">How Carted works</h2></div>
        <div className="mt-9 grid gap-5 md:grid-cols-3">
          {[["01", "Find or list an item", "Search local listings or post an item you want to sell."], ["02", "Pay securely", "Checkout with clear pricing and a balanced transaction record."], ["03", "Receive or pick up", "Choose delivery with a courier or arrange pickup with the seller."]].map(([number, title, text]) => <article className="glass-strong p-6" key={number}><span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary text-lg font-black text-ink">{number}</span><h3 className="mt-4 text-xl font-extrabold">{title}</h3><p className="mt-2 leading-6 text-slate-700">{text}</p></article>)}
        </div>
      </section>
      <section className="hero-glow py-14 text-white">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="max-w-2xl"><p className="text-sm font-bold uppercase tracking-wider text-primary">Built for peace of mind</p><h2 className="mt-2 text-3xl font-black">Trust belongs in every transaction.</h2></div>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{["Secure payments", "Balanced transaction records", "A receipt for every order", "Dispute support"].map((item) => <li className="glass-dark p-5 font-semibold" key={item}><span className="mr-2 text-primary">✓</span>{item}</li>)}</ul>
        </div>
      </section>
      <section className="mx-auto max-w-7xl px-4 py-16 text-center sm:px-6">
        <h2 className="text-3xl font-black">Ready to find your next favourite?</h2><p className="mt-3 text-slate-500">Join Carted and make your next great deal.</p>
        <div className="mt-6 flex justify-center gap-3"><Link className="button-primary" to="/browse">Start shopping</Link><Link className="button-secondary" to="/register">Create an account</Link></div>
      </section>
      <footer className="bg-ink px-4 py-8 text-center text-sm text-slate-300"><img alt="Carted" className="mx-auto mb-4 h-12 w-40 object-contain" src="/logo-dark.png" /><p>Buy and sell safely with your community.</p><div className="mt-4 flex justify-center gap-5"><Link className="hover:text-primary" to="/browse">Browse</Link><Link className="hover:text-primary" to="/login">Log in</Link><Link className="hover:text-primary" to="/register">Sign up</Link></div><p className="mt-5 text-xs text-slate-500">© {new Date().getFullYear()} Carted</p></footer>
    </main>
  );
}
