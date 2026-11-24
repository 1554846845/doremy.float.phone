// lib/interactive-llm.ts
// 四个互动应用（忏悔室/问答箱/交换日记/惩罚券）共用的轻量 LLM 帮助函数。
// 复用主聊天绑定与流式机制；任何异常都向上抛，由调用方决定如何提示。

import type { Character } from "./character-types";
import type { ApiConfig, PresetConfig } from "./settings-types";
import type { LLMMessage } from "./llm-prompt-assembler";
import { sendLLMStreamRequest, sendLLMRequest } from "./chat-engine";
import { loadApiConfigs, loadPresets, loadBindingConfig, resolveBinding } from "./settings-storage";
import { loadCharacters } from "./character-storage";

export type ChatLlm = {
    config: ApiConfig;
    preset: PresetConfig | null;
    character?: Character;
};

/** 解析互动应用要用的 API / 预设 / 角色（复用主聊天绑定）。 */
export function resolveChatLlm(characterId: string): ChatLlm {
    const bindings = loadBindingConfig();
    const activeSlot = resolveBinding(bindings, characterId || undefined, "chat");
    const apiConfigs = loadApiConfigs();
    const config = apiConfigs.find((c) => c.id === activeSlot.apiConfigId) ?? apiConfigs[0];
    if (!config) throw new Error("请先在 设置 → 聊天 里配置并绑定一个 API");
    const presets = loadPresets();
    let preset = activeSlot.presetId ? presets.find((p) => p.id === activeSlot.presetId) ?? null : null;
    if (!preset) preset = presets.find((p) => p.builtIn) ?? null;
    const chars = loadCharacters();
    const character = characterId ? chars.find((c) => c.id === characterId) : undefined;
    return { config, preset, character };
}

export type StreamOptions = {
    onDelta?: (text: string) => void;
    signal?: AbortSignal;
    appId?: string;
};

/** 流式生成：system + user → 逐字输出。 */
export async function streamChat(
    characterId: string,
    system: string,
    user: string,
    opts: StreamOptions = {},
): Promise<string> {
    const llm = resolveChatLlm(characterId);
    const messages: LLMMessage[] = [
        { role: "system", content: system },
        { role: "user", content: user },
    ];
    const result = await sendLLMStreamRequest(
        llm.config,
        llm.preset,
        messages,
        [],
        { characterName: llm.character?.name },
        { skipOutputRegex: true, skipTimestampStrip: true, appId: opts.appId ?? "interactive", signal: opts.signal },
        { onDelta: opts.onDelta },
    );
    return result.content.trim();
}

/** 一次性生成（非流式）。 */
export async function chatOnce(
    characterId: string,
    system: string,
    user: string,
    appId = "interactive",
): Promise<string> {
    const llm = resolveChatLlm(characterId);
    const messages: LLMMessage[] = [
        { role: "system", content: system },
        { role: "user", content: user },
    ];
    return sendLLMRequest(
        llm.config,
        llm.preset,
        messages,
        [],
        { characterName: llm.character?.name },
        { skipOutputRegex: true, appId },
    );
}
