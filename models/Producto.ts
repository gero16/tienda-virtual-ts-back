import { Schema, model, Document, Types } from "mongoose";
import { IVariante } from "./Variante";

export interface IProducto extends Document {
  ml_id: string;
  title: string;
  price: number;
  available_quantity: number;
  status: string;
  main_image?: string | null;
  variantes: Types.ObjectId[] | IVariante[];
}

const ProductoSchema = new Schema<IProducto>({
  ml_id: { type: String, required: true, unique: true },
  title: { type: String, required: true },
  price: { type: Number, required: true },
  available_quantity: { type: Number, required: true },
  status: { type: String, required: true },
  main_image: { type: String, default: null },
  variantes: [{ type: Schema.Types.ObjectId, ref: "Variante" }],
});

export default model<IProducto>("Producto", ProductoSchema);
