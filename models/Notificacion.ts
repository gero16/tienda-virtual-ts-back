import mongoose, { Schema, Document } from "mongoose";

export interface INotificacion extends Document {
  notification_id: string;
  topic: string;
  resource: string;
  user_id: string;
  processed: boolean;
  error?: string;
  createdAt?: Date;
}

const NotificacionSchema = new Schema<INotificacion>(
  {
    notification_id: { type: String, required: true, unique: true },
    topic: { type: String, required: true },
    resource: { type: String, required: true },
    user_id: { type: String, required: true },
    processed: { type: Boolean, default: false },
    error: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export default mongoose.model<INotificacion>("Notificacion", NotificacionSchema);
