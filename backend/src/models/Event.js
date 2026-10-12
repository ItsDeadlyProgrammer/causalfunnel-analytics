import mongoose from 'mongoose';

export const EVENT_TYPES = ['page_view', 'click'];

const eventSchema = new mongoose.Schema(
  {
    sessionId: { type: String, required: true },
    type: { type: String, required: true, enum: EVENT_TYPES },
    // Full URL as the browser reported it (query string included).
    url: { type: String, required: true },
    // Normalised URL (origin + pathname) used to group pages for the heatmap.
    pageUrl: { type: String, required: true },
    timestamp: { type: Date, required: true },

    // Click-only fields. x/y are document coordinates (pageX/pageY), so they
    // stay correct when the user has scrolled.
    x: { type: Number },
    y: { type: Number },
    // Click target summary, e.g. "button#signup.cta", for the journey view.
    target: { type: String },

    // Context needed to render clicks from different screen sizes on one map.
    viewportWidth: { type: Number },
    viewportHeight: { type: Number },
    pageWidth: { type: Number },
    pageHeight: { type: Number },

    title: { type: String },
    referrer: { type: String },
    userAgent: { type: String },
    receivedAt: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

// Session journey: all events of one session in time order.
eventSchema.index({ sessionId: 1, timestamp: 1 });
// Heatmap: all clicks on one page.
eventSchema.index({ pageUrl: 1, type: 1 });

export const Event = mongoose.model('Event', eventSchema);
