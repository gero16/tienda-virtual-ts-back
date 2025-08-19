import mongoose, { Schema, Document } from "mongoose";

export interface IProducto extends Document {
  ml_id: string;
  amazon_sku?: string;
  buybox_ref?: string;
  title: string;
  price: number;
  available_quantity: number;
  status: string;
  main_image?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const ProductoSchema = new Schema<IProducto>(
  {
    ml_id: { type: String, required: true, unique: true },
    amazon_sku: { type: String },
    buybox_ref: { type: String },
    title: { type: String, required: true },
    price: { type: Number, required: true },
    available_quantity: { type: Number, required: true },
    status: { type: String, required: true },
    main_image: { type: String },
  },
  { timestamps: true }
);

export default mongoose.model<IProducto>("Producto", ProductoSchema);
