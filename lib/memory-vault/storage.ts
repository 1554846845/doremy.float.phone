// lib/memory-vault/storage.ts
// 记忆库的 IndexedDB 持久化层（独立数据库，不碰自动记忆库）。

import { openIndexedDbAtLeast } from "@/lib/idb-open";
import {
    MEMORY_VAULT_MAX_CONTENT,
    MEMORY_VAULT_MAX_ENTRIES_PER_CHARACTER,
    isMemoryVaultCategory,
    type MemoryVaultDraft,
    type MemoryVaultEntry,
} from "./types";

const DB_NAME = "ai_phone_memory_vault_v1";
const DB_VERSION = 1;
const STORE = "entries";

function hasBrowserApi(): boolean {
    return typeof window !== "undefined" && typeof indexedDB !== "undefined";
}

function runRequest<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("IndexedDB 操作失败"));
    });
}

async function openDb(): Promise<IDBDatabase | null> {
    if (!hasBrowserApi()) return null;
    try {
        return await openIndexedDbAtLeast(DB_NAME, DB_VERSION, (db) => {
            if (!db.objectStoreNames.contains(STORE)) {
                const store = db.createObjectStore(STORE, { keyPath: "id" });
                store.createIndex("by_character", "characterId", { unique: false });
                store.createIndex("by_character_updated", ["characterId", "updatedAt"], { unique: false });
            }
        });
    } catch (error) {
        console.warn("[memory-vault] 打开数据库失败", error);
        return null;
    }
}

function makeId(): string {
    try {
        if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
            return `mv_${crypto.randomUUID()}`;
        }
    } catch { /* ignore */ }
    return `mv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function normalizeVaultEntry(draft: MemoryVaultDraft): MemoryVaultEntry {
    const now = new Date().toISOString();
    const content = String(draft.content ?? "").trim().slice(0, MEMORY_VAULT_MAX_CONTENT);
    if (!content) throw new Error("记忆内容不能为空");
    const weight = Number.isFinite(draft.weight) ? Math.round(draft.weight) : 60;
    return {
        id: draft.id || makeId(),
        characterId: String(draft.characterId ?? ""),
        category: isMemoryVaultCategory(draft.category) ? draft.category : "other",
        content,
        weight: Math.max(0, Math.min(100, weight)),
        pinned: draft.pinned === true,
        createdAt: now,
        updatedAt: now,
        source: "manual",
    };
}

export async function listVaultEntries(characterId?: string): Promise<MemoryVaultEntry[]> {
    const db = await openDb();
    if (!db) return [];
    try {
        const tx = db.transaction(STORE, "readonly");
        const store = tx.objectStore(STORE);
        const all = await runRequest<MemoryVaultEntry[]>(store.getAll());
        const filtered = characterId === undefined
            ? all
            : all.filter((entry) => entry.characterId === characterId || entry.characterId === "");
        return sortEntries(filtered);
    } catch (error) {
        console.warn("[memory-vault] 读取失败", error);
        return [];
    } finally {
        db.close();
    }
}

function sortEntries(entries: MemoryVaultEntry[]): MemoryVaultEntry[] {
    return [...entries].sort((left, right) => {
        if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
        if (right.weight !== left.weight) return right.weight - left.weight;
        return right.updatedAt.localeCompare(left.updatedAt);
    });
}

export async function searchVaultEntries(query: string, characterId?: string): Promise<MemoryVaultEntry[]> {
    const keyword = query.trim().toLowerCase();
    const entries = await listVaultEntries(characterId);
    if (!keyword) return entries;
    return entries.filter((entry) =>
        entry.content.toLowerCase().includes(keyword)
        || entry.category.toLowerCase().includes(keyword));
}

export async function saveVaultEntry(draft: MemoryVaultDraft): Promise<MemoryVaultEntry> {
    const entry = normalizeVaultEntry(draft);
    const db = await openDb();
    if (!db) throw new Error("当前环境无法使用 IndexedDB，记忆库不可用。");
    try {
        if (draft.id) {
            const existing = await runRequest<MemoryVaultEntry | undefined>(
                db.transaction(STORE, "readonly").objectStore(STORE).get(draft.id),
            );
            if (existing) {
                entry.createdAt = existing.createdAt;
                entry.source = existing.source ?? "manual";
            }
        }
        const all = await runRequest<MemoryVaultEntry[]>(
            db.transaction(STORE, "readonly").objectStore(STORE).getAll(),
        );
        const sameCharacter = all.filter((item) => item.characterId === entry.characterId && item.id !== entry.id);
        if (sameCharacter.length >= MEMORY_VAULT_MAX_ENTRIES_PER_CHARACTER) {
            throw new Error(`每个角色最多 ${MEMORY_VAULT_MAX_ENTRIES_PER_CHARACTER} 条记忆，请先清理旧条目。`);
        }
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE, "readwrite");
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error ?? new Error("写入失败"));
            tx.objectStore(STORE).put(entry);
        });
        return entry;
    } finally {
        db.close();
    }
}

export async function deleteVaultEntry(id: string): Promise<void> {
    const db = await openDb();
    if (!db) return;
    try {
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE, "readwrite");
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error ?? new Error("删除失败"));
            tx.objectStore(STORE).delete(id);
        });
    } finally {
        db.close();
    }
}

export async function deleteCharacterVault(characterId: string): Promise<number> {
    const entries = await listVaultEntries(characterId);
    let removed = 0;
    for (const entry of entries) {
        if (entry.characterId !== characterId) continue;
        await deleteVaultEntry(entry.id);
        removed++;
    }
    return removed;
}

/** 批量导入（鲸鱼机记忆 / 一键搬家恢复时复用）。 */
export async function bulkSaveVaultEntries(entries: MemoryVaultEntry[]): Promise<number> {
    if (entries.length === 0) return 0;
    const db = await openDb();
    if (!db) return 0;
    try {
        let written = 0;
        for (let start = 0; start < entries.length; start += 400) {
            const chunk = entries.slice(start, start + 400);
            await new Promise<void>((resolve, reject) => {
                const tx = db.transaction(STORE, "readwrite");
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error ?? new Error("批量写入失败"));
                const store = tx.objectStore(STORE);
                for (const entry of chunk) store.put(entry);
            });
            written += chunk.length;
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
        return written;
    } finally {
        db.close();
    }
}

export async function countVaultEntries(characterId: string): Promise<number> {
    const entries = await listVaultEntries(characterId);
    return entries.length;
}
