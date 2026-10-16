import { Router } from "express";
import mongoose from "mongoose";
import { rateLimit } from "express-rate-limit";
import { body, query, validationResult } from "express-validator";
import { allowRoles, requireAuth } from "../middleware/auth.js";
import Order from "../models/Order.js";
import Review from "../models/Review.js";
import User from "../models/User.js";

const router = Router();
const pagination = [
  query("page").optional().isInt({ min: 1 }),
  query("limit").optional().isInt({ min: 1, max: 50 })
];
const publicReviewLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false
});

function reportValidation(request, response) {
  const errors = validationResult(request);
  if (errors.isEmpty()) return false;
  response.status(400).json({ errors: errors.array() });
  return true;
}

async function changeSellerRating(sellerId, rating, delta, session) {
  await User.updateOne(
    { _id: sellerId, role: "vendor" },
    [
      {
        $set: {
          ratingSum: { $max: [0, { $add: [{ $ifNull: ["$ratingSum", 0] }, delta * rating] }] },
          ratingCount: { $max: [0, { $add: [{ $ifNull: ["$ratingCount", 0] }, delta] }] }
        }
      },
      {
        $set: {
          ratingAverage: {
            $cond: [
              { $gt: ["$ratingCount", 0] },
              { $divide: ["$ratingSum", "$ratingCount"] },
              0
            ]
          }
        }
      }
    ],
    { session }
  );
}

router.get(
  "/seller/:sellerId",
  publicReviewLimit,
  pagination,
  async (request, response, next) => {
    if (reportValidation(request, response)) return;
    if (!mongoose.isValidObjectId(request.params.sellerId)) {
      response.status(400).json({ message: "Invalid seller ID" });
      return;
    }
    const page = Number(request.query.page || 1);
    const limit = Number(request.query.limit || 10);
    try {
      const filter = { seller: request.params.sellerId, hidden: false };
      const [reviews, total] = await Promise.all([
        Review.find(filter)
          .select("rating comment reply createdAt buyer")
          .populate("buyer", "name")
          .sort({ createdAt: -1, _id: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
        Review.countDocuments(filter)
      ]);
      response.json({
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        reviews: reviews.map((review) => ({
          ...review,
          verifiedPurchase: true,
          buyer: review.buyer ? { name: review.buyer.name } : null
        }))
      });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/",
  requireAuth,
  allowRoles("buyer"),
  [
    body("orderId").isMongoId(),
    body("rating").isInt({ min: 1, max: 5 }),
    body("comment").optional().isString().trim().isLength({ max: 500 })
  ],
  async (request, response, next) => {
    if (reportValidation(request, response)) return;
    const session = await mongoose.startSession();
    let review;
    try {
      await session.withTransaction(async () => {
        const order = await Order.findOne({
          _id: request.body.orderId,
          buyer: request.auth.id,
          status: "Delivered",
          escrowStatus: { $ne: "refunded" }
        }).session(session);
        if (!order) {
          const exists = await Order.exists({ _id: request.body.orderId }).session(session);
          response.locals.reviewError = exists
            ? { status: 409, message: "Only buyers with a completed, non-refunded order can review" }
            : { status: 404, message: "Order not found" };
          throw new Error("Review eligibility rejected");
        }
        if (String(order.buyer) === String(order.vendor)) {
          response.locals.reviewError = { status: 403, message: "You cannot review your own seller account" };
          throw new Error("Self review rejected");
        }
        [review] = await Review.create(
          [{
            order: order._id,
            buyer: order.buyer,
            seller: order.vendor,
            rating: Number(request.body.rating),
            comment: request.body.comment || ""
          }],
          { session }
        );
        await changeSellerRating(order.vendor, review.rating, 1, session);
      });
      response.status(201).json({ review, verifiedPurchase: true });
    } catch (error) {
      if (error.code === 11000) {
        response.status(409).json({ message: "A review has already been submitted for this order" });
        return;
      }
      if (response.locals.reviewError) {
        response.status(response.locals.reviewError.status).json({ message: response.locals.reviewError.message });
        return;
      }
      next(error);
    } finally {
      await session.endSession();
    }
  }
);

router.patch(
  "/:reviewId/reply",
  requireAuth,
  allowRoles("vendor"),
  [body("reply").isString().trim().isLength({ min: 1, max: 500 })],
  async (request, response, next) => {
    if (reportValidation(request, response)) return;
    if (!mongoose.isValidObjectId(request.params.reviewId)) {
      response.status(400).json({ message: "Invalid review ID" });
      return;
    }
    try {
      const review = await Review.findOneAndUpdate(
        { _id: request.params.reviewId, seller: request.auth.id, reply: "" },
        { $set: { reply: request.body.reply } },
        { new: true, runValidators: true }
      );
      if (!review) {
        response.status(409).json({ message: "Review not found for this seller or a reply already exists" });
        return;
      }
      response.json({ review });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/:reviewId/report",
  requireAuth,
  [body("reason").isString().trim().isLength({ min: 3, max: 500 })],
  async (request, response, next) => {
    if (reportValidation(request, response)) return;
    if (!mongoose.isValidObjectId(request.params.reviewId)) {
      response.status(400).json({ message: "Invalid review ID" });
      return;
    }
    try {
      const review = await Review.findOneAndUpdate(
        {
          _id: request.params.reviewId,
          hidden: false,
          "reports.reporter": { $ne: request.auth.id },
          buyer: { $ne: request.auth.id }
        },
        { $push: { reports: { reporter: request.auth.id, reason: request.body.reason } } },
        { new: true }
      );
      if (!review) {
        response.status(409).json({ message: "Review cannot be reported by this account or was already reported" });
        return;
      }
      response.status(201).json({ message: "Review report submitted" });
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  "/reported",
  requireAuth,
  allowRoles("admin"),
  async (_request, response, next) => {
    try {
      const reviews = await Review.find({ "reports.0": { $exists: true } })
        .populate("buyer", "name")
        .populate("seller", "name")
        .sort({ updatedAt: -1 })
        .limit(100)
        .lean();
      response.json({ reviews });
    } catch (error) {
      next(error);
    }
  }
);

router.patch(
  "/:reviewId/moderation",
  requireAuth,
  allowRoles("admin"),
  [body("hidden").isBoolean()],
  async (request, response, next) => {
    if (reportValidation(request, response)) return;
    if (!mongoose.isValidObjectId(request.params.reviewId)) {
      response.status(400).json({ message: "Invalid review ID" });
      return;
    }
    const session = await mongoose.startSession();
    let review;
    try {
      await session.withTransaction(async () => {
        review = await Review.findById(request.params.reviewId).session(session);
        if (!review) {
          response.locals.reviewError = { status: 404, message: "Review not found" };
          throw new Error("Review not found");
        }
        const hidden = request.body.hidden === true;
        if (review.hidden !== hidden) {
          await changeSellerRating(review.seller, review.rating, hidden ? -1 : 1, session);
          review.hidden = hidden;
          await review.save({ session });
        }
      });
      response.json({ review });
    } catch (error) {
      if (response.locals.reviewError) {
        response.status(response.locals.reviewError.status).json({ message: response.locals.reviewError.message });
        return;
      }
      next(error);
    } finally {
      await session.endSession();
    }
  }
);

export default router;
