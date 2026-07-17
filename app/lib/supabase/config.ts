export function isSupabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";

  let endpoint: URL;
  try {
    endpoint = new URL(url);
  } catch {
    return false;
  }

  const isSecureEndpoint = endpoint.protocol === "https:";
  const isLocalEndpoint = endpoint.protocol === "http:"
    && ["localhost", "127.0.0.1", "::1", "kong"].includes(endpoint.hostname);

  return (isSecureEndpoint || isLocalEndpoint)
    && anonKey.length >= 20
    && !/your-|example|placeholder|填写|change[_-]?me/i.test(`${url}${anonKey}`);
}

export function getSupabasePublicConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!isSupabaseConfigured() || !url || !anonKey) {
    throw new Error("Supabase 尚未配置。请先填写 NEXT_PUBLIC_SUPABASE_URL 和 NEXT_PUBLIC_SUPABASE_ANON_KEY。");
  }

  return { url, anonKey };
}
