import { afterEach, describe, expect, it, vi } from "vitest";
import { getSupabasePublicConfig, isSupabaseConfigured } from "../app/lib/supabase/config";

const publishableKey = "sb_publishable_12345678901234567890";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Supabase public configuration", () => {
  it("accepts the production self-hosted HTTPS endpoint", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://summerwork-api.ilelezhan.cn");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", publishableKey);

    expect(isSupabaseConfigured()).toBe(true);
    expect(getSupabasePublicConfig()).toEqual({
      url: "https://summerwork-api.ilelezhan.cn",
      anonKey: publishableKey,
    });
  });

  it("allows the Docker-internal HTTP endpoint used by verification jobs", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://kong:8000");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", publishableKey);

    expect(isSupabaseConfigured()).toBe(true);
  });

  it("rejects insecure remote endpoints and placeholder keys", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://summerwork-api.ilelezhan.cn");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", publishableKey);
    expect(isSupabaseConfigured()).toBe(false);

    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://summerwork-api.ilelezhan.cn");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "sb_publishable_CHANGE_ME");
    expect(isSupabaseConfigured()).toBe(false);
  });
});
