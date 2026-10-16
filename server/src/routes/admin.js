import { Router } from "express";
import { query, validationResult } from "express-validator";
import { allowRoles, requireAuth } from "../middleware/auth.js";
import Dispute from "../models/Dispute.js";
import LedgerEntry from "../models/LedgerEntry.js";
import Order from "../models/Order.js";
import Payment from "../models/Payment.js";
import User from "../models/User.js";

const router = Router();
const pagination = [
  query("page").optional().isInt({ min: 1 }),
  query("limit").optional().isInt({ min: 1, max: 100 })
];

router.use(requireAuth, allowRoles("admin"));

router.get("/dashboard", async (_request, response, next) => {
  try {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const [
      paymentVolume,
      orderCounts,
      usersByRole,
      activeDeliveries,
      feeRevenue,
      dailyVolume,
      openDisputes
    ] = await Promise.all([
      Payment.aggregate([
        { $match: { status: { $in: ["succeeded", "refunded"] } } },
        { $group: { _id: null, totalCents: { $sum: "$amountCents" } } }
      ]),
      Order.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
      User.aggregate([{ $group: { _id: "$role", count: { $sum: 1 } } }]),
      Order.countDocuments({ status: "Shipped" }),
      LedgerEntry.aggregate([
        {
          $match: {
            account: "platform_revenue",
            createdAt: { $gte: thirtyDaysAgo }
          }
        },
        {
          $group: {
            _id: null,
            last7DaysCents: {
              $sum: {
                $cond: [
                  { $gte: ["$createdAt", sevenDaysAgo] },
                  {
                    $cond: [
                      { $eq: ["$direction", "credit"] },
                      "$amountCents",
                      { $multiply: ["$amountCents", -1] }
                    ]
                  },
                  0
                ]
              }
            },
            last30DaysCents: {
              $sum: {
                $cond: [
                  { $eq: ["$direction", "credit"] },
                  "$amountCents",
                  { $multiply: ["$amountCents", -1] }
                ]
              }
            }
          }
        }
      ]),
      Payment.aggregate([
        {
          $match: {
            status: { $in: ["succeeded", "refunded"] },
            confirmedAt: { $gte: thirtyDaysAgo }
          }
        },
        {
          $group: {
            _id: {
              $dateToString: { format: "%Y-%m-%d", date: "$confirmedAt" }
            },
            volumeCents: { $sum: "$amountCents" },
            orders: { $sum: 1 }
          }
        },
        { $sort: { _id: 1 } }
      ]),
      Dispute.countDocuments({ status: { $in: ["Open", "Under review"] } })
    ]);

    const ordersByStatus = Object.fromEntries(
      orderCounts.map((entry) => [entry._id, entry.count])
    );
    const userCounts = Object.fromEntries(
      usersByRole.map((entry) => [entry._id, entry.count])
    );
    response.json({
      transactionVolumeCents: paymentVolume[0]?.totalCents || 0,
      ordersByStatus,
      userCounts,
      totalUsers: usersByRole.reduce((sum, entry) => sum + entry.count, 0),
      activeDeliveries,
      openDisputes,
      platformFeeRevenue: {
        last7DaysCents: feeRevenue[0]?.last7DaysCents || 0,
        last30DaysCents: feeRevenue[0]?.last30DaysCents || 0
      },
      dailyVolume: dailyVolume.map((entry) => ({
        date: entry._id,
        volumeCents: entry.volumeCents,
        orders: entry.orders
      }))
    });
  } catch (error) {
    next(error);
  }
});

router.get("/orders", pagination, async (request, response, next) => {
  const errors = validationResult(request);
  if (!errors.isEmpty()) {
    response.status(400).json({ errors: errors.array() });
    return;
  }
  const page = Number(request.query.page || 1);
  const limit = Number(request.query.limit || 20);
  const filter = {};
  if (request.query.status) filter.status = request.query.status;
  try {
    const [orders, total] = await Promise.all([
      Order.find(filter)
        .populate("buyer", "name email")
        .populate("vendor", "name email")
        .populate("courier", "name email")
        .populate("payment", "provider providerReference status amountCents")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Order.countDocuments(filter)
    ]);
    response.json({
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      orders
    });
  } catch (error) {
    next(error);
  }
});

router.get("/users", pagination, async (request, response, next) => {
  const errors = validationResult(request);
  if (!errors.isEmpty()) {
    response.status(400).json({ errors: errors.array() });
    return;
  }
  const page = Number(request.query.page || 1);
  const limit = Number(request.query.limit || 20);
  const filter = {};
  if (request.query.role) {
    if (!["buyer", "vendor", "courier", "admin"].includes(request.query.role)) {
      response.status(400).json({ message: "Invalid user role filter" });
      return;
    }
    filter.role = request.query.role;
  }
  try {
    const [users, total] = await Promise.all([
      User.find(filter)
        .select("name email role isActive createdAt")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      User.countDocuments(filter)
    ]);
    response.json({
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      users
    });
  } catch (error) {
    next(error);
  }
});

export default router;
