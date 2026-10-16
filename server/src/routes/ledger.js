import { Router } from "express";
import mongoose from "mongoose";
import { query, validationResult } from "express-validator";
import { allowRoles, requireAuth } from "../middleware/auth.js";
import LedgerEntry from "../models/LedgerEntry.js";

const router = Router();

router.get(
  "/entries",
  requireAuth,
  allowRoles("admin"),
  [
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 100 }),
    query("from").optional().isISO8601(),
    query("to").optional().isISO8601(),
    query("orderId").optional().isMongoId()
  ],
  async (request, response, next) => {
    const errors = validationResult(request);
    if (!errors.isEmpty()) {
      response.status(400).json({ errors: errors.array() });
      return;
    }
    if (
      request.query.from &&
      request.query.to &&
      new Date(request.query.from) > new Date(request.query.to)
    ) {
      response.status(400).json({ message: "The from date must be before the to date" });
      return;
    }
    const page = Number(request.query.page || 1);
    const limit = Number(request.query.limit || 25);
    const filter = {};
    if (request.query.orderId) filter.order = new mongoose.Types.ObjectId(request.query.orderId);
    if (request.query.from || request.query.to) {
      filter.createdAt = {};
      if (request.query.from) filter.createdAt.$gte = new Date(request.query.from);
      if (request.query.to) filter.createdAt.$lte = new Date(request.query.to);
    }
    try {
      const [entries, total] = await Promise.all([
        LedgerEntry.find(filter)
          .populate("order", "status totalCents")
          .sort({ createdAt: -1, _id: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
        LedgerEntry.countDocuments(filter)
      ]);
      response.json({
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        entries
      });
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  "/integrity",
  requireAuth,
  allowRoles("admin"),
  async (_request, response, next) => {
    try {
      const totals = await LedgerEntry.aggregate([
        {
          $group: {
            _id: "$currency",
            debitsCents: {
              $sum: {
                $cond: [
                  { $eq: ["$direction", "debit"] },
                  "$amountCents",
                  0
                ]
              }
            },
            creditsCents: {
              $sum: {
                $cond: [
                  { $eq: ["$direction", "credit"] },
                  "$amountCents",
                  0
                ]
              }
            }
          }
        },
        { $sort: { _id: 1 } }
      ]);
      const currencies = totals.map((row) => ({
        currency: row._id,
        debitsCents: row.debitsCents,
        creditsCents: row.creditsCents,
        balanced: row.debitsCents === row.creditsCents
      }));
      response.json({
        balanced: currencies.every((currency) => currency.balanced),
        currencies
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
