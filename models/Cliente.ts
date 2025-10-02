import { Schema, model, Document, Types } from "mongoose";

export interface ICliente extends Document {
  // Información básica
  nombre: string;
  apellido: string;
  email: string;
  telefono: string;
  
  // Información de contacto
  direccion: {
    calle: string;
    numero: string;
    apartamento?: string;
    codigo_postal: string;
    ciudad: string;
    departamento: string;
    pais: string;
  };
  
  // Información adicional
  fecha_nacimiento?: Date;
  genero?: 'masculino' | 'femenino' | 'otro' | 'prefiero_no_decir';
  
  // Datos de la cuenta
  fecha_registro: Date;
  ultima_actividad: Date;
  activo: boolean;
  
  // Preferencias
  preferencias: {
    notificaciones_email: boolean;
    notificaciones_sms: boolean;
    newsletter: boolean;
    idioma: string;
  };
  
  // Historial de compras
  total_compras: number;
  total_gastado: number;
  numero_ordenes: number;
  
  // Información de MercadoLibre (si aplica)
  ml_user_id?: string;
  
  // Notas internas
  notas_internas?: string;
  
  // Métodos de pago guardados (opcional)
  metodos_pago?: Array<{
    tipo: 'tarjeta' | 'transferencia' | 'efectivo';
    ultimos_digitos?: string;
    banco?: string;
    fecha_agregado: Date;
  }>;
}

const ClienteSchema = new Schema<ICliente>({
  // Información básica
  nombre: { type: String, required: true, trim: true },
  apellido: { type: String, required: true, trim: true },
  email: { 
    type: String, 
    required: true, 
    unique: true, 
    lowercase: true, 
    trim: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Email inválido']
  },
  telefono: { 
    type: String, 
    required: true, 
    trim: true,
    match: [/^[0-9+\-\s()]+$/, 'Formato de teléfono inválido']
  },
  
  // Información de contacto
  direccion: {
    calle: { type: String, required: true, trim: true },
    numero: { type: String, required: true, trim: true },
    apartamento: { type: String, trim: true },
    codigo_postal: { type: String, required: true, trim: true },
    ciudad: { type: String, required: true, trim: true },
    departamento: { type: String, required: true, trim: true },
    pais: { type: String, required: true, default: 'Uruguay', trim: true }
  },
  
  // Información adicional
  fecha_nacimiento: { type: Date },
  genero: { 
    type: String, 
    enum: ['masculino', 'femenino', 'otro', 'prefiero_no_decir'],
    default: 'prefiero_no_decir'
  },
  
  // Datos de la cuenta
  fecha_registro: { type: Date, default: Date.now },
  ultima_actividad: { type: Date, default: Date.now },
  activo: { type: Boolean, default: true },
  
  // Preferencias
  preferencias: {
    notificaciones_email: { type: Boolean, default: true },
    notificaciones_sms: { type: Boolean, default: false },
    newsletter: { type: Boolean, default: true },
    idioma: { type: String, default: 'es', enum: ['es', 'en', 'pt'] }
  },
  
  // Historial de compras
  total_compras: { type: Number, default: 0 },
  total_gastado: { type: Number, default: 0 },
  numero_ordenes: { type: Number, default: 0 },
  
  // Información de MercadoLibre
  ml_user_id: { type: String, unique: true, sparse: true },
  
  // Notas internas
  notas_internas: { type: String, trim: true },
  
  // Métodos de pago guardados
  metodos_pago: [{
    tipo: { 
      type: String, 
      enum: ['tarjeta', 'transferencia', 'efectivo'],
      required: true 
    },
    ultimos_digitos: { type: String, trim: true },
    banco: { type: String, trim: true },
    fecha_agregado: { type: Date, default: Date.now }
  }]
}, {
  timestamps: true, // Agrega createdAt y updatedAt automáticamente
  versionKey: false
});

// Índices para mejorar el rendimiento
ClienteSchema.index({ email: 1 });
ClienteSchema.index({ telefono: 1 });
ClienteSchema.index({ 'direccion.ciudad': 1 });
ClienteSchema.index({ fecha_registro: -1 });
ClienteSchema.index({ activo: 1 });

// Middleware para actualizar ultima_actividad
ClienteSchema.pre('save', function(next) {
  this.ultima_actividad = new Date();
  next();
});

// Método para obtener el nombre completo
ClienteSchema.methods.getNombreCompleto = function() {
  return `${this.nombre} ${this.apellido}`;
};

// Método para actualizar estadísticas de compra
ClienteSchema.methods.actualizarEstadisticas = function(monto: number) {
  this.total_compras += 1;
  this.total_gastado += monto;
  this.numero_ordenes += 1;
  this.ultima_actividad = new Date();
  return this.save();
};

// Método estático para buscar por email o teléfono
ClienteSchema.statics.buscarCliente = function(email: string, telefono?: string) {
  const query: any = { email: email.toLowerCase() };
  if (telefono) {
    query.$or = [{ email: email.toLowerCase() }, { telefono }];
  }
  return this.findOne(query);
};

export default model<ICliente>("Cliente", ClienteSchema);
