import { Schema, model, Document, Types } from "mongoose";

export interface IVariante extends Document {
  id: string;
  product_id: Types.ObjectId; // referencia a Producto
  color?: string | null;
  size?: string | null;
  stock: number;
  image?: string | null;
}

const VarianteSchema = new Schema<IVariante>({
  id: { type: String, required: true, unique: true }, // OK
  product_id: { type: Schema.Types.ObjectId, ref: "Producto", required: true },
  color: { type: String, default: null },
  size: { type: String, default: null },
  stock: { type: Number, required: true },
  image: { type: String, default: null },
});

export default model<IVariante>("Variante", VarianteSchema);
