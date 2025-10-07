import { Schema, model, Document } from "mongoose";

export interface ICupon extends Document {
  codigo: string; // Código del cupón (ej: "VERANO2026")
  descripcion: string; // Descripción del cupón
  tipo_descuento: 'porcentaje' | 'monto_fijo'; // Tipo de descuento
  valor_descuento: number; // Valor del descuento (% o monto fijo)
  activo: boolean; // Si el cupón está activo
  fecha_inicio: Date; // Fecha de inicio de validez
  fecha_fin?: Date; // Fecha de fin de validez (opcional)
  usos_maximos?: number; // Cantidad máxima de usos (opcional, null = ilimitado)
  usos_actuales: number; // Cantidad de veces que se usó
  monto_minimo_compra?: number; // Monto mínimo de compra para usar el cupón (opcional)
  usuarios_usados: string[]; // Array de emails de usuarios que ya usaron el cupón
  limite_por_usuario: number; // Cuántas veces puede usar el mismo usuario (default: 1)
  date_created: Date;
  date_updated: Date;
}

const CuponSchema = new Schema<ICupon>({
  codigo: { 
    type: String, 
    required: true, 
    unique: true,
    uppercase: true, // Siempre en mayúsculas
    trim: true
  },
  descripcion: { 
    type: String, 
    required: true 
  },
  tipo_descuento: { 
    type: String, 
    enum: ['porcentaje', 'monto_fijo'],
    required: true,
    default: 'porcentaje'
  },
  valor_descuento: { 
    type: Number, 
    required: true,
    min: 0
  },
  activo: { 
    type: Boolean, 
    default: true 
  },
  fecha_inicio: { 
    type: Date, 
    default: Date.now 
  },
  fecha_fin: { 
    type: Date 
  },
  usos_maximos: { 
    type: Number,
    min: 0
  },
  usos_actuales: { 
    type: Number, 
    default: 0 
  },
  monto_minimo_compra: { 
    type: Number,
    min: 0
  },
  usuarios_usados: [{ 
    type: String 
  }],
  limite_por_usuario: {
    type: Number,
    default: 1,
    min: 1
  },
  date_created: { 
    type: Date, 
    default: Date.now 
  },
  date_updated: { 
    type: Date, 
    default: Date.now 
  }
});

// Actualizar date_updated antes de guardar
CuponSchema.pre('save', function(next) {
  this.date_updated = new Date();
  next();
});

export default model<ICupon>("Cupon", CuponSchema);

