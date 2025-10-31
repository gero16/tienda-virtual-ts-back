import { Schema, model, Document } from "mongoose";
import bcrypt from "bcryptjs";

export type UsuarioRol = "admin" | "manager" | "editor" | "user";

export interface IUsuario extends Document {
  nombre: string;
  email: string;
  password: string;
  rol: UsuarioRol;
  activo: boolean;
  date_created: Date;
  date_updated: Date;
  compararPassword(plain: string): Promise<boolean>;
}

const UsuarioSchema = new Schema<IUsuario>(
  {
    nombre: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,})+$/, "Email inválido"],
    },
    password: { type: String, required: true, minlength: 6 },
    rol: { type: String, enum: ["admin", "manager", "editor", "user"], default: "user" },
    activo: { type: Boolean, default: true },
    date_created: { type: Date, default: Date.now },
    date_updated: { type: Date, default: Date.now },
  },
  { timestamps: { createdAt: "date_created", updatedAt: "date_updated" } }
);

UsuarioSchema.pre("save", async function (next) {
  const usuario = this as IUsuario;
  if (!usuario.isModified("password")) return next();
  const salt = await bcrypt.genSalt(10);
  usuario.password = await bcrypt.hash(usuario.password, salt);
  next();
});

UsuarioSchema.methods.compararPassword = async function (plain: string) {
  return bcrypt.compare(plain, (this as IUsuario).password);
};

export default model<IUsuario>("Usuario", UsuarioSchema);


