import colors from "colors";
import mongoose from "mongoose";
import Orden from "../models/Orden";
import ProductoModel from "../models/Producto";
import { getCurrentToken, getCurrentStockFromMercadoLibre, propagateStockToGroup, updateStockInMercadoLibre } from "../routes/mercadolibre";

type MpPayment = {
  id: number;
  status?: string;
  status_detail?: string;
  transaction_amount?: number;
  currency_id?: string;
  external_reference?: string;
  date_created?: string;
  date_last_updated?: string;
  date_approved?: string | null;
};

function envBool(name: string, defaultValue: boolean) {
  const v = String(process.env[name] ?? "").trim().toLowerCase();
  if (!v) return defaultValue;
  if (["1", "true", "yes", "y", "on"].includes(v)) return true;
  if (["0", "false", "no", "n", "off"].includes(v)) return false;
  return defaultValue;
}

function envInt(name: string, defaultValue: number) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : defaultValue;
}

function mapOrderStatus(mpStatus?: string): "pending" | "approved" | "rejected" | "cancelled" {
  const s = String(mpStatus || "").toLowerCase();
  if (s === "approved") return "approved";
  if (s === "rejected") return "rejected";
  if (s === "cancelled") return "cancelled";
  return "pending";
}

async function searchLatestPaymentByExternalReference(externalReference: string): Promise<MpPayment | null> {
  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) throw new Error("MP_ACCESS_TOKEN no está definido");

  const url =
    `https://api.mercadopago.com/v1/payments/search` +
    `?external_reference=${encodeURIComponent(externalReference)}` +
    `&sort=date_created&criteria=desc&limit=5`;

  const resp = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  } as any);

  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`MP payments/search error ${resp.status}: ${txt.slice(0, 300)}`);
  }

  const data: any = await resp.json();
  const results: any[] = Array.isArray(data?.results) ? data.results : [];
  if (!results.length) return null;

  // Priorizar approved, sino tomar el más nuevo
  const approved = results.find((p) => String(p?.status || "").toLowerCase() === "approved");
  const selected = approved || results[0];
  if (!selected?.id) return null;
  return selected as MpPayment;
}

async function applyApprovedSideEffectsIfNeeded(params: {
  session: mongoose.ClientSession;
  orderDoc: any;
}) {
  const { session, orderDoc } = params;

  // Descontar stock local usando items de la orden (ya persistidos en Mongo)
  const items: Array<{ product_id?: string; ml_id?: string; quantity?: number; product_name?: string }> =
    Array.isArray(orderDoc?.items) ? orderDoc.items : [];

  for (const it of items) {
    const mlId = String(it?.ml_id || it?.product_id || "").trim();
    const qty = Math.max(0, Number(it?.quantity || 0));
    if (!mlId || !Number.isFinite(qty) || qty <= 0) continue;

    const producto = await ProductoModel.findOne({ ml_id: mlId }).session(session);
    if (!producto) continue;

    const nuevoStock = Math.max(0, Number(producto.available_quantity || 0) - qty);
    await ProductoModel.updateOne({ ml_id: mlId }, { $set: { available_quantity: nuevoStock } }, { session });
  }
}

async function syncStockToMercadoLibreBestEffort(orderDoc: any) {
  // Best-effort: no debe romper reconciliación si falla.
  try {
    const token = await getCurrentToken();
    if (!token?.access_token) return;

    const items: Array<{ product_id?: string; ml_id?: string; quantity?: number }> =
      Array.isArray(orderDoc?.items) ? orderDoc.items : [];

    for (const it of items) {
      const mlId = String(it?.ml_id || it?.product_id || "").trim();
      const qty = Math.max(0, Number(it?.quantity || 0));
      if (!mlId || !Number.isFinite(qty) || qty <= 0) continue;

      const currentStockML = await getCurrentStockFromMercadoLibre(mlId, token.access_token);
      const nuevoStockML = Math.max(0, currentStockML - qty);
      await updateStockInMercadoLibre(mlId, nuevoStockML, token.access_token);
      await propagateStockToGroup(mlId, nuevoStockML, token.access_token);
    }
  } catch {
    // Ignorar (best-effort)
  }
}

let running = false;

