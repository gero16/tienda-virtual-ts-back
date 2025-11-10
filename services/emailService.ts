import nodemailer from "nodemailer";

type PriceInvalidEmailPayload = {
  ml_id: string;
  title?: string | null;
  reason: string | null;
  rawPrice: any;
  fallbackPrice: number | null;
  source: string;
};

let cachedTransporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  if (cachedTransporter) return cachedTransporter;

  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : undefined;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !port || !user || !pass) {
    console.warn("⚠️ SMTP no configurado. Define SMTP_HOST, SMTP_PORT, SMTP_USER y SMTP_PASS para habilitar alertas por correo.");
    return null;
  }

  cachedTransporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: {
      user,
      pass,
    },
  });

  return cachedTransporter;
}

export async function sendPriceInvalidEmail(payload: PriceInvalidEmailPayload) {
  const to = process.env.ALERT_EMAIL_TO;
  if (!to) {
    return;
  }

  const transporter = getTransporter();
  if (!transporter) {
    return;
  }

  const from = process.env.ALERT_EMAIL_FROM || process.env.SMTP_USER || "alertas@notificaciones.com";
  const subject = `⚠️ Precio inválido detectado: ${payload.ml_id}`;

  const humanRaw =
    payload.rawPrice === null || typeof payload.rawPrice === "undefined"
      ? "null"
      : Number.isNaN(Number(payload.rawPrice))
        ? String(payload.rawPrice)
        : `${payload.rawPrice}`;

  const lines = [
    `Se detectó un precio inválido en una publicación de Mercado Libre.`,
    ``,
    `Producto: ${payload.title ? `"${payload.title}"` : payload.ml_id}`,
    `ML ID: ${payload.ml_id}`,
    `Origen: ${payload.source}`,
    `Valor recibido: ${humanRaw}`,
    `Motivo detectado: ${payload.reason ?? "desconocido"}`,
  ];

  if (typeof payload.fallbackPrice === "number" && payload.fallbackPrice > 0) {
    lines.push(`Precio anterior conservado: ${payload.fallbackPrice}`);
  }

  lines.push(``, `Por favor revisa el panel de administración para corregir el precio.`);

  try {
    await transporter.sendMail({
      from,
      to,
      subject,
      text: lines.join("\n"),
    });
    console.log(`📧 Alerta de precio inválido enviada por correo a ${to} (producto ${payload.ml_id})`);
  } catch (error: any) {
    console.error("❌ Error enviando correo de precio inválido:", error?.message || error);
  }
}

