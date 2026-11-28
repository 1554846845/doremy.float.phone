// lib/portable/idb.ts
// 裸 IndexedDB 搬运层：不经过任何业务封装，直接把「数据库 → 对象仓库 → 记录」
// 原样读出来 / 写回去。这样即使某个功能忘了把自己的表登记进 data-management
// 的模块清单，一键搬家也不会漏掉它。

import { DATA_MODULES } from "@/lib/data-management/modules";
import type { PortableIdbDatabase, PortableIdbStore } from "./types";

const KV_DB_NAME = "AiPhoneKvDB";

/** 已知数据库名的兜底清单（浏览器不支持 indexedDB.databases() 时使用）。 */
export function knownDatabaseNames(): string[] {
    const names = new Set<string>([KV_DB_NAME]);
    for (const module of DATA_MODULES) {
        for (const source of module.sources) {
            if (source.type === "indexeddb") names.add(source.dbName);
        }
    }
    // 后加的能力不一定已经写进模块清单，这里补上关键库。
    names.add("ai_phone_memory_db_v1");
    names.add("ai_phone_memory_vault_v1");
    names.add("ai_phone_theme_db_v1");
    names.add("AiPhoneSettingsDB");
    return Array.from(names);
}

export async function listDatabaseNames(): Promise<string[]> {
    if (typeof indexedDB === "undefined") return [];
    const factory = indexedDB as unknown as {
        databases?: () => Promise<Array<{ name?: string }>>;
    };
    if (typeof factory.databases === "function") {
        try {
            const infos = await factory.databases();
            const names = infos
                .map((info) => info.name)
                .filter((name): name is string => typeof name === "string" && name.length > 0);
            if (names.length > 0) return names.sort();
        } catch {
            // 隐私模式等场景会直接抛错，退回已知清单。
        }
    }
    return knownDatabaseNames().sort();
}

/** 不指定版本打开（不存在就按 1 创建），用于探测现状。 */
export function openDatabase(name: string, version?: number): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        let request: IDBOpenDBRequest;
        try {
            request = version ? indexedDB.open(name, version) : indexedDB.open(name);
        } catch (error) {
            reject(error);
            return;
        }
        request.onupgradeneeded = () => {
            // 交给调用方在 reopen 时建表；这里不做任何事。
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error(`打开数据库失败：${name}`));
        request.onblocked = () => reject(new Error(`数据库被其他页面占用，请关闭其他标签页后重试：${name}`));
    });
}

function readAllRecords(store: IDBObjectStore): Promise<Array<{ key?: unknown; value: unknown }>> {
    return new Promise((resolve, reject) => {
        const records: Array<{ key?: unknown; value: unknown }> = [];
        const request = store.openCursor();
        request.onerror = () => reject(request.error ?? new Error("读取记录失败"));
        request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) {
                resolve(records);
                return;
            }
            const inline = store.keyPath !== null;
            records.push(inline ? { value: cursor.value } : { key: cursor.primaryKey, value: cursor.value });
            cursor.continue();
        };
    });
}

function readStoreMeta(store: IDBObjectStore): PortableIdbStore {
    const indexes = Array.from(store.indexNames).map((name) => {
        const index = store.index(name);
        return {
            name: index.name,
            keyPath: index.keyPath as string | string[],
            unique: index.unique,
            multiEntry: index.multiEntry,
        };
    });
    return {
        name: store.name,
        keyPath: store.keyPath as string | string[] | null,
        autoIncrement: store.autoIncrement,
        indexes,
        records: [],
    };
}

export async function dumpDatabase(name: string): Promise<PortableIdbDatabase> {
    const db = await openDatabase(name);
    try {
        const stores: PortableIdbStore[] = [];
        for (const storeName of Array.from(db.objectStoreNames)) {
            const tx = db.transaction(storeName, "readonly");
            const store = tx.objectStore(storeName);
            const meta = readStoreMeta(store);
            meta.records = await readAllRecords(store);
            // 媒体缓存存的是 Blob，必须编码后才能进 JSON。
            meta.records = await Promise.all(meta.records.map(async (record) => ({
                ...record,
                value: await encodeValue(record.value),
            })));
            stores.push(meta);
        }
        return { name, version: db.version, stores };
    } finally {
        db.close();
    }
}

/** 读 AiPhoneKvDB 的 entries，作为备份里的 kv 段（不重复塞进 databases）。 */
export async function dumpKv(): Promise<Array<{ key: string; value: string }>> {
    try {
        const db = await openDatabase(KV_DB_NAME);
        try {
            if (!db.objectStoreNames.contains("entries")) return [];
            const tx = db.transaction("entries", "readonly");
            const rows = await readAllRecords(tx.objectStore("entries"));
            return rows
                .map((row) => row.value as { key?: unknown; value?: unknown })
                .filter((row) => typeof row?.key === "string" && typeof row?.value === "string")
                .map((row) => ({ key: row.key as string, value: row.value as string }));
        } finally {
            db.close();
        }
    } catch {
        return [];
    }
}

