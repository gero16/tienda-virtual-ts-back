import { Schema, model, Document } from "mongoose";

export interface IEvento extends Document {
  slug: string;
  titulo: string;
  descripcion?: string;
  activo: boolean;
  theme?: string; // p.ej. 'halloween', 'blackfriday', etc.
  subtitle?: string; // subtítulo para banner
  discount_text?: string; // texto de descuento (ej: "Hasta 50% OFF")
  discount_percentage?: number; // porcentaje para aplicar a productos del evento
  fecha_inicio?: Date;
  fecha_fin?: Date;
  productos_ml_ids: string[]; // Asociamos por ml_id para rapidez
  createdAt: Date;
  updatedAt: Date;
}

const EventoSchema = new Schema<IEvento>({
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
  titulo: { type: String, required: true },
  descripcion: { type: String, default: "" },
  activo: { type: Boolean, default: true },
  theme: { type: String, default: "" },
  subtitle: { type: String, default: "" },
  discount_text: { type: String, default: "" },
  discount_percentage: { type: Number, default: 0 },
  fecha_inicio: { type: Date },
  fecha_fin: { type: Date },
  productos_ml_ids: { type: [String], default: [] },
}, { timestamps: true });

export default model<IEvento>("Evento", EventoSchema);


