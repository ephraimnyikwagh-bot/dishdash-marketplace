import { Router } from "express";
import mongoose from "mongoose";
import { rateLimit } from "express-rate-limit";
import Product, { listingCategories, listingConditions, nigerianStates } from "../models/Product.js";
import User from "../models/User.js";
import Review from "../models/Review.js";

const router = Router();
const publicReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message: "Too many public listing requests. Try again shortly." }
});
const listingProjection =
  "name title description priceCents stock quantity category condition location images imageUrl createdAt vendor";

function publicListing(product) {
  return {
    _id: product._id,
    title: product.title || product.name,
    description: product.description,
    price: product.priceCents / 100,
    priceCents: product.priceCents,
    quantity: product.quantity ?? product.stock,
    category: product.category,
    condition: product.condition || "Used",
    location: product.location,
    images: product.images?.length ? product.images : product.imageUrl ? [product.imageUrl] : [],
    createdAt: product.createdAt,
    seller: product.vendor
      ? {
          _id: product.vendor._id,
          name: product.vendor.name,
          ratingAverage: product.vendor.ratingAverage || 0,
          ratingCount: product.vendor.ratingCount || 0
        }
      : undefined
  };
}

function featuredListing(product) {
  const listing = publicListing(product);
  listing.sellerRating = listing.seller
    ? {
        average: listing.seller.ratingAverage,
        count: listing.seller.ratingCount
      }
    : { average: 0, count: 0 };
  delete listing.seller;
  return listing;
}

router.get("/featured", publicReadLimiter, async (request, response, next) => {
  const rawLimit = Number(request.query.limit ?? 8);
  if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 8) {
    response.status(400).json({ message: "Limit must be between 1 and 8" });
    return;
  }
  try {
    const products = await Product.find({ isActive: true, stock: { $gt: 0 } })
      .select(listingProjection)
      .populate("vendor", "name ratingAverage ratingCount")
      .sort({ createdAt: -1, _id: -1 })
      .limit(rawLimit)
      .lean();
    response.json({ listings: products.map(featuredListing) });
  } catch (error) {
    next(error);
  }
});