function createStoreTree(db: IDBDatabase, tx: IDBTransaction | null, store: PortableIdbStore): void {
    let target: IDBObjectStore;
    if (!db.objectStoreNames.contains(store.name)) {
        target = db.createObjectStore(store.name, {
            keyPath: store.keyPath ?? undefined,
            autoIncrement: store.autoIncrement,
        });
    } else if (tx) {
        target = tx.objectStore(store.name);
    } else {
        return;
    }
    for (const index of store.indexes ?? []) {
        if (target.indexNames.contains(index.name)) continue;
        try {
            target.createIndex(index.name, index.keyPath, {
                unique: index.unique,
                multiEntry: index.multiEntry,
            });
        } catch {
            // 已经存在同名索引或 keyPath 不合法时忽略，数据本身仍可写入。
        }
    }
}

/** 打开数据库并补齐备份里存在、但本地还没有的仓库与索引。 */
export async function ensureDatabase(database: PortableIdbDatabase): Promise<IDBDatabase> {
    let db = await openDatabase(database.name);
    const missingStores = database.stores.some((store) => !db.objectStoreNames.contains(store.name));
    const needVersionBump = database.version > db.version;
    if (!missingStores && !needVersionBump) return db;

    const nextVersion = Math.max(db.version, database.version) + (missingStores ? 1 : 0);
    db.close();
    db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(database.name, nextVersion);
        request.onupgradeneeded = () => {
            const tx = request.transaction;
            for (const store of database.stores) createStoreTree(request.result, tx ?? null, store);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error(`升级数据库失败：${database.name}`));
        request.onblocked = () => reject(new Error(`数据库被占用，无法升级：${database.name}`));
    });
    return db;
}

const WRITE_CHUNK = 400;

// IndexedDB 里允许直接存 Blob（媒体缓存就是这么做的），但 JSON.stringify 会把
// Blob 变成 `{}`——不处理的话「一键搬家」搬完图片全丢。这里用带标记的对象把
// Blob 编码成 base64，恢复时再还原成 Blob。
const BLOB_MARKER = "__aiPhoneBlobV1";

function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = String(reader.result ?? "");
            const comma = result.indexOf(",");
            resolve(comma >= 0 ? result.slice(comma + 1) : result);
        };
        reader.onerror = () => reject(reader.error ?? new Error("读取二进制数据失败"));
        reader.readAsDataURL(blob);
    });
}

function base64ToBlob(base64: string, mime: string): Blob {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) {
        bytes[index] = binary.charCodeAt(index);
    }
    return new Blob([bytes], { type: mime || "application/octet-stream" });
}

async function encodeValue(value: unknown, depth = 0): Promise<unknown> {
    if (depth > 6 || value === null || value === undefined) return value;
    if (typeof Blob !== "undefined" && value instanceof Blob) {
        try {
            return { [BLOB_MARKER]: true, type: value.type || "", data: await blobToBase64(value) };
        } catch (error) {
            console.warn("[portable] Blob 编码失败，已跳过该字段", error);
            return null;
        }
    }
    if (Array.isArray(value)) {
        return Promise.all(value.map((item) => encodeValue(item, depth + 1)));
    }
    if (typeof value === "object") {
        const proto = Object.getPrototypeOf(value);
        if (proto !== Object.prototype && proto !== null) return value; // Date/Map 等交给 JSON 自己处理
        const entries = await Promise.all(
            Object.entries(value as Record<string, unknown>)
                .map(async ([key, item]) => [key, await encodeValue(item, depth + 1)] as const),
        );
        return Object.fromEntries(entries);
    }
    return value;
}

function decodeValue(value: unknown, depth = 0): unknown {
    if (depth > 6 || value === null || value === undefined) return value;
    if (Array.isArray(value)) return value.map((item) => decodeValue(item, depth + 1));
    if (typeof value === "object") {
        const record = value as Record<string, unknown>;
        if (record[BLOB_MARKER] === true && typeof record.data === "string") {
            try {
                return base64ToBlob(record.data, typeof record.type === "string" ? record.type : "");
            } catch (error) {
                console.warn("[portable] Blob 还原失败，已改为空值", error);
                return null;
            }
        }
        const entries = Object.entries(record).map(([key, item]) => [key, decodeValue(item, depth + 1)] as const);
        return Object.fromEntries(entries);
    }
    return value;
}

