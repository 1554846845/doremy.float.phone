// lib/theater-engine.ts
// 小剧场流式生成引擎：边生成边逐字输出。
// 复用主聊天的 sendLLMStreamRequest 流式机制，不重造 SSE 解析。

import type { Character } from "./character-types";
import type { ApiConfig, PresetConfig } from "./settings-types";
import type { LLMMessage } from "./llm-prompt-assembler";
import { sendLLMStreamRequest, sendLLMRequest } from "./chat-engine";
import {
    loadApiConfigs, loadPresets, loadBindingConfig, resolveBinding,
} from "./settings-storage";
import { loadCharacters } from "./character-storage";
import {
    loadChatSessions, loadChatMessages, resolveSessionCharacterId,
} from "./chat-storage";
import type { TheaterConfig, TheaterStory, TheaterStoryKind, TheaterStyleTemplate, TheaterTag } from "./theater-types";

export type TheaterLlm = {
    config: ApiConfig;
    preset: PresetConfig | null;
    character?: Character;
};

/** 解析小剧场要用的 API / 预设 / 角色（复用主聊天绑定，不混用独立记忆接口）。 */
export function resolveTheaterLlm(characterId: string): { llm: TheaterLlm; error?: string } {
    const bindings = loadBindingConfig();
    const activeSlot = resolveBinding(bindings, characterId || undefined, "chat");
    const apiConfigs = loadApiConfigs();
    const config = apiConfigs.find((c) => c.id === activeSlot.apiConfigId) ?? apiConfigs[0];
    if (!config) return { error: "请先在 设置 → 聊天 里配置并绑定一个 API", llm: { config: undefined as unknown as ApiConfig, preset: null } };
    const presets = loadPresets();
    let preset = activeSlot.presetId ? presets.find((p) => p.id === activeSlot.presetId) ?? null : null;
    if (!preset) preset = presets.find((p) => p.builtIn) ?? null;
    const chars = loadCharacters();
    const character = characterId ? chars.find((c) => c.id === characterId) : undefined;
    return { llm: { config, preset, character } };
}

function pickStyle(templates: TheaterStyleTemplate[], styleId?: string): TheaterStyleTemplate | undefined {
    if (!styleId) return undefined;
    return templates.find((t) => t.id === styleId);
}

function pickLabel(arr: Array<{ id: string; label: string }>, id?: string): string | undefined {
    if (!id) return undefined;
    return arr.find((x) => x.id === id)?.label;
}

function buildSystemPrompt(kind: TheaterStoryKind, config: TheaterConfig, opts: {
    tone?: string;
    person?: string;
    styleId?: string;
    tags?: string[];
}): string {
    const spec = kind === "pickup" ? config.pickupSpec : config.theaterSpec;
    const style = pickStyle(config.styleTemplates, opts.styleId);
    const toneLabel = pickLabel(config.tones, opts.tone);
    const personItem = config.persons.find((p) => p.id === opts.person);
    const tagLabels = (opts.tags ?? []).map((t) => pickLabel(config.tags, t)).filter(Boolean) as string[];

    const parts: string[] = [];
    if (kind === "pickup") {
        parts.push("你是「捡手机」写手。请以「手机截图 + 聊天记录」的口吻创作：");
        parts.push("输出格式要求：用【聊天记录】【朋友圈】【备忘录】【搜索记录】等分块标签，模拟手机界面上看到的碎片化内容。");
    } else {
        parts.push("你是恋爱小剧场写手。请创作一段精炼、有画面感、可读性强的短剧文本。");
    }
    if (toneLabel) parts.push(`基调：${toneLabel}。`);
    if (personItem) parts.push(`人称：${personItem.prompt}`);
    if (style) parts.push(`文风：${style.prompt}`);
    if (tagLabels.length > 0) parts.push(`标签语境：${tagLabels.join("、")}。`);
    if (spec.customPrompt.trim()) parts.push(`附加写作规范：${spec.customPrompt.trim()}`);
    if (spec.forbiddenWords.length > 0) parts.push(`硬性禁词（正文中绝不能出现这些词）：${spec.forbiddenWords.join("、")}。`);
    parts.push("直接输出正文，不要解释、不要标题序号、不要元信息。");
    return parts.join("\n");
}

/** 对成品做禁词兜底替换（流式过程中无法逐字红act，落库前统一处理）。 */
export function applyForbiddenWords(text: string, forbiddenWords: string[]): string {
    if (forbiddenWords.length === 0) return text;
    let out = text;
    for (const word of forbiddenWords) {
        const w = word.trim();
        if (!w) continue;
        out = out.split(w).join("□".repeat(Math.min(w.length, 4)));
    }
    return out;
}

export type GenerateTheaterOptions = {
    characterId: string;
    kind: TheaterStoryKind;
    idea: string;
    tone?: string;
    person?: string;
    styleId?: string;
    tags?: string[];
    onDelta?: (text: string) => void;
    signal?: AbortSignal;
};