export function startMercadoPagoReconciliation() {
  const enabled = envBool("MP_RECONCILE_ENABLED", true);
  const intervalMs = envInt("MP_RECONCILE_INTERVAL_MS", 5 * 60 * 1000);
  const minAgeMinutes = envInt("MP_RECONCILE_MIN_AGE_MINUTES", 10);
  const maxPerRun = envInt("MP_RECONCILE_MAX_PER_RUN", 30);

  if (!enabled) {
    console.log(colors.yellow("🟡 MP Reconciliation deshabilitado (MP_RECONCILE_ENABLED=false)"));
    return;
  }

  const tick = async () => {
    if (running) return;
    running = true;
    const startedAt = Date.now();

    try {
      const minAgeDate = new Date(Date.now() - minAgeMinutes * 60 * 1000);

      // Buscar órdenes pendientes lo suficientemente viejas como para reconciliar
      const pendingOrders = await Orden.find({
        status: "pending",
        date_created: { $lte: minAgeDate },
      })
        .sort({ date_created: 1 })
        .limit(maxPerRun);

      if (!pendingOrders.length) return;

      console.log(colors.blue(`\n🔎 MP Reconciliation: revisando ${pendingOrders.length} órdenes pendientes...`));

      for (const order of pendingOrders) {
        const externalRef = String(order.external_reference || "").trim();
        if (!externalRef) continue;

        // Consultar MP por external_reference
        let mpPayment: MpPayment | null = null;
        try {
          mpPayment = await searchLatestPaymentByExternalReference(externalRef);
        } catch (e: any) {
          console.log(colors.yellow(`   ⚠️ MP search falló para ${externalRef}: ${e?.message || e}`));
          continue;
        }

        if (!mpPayment) continue;

        const mpStatus = String(mpPayment.status || "").toLowerCase();
        if (!mpStatus) continue;

        // Si sigue pending/in_process, no tocar aún
        if (["pending", "in_process", "in_mediation", "authorized"].includes(mpStatus)) continue;

        // Cargar orden fresca y aplicar transición de estado de forma idempotente
        const session = await mongoose.startSession();
        try {
          session.startTransaction();

          const fresh = await Orden.findById(order._id).session(session);
          if (!fresh) {
            await session.abortTransaction();
            continue;
          }

          const wasApproved =
            String(fresh.payment_status || "").toLowerCase() === "approved" ||
            String(fresh.status || "").toLowerCase() === "approved";

          const nextStatus = mapOrderStatus(mpPayment.status);

          // Evitar re-escribir si ya está en estado final igual
          if (String(fresh.status || "").toLowerCase() === nextStatus && String(fresh.payment_status || "").toLowerCase() === mpStatus) {
            await session.commitTransaction();
            continue;
          }

          // Si transiciona a approved por primera vez, aplicar stock local dentro de transacción
          const shouldApplyApprovedSideEffects = nextStatus === "approved" && !wasApproved;
          if (shouldApplyApprovedSideEffects) {
            await applyApprovedSideEffectsIfNeeded({ session, orderDoc: fresh });
          }

          await Orden.updateOne(
            { _id: fresh._id },
            {
              $set: {
                payment_id: String(mpPayment.id),
                payment_status: mpPayment.status || mpStatus,
                payment_status_detail: mpPayment.status_detail || "",
                status: nextStatus,
                date_approved: mpPayment.date_approved ? new Date(mpPayment.date_approved) : fresh.date_approved,
                date_updated: new Date(),
                notes:
                  (fresh.notes ? fresh.notes + "\n" : "") +
                  `[RECONCILIATION] status=${mpStatus}; payment_id=${mpPayment.id}; ext_ref=${externalRef}; checked_at=${new Date().toISOString()}`,
              },
            },
            { session }
          );

          await session.commitTransaction();

          console.log(
            colors.green(
              `   ✅ Reconciliada ${String(fresh.orden_id || fresh._id)} → ${mpStatus} (payment ${mpPayment.id})${shouldApplyApprovedSideEffects ? " + stock" : ""}`
            )
          );

          // Stock en MercadoLibre (best-effort, fuera de la transacción)
          if (nextStatus === "approved" && !wasApproved) {
            void syncStockToMercadoLibreBestEffort(fresh);
          }
        } catch (e: any) {
          try {
            await session.abortTransaction();
          } catch {}
          console.log(colors.red(`   ❌ Error reconciliando ${externalRef}: ${e?.message || e}`));
        } finally {
          session.endSession();
        }
      }
    } finally {
      running = false;
      const ms = Date.now() - startedAt;
      if (ms > 2000) {
        console.log(colors.gray(`   ⏱️ MP Reconciliation run: ${ms}ms`));
      }
    }
  };

  // Ejecutar una vez al iniciar y luego en intervalos
  void tick();
  setInterval(() => void tick(), intervalMs);

  console.log(
    colors.green(
      `✅ MP Reconciliation habilitado | intervalo=${intervalMs}ms | minAge=${minAgeMinutes}min | maxPerRun=${maxPerRun}`
    )
  );
}

