// lib/lover-memory-storage.ts
// 专属恋人记忆库的持久化：独立 IndexedDB（不限条数），
// 支持按日期时间线切片归档、文本/表格导入、一键导出。

import type { LoverMemoryArchive, LoverMemoryConfig, LoverMemoryEntry } from "./lover-memory-types";
import { DEFAULT_LOVER_MEMORY_CONFIG } from "./lover-memory-types";
import { kvGet, kvSet, registerKvMigration } from "./kv-db";
import { openIndexedDbAtLeast } from "./idb-open";

const DB_NAME = "ai_phone_lover_memory_db_v1";
const DB_VERSION = 2;
const ENTRY_STORE = "entries";
const ARCHIVE_STORE = "archives";
const BACKUP_STORE = "backups";
const CONFIG_KEY = "ai_phone_lover_memory_config_v1";
registerKvMigration(CONFIG_KEY);

/** 本地自动备份快照（定时备份产物）。 */
export type LoverMemoryBackupSnapshot = {
    id: string;
    characterId: string;
    createdAt: string;
    entryCount: number;
    archiveCount: number;
    /** JSON 字符串（entries + archives 的完整导出）。 */
    payload: string;
};

function hasBrowserApi(): boolean {
    return typeof window !== "undefined" && typeof indexedDB !== "undefined";
}

async function openDb(): Promise<IDBDatabase | null> {
    if (!hasBrowserApi()) return null;
    return openIndexedDbAtLeast(DB_NAME, DB_VERSION, (db) => {
        if (!db.objectStoreNames.contains(ENTRY_STORE)) {
            const store = db.createObjectStore(ENTRY_STORE, { keyPath: "id" });
            store.createIndex("by_character", "characterId", { unique: false });
            store.createIndex("by_character_date", ["characterId", "eventDate"], { unique: false });
        }
        if (!db.objectStoreNames.contains(ARCHIVE_STORE)) {
            const store = db.createObjectStore(ARCHIVE_STORE, { keyPath: "id" });
            store.createIndex("by_character", "characterId", { unique: false });
        }
        if (!db.objectStoreNames.contains(BACKUP_STORE)) {
            const store = db.createObjectStore(BACKUP_STORE, { keyPath: "id" });
            store.createIndex("by_character", "characterId", { unique: false });
        }
    }).catch(() => null);
}

