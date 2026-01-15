import { Router, Request, Response } from "express";
import colors from "colors";
import mongoose from "mongoose";
import Orden from "../models/Orden";
import { authenticate, authorize } from "../middleware/auth";

const router = Router();

type MpPayment = {
  id: number;
  status?: string;
  status_detail?: string;
  date_created?: string;
  date_last_updated?: string;
  date_approved?: string | null;
  transaction_amount?: number;
  currency_id?: string;
  external_reference?: string;
};

type MpMerchantOrder = {
  id: number;
  status?: string;
  external_reference?: string;
  preference_id?: string;
  payments?: Array<{ id?: number; status?: string }>;
  date_created?: string;
  last_updated?: string;
};

function mpHeaders() {
  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) throw new Error("MP_ACCESS_TOKEN no está definido");
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

async function mpSearchPaymentsByExternalReference(externalReference: string): Promise<MpPayment[]> {
  const url =
    `https://api.mercadopago.com/v1/payments/search` +
    `?external_reference=${encodeURIComponent(externalReference)}` +
    `&sort=date_created&criteria=desc&limit=5`;

  const resp = await fetch(url, { headers: mpHeaders() } as any);
  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`payments/search ${resp.status}: ${txt.slice(0, 300)}`);
  }
  const data: any = await resp.json();
  return Array.isArray(data?.results) ? (data.results as MpPayment[]) : [];
}

async function mpSearchMerchantOrders(params: { externalReference?: string; preferenceId?: string }): Promise<MpMerchantOrder[]> {
  const qs: string[] = [];
  if (params.externalReference) qs.push(`external_reference=${encodeURIComponent(params.externalReference)}`);
  if (params.preferenceId) qs.push(`preference_id=${encodeURIComponent(params.preferenceId)}`);
  qs.push(`sort=date_created&criteria=desc&limit=5`);

  const url = `https://api.mercadopago.com/merchant_orders/search?${qs.join("&")}`;
  const resp = await fetch(url, { headers: mpHeaders() } as any);
  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`merchant_orders/search ${resp.status}: ${txt.slice(0, 300)}`);
  }
  const data: any = await resp.json();
  const results: any[] = Array.isArray(data?.elements) ? data.elements : Array.isArray(data?.results) ? data.results : [];
  return results as MpMerchantOrder[];
}

/**
 * GET /api/admin/mp/reconcile-check?order_id=<orden_id>|external_reference|preference_id
 * (Compat) también acepta `order_id` como `_id` de Mongo si es un ObjectId válido.
 * Devuelve qué ve MercadoPago para esa orden (payments y merchant_orders).
 */
router.get("/reconcile-check", authenticate, authorize("admin"), async (req: Request, res: Response) => {
  try {
    const q = String(req.query.order_id || "").trim();
    const ext = String(req.query.external_reference || "").trim();
    const pref = String(req.query.preference_id || "").trim();

    let orden: any = null;
    if (q) {
      const or: any[] = [{ orden_id: q }, { payment_id: q }, { external_reference: q }];
      // Evitar CastError cuando q NO es un ObjectId (ej. "ORD-123")
      if (mongoose.Types.ObjectId.isValid(q)) {
        or.push({ _id: new mongoose.Types.ObjectId(q) });
      }
      orden = await Orden.findOne({ $or: or }).lean();
    } else if (ext) {
      orden = await Orden.findOne({ external_reference: ext }).lean();
    }

    const externalReference = ext || String(orden?.external_reference || "").trim();
    const preferenceId = pref || String(orden?.payment_id || "").trim();

    if (!externalReference && !preferenceId) {
      return res.status(400).json({
        error: "Debes enviar order_id, external_reference o preference_id",
      });
    }

    const [payments, moByExt, moByPref] = await Promise.all([
      externalReference ? mpSearchPaymentsByExternalReference(externalReference) : Promise.resolve([]),
      externalReference ? mpSearchMerchantOrders({ externalReference }) : Promise.resolve([]),
      preferenceId ? mpSearchMerchantOrders({ preferenceId }) : Promise.resolve([]),
    ]);

    // Log útil para consola
    console.log(colors.cyan(`🔎 reconcile-check ext_ref=${externalReference || "N/A"} pref_id=${preferenceId || "N/A"}`));
    console.log(colors.cyan(`   payments=${payments.length} | mo(ext)=${moByExt.length} | mo(pref)=${moByPref.length}`));

    return res.json({
      ok: true,
      input: { order_id: q || undefined, external_reference: externalReference || undefined, preference_id: preferenceId || undefined },
      orden: orden
        ? {
            orden_id: orden.orden_id,
            external_reference: orden.external_reference,
            payment_id: orden.payment_id,
            status: orden.status,
            payment_status: orden.payment_status,
            payment_status_detail: orden.payment_status_detail,
            date_created: orden.date_created,
            date_updated: orden.date_updated,
            date_approved: orden.date_approved,
          }
        : null,
      mp: {
        payments: payments.map((p) => ({
          id: p.id,
          status: p.status,
          status_detail: p.status_detail,
          date_created: p.date_created,
          date_last_updated: p.date_last_updated,
          date_approved: p.date_approved,
          external_reference: p.external_reference,
          transaction_amount: p.transaction_amount,
          currency_id: p.currency_id,
        })),
        merchant_orders_by_external_reference: moByExt.map((m) => ({
          id: m.id,
          status: m.status,
          external_reference: m.external_reference,
          preference_id: m.preference_id,
          payments: m.payments,
          date_created: m.date_created,
          last_updated: m.last_updated,
        })),
        merchant_orders_by_preference_id: moByPref.map((m) => ({
          id: m.id,
          status: m.status,
          external_reference: m.external_reference,
          preference_id: m.preference_id,
          payments: m.payments,
          date_created: m.date_created,
          last_updated: m.last_updated,
        })),
      },
    });
  } catch (e: any) {
    return res.status(500).json({ error: "Error consultando MercadoPago", message: e?.message || String(e) });
  }
});

export default router;