/** 清空写入一个仓库；分块提交，避免单事务塞几万条把主线程卡死。 */
export async function replaceStoreRecords(
    db: IDBDatabase,
    store: PortableIdbStore,
    onChunk?: (written: number) => void,
): Promise<number> {
    if (!db.objectStoreNames.contains(store.name)) {
        throw new Error(`目标数据库缺少仓库：${store.name}`);
    }

    await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(store.name, "readwrite");
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error(`清空仓库失败：${store.name}`));
        tx.onabort = () => reject(tx.error ?? new Error(`清空仓库被中止：${store.name}`));
        tx.objectStore(store.name).clear();
    });

    let written = 0;
    for (let start = 0; start < store.records.length; start += WRITE_CHUNK) {
        const chunk = store.records.slice(start, start + WRITE_CHUNK);
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(store.name, "readwrite");
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error ?? new Error(`写入仓库失败：${store.name}`));
            tx.onabort = () => reject(tx.error ?? new Error(`写入仓库被中止：${store.name}`));
            const target = tx.objectStore(store.name);
            for (const record of chunk) {
                try {
                    const value = decodeValue(record.value);
                    if (store.keyPath === null) target.put(value as unknown, record.key as IDBValidKey);
                    else target.put(value as unknown);
                } catch (error) {
                    // 单条坏记录不能拖垮整次导入：跳过并继续写后面的。
                    console.warn("[portable] 跳过一条无法写入的记录", store.name, error);
                }
            }
        });
        written += chunk.length;
        onChunk?.(written);
        // 让出一帧，手机 WebView 才不会假死。
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return written;
}

/** 整库覆盖写入：补齐仓库 → 逐仓库清空 + 分块写入。 */
export async function restoreDatabase(
    database: PortableIdbDatabase,
    onProgress?: (written: number, total: number) => void,
): Promise<{ records: number; errors: string[] }> {
    const errors: string[] = [];
    const total = database.stores.reduce((sum, store) => sum + store.records.length, 0);
    let written = 0;
    const db = await ensureDatabase(database);
    try {
        for (const store of database.stores) {
            try {
                written += await replaceStoreRecords(db, store, (count) => {
                    onProgress?.(written + count, total);
                });
            } catch (error) {
                errors.push(`[${database.name}/${store.name}] ${error instanceof Error ? error.message : String(error)}`);
                written += store.records.length;
            }
        }
    } finally {
        db.close();
    }
    return { records: written, errors };
}

export async function restoreKv(records: Array<{ key: string; value: string }>): Promise<number> {
    if (records.length === 0) return 0;
    const db = await openDatabase(KV_DB_NAME, 1);
    try {
        const exists = db.objectStoreNames.contains("entries");
        if (!exists) {
            db.close();
            const upgraded = await openDatabase(KV_DB_NAME, Math.max(2, db.version + 1));
            upgraded.close();
            return restoreKv(records);
        }
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction("entries", "readwrite");
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error ?? new Error("清空 KV 失败"));
            tx.objectStore("entries").clear();
        });
        for (let start = 0; start < records.length; start += WRITE_CHUNK) {
            const chunk = records.slice(start, start + WRITE_CHUNK);
            await new Promise<void>((resolve, reject) => {
                const tx = db.transaction("entries", "readwrite");
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error ?? new Error("写入 KV 失败"));
                const store = tx.objectStore("entries");
                for (const record of chunk) store.put({ key: record.key, value: record.value });
            });
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
        return records.length;
    } finally {
        try { db.close(); } catch { /* ignore */ }
    }
}

export function snapshotLocalStorage(): Record<string, string> {
    const snapshot: Record<string, string> = {};
    try {
        for (let index = 0; index < localStorage.length; index++) {
            const key = localStorage.key(index);
            if (!key) continue;
            const value = localStorage.getItem(key);
            if (value !== null) snapshot[key] = value;
        }
    } catch (error) {
        console.warn("[portable] 读取 localStorage 失败", error);
    }
    return snapshot;
}

export function restoreLocalStorage(data: Record<string, string>): { written: number; errors: string[] } {
    const errors: string[] = [];
    let written = 0;
    try {
        const existing: string[] = [];
        for (let index = 0; index < localStorage.length; index++) {
            const key = localStorage.key(index);
            if (key) existing.push(key);
        }
        for (const key of existing) {
            try { localStorage.removeItem(key); } catch { /* ignore */ }
        }
    } catch (error) {
        errors.push(`清空 localStorage 失败：${error instanceof Error ? error.message : String(error)}`);
    }
    for (const [key, value] of Object.entries(data)) {
        try {
            localStorage.setItem(key, value);
            written++;
        } catch (error) {
            errors.push(`写入 localStorage 失败：${key}（${error instanceof Error ? error.message : String(error)}）`);
        }
    }
    return { written, errors };
}
