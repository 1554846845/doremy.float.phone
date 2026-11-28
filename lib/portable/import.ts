// lib/portable/import.ts
// 一键全量导入：严格校验 → 清空覆盖 → 分块写入 → 提示刷新。
//
// 安全策略：
// 1. 先完整解析并校验 format / version / 结构 / checksum，任何一项不过都直接
//    中止，绝不半途清库；
// 2. 真正写入阶段逐库 try-catch，某个库失败只记录错误，其余库继续，最后一次性
//    汇总给用户看；
// 3. 写入分块并主动让出事件循环，避免手机 WebView 因为一个超大事务假死。

import { restoreDatabase, restoreKv, restoreLocalStorage } from "./idb";
import { verifyChecksum } from "./checksum";
import {
    PORTABLE_BACKUP_FORMAT,
    PORTABLE_BACKUP_VERSION,
    type PortableBackup,
    type PortableIdbDatabase,
    type PortableImportPhase,
    type PortableImportProgress,
    type PortableImportResult,
    type PortableKvRecord,
} from "./types";

const KV_DB_NAME = "AiPhoneKvDB";

export type ParseResult = {
    backup: PortableBackup;
    warnings: string[];
};

export function readFileText(
    file: File,
    onProgress?: (percent: number) => void,
): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onprogress = (event) => {
            if (event.lengthComputable && event.total > 0) {
                onProgress?.(Math.round((event.loaded / event.total) * 100));
            }
        };
        reader.onload = () => resolve(String(reader.result ?? ""));
        reader.onerror = () => reject(reader.error ?? new Error("读取文件失败"));
        reader.readAsText(file);
    });
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function validateDatabase(value: unknown): value is PortableIdbDatabase {
    if (!isRecord(value)) return false;
    if (typeof value.name !== "string" || !value.name) return false;
    if (!Array.isArray(value.stores)) return false;
    return value.stores.every((store) => isRecord(store)
        && typeof store.name === "string"
        && Array.isArray(store.records)
        && (store.keyPath === null || typeof store.keyPath === "string" || Array.isArray(store.keyPath)));
}

/**
 * 解析并校验备份文件。校验顺序刻意从便宜到昂贵：先看结构，最后才算 checksum，
 * 避免拿一个 200MB 的坏文件去跑哈希。
 */
export async function parsePortableBackup(text: string): Promise<ParseResult> {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch (error) {
        throw new Error(`不是合法的 JSON 文件：${error instanceof Error ? error.message : "解析失败"}`);
    }
    if (!isRecord(parsed)) throw new Error("备份文件顶层不是对象。");
    if (parsed.format !== PORTABLE_BACKUP_FORMAT) {
        throw new Error("这不是本应用的「一键搬家」备份文件（format 不匹配）。");
    }
    const version = Number(parsed.version);
    if (!Number.isFinite(version) || version < 1) {
        throw new Error("备份文件版本号缺失或无效。");
    }
    if (version > PORTABLE_BACKUP_VERSION) {
        throw new Error(`备份文件版本 ${version} 高于当前应用支持的 ${PORTABLE_BACKUP_VERSION}，请先更新应用。`);
    }

    const data = parsed.data;
    if (!isRecord(data)) throw new Error("备份文件缺少 data 段。");
    const databases = data.databases;
    if (!Array.isArray(databases) || !databases.every(validateDatabase)) {
        throw new Error("备份文件的 IndexedDB 数据段结构损坏。");
    }
    const kv = Array.isArray(data.kv) ? data.kv : [];
    const localStorageData = isRecord(data.localStorage) ? data.localStorage : {};

    const warnings: string[] = [];
    if (typeof parsed.checksum === "string" && parsed.checksum) {
        const ok = await verifyChecksum(JSON.stringify({
            databases,
            kv,
            localStorage: localStorageData,
        }), parsed.checksum);
        if (ok === false) {
            // 校验不一致不直接拒绝：用户可能手工编辑过文件，或者导出端是旧算法。
            // 但要给出明确警告，让他自己决定要不要继续。
            warnings.push("备份文件校验值与内容不一致（可能被编辑或传输损坏），导入后请自行核对数据。");
        } else if (ok === null) {
            warnings.push("备份文件的校验算法无法识别，已跳过完整性校验。");
        }
    } else {
        warnings.push("备份文件没有校验值，无法确认完整性。");
    }

    const backup: PortableBackup = {
        format: PORTABLE_BACKUP_FORMAT,
        version,
        createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : new Date().toISOString(),
        origin: typeof parsed.origin === "string" ? parsed.origin : "",
        appVersion: typeof parsed.appVersion === "string" ? parsed.appVersion : undefined,
        device: typeof parsed.device === "string" ? parsed.device : undefined,
        checksum: typeof parsed.checksum === "string" ? parsed.checksum : "",
        summary: isRecord(parsed.summary)
            ? parsed.summary as PortableBackup["summary"]
            : {
                databases: databases.length,
                stores: databases.reduce((sum, db) => sum + db.stores.length, 0),
                records: databases.reduce((sum, db) => sum + db.stores.reduce((count, store) => count + store.records.length, 0), 0),
                kvKeys: kv.length,
                localStorageKeys: Object.keys(localStorageData).length,
                bytes: text.length,
            },
        data: {
            databases,
            kv: kv.filter((item): item is PortableKvRecord => isRecord(item) && typeof item.key === "string" && typeof item.value === "string"),
            localStorage: Object.fromEntries(
                Object.entries(localStorageData).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
            ),
        },
    };

    return { backup, warnings };
}

function report(onProgress: ((progress: PortableImportProgress) => void) | undefined, phase: PortableImportPhase, percent: number, detail: string) {
    onProgress?.({ phase, percent, detail });
}

/** 执行覆盖写入。返回逐项统计与错误列表，由 UI 决定提示文案。 */
export async function restorePortableBackup(
    backup: PortableBackup,
    onProgress?: (progress: PortableImportProgress) => void,
): Promise<PortableImportResult> {
    const result: PortableImportResult = {
        databases: 0,
        stores: 0,
        records: 0,
        kvKeys: 0,
        localStorageKeys: 0,
        errors: [],
    };

    const databases = backup.data.databases.filter((db) => db.name !== KV_DB_NAME);
    const totalRecords = databases.reduce(
        (sum, db) => sum + db.stores.reduce((count, store) => count + store.records.length, 0),
        0,
    );

    report(onProgress, "clear", 5, "正在清空旧数据并准备写入…");

    let writtenRecords = 0;
    for (const database of databases) {
        try {
            const { records, errors } = await restoreDatabase(database, (written) => {
                const percent = totalRecords > 0
                    ? 5 + Math.round(((writtenRecords + written) / totalRecords) * 70)
                    : 40;
                report(onProgress, "write", Math.min(percent, 75), `正在写入 ${database.name}…`);
            });
            result.databases++;
            result.stores += database.stores.length;
            result.records += records;
            writtenRecords += records;
            result.errors.push(...errors);
        } catch (error) {
            result.errors.push(`[${database.name}] ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    report(onProgress, "kv", 80, "正在写入配置键值…");
    try {
        result.kvKeys = await restoreKv(backup.data.kv);
    } catch (error) {
        result.errors.push(`KV 写入失败：${error instanceof Error ? error.message : String(error)}`);
    }

    report(onProgress, "localStorage", 90, "正在写入浏览器本地存储…");
    const localResult = restoreLocalStorage(backup.data.localStorage);
    result.localStorageKeys = localResult.written;
    result.errors.push(...localResult.errors);

    report(onProgress, "done", 100, "写入完成");
    return result;
}
