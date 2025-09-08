import { Schema, model, Document, Types } from "mongoose";
import { IVariante } from "./Variante";

export interface IProducto extends Document {
  ml_id: string;
  title: string;
  price: number;
  available_quantity: number;
  status: string;
  images: Array<{
    id: string;
    url: string;
    max_size: string;
  }>;
  description: string;
  sold_quantity: number;
  warranty: string;
  attributes: Array<{
    id: string;
    name: string;
    value_id: string;
    value_name: string;
  }>;
  tags: string[];
  date_created: Date;
  last_updated: Date;
  category_id: string;
  condition: string;
  listing_type_id: string;
  shipping: any;
  health: number;
  metrics: {
    visits: number;
    reviews: {
      rating_average: number;
      total: number;
    };
  };
  variantes: Types.ObjectId[] | IVariante[];
  // 🆕 NUEVOS CAMPOS
  tipo: 'producto_base' | 'variante_individual';
  es_producto_base: boolean;
}

const ProductoSchema = new Schema<IProducto>({
  ml_id: { type: String, required: true, unique: true },
  title: { type: String, required: true },
  price: { type: Number, required: true },
  available_quantity: { type: Number, required: true },
  status: { type: String, required: true },
  images: [{
    id: String,
    url: String,
    max_size: String
  }],
  description: { type: String, default: "" },
  sold_quantity: { type: Number, default: 0 },
  warranty: { type: String, default: "" },
  attributes: [{
    id: String,
    name: String,
    value_id: String,
    value_name: String
  }],
  tags: [{ type: String }],
  date_created: { type: Date, default: Date.now },
  last_updated: { type: Date, default: Date.now },
  category_id: { type: String, default: "" },
  condition: { type: String, default: "" },
  listing_type_id: { type: String, default: "" },
  shipping: { type: Schema.Types.Mixed, default: {} },
  health: { type: Number, default: 0 },
  metrics: {
    visits: { type: Number, default: 0 },
    reviews: {
      rating_average: { type: Number, default: 0 },
      total: { type: Number, default: 0 }
    }
  },
  variantes: [{ type: Schema.Types.ObjectId, ref: "Variante" }],
  // 🆕 NUEVOS CAMPOS
  tipo: { 
    type: String, 
    enum: ['producto_base', 'variante_individual'], 
    default: 'producto_base' 
  },
  es_producto_base: { type: Boolean, default: true }
});

export default model<IProducto>("Producto", ProductoSchema);
