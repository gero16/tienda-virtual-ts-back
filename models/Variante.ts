import { Schema, model, Document, Types } from "mongoose";

export interface IVariante extends Document {
  id: string;
  product_id: Types.ObjectId;
  color?: string | null;
  size?: string | null;
  stock: number;
  price: number;
  images: Array<{
    id: string;
    url: string;
    high_quality: string;
  }>;
  attribute_combinations: Array<{
    id: string;
    name: string;
    value_id: string;
    value_name: string;
  }>;
}

const VarianteSchema = new Schema<IVariante>({
  id: { type: String, required: true, unique: true },
  product_id: { type: Schema.Types.ObjectId, ref: "Producto", required: true },
  color: { type: String, default: null },
  size: { type: String, default: null },
  stock: { type: Number, required: true },
  price: { type: Number, required: true },
  images: [{
    id: String,
    url: String,
    high_quality: String
  }],
  attribute_combinations: [{
    id: String,
    name: String,
    value_id: String,
    value_name: String
  }]
});

export default model<IVariante>("Variante", VarianteSchema);