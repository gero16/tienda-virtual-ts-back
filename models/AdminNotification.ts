import mongoose, { Schema, Document } from "mongoose";

export interface IAdminNotification extends Document {
  type: "order" | "payment" | "system";
  status: "unread" | "read";
  message?: string;
  admin_id?: string; // 🆕 propietario (admin)
  admin_email?: string; // opcional, para mostrarse
  order_id?: string;
  payment_id?: string;
  customer_email?: string;
  total?: number;
  currency?: string;
  createdAt?: Date;
}

const AdminNotificationSchema = new Schema<IAdminNotification>({
  type: { type: String, enum: ["order", "payment", "system"], required: true },
  status: { type: String, enum: ["unread", "read"], default: "unread" },
  message: { type: String },
  admin_id: { type: String },
  admin_email: { type: String },
  order_id: { type: String },
  payment_id: { type: String },
  customer_email: { type: String },
  total: { type: Number },
  currency: { type: String, default: "UYU" },
}, { timestamps: { createdAt: true, updatedAt: false } });

export default mongoose.model<IAdminNotification>("AdminNotification", AdminNotificationSchema);