/** 流式生成一段小剧场 / 捡手机正文。 */
export async function generateTheaterStoryStream(config: TheaterConfig, opts: GenerateTheaterOptions): Promise<string> {
    const { llm, error } = resolveTheaterLlm(opts.characterId);
    if (error) throw new Error(error);

    const system = buildSystemPrompt(opts.kind, config, {
        tone: opts.tone,
        person: opts.person,
        styleId: opts.styleId,
        tags: opts.tags,
    });
    const user = opts.idea.trim()
        ? `请围绕下面这个梗创作：\n${opts.idea.trim()}`
        : "请自由发挥，创作一段与恋人相关的内容。";

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
        { skipOutputRegex: true, skipTimestampStrip: true, appId: "theater", signal: opts.signal },
        { onDelta: opts.onDelta ? (text) => opts.onDelta?.(text) : undefined },
    );
    return applyForbiddenWords(result.content.trim(), config[opts.kind === "pickup" ? "pickupSpec" : "theaterSpec"].forbiddenWords);
}

/** 一键结合近期聊天记录生成灵感梗（流式，逐字填到输入框）。 */
export async function generateTheaterInspiration(
    characterId: string,
    onDelta?: (text: string) => void,
): Promise<string> {
    const { llm, error } = resolveTheaterLlm(characterId);
    if (error) throw new Error(error);
    const recent = getRecentChatText(characterId, 2400);
    const messages: LLMMessage[] = [
        { role: "system", content: "你是恋爱脑洞灵感机。根据最近聊天记录，提炼 1 个适合写「小剧场」的有趣灵感梗。直接给梗，一句话，不要解释。" },
        { role: "user", content: recent ? `最近聊天：\n${recent}` : "根据你们的关系日常，给一个甜或有趣的灵感梗。" },
    ];
    const result = await sendLLMStreamRequest(
        llm.config,
        llm.preset,
        messages,
        [],
        { characterName: llm.character?.name },
        { skipOutputRegex: true, skipTimestampStrip: true, appId: "theater", signal: undefined },
        { onDelta },
    );
    return result.content.trim();
}

/** 续写：把已有正文当作上下文继续写。 */
export async function continueTheaterStory(
    story: TheaterStory,
    config: TheaterConfig,
    characterId: string,
    onDelta?: (text: string) => void,
    signal?: AbortSignal,
): Promise<string> {
    const { llm, error } = resolveTheaterLlm(characterId);
    if (error) throw new Error(error);
    const system = buildSystemPrompt(story.kind, config, {
        tone: story.tone,
        person: story.person,
        styleId: story.styleId,
        tags: story.tags,
    });
    const messages: LLMMessage[] = [
        { role: "system", content: `${system}\n请承接下面已有的正文，自然续写下去，不重复、不另起标题。` },
        { role: "user", content: `已有正文：\n${story.content.slice(-3000)}\n\n请继续写：` },
    ];
    const result = await sendLLMStreamRequest(
        llm.config,
        llm.preset,
        messages,
        [],
        { characterName: llm.character?.name },
        { skipOutputRegex: true, skipTimestampStrip: true, appId: "theater", signal },
        { onDelta },
    );
    const forbidden = config[story.kind === "pickup" ? "pickupSpec" : "theaterSpec"].forbiddenWords;
    return applyForbiddenWords(result.content.trim(), forbidden);
}

/** 近期聊天文本（用于灵感梗 / 连着主线）。 */
export function getRecentChatText(characterId: string, maxChars = 2400): string {
    try {
        const sessions = loadChatSessions().filter((s) => !s.isGroup);
        const lines: string[] = [];
        for (const s of sessions) {
            const cid = resolveSessionCharacterId(s);
            if (characterId && cid !== characterId) continue;
            const msgs = loadChatMessages(s.id);
            for (const m of msgs.slice(-24)) {
                if (m.role !== "user" && m.role !== "assistant") continue;
                const who = m.role === "user" ? "TA" : "我";
                const text = (m.content || "").trim();
                if (text) lines.push(`${who}：${text.slice(0, 400)}`);
            }
        }
        const joined = lines.slice(-30).join("\n");
        return joined.slice(-maxChars);
    } catch {
        return "";
    }
}

/** 生成「每日一问」（非流式，供离线推送/桌面组件使用）。 */
export async function generateDailyQuestion(characterId: string): Promise<string> {
    const { llm, error } = resolveTheaterLlm(characterId);
    if (error) throw new Error(error);
    const messages: LLMMessage[] = [
        { role: "system", content: "你是情侣互动助手。请出一个适合恋人之间交流的「每日一问」，短小、有温度、能引发真诚回答。直接给问题，不要解释。" },
        { role: "user", content: "给我一个今天的每日一问。" },
    ];
    return sendLLMRequest(llm.config, llm.preset, messages, [], { characterName: llm.character?.name }, { skipOutputRegex: true, appId: "theater" });
}
