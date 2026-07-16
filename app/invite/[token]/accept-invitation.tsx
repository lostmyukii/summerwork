"use client";

import { useState } from "react";
import Link from "next/link";
import { getSupabaseBrowserClient } from "../../lib/supabase/client";

export function AcceptInvitation({ configured, token }: { configured: boolean; token: string }) {
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  async function accept() {
    if (!configured) return setMessage("Supabase 尚未配置，暂时不能接受邀请。");
    setStatus("loading");
    const { error } = await getSupabaseBrowserClient().rpc("accept_invitation", { raw_token: token });
    if (error) {
      setStatus("error");
      setMessage("邀请无效、已使用、已过期，或登录邮箱与邀请邮箱不一致。");
      return;
    }
    setStatus("done");
    setMessage("邀请已接受，权限已经生效。");
    window.setTimeout(() => window.location.assign("/"), 900);
  }

  return (
    <main className="invite-page"><section className="invite-card"><span className="brand-mark">闭</span><p className="eyebrow">私有家庭空间邀请</p><h1>{status === "done" ? "权限已启用" : "加入学业闭环"}</h1><p>系统会校验当前登录邮箱、一次性令牌和有效期；家教只获得邀请中指定的科目。</p>{message ? <div className={status === "done" ? "invite-message success" : "invite-message"}>{message}</div> : null}<button className="primary-button full" type="button" disabled={status === "loading" || status === "done"} onClick={() => void accept()}>{status === "loading" ? "正在校验…" : status === "done" ? "即将进入系统" : "确认接受邀请"}</button><Link href="/login">切换登录账号</Link></section></main>
  );
}
