import mongoose from 'mongoose';

// One document per session, kept up to date on every ingest with $inc/$min/$max.
// This makes the sessions list a cheap indexed read instead of an aggregation
// over the whole events collection.
const sessionSchema = new mongoose.Schema(
  {
    _id: { type: String }, // the client-generated session id
    firstSeen: { type: Date, required: true },
    lastSeen: { type: Date, required: true },
    eventCount: { type: Number, default: 0 },
    pageViews: { type: Number, default: 0 },
    clicks: { type: Number, default: 0 },
    entryPage: { type: String },
    userAgent: { type: String },
  },
  { versionKey: false }
);

sessionSchema.index({ lastSeen: -1 });

export const Session = mongoose.model('Session', sessionSchema);
