// lib/portable/legacy.ts
// 旧版「鲸鱼机 / littlephone」备份格式的迁移适配器。
//
// 鲸鱼机与本项目同源但存储形态不同：它把数据放在一份扁平 JSON 里
// （friends / messages / memories / apiSettings / _localStorage），本项目则把
// 数据拆进 IndexedDB 和若干 kv 键。这里做的是「尽力而为」的结构映射：
//   friends    → 角色卡 + 联系人 + 会话
//   messages   → 聊天记录（sent=user / received=assistant）
//   memories   → 长期记忆库（isCore 归到 core）
//   apiSettings→ API 配置（只取 chat 那一条）
// 其余字段（朋友圈、表情包、自定义工具、appSettings 等）不在本次映射范围，
// 会在结果里明确列出「未迁移」，不假装成功。

import { chatDb } from "@/lib/chat-db";
import { loadCharacters, saveCharacters } from "@/lib/character-storage";
import { loadApiConfigs, saveApiConfigs } from "@/lib/settings-storage";
import { ensureDatabase } from "./idb";
import type { Character } from "@/lib/character-types";
import type { ChatContact, ChatMessage, ChatSession } from "@/lib/chat-storage";
import type { MemoryEntry } from "@/lib/memory-types";
import type { ApiConfig } from "@/lib/settings-types";
import type { LegacyBackupPreview, LegacyImportResult, PortableIdbDatabase } from "./types";

type UnknownRecord = Record<string, unknown>;

const MEMORY_DB = "ai_phone_memory_db_v1";
const MEMORY_STORE = "memories";

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === "object" && value !== null;
}

function asArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

function text(value: unknown, max = 4000): string {
    return typeof value === "string" ? value.slice(0, max) : "";
}

function isoOrNow(value: unknown): string {
    if (typeof value === "string" && value.length >= 10) {
        const time = Date.parse(value);
        if (Number.isFinite(time)) return new Date(time).toISOString();
    }
    return new Date().toISOString();
}

function clamp01(value: unknown, fallback = 0.5): number {
    const num = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.max(0, Math.min(1, num));
}

function countMessages(payload: UnknownRecord): number {
    return asArray(payload.messages).reduce<number>((sum, bucket) => {
        if (!isRecord(bucket)) return sum;
        return sum + asArray(bucket.messages).length;
    }, 0);
}

/** 结构嗅探：只认「有 friends / messages 桶 + 至少一个 littlephone_ 键」。 */
export function detectLegacyBackup(payload: unknown): LegacyBackupPreview | null {
    if (!isRecord(payload)) return null;
    const localStorageData = isRecord(payload._localStorage) ? payload._localStorage : null;
    const hasLittlePhoneKeys = !!localStorageData
        && Object.keys(localStorageData).some((key) => key.startsWith("littlephone_"));
    const looksLikePhoneBackup = Array.isArray(payload.friends) && Array.isArray(payload.messages);
    if (!hasLittlePhoneKeys && !looksLikePhoneBackup) return null;

    const apiSettings = asArray(payload.apiSettings);
    return {
        kind: "whale",
        app: typeof payload.app === "string" ? payload.app : undefined,
        exportedAt: typeof payload.exportedAt === "string" ? payload.exportedAt : undefined,
        characters: asArray(payload.friends).length,
        messages: countMessages(payload),
        sessions: asArray(payload.messages).length,
        memories: asArray(payload.memories).length,
        worldBooks: asArray(payload.worldBooks).length,
        apiConfigs: apiSettings.length,
        rawBytes: 0,
    };
}

type LegacyMessage = {
    id: string;
    type?: string;
    role?: string;
    content?: string;
    contentType?: string;
    timestamp?: string;
    createdAt?: string;
    senderId?: string;
};

function legacyRole(message: LegacyMessage): "user" | "assistant" {
    const type = (message.type ?? "").toLowerCase();
    const role = (message.role ?? "").toLowerCase();
    if (type === "sent" || role === "user") return "user";
    return "assistant";
}

function toCharacter(friend: UnknownRecord, now: string): Character | null {
    const id = text(friend.id, 120);
    if (!id) return null;
    const avatarImage = text(friend.avatarImage, 2_000_000);
    const avatarText = text(friend.avatar, 400);
    const avatar = avatarImage
        || (avatarText.startsWith("data:") ? avatarText : null);
    return {
        id,
        name: text(friend.name, 120) || bodyName(friend) || "未命名角色",
        avatar,
        persona: text(friend.role, 200_000) || text(friend.persona, 200_000),
        createdAt: now,
        updatedAt: now,
    };
}

function bodyName(friend: UnknownRecord): string {
    return text(friend.remark, 60);
}

