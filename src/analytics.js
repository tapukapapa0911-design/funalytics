/**
 * Vercel Web Analytics initialization
 * This module injects the Vercel Analytics script for tracking page views
 */
import { inject } from '../node_modules/@vercel/analytics/dist/index.mjs';

// Inject Vercel Analytics
inject({
  mode: 'auto', // Automatically detect environment (production/development)
  debug: false  // Set to true for debugging in development
});

console.log('[Funalytics] Vercel Analytics initialized');
