import { NextResponse } from "next/server";

import { isSelfHostedModeEnabled } from "@/lib/self-hosting";
import { getCurrentAccount } from "@/lib/server/account-auth";
import { broadcastShellNotify, getOrCreateVapidConfig } from "@/lib/server/push-service";
import { encodeSupabaseFilter, getSupabaseServerConfig, supabaseRestFetch } from "@/lib/server/supabase-rest";

/**
 * 离线推送全链路自检。
 *
 * 为什么需要这个：离线推送是一条很长的链（站点配置 → 账号 → 订阅 → 建任务 →
 * 服务端扫描 → 调模型 → 写回传箱 → 广播 → 壳长连接 → 系统通知），任何一段断了
 * 的现象都一样：收不到消息。过去链上没有观测点，只能猜。
 *
 * 这里把链拆成若干可独立判定的段，逐段给出「通过 / 未通过 / 需注意」和下一步该
 * 做什么。默认还会真发一条广播到壳通道，把「服务端能不能推到这台设备」这件事
 * 直接变成可观测的结果。
 *
 * 只读查询 + 一条测试广播，不会改动任何业务数据。
 */

type StepStatus = "ok" | "warn" | "fail";

type Step = {
  key: string;
  label: string;
  status: StepStatus;
  detail: string;
  hint?: string;
};

const SHELL_PREFIX = "shell:";

/**
 * 给服务端密钥做一次"体检"，把「Invalid API key」拆成能照着改的一句话。
 *
 * 为什么需要：Supabase 对错误的钥匙只会回 `Invalid API key`，三种完全不同的
 * 错法（用了 anon 公钥、从别的项目复制、复制时被截断或带了空白）表现一模一样，
 * 用户对着两个长得几乎相同的长串根本没法自查。这里只报告长度、格式、角色和
 * 所属项目，不回显密钥本身。
 */
function describeServerKey(url: string, key: string): { ok: boolean; detail: string } {
  const notes: string[] = [];
  let ok = true;
  const trimmed = key.trim();
  notes.push(`长度 ${key.length} 位`);
  if (key !== trimmed) {
    ok = false;
    notes.push("⚠️ 首尾带空格或换行——Supabase 会直接判成 Invalid API key，删掉空白再存");
  }
  let projectRef = "";
  try { projectRef = new URL(url).hostname.split(".")[0] || ""; } catch { /* URL 已在上一步校验过 */ }
  const innerWhitespace = trimmed.search(/\s/);
  if (innerWhitespace >= 0) {
    ok = false;
    notes.push(`⚠️ 第 ${innerWhitespace + 1} 位夹了空白或换行（复制时被折行，密钥中间断开）`);
  }
  const illegal = trimmed.replace(/[A-Za-z0-9_.-]/g, "");
  if (illegal.length > 0) {
    ok = false;
    notes.push(`⚠️ 含 ${illegal.length} 个不属于密钥的字符（引号、中文标点之类）`);
  }
  const parts = trimmed.split(".");
  notes.push(`按「.」切成 ${parts.length} 段（正常 JWT 是 3 段）`);
  if (trimmed.startsWith("eyJ")) {
    try {
      const payload = JSON.parse(
        Buffer.from(parts[1] ?? "", "base64url").toString("utf8"),
      ) as { role?: string; ref?: string };
      notes.push(`格式 JWT，role=${payload.role ?? "?"}，所属项目=${payload.ref ?? "?"}`);
      if (payload.role !== "service_role") {
        ok = false;
        notes.push("⚠️ 这不是 service_role 密钥（权限不够，任何表都读不到）");
      }
      if (payload.ref && projectRef && payload.ref !== projectRef) {
        ok = false;
        notes.push(`⚠️ 这把钥匙属于另一个项目 ${payload.ref}，不是 ${projectRef}`);
      }
    } catch {
      ok = false;
      notes.push("⚠️ JWT 第二段解不出 JSON，密钥多半被复制残缺了");
    }
  } else if (trimmed.startsWith("sb_secret_")) {
    notes.push("格式：新版 secret key");
  } else if (trimmed.startsWith("sb_publishable_")) {
    ok = false;
    notes.push("⚠️ 这是 publishable 公钥，不是 secret key");
  } else {
    ok = false;
    notes.push("⚠️ 既不是 eyJ… 也不是 sb_secret_…，多半不是这个项目的密钥");
  }
  return { ok, detail: notes.join("；") };
}

/**
 * 直接拿站点这把密钥去问 Supabase 一次，把「密钥不对」和「表没建」彻底分开。
 *
 * 这一步取代了所有猜测：401 就是密钥本身不被接受；404/schema cache 说明密钥是好的、
 * 只是建表脚本没跑成功；200 则两者都对。只读一条 `id`，不改任何数据。
 */
