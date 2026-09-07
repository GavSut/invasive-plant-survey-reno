// Safe-to-publish browser configuration. Never place a service-role key or class code here.
export const CONFIG = Object.freeze({
  appName: "Invasive Plant Transect",
  appVersion: "1.0.0",
  supabaseUrl: "https://YOUR_PROJECT.supabase.co",
  supabasePublishableKey: "YOUR_PUBLISHABLE_OR_ANON_KEY",
  enrollmentFunction: "enroll-class",
  photoBucket: "transect-photos",
  maxPhotoDimensionPx: 1600,
  jpegQuality: 0.82,
});

export function backendIsConfigured() {
  return /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(CONFIG.supabaseUrl)
    && !CONFIG.supabaseUrl.includes("YOUR_PROJECT")
    && CONFIG.supabasePublishableKey.length > 30
    && !CONFIG.supabasePublishableKey.includes("YOUR_");
}
