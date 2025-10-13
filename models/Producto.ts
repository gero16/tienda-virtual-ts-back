import { Schema, model, Document, Types } from "mongoose";
import { IVariante } from "./Variante";

export interface IProducto extends Document {
  ml_id: string;
  title: string;
  price: number;
  available_quantity: number;
  status: string;
  permalink?: string; // URL de la publicación en MercadoLibre
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
  shipping: {
    logistic_type?: string; // 'fulfillment' (Flex), 'self_service', 'cross_docking', etc.
    mode?: string;
    free_shipping?: boolean;
    tags?: string[];
    [key: string]: any;
  };
  health: number;
  metrics: {
    visits: number;
    reviews: {
      rating_average: number;
      total: number;
    };
  };
  variantes: Types.ObjectId[] | IVariante[];
  // Campos existentes
  tipo: 'producto_base' | 'variante_individual';
  es_producto_base: boolean;
  
  // 🆕 NUEVOS CAMPOS PARA DROPSHIPPING
  tipo_venta: 'stock_fisico' | 'dropshipping' | 'mixto';
  
  // Para productos con stock físico
  stock_fisico?: {
    cantidad_disponible: number;
    ubicacion: string;
    reorder_point: number;
    ultima_actualizacion_stock: Date;
  };
  
  // Para productos de dropshipping
  dropshipping?: {
    dias_preparacion: number;
    dias_envio_estimado: number;
    proveedor: string;
    pais_origen: string;
    requiere_confirmacion: boolean;
    costo_importacion?: number;
    tiempo_configurado_en_ml?: boolean;
  };
  
  // Campos de nivel raíz para dropshipping (compatibilidad y acceso rápido)
  dias_preparacion?: number;
  dias_envio_estimado?: number;
  proveedor?: string;
  pais_origen?: string;
  
  // Tiempos de entrega (calculados automáticamente)
  tiempo_entrega_total?: number; // días totales
  tiempo_entrega_texto?: string; // "18 días + envío"
  
  // Metadatos adicionales
  es_importacion?: boolean;
  requiere_stock_especial?: boolean;
  
  // 🆕 CAMPOS PARA DESCUENTOS
  descuento?: {
    activo: boolean;
    porcentaje: number; // Porcentaje de descuento (ej: 10 para 10%)
    precio_original?: number; // Precio antes del descuento
    fecha_inicio?: Date;
    fecha_fin?: Date;
  };
}

const ProductoSchema = new Schema<IProducto>({
  ml_id: { type: String, required: true, unique: true },
  title: { type: String, required: true },
  price: { type: Number, required: true },
  available_quantity: { type: Number, required: true },
  status: { type: String, required: true },
  permalink: { type: String, default: "" }, // URL de la publicación en MercadoLibre
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
  // Campos existentes
  tipo: { 
    type: String, 
    enum: ['producto_base', 'variante_individual'], 
    default: 'producto_base' 
  },
  es_producto_base: { type: Boolean, default: true },
  
  // 🆕 NUEVOS CAMPOS PARA DROPSHIPPING
  tipo_venta: { 
    type: String, 
    enum: ['stock_fisico', 'dropshipping', 'mixto'], 
    default: 'stock_fisico' 
  },
  
  // Para productos con stock físico
  stock_fisico: {
    cantidad_disponible: { type: Number, default: 0 },
    ubicacion: { type: String, default: "" },
    reorder_point: { type: Number, default: 5 },
    ultima_actualizacion_stock: { type: Date, default: Date.now }
  },
  
  // Para productos de dropshipping
  dropshipping: {
    dias_preparacion: { type: Number, default: 0 },
    dias_envio_estimado: { type: Number, default: 7 },
    proveedor: { type: String, default: "" },
    pais_origen: { type: String, default: "Estados Unidos" },
    requiere_confirmacion: { type: Boolean, default: true },
    costo_importacion: { type: Number, default: 0 },
    tiempo_configurado_en_ml: { type: Boolean, default: false }
  },
  
  // Campos de nivel raíz para dropshipping (compatibilidad y acceso rápido)
  dias_preparacion: { type: Number },
  dias_envio_estimado: { type: Number },
  proveedor: { type: String },
  pais_origen: { type: String },
  
  // Tiempos de entrega (calculados automáticamente)
  tiempo_entrega_total: { type: Number },
  tiempo_entrega_texto: { type: String },
  
  // Metadatos adicionales
  es_importacion: { type: Boolean, default: false },
  requiere_stock_especial: { type: Boolean, default: false },
  
  // 🆕 CAMPOS PARA DESCUENTOS
  descuento: {
    activo: { type: Boolean, default: false },
    porcentaje: { type: Number, default: 0 },
    precio_original: { type: Number },
    fecha_inicio: { type: Date },
    fecha_fin: { type: Date }
  }
});

export default model<IProducto>("Producto", ProductoSchema);
