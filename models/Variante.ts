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
  
  // 🆕 NUEVOS CAMPOS PARA DROPSHIPPING DE VARIANTES
  tipo_venta: 'stock_fisico' | 'dropshipping' | 'mixto';
  
  // Para variantes con stock físico
  stock_fisico?: {
    cantidad_disponible: number;
    ubicacion: string;
    reorder_point: number;
    ultima_actualizacion_stock: Date;
  };
  
  // Para variantes de dropshipping
  dropshipping?: {
    dias_preparacion: number;
    dias_envio_estimado: number;
    proveedor: string;
    pais_origen: string;
    requiere_confirmacion: boolean;
    costo_importacion?: number;
    tiempo_configurado_en_ml?: boolean;
  };
  
  // Tiempos de entrega (calculados automáticamente)
  tiempo_entrega_total: number; // días totales
  tiempo_entrega_texto: string; // "18 días + envío"
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
  }],
  
  // 🆕 NUEVOS CAMPOS PARA DROPSHIPPING DE VARIANTES
  tipo_venta: { 
    type: String, 
    enum: ['stock_fisico', 'dropshipping', 'mixto'], 
    default: 'stock_fisico' 
  },
  
  // Para variantes con stock físico
  stock_fisico: {
    cantidad_disponible: { type: Number, default: 0 },
    ubicacion: { type: String, default: "" },
    reorder_point: { type: Number, default: 5 },
    ultima_actualizacion_stock: { type: Date, default: Date.now }
  },
  
  // Para variantes de dropshipping
  dropshipping: {
    dias_preparacion: { type: Number, default: 0 },
    dias_envio_estimado: { type: Number, default: 7 },
    proveedor: { type: String, default: "" },
    pais_origen: { type: String, default: "" },
    requiere_confirmacion: { type: Boolean, default: false },
    costo_importacion: { type: Number, default: 0 },
    tiempo_configurado_en_ml: { type: Boolean, default: false }
  },
  
  // Tiempos de entrega (calculados automáticamente)
  tiempo_entrega_total: { type: Number, default: 7 },
  tiempo_entrega_texto: { type: String, default: "7 días + envío" }
});

export default model<IVariante>("Variante", VarianteSchema);
