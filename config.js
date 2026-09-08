// Safe-to-publish browser configuration. Never place a service-role key or class code here.
export const CONFIG = Object.freeze({
  appName: "Invasive Plant Transect",
  appVersion: "1.0.1",
  supabaseUrl: "https://apjjzoaayttcovofwzmc.supabase.co",
  supabasePublishableKey: "sb_publishable_mG7k6-R34CXt-g4v-DSHZA_td72pzy6",
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
