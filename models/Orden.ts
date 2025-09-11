import { Schema, model, Document, Types } from "mongoose";

export interface IOrden extends Document {
  // Información de la orden
  orden_id: string;
  external_reference: string;
  numero_orden?: string; // 🆕 Campo que falta en la DB
  
  // Información del pago
  payment_id: string;
  payment_status: string;
  payment_status_detail: string;
  transaction_amount: number;
  payment_method_id: string;
  installments: number;
  
  // Información del cliente
  customer: {
    name: string;
    email: string;
    phone: string;
    address: string;
    city: string;
    state: string;
  };
  
  // Productos comprados
  items: Array<{
    product_id: string;
    product_name: string;
    variant_id?: string;
    color?: string;
    size?: string;
    quantity: number;
    unit_price: number;
    total_price: number;
  }>;
  
  // Totales
  subtotal: number;
  total: number;
  currency: string;
  
  // Fechas
  date_created: Date;
  date_approved?: Date;
  
  // Estado de la orden
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  
  // Información adicional
  notes?: string;
  shipping_address?: {
    street_name: string;
    street_number: string;
    zip_code: string;
    city: string;
    state: string;
  };
}

const OrdenSchema = new Schema<IOrden>({
  orden_id: { type: String, required: true, unique: true },
  external_reference: { type: String, required: true },
  numero_orden: { type: String, unique: true, sparse: true }, // 🆕 Campo único pero opcional
  
  // Información del pago
  payment_id: { type: String, required: true },
  payment_status: { type: String, required: true },
  payment_status_detail: { type: String, required: true },
  transaction_amount: { type: Number, required: true },
  payment_method_id: { type: String, required: true },
  installments: { type: Number, default: 1 },
  
  // Información del cliente
  customer: {
    name: { type: String, required: true },
    email: { type: String, required: true },
    phone: { type: String, required: true },
    address: { type: String, required: true },
    city: { type: String, required: true },
    state: { type: String, required: true }
  },
  
  // Productos comprados
  items: [{
    product_id: { type: String, required: true },
    product_name: { type: String, required: true },
    variant_id: { type: String },
    color: { type: String },
    size: { type: String },
    quantity: { type: Number, required: true },
    unit_price: { type: Number, required: true },
    total_price: { type: Number, required: true }
  }],
  
  // Totales
  subtotal: { type: Number, required: true },
  total: { type: Number, required: true },
  currency: { type: String, default: 'UYU' },
  
  // Fechas
  date_created: { type: Date, default: Date.now },
  date_approved: { type: Date },
  
  // Estado de la orden
  status: { 
    type: String, 
    enum: ['pending', 'approved', 'rejected', 'cancelled'], 
    default: 'pending' 
  },
  
  // Información adicional
  notes: { type: String },
  shipping_address: {
    street_name: { type: String },
    street_number: { type: String },
    zip_code: { type: String },
    city: { type: String },
    state: { type: String }
  }
});

export default model<IOrden>("Orden", OrdenSchema); 