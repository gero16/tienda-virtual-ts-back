import mongoose, { Schema, Document } from "mongoose";

export interface IToken extends Document {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user_id: string;
  scope?: string;
  last_updated: Date;
}

const TokenSchema = new Schema<IToken>(
  {
    access_token: { type: String, required: true },
    refresh_token: { type: String, required: true },
    expires_in: { type: Number, required: true },
    user_id: { type: String, required: true },
    scope: { type: String },
    last_updated: { type: Date, default: Date.now },
  },
  { timestamps: { createdAt: false, updatedAt: "last_updated" } }
);

export default mongoose.model<IToken>("Token", TokenSchema);
