// lib/lover-memory-ingest.ts
// 聊天实时自动沉淀归档 + 定时自动备份。
// 全部独立于聊天主流程：任何异常都吞掉，绝不影响聊天。

import type { LoverMemoryEntry } from "./lover-memory-types";
import { kvGet, kvSet, registerKvMigration } from "./kv-db";
import {
    loadLoverMemoryConfig,
    loadLoverMemoryEntries,
    saveLoverMemoryEntries,
    saveLoverMemoryArchive,
    loadLoverMemoryArchives,
    saveLoverMemoryBackupSnapshot,
    loadLoverMemoryBackupSnapshots,
    deleteLoverMemoryBackupSnapshots,
    sliceEntriesByDay,
    extractKeyEvents,
    buildLoverMemoryBackupSnapshotPayload,
} from "./lover-memory-storage";

const INGESTED_KEY = "ai_phone_lover_memory_ingested_v1";
const LAST_BACKUP_KEY = "ai_phone_lover_memory_last_backup_v1";
registerKvMigration(INGESTED_KEY);
registerKvMigration(LAST_BACKUP_KEY);

const INGESTED_CAP = 500;

/** 已沉淀的消息 id 集合（用于去重，防止重复写入）。 */
function loadIngestedIds(): Set<string> {
    if (typeof window === "undefined") return new Set();
    try {
        const raw = kvGet(INGESTED_KEY);
        if (!raw) return new Set();
        const arr = JSON.parse(raw);
        return new Set(Array.isArray(arr) ? arr.map(String) : []);
    } catch {
        return new Set();
    }
}

function saveIngestedIds(ids: Set<string>): void {
    if (typeof window === "undefined") return;
    const arr = Array.from(ids).slice(-INGESTED_CAP);
    kvSet(INGESTED_KEY, JSON.stringify(arr));
}

export type IngestibleMessage = {
    id: string;
    role: string;
    content: string;
    createdAt?: string;
};

/** 情感/事件关键词启发式：给有信息量的用户发言更高重要度。 */
function heuristicImportance(text: string, role: string): number {
    const length = text.trim().length;
    if (role === "assistant") return 0.5;
    let score = 0.45;
    if (length >= 20) score += 0.15;
    if (length >= 60) score += 0.1;
    if (/喜欢|爱|讨厌|生日|纪念|害怕|不想|讨厌|雷|别|约定|承诺|记住|秘密|家人|朋友|身体|情绪/.test(text)) score += 0.15;
    return Math.min(score, 0.95);
}

/**
 * 把一轮聊天（最近若干条）自动沉淀进恋人记忆库。
 * 幂等：按消息 id 去重，重复调用不会重复写入。
 */
export async function ingestChatTurnToLoverMemory(
    characterId: string,
    messages: IngestibleMessage[],
): Promise<number> {
    try {
        const config = loadLoverMemoryConfig();
        if (!config.autoArchiveEnabled) return 0;
        if (messages.length === 0) return 0;

        const seen = loadIngestedIds();
        const now = new Date().toISOString();
        const toSave: LoverMemoryEntry[] = [];
        let budget = Math.max(1, config.autoArchiveMaxPerTurn);

        for (const msg of messages) {
            if (budget <= 0) break;
            const text = msg.content?.trim();
            if (!text || text.length < 2) continue;
            if (seen.has(msg.id)) continue;
            const importance = heuristicImportance(text, msg.role);
            if (importance < config.autoArchiveMinImportance) continue;

            toSave.push({
                id: `lm_auto_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                characterId,
                content: text.length > 800 ? text.slice(0, 800) : text,
                eventDate: (msg.createdAt ?? now).slice(0, 10),
                createdAt: now,
                updatedAt: now,
                tags: msg.role === "user" ? ["聊天"] : ["聊天"],
                pinned: false,
                source: "chat_auto",
                importance,
            });
            seen.add(msg.id);
            budget -= 1;
        }

        if (toSave.length > 0) {
            await saveLoverMemoryEntries(toSave);
        }
        saveIngestedIds(seen);
        return toSave.length;
    } catch {
        return 0;
    }
}

/**
 * 自动归档：把同一天内 ≥ 2 条的记录切成时间片并生成精简归档（幂等，已归档的日期跳过）。
 */
export async function autoArchiveLoverMemory(characterId: string): Promise<number> {
    try {
        const config = loadLoverMemoryConfig();
        if (!config.autoArchiveEnabled) return 0;
        const entries = await loadLoverMemoryEntries(characterId);
        if (entries.length < 2) return 0;
        const archives = await loadLoverMemoryArchives(characterId);
        const archivedDates = new Set(archives.map((a) => a.startTime.slice(0, 10)));

        const slices = sliceEntriesByDay(entries);
        const now = new Date().toISOString();
        let created = 0;
        for (const slice of slices) {
            if (slice.entries.length < 2) continue;
            if (archivedDates.has(slice.date)) continue;
            const keyEvents = extractKeyEvents(slice.entries);
            const summary = slice.entries
                .map((e) => e.summary || e.content)
                .slice(0, 4)
                .join(" / ")
                .slice(0, 300);
            await saveLoverMemoryArchive({
                id: `lm_arch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                characterId,
                startTime: `${slice.date}T00:00:00`,
                endTime: `${slice.date}T23:59:59`,
                title: `${slice.date} 的回忆`,
                summary,
                entryIds: slice.entries.map((e) => e.id),
                keyEvents,
                createdAt: now,
                updatedAt: now,
            });
            created += 1;
        }
        return created;
    } catch {
        return 0;
    }
}

/** 一次自动沉淀+归档的合体入口（聊天引擎每轮调用）。 */
export async function autoSettleChatToLoverMemory(
    characterId: string,
    messages: IngestibleMessage[],
): Promise<void> {
    await ingestChatTurnToLoverMemory(characterId, messages);
    await autoArchiveLoverMemory(characterId);
}

// ── 定时自动备份 ──

function loadLastBackupTime(): number {
    if (typeof window === "undefined") return 0;
    const raw = kvGet(LAST_BACKUP_KEY);
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
}

function saveLastBackupTime(ts: number): void {
    if (typeof window === "undefined") return;
    kvSet(LAST_BACKUP_KEY, String(ts));
}

/**
 * 若距上次自动备份已超过配置间隔，则生成一份本地快照（落 IndexedDB）。
 * 返回是否生成了新快照。可被定时器周期调用。
 */
export async function maybeRunLoverMemoryAutoBackup(characterId: string): Promise<boolean> {
    try {
        const config = loadLoverMemoryConfig();
        if (!config.autoBackupEnabled) return false;
        const intervalMs = Math.max(1, config.backupIntervalHours) * 3600_000;
        const last = loadLastBackupTime();
        if (last > 0 && Date.now() - last < intervalMs) return false;

        const [entries, archives] = await Promise.all([
            loadLoverMemoryEntries(characterId),
            loadLoverMemoryArchives(characterId),
        ]);
        const payload = buildLoverMemoryBackupSnapshotPayload(entries, archives);
        await saveLoverMemoryBackupSnapshot({
            id: `lm_bak_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            characterId,
            createdAt: new Date().toISOString(),
            entryCount: entries.length,
            archiveCount: archives.length,
            payload,
        });
        saveLastBackupTime(Date.now());

        // 只保留最近 10 份快照，防止无限膨胀。
        const snaps = await loadLoverMemoryBackupSnapshots(characterId);
        if (snaps.length > 10) {
            const toDrop = snaps.slice(10).map((s) => s.id);
            await deleteLoverMemoryBackupSnapshots(toDrop);
        }
        return true;
    } catch {
        return false;
    }
}
