import { useCallback, useEffect, useRef, useState } from "react";
import api, { getErrorMessage } from "../api.js";
import Loading from "../components/Loading.jsx";
import Notice from "../components/Notice.jsx";
import ProductImage from "../components/ProductImage.jsx";
import { formatPrice } from "../money.js";

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
const emptyForm = {
  title: "", category: "", description: "", price: "", quantity: "",
  condition: "Used", state: "Lagos", city: ""
};

export default function VendorDashboardPage() {
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editingId, setEditingId] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [imageFiles, setImageFiles] = useState([]);
  const [previews, setPreviews] = useState([]);
  const fileInput = useRef(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [listingToRemove, setListingToRemove] = useState(null);

  const loadListings = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get("/products/mine", { params: { page, limit: 30 } });
      setListings(data.products || []);
      setTotalPages(Math.max(1, data.totalPages || 1));
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Could not load your listings."));
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => { loadListings(); }, [loadListings]);

  function clearPreviews() {
    previews.filter((url) => url.startsWith("blob:")).forEach(URL.revokeObjectURL);
  }

  function resetForm() {
    clearPreviews();
    setForm(emptyForm);
    setImageFiles([]);
    setPreviews([]);
    setEditingId("");
    if (fileInput.current) fileInput.current.value = "";
  }

  function editListing(listing) {
    clearPreviews();
    setEditingId(listing._id);
    setImageFiles([]);
    setPreviews(listing.images?.length ? listing.images : listing.imageUrl ? [listing.imageUrl] : []);
    setForm({
      title: listing.title || listing.name,
      category: listing.category,
      description: listing.description || "",
      price: String(listing.priceCents / 100),
      quantity: String(listing.quantity ?? listing.stock),
      condition: listing.condition || "Used",
      state: listing.location?.state || "Lagos",
      city: listing.location?.city || ""
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function selectImages(event) {
    const files = Array.from(event.target.files || []);
    if (files.length > 5) {
      setError("Choose no more than 5 images.");
      event.target.value = "";
      return;
    }
    if (files.some((file) => !["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 2 * 1024 * 1024)) {
      setError("Each image must be JPG, PNG, or WebP and no larger than 2 MB.");
      event.target.value = "";
      return;
    }
    clearPreviews();
    setError("");
    setImageFiles(files);
    setPreviews(files.map((file) => URL.createObjectURL(file)));
  }

  async function submit(event) {
    event.preventDefault();
    const price = Number(form.price);
    const quantity = Number(form.quantity);
    if (!Number.isFinite(price) || price < 0.01 || price > 100000000) {
      setError("Enter a valid price in naira.");
      return;
    }
    if (!Number.isInteger(quantity) || quantity < 0 || quantity > 999999) {
      setError("Quantity must be a whole number from 0 to 999999.");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    let listingId = editingId;
    const payload = {
      title: form.title,
      category: form.category,
      description: form.description,
      price,
      quantity,
      condition: form.condition,
      location: { state: form.state, city: form.city }
    };
    try {
      if (editingId) {
        await api.patch(`/products/${editingId}`, payload);
        setNotice("Listing updated.");
      } else {
        const { data } = await api.post("/products", payload);
        listingId = data.product._id;
        setNotice("Listing created.");
      }
      if (imageFiles.length) {
        const upload = new FormData();
        imageFiles.forEach((file) => upload.append("images", file));
        await api.post(`/products/${listingId}/images`, upload, {
          headers: { "Content-Type": "multipart/form-data" }
        });
      }
      resetForm();
      await loadListings();
    } catch (requestError) {
      if (listingId) await loadListings();
      setError(getErrorMessage(requestError, "Could not save this listing."));
    } finally {
      setSaving(false);
    }
  }

  async function removeListing(listing) {
    setListingToRemove(listing);
  }

  async function confirmRemoveListing() {
    if (!listingToRemove) return;
    const listing = listingToRemove;
    setListingToRemove(null);
    setError("");
    setNotice("");
    try {
      await api.delete(`/products/${listing._id}`);
      setListings((current) => current.filter((item) => item._id !== listing._id));
      setNotice("Listing removed.");
      if (editingId === listing._id) resetForm();
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Could not remove this listing."));
    }
  }

  return (
    <main className="mx-auto max-w-7xl px-4 pb-16 pt-8 sm:px-6">
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-link">Seller</p><h1 className="mt-2 text-3xl font-black">Seller dashboard</h1><p className="mt-2 text-sm text-slate-500">Manage your listings, quantity, and item status.</p></div>
        <span className="rounded-full bg-primary/20 px-4 py-2 text-sm font-bold text-link">{listings.length} shown</span>
      </div>
      {listingToRemove && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4" role="presentation">
          <section aria-labelledby="remove-listing-title" aria-modal="true" className="glass-strong w-full max-w-md p-6" role="dialog">
            <h2 className="text-xl font-black" id="remove-listing-title">Remove this listing?</h2>
            <p className="mt-2 text-sm text-slate-700">“{listingToRemove.title || listingToRemove.name}” will no longer appear in Browse.</p>
            <div className="mt-5 flex justify-end gap-3">
              <button className="button-secondary" onClick={() => setListingToRemove(null)} type="button">Keep listing</button>
              <button className="button-primary" onClick={confirmRemoveListing} type="button">Remove listing</button>
            </div>
          </section>
        </div>
      )}
      <div className="grid items-start gap-6 lg:grid-cols-[360px_1fr]">
        <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100 sm:p-6">
          <h2 className="text-lg font-extrabold">{editingId ? "Edit listing" : "Create a listing"}</h2>
          <p className="mt-1 text-sm text-slate-500">Set the amount in naira and tell buyers where the item is located.</p>
          <form className="mt-5 space-y-3" onSubmit={submit}>
            <Notice>{error}</Notice><Notice kind="success">{notice}</Notice>
            <label className="field-label">Title<input className="field-input" maxLength={160} onChange={(event) => setForm({ ...form, title: event.target.value })} required value={form.title} /></label>
            <label className="field-label">Category<select className="field-input" onChange={(event) => setForm({ ...form, category: event.target.value })} required value={form.category}><option value="">Choose a category</option>{categories.map((category) => <option key={category}>{category}</option>)}</select></label>
            <label className="field-label">Description<textarea className="field-input min-h-20 resize-y" maxLength={2000} onChange={(event) => setForm({ ...form, description: event.target.value })} value={form.description} /></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="field-label">Price (₦)<input className="field-input" min="0.01" onChange={(event) => setForm({ ...form, price: event.target.value })} required step="0.01" type="number" value={form.price} /></label>
              <label className="field-label">Quantity<input className="field-input" max="999999" min="0" onChange={(event) => setForm({ ...form, quantity: event.target.value })} required step="1" type="number" value={form.quantity} /></label>
            </div>
            <label className="field-label">Condition<select className="field-input" onChange={(event) => setForm({ ...form, condition: event.target.value })} value={form.condition}>{conditions.map((condition) => <option key={condition}>{condition}</option>)}</select></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="field-label">State<select className="field-input" onChange={(event) => setForm({ ...form, state: event.target.value })} value={form.state}>{states.map((state) => <option key={state}>{state}</option>)}</select></label>
              <label className="field-label">City<input className="field-input" maxLength={100} onChange={(event) => setForm({ ...form, city: event.target.value })} required value={form.city} /></label>
            </div>
            <label className="field-label">Photos <span className="font-normal text-slate-500">(up to 5; JPG, PNG, WebP; max 2 MB each)</span><input accept="image/jpeg,image/png,image/webp" className="field-input" multiple onChange={selectImages} ref={fileInput} type="file" /></label>
            {previews.length > 0 && <div className="grid grid-cols-3 gap-2">{previews.map((src) => <ProductImage className="aspect-square w-full rounded-lg object-cover" key={src} name={form.title || "Listing"} src={src} />)}</div>}
            <div className="flex gap-2 pt-1"><button className="button-primary flex-1" disabled={saving} type="submit">{saving ? "Saving..." : editingId ? "Save changes" : "Publish listing"}</button>{editingId && <button className="button-secondary" onClick={resetForm} type="button">Cancel</button>}</div>
          </form>
        </section>
        <section>
          <h2 className="mb-4 text-xl font-extrabold">Your listings</h2>
          {loading ? <Loading label="Loading your listings..." /> : listings.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-primary/40 bg-white px-6 py-14 text-center"><h3 className="font-bold">Your first listing starts here</h3><p className="mt-2 text-sm text-slate-500">Add an item with the form.</p></div>
          ) : <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {listings.map((listing) => <article className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-100" key={listing._id}><ProductImage name={listing.title || listing.name} src={listing.images?.[0] || listing.imageUrl} /><div className="p-4"><p className="text-xs font-bold uppercase tracking-wide text-link">{listing.category} · {listing.condition || "Used"}</p><div className="mt-1 flex justify-between gap-3"><h3 className="font-bold">{listing.title || listing.name}</h3><span className="font-extrabold">{formatPrice(listing.priceCents)}</span></div><p className="mt-3 text-sm text-slate-500">Quantity: <strong className="text-slate-700">{listing.quantity ?? listing.stock}</strong></p><p className="mt-1 text-xs text-slate-500">Status: {listing.isActive ? "Active" : "Removed"}</p><div className="mt-4 flex gap-2"><button className="button-secondary flex-1 !py-2" onClick={() => editListing(listing)} type="button">Edit</button><button className="rounded-xl border border-red-200 px-3 py-2 text-sm font-bold text-red-600 hover:bg-red-50" onClick={() => removeListing(listing)} type="button">Remove</button></div></div></article>)}
            </div>
            {totalPages > 1 && <div className="mt-6 flex items-center justify-center gap-4"><button className="button-secondary" disabled={page <= 1} onClick={() => setPage((current) => current - 1)} type="button">Previous</button><span className="text-sm text-slate-500">Page {page} of {totalPages}</span><button className="button-secondary" disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)} type="button">Next</button></div>}
          </>}
        </section>
      </div>
    </main>
  );
}
