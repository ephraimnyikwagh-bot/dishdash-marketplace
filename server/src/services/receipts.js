import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";
import Order from "../models/Order.js";
import OrderItem from "../models/OrderItem.js";
import Receipt from "../models/Receipt.js";

const logoPath = fileURLToPath(
  new URL("../../../client/public/logo.png", import.meta.url)
);

function formatNaira(amountCents) {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    currencyDisplay: "code",
    minimumFractionDigits: 2
  }).format(amountCents / 100);
}

async function renderReceipt(order, items) {
  const payment = order.payment;
  const doc = new PDFDocument({ size: "A4", margin: 50, bufferPages: true });
  const chunks = [];
  doc.on("data", (chunk) => chunks.push(chunk));
  const completed = new Promise((resolveBuffer, reject) => {
    doc.on("end", () => resolveBuffer(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  if (existsSync(logoPath)) {
    doc.image(logoPath, 50, 42, { fit: [72, 56] });
  } else {
    doc.roundedRect(50, 42, 72, 56, 10).fill("#ea580c");
    doc.fillColor("#ffffff").fontSize(16).text("DD", 50, 61, {
      width: 72,
      align: "center"
    });
  }
  doc
    .fontSize(22)
    .fillColor("#c2410c")
    .text("DishDash", 140, 48, { continued: true })
    .fontSize(10)
    .fillColor("#475569")
    .text("  FOOD MARKETPLACE");
  doc.moveDown(2);
  doc.fontSize(18).fillColor("#0f172a").text("Payment receipt");
  doc.moveDown(0.6);
  doc.fontSize(10).fillColor("#334155");
  doc.text(`Receipt: ${order.receiptNumber}`);
  doc.text(`Order: ${String(order._id)}`);
  doc.text(`Date: ${order.statusHistory?.find((entry) => entry.status === "Paid")?.changedAt?.toISOString() || order.createdAt.toISOString()}`);
  doc.text(`Payment reference: ${payment?.providerReference || "Unavailable"}`);
  doc.moveDown();
  doc.fontSize(12).fillColor("#0f172a").text("Buyer");
  doc.fontSize(10).fillColor("#334155");
  doc.text(order.buyer?.name || "Buyer");
  doc.text(order.buyer?.email || "");
  doc.moveDown(0.5);
  doc.fontSize(12).fillColor("#0f172a").text("Vendor");
  doc.fontSize(10).fillColor("#334155");
  doc.text(order.vendor?.name || "Vendor");
  doc.text(order.vendor?.email || "");
  doc.moveDown();
  const tableTop = doc.y;
  const columns = { item: 50, quantity: 330, unit: 395, total: 485 };
  doc.fontSize(10).fillColor("#0f172a");
  doc.text("Item", columns.item, tableTop);
  doc.text("Qty", columns.quantity, tableTop, { width: 45, align: "right" });
  doc.text("Unit price", columns.unit, tableTop, { width: 75, align: "right" });
  doc.text("Total", columns.total, tableTop, { width: 65, align: "right" });
  doc
    .moveTo(50, tableTop + 17)
    .lineTo(545, tableTop + 17)
    .strokeColor("#cbd5e1")
    .stroke();
  let rowY = tableTop + 25;
  doc.fontSize(9).fillColor("#334155");
  for (const item of items) {
    if (rowY > 700) {
      doc.addPage();
      rowY = 55;
    }
    doc.text(item.name, columns.item, rowY, { width: 260 });
    doc.text(String(item.quantity), columns.quantity, rowY, {
      width: 45,
      align: "right"
    });
    doc.text(formatNaira(item.unitPriceCents), columns.unit, rowY, {
      width: 75,
      align: "right"
    });
    doc.text(formatNaira(item.lineTotalCents), columns.total, rowY, {
      width: 65,
      align: "right"
    });
    rowY += 22;
  }
  rowY += 8;
  doc.moveTo(330, rowY).lineTo(545, rowY).strokeColor("#cbd5e1").stroke();
  rowY += 12;
  doc.fontSize(10).fillColor("#334155");
  doc.text("Subtotal", 350, rowY);
  doc.text(formatNaira(order.subtotalCents), 445, rowY, {
    width: 100,
    align: "right"
  });
  rowY += 20;
  doc.text("Platform fee", 350, rowY);
  doc.text(formatNaira(order.platformFeeCents), 445, rowY, {
    width: 100,
    align: "right"
  });
  rowY += 22;
  doc.fontSize(12).fillColor("#0f172a");
  doc.text("Total paid (NGN)", 350, rowY);
  doc.text(formatNaira(order.totalCents), 445, rowY, {
    width: 100,
    align: "right"
  });
  doc.end();
  return completed;
}

export async function ensureReceipt(orderId) {
  const existing = await Receipt.findOne({ order: orderId });
  if (existing?.pdfData?.subarray(0, 4).toString() === "%PDF") {
    return existing;
  }

  const order = await Order.findById(orderId)
    .populate("buyer", "name email")
    .populate("vendor", "name email")
    .populate("payment", "providerReference status");
  if (
    !order ||
    !["Paid", "Shipped", "Delivered", "Refunded"].includes(order.status)
  ) {
    throw new Error("A receipt can only be generated for a paid order");
  }
  const items = await OrderItem.find({ order: order._id }).sort({ _id: 1 }).lean();
  const receiptNumber =
    existing?.receiptNumber ||
    `DD-${Date.now()}-${randomUUID().slice(0, 8).toUpperCase()}`;
  const pdfData = await renderReceipt(
    { ...order.toObject(), receiptNumber },
    items
  );

  if (existing) {
    existing.pdfData = pdfData;
    existing.issuedAt = new Date();
    await existing.save();
    return existing;
  }

  try {
    return await Receipt.create({
      order: order._id,
      receiptNumber,
      pdfData,
      issuedAt: new Date()
    });
  } catch (error) {
    if (error.code !== 11000) throw error;
    const concurrent = await Receipt.findOne({ order: orderId });
    if (concurrent?.pdfData?.subarray(0, 4).toString() === "%PDF") {
      return concurrent;
    }
    if (concurrent) {
      concurrent.pdfData = pdfData;
      concurrent.issuedAt = new Date();
      await concurrent.save();
      return concurrent;
    }
    throw error;
  }
}
