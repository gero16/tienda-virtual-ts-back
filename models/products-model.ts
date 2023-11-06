import { Schema, model, Document } from 'mongoose';

const ProductosSchema = new Schema({
  id: {
    type: Number,
    required: true,
    unique: true,
  },
  name: {
    type: String,
    required: [true, 'El nombre es obligatorio'],
  },
  price: {
    type: Number,
    required: [true, 'El precio es obligatorio'],
  },
  image: String, // Ahora image es opcional
  category: {
    type: String,
    required: true,
  },
  stock: {
    type: Number,
    required: true,
  },
  cantidad: {
    type: Number,
    required: true,
  },
});

ProductosSchema.methods.toJSON = function () {
  // No es necesario hacer cambios aquí
  return this.toObject();
};

const ProductoModel = model('Producto', ProductosSchema);

export default ProductoModel;
