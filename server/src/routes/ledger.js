import { Router } from "express";
import mongoose from "mongoose";
import { query, validationResult } from "express-validator";
import { allowRoles, requireAuth } from "../middleware/auth.js";
import LedgerEntry from "../models/LedgerEntry.js";
import Order from "../models/Order.js";
import Payout from "../models/Payout.js";
import User from "../models/User.js";
import { releaseMatureEscrows } from "../services/escrow.js";

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
      const [totals, accountTotals, heldOrders] = await Promise.all([
        LedgerEntry.aggregate([
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
        ]),
        LedgerEntry.aggregate([
          {
            $group: {
              _id: { account: "$account", currency: "$currency" },
              balanceCents: {
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
        Order.find({
          escrowStatus: "held",
          status: { $in: ["Paid", "Shipped", "Ready for pickup", "Delivered"] }
        }).select("totalCents payment").populate("payment", "status").lean()
      ]);
      const currencies = totals.map((row) => ({
        currency: row._id,
        debitsCents: row.debitsCents,
        creditsCents: row.creditsCents,
        balanced: row.debitsCents === row.creditsCents
      }));
      const escrowByCurrency = Object.fromEntries(
        accountTotals
          .filter((row) => row._id.account === "escrow")
          .map((row) => [row._id.currency, row.balanceCents])
      );
      const expectedEscrow = heldOrders
        .filter((order) => order.payment?.status === "succeeded")
        .reduce((sum, order) => sum + order.totalCents, 0);
      const escrowBalanceCents = escrowByCurrency.NGN || 0;
      const escrowNonNegative = escrowBalanceCents >= 0;
      const escrowMatchesOrders = escrowBalanceCents === expectedEscrow;
      response.json({
        balanced: currencies.every((currency) => currency.balanced) &&
          escrowNonNegative && escrowMatchesOrders,
        currencies,
        escrow: {
          balanceCents: escrowBalanceCents,
          expectedCents: expectedEscrow,
          nonNegative: escrowNonNegative,
          matchesUnreleasedPaidOrders: escrowMatchesOrders
        }
      });
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  "/escrow",
  requireAuth,
  allowRoles("admin"),
  async (_request, response, next) => {
    try {
      const orders = await Order.find({
        escrowStatus: "held",
        status: { $in: ["Paid", "Shipped", "Ready for pickup", "Delivered"] }
      }).select("totalCents escrowReleaseAt status").lean();
      response.json({
        pendingCents: orders.reduce((sum, order) => sum + order.totalCents, 0),
        orderCount: orders.length,
        dueCount: orders.filter((order) => order.escrowReleaseAt && order.escrowReleaseAt <= new Date()).length
      });
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  "/wallet",
  requireAuth,
  allowRoles("vendor"),
  async (request, response, next) => {
    try {
      await releaseMatureEscrows({ sellerId: request.auth.id });
      const page = Number(request.query.page || 1);
      const limit = Number(request.query.limit || 20);
      if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 50) {
        response.status(400).json({ message: "Invalid wallet pagination" });
        return;
      }
      const [accountTotals, pendingOrders, requestedPayouts, paidPayouts, entries, payouts, entryCount] =
        await Promise.all([
          LedgerEntry.aggregate([
            { $match: { owner: new mongoose.Types.ObjectId(request.auth.id), account: { $in: ["seller_payable", "seller_payout"] } } },
            {
              $group: {
                _id: "$account",
                balanceCents: {
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
          Order.find({ vendor: request.auth.id, escrowStatus: "held" })
            .select("totalCents")
            .lean(),
          Payout.aggregate([
            { $match: { seller: new mongoose.Types.ObjectId(request.auth.id), status: "Requested" } },
            { $group: { _id: null, amountCents: { $sum: "$amountCents" } } }
          ]),
          Payout.aggregate([
            { $match: { seller: new mongoose.Types.ObjectId(request.auth.id), status: "Paid out" } },
            { $group: { _id: null, amountCents: { $sum: "$amountCents" } } }
          ]),
          LedgerEntry.find({ owner: request.auth.id })
            .sort({ createdAt: -1, _id: -1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .lean(),
          Payout.find({ seller: request.auth.id }).sort({ createdAt: -1, _id: -1 }).limit(limit).lean(),
          LedgerEntry.countDocuments({ owner: request.auth.id })
        ]);
      const balances = Object.fromEntries(accountTotals.map((row) => [row._id, row.balanceCents]));
      const pendingCents = pendingOrders.reduce((sum, order) => sum + order.totalCents, 0);
      const requestedCents = requestedPayouts[0]?.amountCents || 0;
      response.json({
        pendingCents,
        availableCents: Math.max(0, (balances.seller_payable || 0) - requestedCents),
        reservedPayoutCents: requestedCents,
        paidOutCents: paidPayouts[0]?.amountCents || 0,
        transactions: entries,
        payouts,
        page,
        limit,
        total: entryCount
      });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/wallet/payouts",
  requireAuth,
  allowRoles("vendor"),
  async (request, response, next) => {
    const { amountCents, idempotencyKey } = request.body || {};
    if (!Number.isSafeInteger(amountCents) || amountCents < 1 || typeof idempotencyKey !== "string" || idempotencyKey.trim().length < 8 || idempotencyKey.length > 120) {
      response.status(400).json({ message: "A positive amountCents and valid idempotencyKey are required" });
      return;
    }
    const normalizedKey = idempotencyKey.trim();
    const session = await mongoose.startSession();
    let payout;
    let reused = false;
    try {
      await session.withTransaction(async () => {
        payout = await Payout.findOne({ idempotencyKey: `${request.auth.id}:${normalizedKey}` }).session(session);
        if (payout) {
          reused = true;
          return;
        }
        const seller = await User.findOneAndUpdate(
          { _id: request.auth.id, role: "vendor" },
          { $inc: { walletVersion: 1 } },
          { new: true, session }
        );
        if (!seller) {
          response.locals.walletError = { status: 404, message: "Seller account not found" };
          throw new Error("Seller account not found");
        }
        const [totals, requested] = await Promise.all([
          LedgerEntry.aggregate([
            { $match: { owner: seller._id, account: "seller_payable" } },
            {
              $group: {
                _id: null,
                balanceCents: {
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
          ]).session(session),
          Payout.aggregate([
            { $match: { seller: seller._id, status: "Requested" } },
            { $group: { _id: null, amountCents: { $sum: "$amountCents" } } }
          ]).session(session)
        ]);
        const available = (totals[0]?.balanceCents || 0) - (requested[0]?.amountCents || 0);
        if (amountCents > available) {
          response.locals.walletError = { status: 409, message: "Payout amount exceeds your available balance" };
          throw new Error("Payout exceeds seller balance");
        }
        [payout] = await Payout.create(
          [{
            seller: seller._id,
            amountCents,
            idempotencyKey: `${request.auth.id}:${normalizedKey}`
          }],
          { session }
        );
      });
      response.status(reused ? 200 : 201).json({ payout, reused });
    } catch (error) {
      if (response.locals.walletError) {
        response.status(response.locals.walletError.status).json({ message: response.locals.walletError.message });
        return;
      }
      if (error.code === 11000) {
        const duplicate = await Payout.findOne({ idempotencyKey: `${request.auth.id}:${normalizedKey}` });
        if (duplicate) {
          response.status(200).json({ payout: duplicate, reused: true });
          return;
        }
      }
      next(error);
    } finally {
      await session.endSession();
    }
  }
);

router.get(
  "/admin/payouts",
  requireAuth,
  allowRoles("admin"),
  async (request, response, next) => {
    try {
      const payouts = await Payout.find()
        .populate("seller", "name email")
        .sort({ createdAt: -1, _id: -1 })
        .limit(100)
        .lean();
      response.json({ payouts });
    } catch (error) {
      next(error);
    }
  }
);

router.patch(
  "/admin/payouts/:payoutId",
  requireAuth,
  allowRoles("admin"),
  async (request, response, next) => {
    if (request.body?.status !== "Paid out" || !mongoose.isValidObjectId(request.params.payoutId)) {
      response.status(400).json({ message: "A valid payoutId and status Paid out are required" });
      return;
    }
    const session = await mongoose.startSession();
    let payout;
    let duplicate = false;
    try {
      await session.withTransaction(async () => {
        payout = await Payout.findById(request.params.payoutId).session(session);
        if (!payout) {
          response.locals.payoutError = { status: 404, message: "Payout not found" };
          throw new Error("Payout not found");
        }
        if (payout.status === "Paid out") {
          duplicate = true;
          return;
        }
        const seller = await User.findOneAndUpdate(
          { _id: payout.seller, role: "vendor" },
          { $inc: { walletVersion: 1 } },
          { new: true, session }
        );
        const totals = await LedgerEntry.aggregate([
          { $match: { owner: payout.seller, account: "seller_payable" } },
          {
            $group: {
              _id: null,
              balanceCents: {
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
        ]).session(session);
        if (!seller || (totals[0]?.balanceCents || 0) < payout.amountCents) {
          response.locals.payoutError = { status: 409, message: "Seller payable balance is insufficient" };
          throw new Error("Seller payable balance is insufficient");
        }
        await LedgerEntry.create(
          [
            {
              transactionId: `payout_${payout._id}`,
              owner: payout.seller,
              account: "seller_payable",
              direction: "debit",
              amountCents: payout.amountCents,
              currency: "NGN",
              idempotencyKey: `payout:${payout._id}:seller-payable`
            },
            {
              transactionId: `payout_${payout._id}`,
              owner: payout.seller,
              account: "seller_payout",
              direction: "credit",
              amountCents: payout.amountCents,
              currency: "NGN",
              idempotencyKey: `payout:${payout._id}:seller-payout`
            }
          ],
          { session, ordered: true }
        );
        payout.status = "Paid out";
        await payout.save({ session });
      });
      response.json({ payout, duplicate });
    } catch (error) {
      if (response.locals.payoutError) {
        response.status(response.locals.payoutError.status).json({ message: response.locals.payoutError.message });
        return;
      }
      next(error);
    } finally {
      await session.endSession();
    }
  }
);

export default router;
