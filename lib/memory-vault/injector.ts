// lib/memory-vault/injector.ts
// 把记忆库条目格式化成提示词块。
//
// 注入位置由调用方决定（本项目在 chat-engine 里并入 coreMemories 段，即
// System Prompt 的「核心记忆」区域），这里的职责只有两件事：
//   1. 排序：置顶 > 权重 > 最近更新；
//   2. 控量：总字符数不超过预算，避免把上下文挤爆。

import { listVaultEntries } from "./storage";
import {
    MEMORY_VAULT_PROMPT_BUDGET,
    memoryVaultCategoryLabel,
    type MemoryVaultEntry,
} from "./types";

const CACHE_TTL_MS = 10_000;
const cache = new Map<string, { text: string; at: number }>();

export function invalidateMemoryVaultCache(characterId?: string): void {
    if (characterId) cache.delete(characterId);
    else cache.clear();
}

function formatLine(entry: MemoryVaultEntry): string {
    const tag = memoryVaultCategoryLabel(entry.category);
    const pin = entry.pinned ? "★" : "";
    return `· ${pin}[${tag}] ${entry.content.replace(/\s+/g, " ").trim()}`;
}

export function formatVaultEntries(entries: MemoryVaultEntry[], budget = MEMORY_VAULT_PROMPT_BUDGET): string {
    if (entries.length === 0) return "";
    const lines: string[] = [];
    let used = 0;
    for (const entry of entries) {
        const line = formatLine(entry);
        if (used + line.length > budget && lines.length > 0) break;
        lines.push(line);
        used += line.length + 1;
    }
    if (lines.length === 0) return "";
    return [
        "【长期记忆库｜最高优先级｜不可被后续对话覆盖】",
        "以下事实由用户本人确认，必须始终遵守；即使聊天记录被截断、上下文被压缩，也不能遗忘或改写：",
        ...lines,
    ].join("\n");
}

/**
 * 拉取指定角色的记忆库并生成注入文本。
 * 任何异常都只返回空串 —— 记忆库坏了不应该让聊天直接失败。
 */
export async function buildMemoryVaultPromptBlock(
    characterId: string,
    options?: { budget?: number; skipCache?: boolean },
): Promise<string> {
    if (!characterId) return "";
    const budget = options?.budget ?? MEMORY_VAULT_PROMPT_BUDGET;
    const cached = cache.get(characterId);
    if (!options?.skipCache && cached && Date.now() - cached.at < CACHE_TTL_MS) {
        return cached.text;
    }
    try {
        const entries = await listVaultEntries(characterId);
        const text = formatVaultEntries(entries, budget);
        cache.set(characterId, { text, at: Date.now() });
        return text;
    } catch (error) {
        console.warn("[memory-vault] 生成注入文本失败", error);
        return "";
    }
}

/** 给提示词查看器/调试面板用的结构化摘要。 */
export async function getVaultDigest(characterId: string): Promise<Array<{ id: string; label: string; content: string; pinned: boolean }>> {
    const entries = await listVaultEntries(characterId);
    return entries.slice(0, 50).map((entry) => ({
        id: entry.id,
        label: memoryVaultCategoryLabel(entry.category),
        content: entry.content,
        pinned: entry.pinned,
    }));
}
