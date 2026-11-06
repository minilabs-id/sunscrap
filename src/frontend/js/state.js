/** sunscrap v2 — state global renderer (singleton). */
import { createState } from './helpers.js';

export const state = createState();
state.needsReview = 0;
state.intel = null; // cache intel akun: { items, levels, clusters, flagged, needsReview, at }