async function mergeRecords(
    dbName: string,
    storeName: string,
    keyPath: string,
    records: unknown[],
    onChunk?: (written: number) => void,
): Promise<number> {
    if (records.length === 0) return 0;
    const definition: PortableIdbDatabase = {
        name: dbName,
        version: 1,
        stores: [{
            name: storeName,
            keyPath,
            autoIncrement: false,
            indexes: [],
            records: [],
        }],
    };
    const db = await ensureDatabase(definition);
    try {
        const chunkSize = 400;
        let written = 0;
        for (let start = 0; start < records.length; start += chunkSize) {
            const chunk = records.slice(start, start + chunkSize);
            await new Promise<void>((resolve, reject) => {
                const tx = db.transaction(storeName, "readwrite");
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error ?? new Error(`写入 ${storeName} 失败`));
                const store = tx.objectStore(storeName);
                for (const record of chunk) store.put(record);
            });
            written += chunk.length;
            onChunk?.(written);
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
        return written;
    } finally {
        db.close();
    }
}

export type LegacyImportProgress = {
    percent: number;
    detail: string;
};

export async function importLegacyBackup(
    payload: unknown,
    onProgress?: (progress: LegacyImportProgress) => void,
): Promise<LegacyImportResult> {
    const preview = detectLegacyBackup(payload);
    if (!preview) {
        throw new Error("无法识别的备份格式：既不是本应用的一键搬家文件，也不是鲸鱼机备份。");
    }
    if (!isRecord(payload)) throw new Error("备份文件顶层结构不正确。");

    const result: LegacyImportResult = {
        characters: 0,
        contacts: 0,
        sessions: 0,
        messages: 0,
        memories: 0,
        apiConfigs: 0,
        skipped: [],
        errors: [],
    };
    const now = new Date().toISOString();

    // ── 1. 角色卡 ────────────────────────────────
    onProgress?.({ percent: 8, detail: "正在迁移角色卡…" });
    const friends = asArray(payload.friends).filter(isRecord);
    const incomingCharacters = friends
        .map((friend) => toCharacter(friend, now))
        .filter((item): item is Character => item !== null);
    try {
        const existing = loadCharacters();
        const existingIds = new Set(existing.map((item) => item.id));
        const fresh = incomingCharacters.filter((item) => !existingIds.has(item.id));
        if (fresh.length > 0) {
            saveCharacters([...existing, ...fresh]);
        }
        result.characters = fresh.length;
        if (incomingCharacters.length !== fresh.length) {
            result.skipped.push(`已存在同 ID 角色 ${incomingCharacters.length - fresh.length} 个（保留本机版本）`);
        }
    } catch (error) {
        result.errors.push(`角色卡写入失败：${error instanceof Error ? error.message : String(error)}`);
    }

    // ── 2. 会话与联系人 ──────────────────────────
    onProgress?.({ percent: 18, detail: "正在迁移会话与联系人…" });
    const buckets = asArray(payload.messages).filter(isRecord);
    const contacts: ChatContact[] = [];
    const sessions: ChatSession[] = [];
    const messages: ChatMessage[] = [];

    for (const bucket of buckets) {
        const friendId = text(bucket.friendId, 120);
        if (!friendId) continue;
        const rawMessages = asArray(bucket.messages).filter(isRecord) as unknown as LegacyMessage[];
        const sorted = [...rawMessages].sort((a, b) => {
            const left = Date.parse(String(a.timestamp ?? a.createdAt ?? "")) || 0;
            const right = Date.parse(String(b.timestamp ?? b.createdAt ?? "")) || 0;
            return left - right;
        });
        const last = sorted[sorted.length - 1];
        const sessionId = `legacy-session-${friendId}`;
        const contactId = `legacy-contact-${friendId}`;
        const friend = friends.find((item) => text(item.id, 120) === friendId);
        const alias = friend ? text(friend.remark, 60) : "";

        contacts.push({ id: contactId, characterId: friendId, addedAt: now });
        sessions.push({
            id: sessionId,
            characterId: friendId,
            contactId,
            unreadCount: 0,
            updatedAt: isoOrNow(last?.timestamp ?? last?.createdAt),
            isPinned: false,
            alias: alias || undefined,
        });

        sorted.forEach((message, index) => {
            const content = text(message.content, 200_000);
            const id = text(message.id, 120) || `legacy-msg-${sessionId}-${index}`;
            messages.push({
                id,
                sessionId,
                role: legacyRole(message),
                content,
                status: "sent",
                createdAt: isoOrNow(message.timestamp ?? message.createdAt),
                order: index,
            });
        });
    }

    try {
        await chatDb.transaction("rw", chatDb.contacts, chatDb.sessions, async () => {
            await chatDb.contacts.bulkPut(contacts);
            await chatDb.sessions.bulkPut(sessions);
        });
        result.contacts = contacts.length;
        result.sessions = sessions.length;
    } catch (error) {
        result.errors.push(`会话/联系人写入失败：${error instanceof Error ? error.message : String(error)}`);
    }

    // ── 3. 聊天记录 ──────────────────────────────
    try {
        const chunkSize = 800;
        for (let start = 0; start < messages.length; start += chunkSize) {
            const chunk = messages.slice(start, start + chunkSize);
            await chatDb.messages.bulkPut(chunk);
            result.messages += chunk.length;
            onProgress?.({
                percent: 28 + Math.round((result.messages / Math.max(1, messages.length)) * 40),
                detail: `正在写入聊天记录 ${result.messages}/${messages.length}`,
            });
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
    } catch (error) {
        result.errors.push(`聊天记录写入失败：${error instanceof Error ? error.message : String(error)}`);
    }

    // ── 4. 记忆 ──────────────────────────────────
    onProgress?.({ percent: 74, detail: "正在迁移记忆…" });
    const memoryEntries: MemoryEntry[] = asArray(payload.memories)
        .filter(isRecord)
        .map((memory, index): MemoryEntry | null => {
            const characterId = text(memory.friendId, 120) || "legacy-unknown";
            const content = text(memory.content, 20_000);
            if (!content) return null;
            const createdAt = isoOrNow(memory.createdAt);
            return {
                id: text(memory.id, 160) || `legacy-memory-${index}`,
                characterId,
                sourceApp: "chat",
                type: memory.isCore === true ? "core" : "long_term",
                content,
                importance: clamp01(memory.importance),
                createdAt,
                updatedAt: isoOrNow(memory.updatedAt ?? memory.createdAt),
                metadata: { migratedFrom: "littlephone", migratedAt: now },
            } satisfies MemoryEntry;
        })
        .filter((item): item is MemoryEntry => item !== null);

    try {
        result.memories = await mergeRecords(MEMORY_DB, MEMORY_STORE, "id", memoryEntries, (written) => {
            onProgress?.({
                percent: 74 + Math.round((written / Math.max(1, memoryEntries.length)) * 14),
                detail: `正在写入记忆 ${written}/${memoryEntries.length}`,
            });
        });
    } catch (error) {
        result.errors.push(`记忆写入失败：${error instanceof Error ? error.message : String(error)}`);
    }

    // ── 5. API 配置（只取 chat） ─────────────────
    onProgress?.({ percent: 92, detail: "正在迁移 API 配置…" });
    try {
        const apiSettings = asArray(payload.apiSettings).filter(isRecord);
        const chatConfig = apiSettings
            .map((item) => (isRecord(item.configs) ? item.configs.chat : null))
            .find((item): item is UnknownRecord => isRecord(item));
        if (chatConfig) {
            const baseUrl = text(chatConfig.url, 500);
            const apiKey = text(chatConfig.key, 500);
            const model = text(chatConfig.model, 200);
            if (baseUrl && apiKey && model) {
                const config: ApiConfig = {
                    id: "legacy-littlephone-chat",
                    name: "迁移自鲸鱼机",
                    provider: "openai",
                    apiKey,
                    baseUrl,
                    defaultModel: model,
                    enableNativeTools: true,
                    enableImageRecognition: false,
                    enableImageGeneration: false,
                };
                const existing = loadApiConfigs();
                if (!existing.some((item) => item.id === config.id)) {
                    saveApiConfigs([...existing, config]);
                    result.apiConfigs = 1;
                }
            } else {
                result.skipped.push("鲸鱼机的聊天 API 配置不完整，已跳过");
            }
        }
        if (asArray(payload.worldBooks).length > 0) {
            result.skipped.push(`世界书 ${asArray(payload.worldBooks).length} 本未迁移（两边条目结构不同，需要单独转换）`);
        }
        if (asArray(payload.moments).length > 0) {
            result.skipped.push(`朋友圈 ${asArray(payload.moments).length} 条未迁移`);
        }
        if (asArray(payload.stickers).length > 0) {
            result.skipped.push(`表情包 ${asArray(payload.stickers).length} 个未迁移`);
        }
        if (asArray(payload.tools).length > 0) {
            result.skipped.push(`自定义工具 ${asArray(payload.tools).length} 个未迁移`);
        }
    } catch (error) {
        result.errors.push(`API 配置迁移失败：${error instanceof Error ? error.message : String(error)}`);
    }

    onProgress?.({ percent: 100, detail: "迁移完成" });
    return result;
}