router.get("/listings", publicReadLimiter, async (request, response, next) => {
  const page = Number(request.query.page ?? 1);
  const limit = Number(request.query.limit ?? 12);
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 50) {
    response.status(400).json({ message: "Invalid pagination" });
    return;
  }
  if (request.query.sort && !["newest", "price_asc", "price_desc"].includes(String(request.query.sort))) {
    response.status(400).json({ message: "Invalid sort order" });
    return;
  }
  const minimum = request.query.minPrice == null ? null : Number(request.query.minPrice);
  const maximum = request.query.maxPrice == null ? null : Number(request.query.maxPrice);
  if (
    (minimum != null && (!Number.isFinite(minimum) || minimum < 0 || minimum > 100000000)) ||
    (maximum != null && (!Number.isFinite(maximum) || maximum < 0 || maximum > 100000000)) ||
    (minimum != null && maximum != null && maximum < minimum)
  ) {
    response.status(400).json({ message: "Price range is invalid" });
    return;
  }
  const filter = { isActive: true };
  if (request.query.category) {
    if (!listingCategories.includes(String(request.query.category))) {
      response.status(400).json({ message: "Invalid category" });
      return;
    }
    filter.category = String(request.query.category);
  }
  if (request.query.condition) {
    if (!listingConditions.includes(String(request.query.condition))) {
      response.status(400).json({ message: "Invalid condition" });
      return;
    }
    filter.condition = String(request.query.condition);
  }
  if (request.query.state) {
    if (!nigerianStates.includes(String(request.query.state))) {
      response.status(400).json({ message: "Invalid state" });
      return;
    }
    filter["location.state"] = String(request.query.state);
  }
  if (request.query.city) {
    if (String(request.query.city).length > 100) {
      response.status(400).json({ message: "City filter is too long" });
      return;
    }
    filter["location.city"] = new RegExp(String(request.query.city).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  }
  const priceFilter = {};
  if (minimum != null) priceFilter.$gte = Math.round(minimum * 100);
  if (maximum != null) priceFilter.$lte = Math.round(maximum * 100);
  if (Object.keys(priceFilter).length) {
    if (Object.values(priceFilter).some((price) => !Number.isFinite(price) || price < 0)) {
      response.status(400).json({ message: "Price filters must be valid amounts" });
      return;
    }
    filter.priceCents = priceFilter;
  }
  if (request.query.q) {
    if (String(request.query.q).length > 120) {
      response.status(400).json({ message: "Search term is too long" });
      return;
    }
    const search = String(request.query.q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.$or = ["name", "description"].map((field) => ({
      [field]: { $regex: search, $options: "i" }
    }));
  }
  const sort = request.query.sort === "price_asc"
    ? { priceCents: 1, _id: 1 }
    : request.query.sort === "price_desc"
      ? { priceCents: -1, _id: -1 }
      : { createdAt: -1, _id: -1 };
  try {
    const [items, total] = await Promise.all([
      Product.find(filter)
        .select(listingProjection)
        .populate("vendor", "name ratingAverage ratingCount")
        .sort(sort)
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Product.countDocuments(filter)
    ]);
    response.json({ page, limit, total, totalPages: Math.ceil(total / limit), items: items.map(publicListing) });
  } catch (error) {
    next(error);
  }
});

router.get("/listings/:listingId", publicReadLimiter, async (request, response, next) => {
  if (!mongoose.isValidObjectId(request.params.listingId)) {
    response.status(400).json({ message: "Invalid listing ID" });
    return;
  }
  try {
    const product = await Product.findOne({
      _id: request.params.listingId,
      isActive: true
    })
      .select(listingProjection)
      .populate("vendor", "name ratingAverage ratingCount")
      .lean();
    if (!product) {
      response.status(404).json({ message: "Listing not found" });
      return;
    }
    response.json({ listing: publicListing(product) });
  } catch (error) {
    next(error);
  }
});

router.get("/sellers/:sellerId", publicReadLimiter, async (request, response, next) => {
  if (!mongoose.isValidObjectId(request.params.sellerId)) {
    response.status(400).json({ message: "Invalid seller ID" });
    return;
  }
  const page = Number(request.query.page ?? 1);
  const limit = Number(request.query.limit ?? 12);
  const reviewPage = Number(request.query.reviewPage ?? 1);
  const reviewLimit = Number(request.query.reviewLimit ?? 10);
  if (
    !Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 50 ||
    !Number.isInteger(reviewPage) || reviewPage < 1 || !Number.isInteger(reviewLimit) || reviewLimit < 1 || reviewLimit > 50
  ) {
    response.status(400).json({ message: "Invalid pagination" });
    return;
  }
  try {
    const seller = await User.findOne({
      _id: request.params.sellerId,
      role: "vendor",
      isActive: true
    }).select("name ratingAverage ratingCount").lean();
    if (!seller) {
      response.status(404).json({ message: "Seller not found" });
      return;
    }
    const filter = { vendor: seller._id, isActive: true };
    const [items, total] = await Promise.all([
      Product.find(filter)
        .select(listingProjection)
        .populate("vendor", "name ratingAverage ratingCount")
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Product.countDocuments(filter)
    ]);
    const reviewFilter = { seller: seller._id, hidden: false };
    const [reviews, reviewTotal] = await Promise.all([
      Review.find(reviewFilter)
        .select("rating comment reply createdAt buyer")
        .populate("buyer", "name")
        .sort({ createdAt: -1, _id: -1 })
        .skip((reviewPage - 1) * reviewLimit)
        .limit(reviewLimit)
        .lean(),
      Review.countDocuments(reviewFilter)
    ]);
    response.json({
      seller: {
        _id: seller._id,
        name: seller.name,
        ratingAverage: seller.ratingAverage || 0,
        ratingCount: seller.ratingCount || 0
      },
      items: items.map(publicListing),
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      reviews: {
        page: reviewPage,
        limit: reviewLimit,
        total: reviewTotal,
        totalPages: Math.ceil(reviewTotal / reviewLimit),
        items: reviews.map((review) => ({
          ...review,
          verifiedPurchase: true,
          buyer: review.buyer ? { name: review.buyer.name } : null
        }))
      }
    });
  } catch (error) {
    next(error);
  }
});

export default router;