function runRequest<T>(req: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function runWrite(storeName: string, fn: (store: IDBObjectStore) => void): Promise<void> {
    const db = await openDb();
    if (!db) return;
    try {
        const tx = db.transaction(storeName, "readwrite");
        fn(tx.objectStore(storeName));
        await new Promise<void>((res, rej) => {
            tx.oncomplete = () => res();
            tx.onerror = () => rej(tx.error);
            tx.onabort = () => rej(tx.error);
        });
    } finally {
        db.close();
    }
}

async function readAll<T>(storeName: string): Promise<T[]> {
    const db = await openDb();
    if (!db) return [];
    try {
        const tx = db.transaction(storeName, "readonly");
        const rows: T[] = await runRequest(tx.objectStore(storeName).getAll());
        return rows;
    } finally {
        db.close();
    }
}

function makeId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ── 配置 ──

export function loadLoverMemoryConfig(): LoverMemoryConfig {
    if (typeof window === "undefined") return { ...DEFAULT_LOVER_MEMORY_CONFIG };
    try {
        const raw = kvGet(CONFIG_KEY);
        if (!raw) return { ...DEFAULT_LOVER_MEMORY_CONFIG };
        const parsed = JSON.parse(raw) as Partial<LoverMemoryConfig>;
        return { ...DEFAULT_LOVER_MEMORY_CONFIG, ...parsed };
    } catch {
        return { ...DEFAULT_LOVER_MEMORY_CONFIG };
    }
}

export function saveLoverMemoryConfig(config: LoverMemoryConfig): void {
    if (typeof window === "undefined") return;
    kvSet(CONFIG_KEY, JSON.stringify(config));
}

// ── 条目 CRUD ──

export async function saveLoverMemoryEntry(entry: LoverMemoryEntry): Promise<void> {
    await runWrite(ENTRY_STORE, (store) => store.put(entry));
}

export async function saveLoverMemoryEntries(entries: LoverMemoryEntry[]): Promise<void> {
    if (entries.length === 0) return;
    await runWrite(ENTRY_STORE, (store) => {
        for (const e of entries) store.put(e);
    });
}

export async function loadLoverMemoryEntries(characterId = ""): Promise<LoverMemoryEntry[]> {
    const all = await readAll<LoverMemoryEntry>(ENTRY_STORE);
    const list = all.filter((e) => e.characterId === characterId);
    list.sort((a, b) => a.eventDate.localeCompare(b.eventDate));
    return list;
}

export async function deleteLoverMemoryEntry(id: string): Promise<void> {
    await runWrite(ENTRY_STORE, (store) => store.delete(id));
}

export async function deleteLoverMemoryEntries(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await runWrite(ENTRY_STORE, (store) => {
        for (const id of ids) store.delete(id);
    });
}

export async function clearLoverMemory(characterId = ""): Promise<void> {
    const entries = await loadLoverMemoryEntries(characterId);
    await deleteLoverMemoryEntries(entries.map((e) => e.id));
    const archives = await loadLoverMemoryArchives(characterId);
    await runWrite(ARCHIVE_STORE, (store) => {
        for (const a of archives) store.delete(a.id);
    });
}

export async function countLoverMemoryEntries(characterId = ""): Promise<number> {
    return (await loadLoverMemoryEntries(characterId)).length;
}

// ── 归档 ──

export async function saveLoverMemoryArchive(archive: LoverMemoryArchive): Promise<void> {
    await runWrite(ARCHIVE_STORE, (store) => store.put(archive));
}

export async function loadLoverMemoryArchives(characterId = ""): Promise<LoverMemoryArchive[]> {
    const all = await readAll<LoverMemoryArchive>(ARCHIVE_STORE);
    const list = all.filter((a) => a.characterId === characterId);
    list.sort((a, b) => a.startTime.localeCompare(b.startTime));
    return list;
}

export async function deleteLoverMemoryArchives(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await runWrite(ARCHIVE_STORE, (store) => {
        for (const id of ids) store.delete(id);
    });
}

/** 把条目按日历日切成时间片（纯本地，不依赖 API）。 */
export function sliceEntriesByDay(entries: LoverMemoryEntry[]): Array<{ date: string; entries: LoverMemoryEntry[] }> {
    const groups = new Map<string, LoverMemoryEntry[]>();
    for (const e of entries) {
        const day = e.eventDate.slice(0, 10) || "未知日期";
        const arr = groups.get(day) ?? [];
        arr.push(e);
        groups.set(day, arr);
    }
    return Array.from(groups.entries())
        .map(([date, list]) => ({ date, entries: list }))
        .sort((a, b) => a.date.localeCompare(b.date));
}

/** 从切片提炼关键事件关键词（按标签 + 置顶 + 重要度启发式）。 */
export function extractKeyEvents(entries: LoverMemoryEntry[]): string[] {
    const keywords = new Set<string>();
    for (const e of entries) {
        for (const t of e.tags) keywords.add(t);
        if (e.pinned) keywords.add("置顶");
    }
    // 追加高频中文词（长度 >= 2 的片段，简单启发式）
    const counter = new Map<string, number>();
    for (const e of entries) {
        const text = e.summary || e.content;
        const segs = text.match(/[\u4e00-\u9fff]{2,4}/g) ?? [];
        for (const s of segs) counter.set(s, (counter.get(s) ?? 0) + 1);
    }
    for (const [word, count] of counter) {
        if (count >= 2 && keywords.size < 6) keywords.add(word);
    }
    return Array.from(keywords).slice(0, 8);
}

// ── 导入 ──

export type ImportedRecord = {
    content: string;
    eventDate?: string;
    tags: string[];
    sender?: string;
};

/** 解析纯文本聊天记录：按行切分，自动识别「名字: 内容」与日期行。 */
export function parseTextImport(text: string): ImportedRecord[] {
    const records: ImportedRecord[] = [];
    let currentDate: string | undefined;
    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) continue;
        // 日期行：2024-01-01 / 2024/1/1 / 1月1日
        const dateMatch = line.match(/^(\d{4}[-/年]\d{1,2}[-/月]\d{1,2}日?)/);
        if (dateMatch && line.length < 24) {
            currentDate = dateMatch[1].replace(/[年/]/g, "-").replace(/月/g, "-").replace(/日/g, "").replace(/-+/g, "-").replace(/(-\d{1,2})$/g, (m) => m);
            continue;
        }
        const senderMatch = line.match(/^(.{1,20}?)[：:]\s*([\s\S]+)$/);
        if (senderMatch) {
            records.push({
                content: senderMatch[2].trim(),
                sender: senderMatch[1].trim(),
                eventDate: currentDate,
                tags: [],
            });
        } else {
            records.push({ content: line, eventDate: currentDate, tags: [] });
        }
    }
    return records;
}

