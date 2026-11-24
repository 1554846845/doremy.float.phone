// lib/lover-memory-profile.ts
// 恋人「喜好与雷区」档案：永久置顶、以最高优先级注入上下文。
// 与聊天记录/长期记忆/人设完全分离，切换任何模型/接口都不会丢失。

import type { LoverProfile } from "./lover-memory-types";
import { DEFAULT_LOVER_PROFILE } from "./lover-memory-types";
import { kvGet, kvSet, registerKvMigration } from "./kv-db";
import { estimateTokens } from "./token-counter";

const PROFILE_KEY = "ai_phone_lover_profile_v1";
registerKvMigration(PROFILE_KEY);

/** 加载档案（按角色隔离；空角色 id 为全局档案）。 */
export function loadLoverProfile(characterId = ""): LoverProfile {
    if (typeof window === "undefined") return { ...DEFAULT_LOVER_PROFILE, characterId };
    try {
        const raw = kvGet(PROFILE_KEY);
        if (!raw) return { ...DEFAULT_LOVER_PROFILE, characterId };
        const all = JSON.parse(raw) as Partial<LoverProfile> | LoverProfile[];
        // 兼容「单档案对象」与「按角色分组的数组」两种存法。
        if (Array.isArray(all)) {
            const hit = all.find((p) => p?.characterId === characterId) ?? all.find((p) => p?.characterId === "");
            return { ...DEFAULT_LOVER_PROFILE, ...(hit ?? {}), characterId };
        }
        return { ...DEFAULT_LOVER_PROFILE, ...all, characterId };
    } catch {
        return { ...DEFAULT_LOVER_PROFILE, characterId };
    }
}

/** 保存档案。 */
export function saveLoverProfile(profile: LoverProfile): void {
    if (typeof window === "undefined") return;
    kvSet(PROFILE_KEY, JSON.stringify(profile));
}

/** 判断档案是否有实质内容。 */
export function hasLoverProfileContent(profile: LoverProfile): boolean {
    return profile.likes.length > 0
        || profile.mines.length > 0
        || profile.nicknames.length > 0
        || profile.notes.length > 0
        || profile.raw.trim().length > 0;
}

/**
 * 把档案格式化成「最高优先级」上下文块，供聊天系统提示词最前面注入。
 * 任何异常都吞掉返回 ""，绝不影响聊天主流程。
 */
export function formatLoverProfileForPrompt(profile: LoverProfile, budgetTokens = 1200): string {
    if (!hasLoverProfileContent(profile)) return "";
    const lines: string[] = [];
    const push = (title: string, items: string[]) => {
        if (items.length === 0) return;
        const cleaned = items.map((s) => s.trim()).filter(Boolean).slice(0, 40);
        if (cleaned.length === 0) return;
        lines.push(`${title}：${cleaned.join("；")}`);
    };
    push("TA 喜欢", profile.likes);
    push("雷区（绝不能踩）", profile.mines);
    push("称呼偏好", profile.nicknames);
    push("重要约定", profile.notes);
    if (profile.raw.trim()) lines.push(profile.raw.trim());

    if (lines.length === 0) return "";

    // 严格按预算截断：从最后一条开始丢弃，优先保住「雷区」与「喜好」。
    const full = `### 恋人档案（最高优先级，永久生效）\n${lines.map((l) => `- ${l}`).join("\n")}`;
    let used = estimateTokens(full) + 4;
    if (used <= budgetTokens) return full;

    const kept: string[] = [];
    // 倒序保留（雷区/喜好靠前，越靠后越先被丢弃）。
    for (const line of [...lines].reverse()) {
        const candidate = `- ${line}`;
        const cost = estimateTokens(candidate) + 4;
        if (estimateTokens(`### 恋人档案（最高优先级，永久生效）\n${[...kept, candidate].reverse().join("\n")}`) > budgetTokens) break;
        kept.push(candidate);
    }
    if (kept.length === 0) return "";
    return `### 恋人档案（最高优先级，永久生效）\n${kept.reverse().join("\n")}`;
}

/**
 * 聊天时调用：加载档案并格式化最高优先级上下文。
 * 设计上放在 longTermMemories 的最前面，永远先于其它记忆注入。
 */
export function buildLoverProfileContext(characterId: string): string {
    try {
        const profile = loadLoverProfile(characterId);
        return formatLoverProfileForPrompt(profile);
    } catch {
        return "";
    }
}