async function probeServerKey(url: string, key: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const response = await fetch(`${url}/rest/v1/push_server_config?select=id&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: "no-store",
    });
    const body = (await response.text().catch(() => "")).slice(0, 200);
    if (response.ok) {
      return { ok: true, detail: `直连测试通过（HTTP ${response.status}）：密钥有效，push_server_config 表存在。` };
    }
    if (response.status === 401 || /Invalid API key/i.test(body)) {
      return { ok: false, detail: `Supabase 直接回了 HTTP ${response.status}「Invalid API key」——它不接受这把密钥本身，与表无关。` };
    }
    if (/PGRST205|does not exist|schema cache/i.test(body)) {
      return { ok: false, detail: `密钥有效，但 push_server_config 表不存在（HTTP ${response.status}）——建表 SQL 没跑成功。` };
    }
    return { ok: false, detail: `HTTP ${response.status}：${body}` };
  } catch (error) {
    return { ok: false, detail: `直连 Supabase 失败：${error instanceof Error ? error.message : String(error)}` };
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  // 探测广播会真的弹一条通知，允许用 ?probe=0 关掉。
  const probe = url.searchParams.get("probe") !== "0";
  const steps: Step[] = [];

  // ── ① 站点配置 ──
  const supabase = getSupabaseServerConfig();
  if (!supabase) {
    steps.push({
      key: "site",
      label: "站点 Supabase 配置",
      status: "fail",
      detail: "缺少 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY：网站服务器自己没有数据库钥匙。",
      hint: "到部署平台（Vercel：Settings → Environment Variables）添加这两项，指向离线推送部署的那个 Supabase 项目，然后必须重新部署一次（旧构建不会带上新变量）。",
    });
    return NextResponse.json({ ok: false, steps, summary: "站点未配置 Supabase，后续步骤无法进行。" });
  }
  steps.push({ key: "site", label: "站点 Supabase 配置", status: "ok", detail: `已配置：${supabase.url}` });

  const keyCheck = describeServerKey(supabase.url, supabase.key);
  steps.push({
    key: "key",
    label: "服务端密钥体检",
    status: keyCheck.ok ? "ok" : "fail",
    detail: keyCheck.detail,
    hint: keyCheck.ok
      ? undefined
      : "到 Supabase → Project Settings → API Keys，点 service_role（secret）右侧的 Copy 按钮整串复制（不要手动框选），整串替换 Vercel 里 SUPABASE_SERVICE_ROLE_KEY 的值，然后 Redeploy。",
  });

  const keyProbe = await probeServerKey(supabase.url, supabase.key);
  steps.push({
    key: "probe",
    label: "直连 Supabase 测试",
    status: keyProbe.ok ? "ok" : "fail",
    detail: keyProbe.detail,
    hint: keyProbe.ok ? undefined : "这一项最权威：它直接用站点里的密钥访问了一次你的项目，返回什么就是 Supabase 的真实态度。",
  });

  // 单机模式现在由 lib/self-hosting.ts 固定开启，不再依赖构建期环境变量；
  // 这里如实报告它的实际取值，而不是去读一个可能根本没设的变量。
  const selfHosted = isSelfHostedModeEnabled();
  steps.push({
    key: "mode",
    label: "单机模式开关",
    status: selfHosted ? "ok" : "fail",
    detail: selfHosted
      ? "单机模式内置开启，/api/push/jobs 与 /api/push/outbox 已开放。"
      : "/api/push/jobs 与 /api/push/outbox 会直接返回 503，任务永远建不起来。",
  });

  // ── ② 账号身份 ──
  const account = await getCurrentAccount(request).catch(() => null);
  if (!account) {
    steps.push({
      key: "account",
      label: "账号身份",
      status: "fail",
      detail: "未取得当前账号。",
      hint: "确认已登录。壳的订阅与任务是挂在站点账号 id 下的，身份拿不到后面全断。",
    });
    return NextResponse.json({ ok: false, steps, summary: "没有账号身份，无法继续。" });
  }
  steps.push({ key: "account", label: "账号身份", status: "ok", detail: account.id });

  // ── ③ 推送订阅 ──
  const subs = await supabaseRestFetch<{ endpoint: string }[]>(
    `push_subscriptions?user_id=eq.${encodeSupabaseFilter(account.id)}&select=endpoint&limit=50`,
  );
  if (!subs.ok) {
    steps.push({ key: "subs", label: "推送订阅", status: "fail", detail: `查询失败：${subs.error}` });
  } else {
    // 壳订阅的 endpoint 是合成的 shell:<账号id>，服务端凭前缀分流，不走 Web Push。
    const shellCount = subs.data.filter(row => row.endpoint.startsWith(SHELL_PREFIX)).length;
    const webCount = subs.data.length - shellCount;
    if (subs.data.length === 0) {
      steps.push({
        key: "subs",
        label: "推送订阅",
        status: "fail",
        detail: "该账号名下没有任何订阅——这是「收不到任何消息」最常见的原因。",
        hint: "壳需要成功连过一次长连接才会注册。通知栏常驻通知显示「已连接，等待角色消息」即已注册；显示「未登录或站点不可达」则还没注册成功。",
      });
    } else {
      steps.push({
        key: "subs",
        label: "推送订阅",
        status: shellCount > 0 ? "ok" : "warn",
        detail: `共 ${subs.data.length} 条：壳通道 ${shellCount} 条，Web Push ${webCount} 条。`,
        hint: shellCount === 0 ? "没有 shell: 订阅，离线消息不会被广播到壳的长连接。" : undefined,
      });
    }
  }

  // ── ④ 离线任务表 ──
  const jobs = await supabaseRestFetch<{ trigger_key: string; kind: string; status: string; execute_at: string }[]>(
    `push_jobs?user_id=eq.${encodeSupabaseFilter(account.id)}&select=trigger_key,kind,status,execute_at&order=execute_at.desc&limit=20`,
  );
  if (!jobs.ok) {
    steps.push({ key: "jobs", label: "离线任务表 push_jobs", status: "fail", detail: `查询失败：${jobs.error}` });
  } else {
    const pending = jobs.data.filter(row => row.status === "pending");
    steps.push({
      key: "jobs",
      label: "离线任务表 push_jobs",
      status: jobs.data.length > 0 ? "ok" : "warn",
      detail: jobs.data.length === 0
        ? "一条记录都没有——说明预约根本没建起来，不是投递失败。"
        : `最近 ${jobs.data.length} 条，其中待执行 ${pending.length} 条：${jobs.data.slice(0, 5).map(row => row.kind).join("、")}`,
      hint: jobs.data.length === 0
        ? "依次查：主动消息规则建了吗？订阅门控过了吗？触发时刻是否落在安静时段？"
        : undefined,
    });
  }

  // ── ⑤ 回传箱积压 ──
  const outbox = await supabaseRestFetch<{ id: string }[]>(
    `push_outbox?user_id=eq.${encodeSupabaseFilter(account.id)}&consumed_at=is.null&select=id&limit=50`,
  );
  if (outbox.ok) {
    steps.push({
      key: "outbox",
      label: "回传箱 push_outbox",
      status: "ok",
      detail: outbox.data.length === 0
        ? "没有积压。"
        : `有 ${outbox.data.length} 条已生成但还没合并进聊天（打开 App 应会自动取回）。`,
    });
  }

  // ── ⑥ Web Push 密钥自举 ──
  try {
    const vapid = await getOrCreateVapidConfig();
    steps.push({
      key: "vapid",
      label: "Web Push 密钥",
      status: vapid.publicKey ? "ok" : "fail",
      detail: vapid.publicKey ? "push_server_config 就绪。" : "未取得 VAPID 公钥。",
    });
  } catch (err) {
    steps.push({
      key: "vapid",
      label: "Web Push 密钥",
      status: "fail",
      detail: `自举失败：${err instanceof Error ? err.message : String(err)}`,
      hint: "检查 push_server_config 表是否存在（docs/Push-Supabase 建表脚本）。",
    });
  }

  // ── ⑦ 真发一条广播：服务端 → 壳长连接 ──
  if (probe) {
    const sent = await broadcastShellNotify(account.id, {
      title: "链路自检",
      body: "自检广播：看到这条说明服务端→壳长连接是通的。",
      url: "/",
    });
    steps.push({
      key: "broadcast",
      label: "服务端 → 壳长连接广播",
      status: sent ? "ok" : "fail",
      detail: sent ? "已向 shellpush:<账号id> 频发送出一条广播。" : "广播请求失败。",
      hint: sent
        ? "若此刻没收到系统通知，问题在壳侧：长连接是否活着、系统通知权限是否给了。"
        : "检查 Supabase Realtime 是否可用（项目是否被暂停、Realtime 是否被关）。",
    });
  }

  const failed = steps.filter(step => step.status === "fail");
  return NextResponse.json({
    ok: failed.length === 0,
    steps,
    summary: failed.length === 0
      ? "各段均通过。若仍收不到消息，问题在客户端触发或系统通知权限。"
      : `有 ${failed.length} 段未通过：${failed.map(step => step.label).join("、")}。`,
  });
}