/** 极简 CSV/TSV 解析（支持引号包裹与逗号/制表符分隔）。 */
export function parseDelimitedTable(text: string, delimiter: "," | "\t"): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = "";
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inQuotes) {
            if (ch === '"') {
                if (text[i + 1] === '"') { cell += '"'; i++; }
                else inQuotes = false;
            } else cell += ch;
        } else if (ch === '"') {
            inQuotes = true;
        } else if (ch === delimiter) {
            row.push(cell); cell = "";
        } else if (ch === "\n" || ch === "\r") {
            if (ch === "\r" && text[i + 1] === "\n") i++;
            row.push(cell); cell = "";
            if (row.some((c) => c.trim() !== "")) rows.push(row);
            row = [];
        } else cell += ch;
    }
    row.push(cell);
    if (row.some((c) => c.trim() !== "")) rows.push(row);
    return rows;
}

/** 解析表格格式（CSV/TSV）为导入记录；首行若为表头则自动映射列。 */
export function parseTableImport(text: string): ImportedRecord[] {
    const delimiter: "," | "\t" = text.includes("\t") ? "\t" : ",";
    const rows = parseDelimitedTable(text, delimiter);
    if (rows.length === 0) return [];
    const header = rows[0].map((h) => h.trim());
    const hasHeader = /内容|正文|消息|text|content|记录|日期|时间|标签|tag/i.test(header.join(","));
    const contentIdx = hasHeader ? header.findIndex((h) => /内容|正文|消息|text|content|记录/i.test(h)) : 0;
    const dateIdx = hasHeader ? header.findIndex((h) => /日期|时间|date|time/i.test(h)) : 1;
    const tagIdx = hasHeader ? header.findIndex((h) => /标签|tag/i.test(h)) : -1;
    const body = hasHeader ? rows.slice(1) : rows;
    const records: ImportedRecord[] = [];
    for (const row of body) {
        if (row.length === 0) continue;
        const content = (row[contentIdx] ?? row[0] ?? "").trim();
        if (!content) continue;
        records.push({
            content,
            eventDate: dateIdx >= 0 ? normalizeDate(row[dateIdx]) : undefined,
            tags: tagIdx >= 0 ? row[tagIdx].split(/[,，;；]/).map((t) => t.trim()).filter(Boolean) : [],
        });
    }
    return records;
}

function normalizeDate(value: string | undefined): string | undefined {
    if (!value) return undefined;
    const m = value.match(/(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?/);
    if (!m) return undefined;
    const pad = (n: string) => n.padStart(2, "0");
    return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
}

/** 把导入记录转为记忆条目（不落库，供 UI 预览 / 确认）。 */
export function recordsToEntries(characterId: string, records: ImportedRecord[]): LoverMemoryEntry[] {
    const now = new Date().toISOString();
    return records.map((r, i) => {
        const eventDate = r.eventDate || now.slice(0, 10);
        return {
            id: `lm_import_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`,
            characterId,
            content: r.content,
            eventDate,
            createdAt: now,
            updatedAt: now,
            tags: r.tags,
            pinned: false,
            source: "import" as const,
            importance: 0.6,
        };
    });
}

// ── 导出 ──

export function buildLoverMemoryExportJson(entries: LoverMemoryEntry[], archives: LoverMemoryArchive[]): string {
    return JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), entries, archives }, null, 2);
}

export function buildLoverMemoryExportCsv(entries: LoverMemoryEntry[]): string {
    const esc = (v: string) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = ["日期,标签,置顶,原文,摘要"];
    for (const e of entries) {
        lines.push([e.eventDate.slice(0, 10), e.tags.join(";"), e.pinned ? "是" : "否", e.content, e.summary ?? ""].map(esc).join(","));
    }
    return lines.join("\n");
}

// ── 定时自动备份快照 ──

export async function saveLoverMemoryBackupSnapshot(snapshot: LoverMemoryBackupSnapshot): Promise<void> {
    await runWrite(BACKUP_STORE, (store) => store.put(snapshot));
}

export async function loadLoverMemoryBackupSnapshots(characterId = ""): Promise<LoverMemoryBackupSnapshot[]> {
    const all = await readAll<LoverMemoryBackupSnapshot>(BACKUP_STORE);
    const list = all.filter((s) => s.characterId === characterId);
    list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return list;
}

export async function deleteLoverMemoryBackupSnapshots(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await runWrite(BACKUP_STORE, (store) => {
        for (const id of ids) store.delete(id);
    });
}

/** 生成一份快照（不落库），返回其 JSON 串。 */
export function buildLoverMemoryBackupSnapshotPayload(entries: LoverMemoryEntry[], archives: LoverMemoryArchive[]): string {
    return buildLoverMemoryExportJson(entries, archives);
}
