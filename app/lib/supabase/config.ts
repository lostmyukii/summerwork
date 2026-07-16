export function isSupabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";
  return /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)
    && anonKey.length >= 20
    && !/your-|example|placeholder|填写/i.test(`${url}${anonKey}`);
}

export function getSupabasePublicConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!isSupabaseConfigured() || !url || !anonKey) {
    throw new Error("Supabase 尚未配置。请先填写 NEXT_PUBLIC_SUPABASE_URL 和 NEXT_PUBLIC_SUPABASE_ANON_KEY。");
  }

  return { url, anonKey };
}
