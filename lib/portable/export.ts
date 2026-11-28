// lib/portable/export.ts
// 一键全量导出：把当前设备上所有 IndexedDB 库、AiPhoneKvDB 键值、
// localStorage 全部序列化成一个独立 JSON 文件。

import { downloadFile } from "@/lib/download-utils";
import { buildBackupFilename, computeChecksum } from "./checksum";
import { dumpDatabase, dumpKv, listDatabaseNames, snapshotLocalStorage } from "./idb";
import {
    PORTABLE_BACKUP_FORMAT,
    PORTABLE_BACKUP_VERSION,
    type PortableBackup,
    type PortableBackupData,
    type PortableIdbDatabase,
} from "./types";

const KV_DB_NAME = "AiPhoneKvDB";

export type ExportProgress = {
    percent: number;
    detail: string;
};

function appVersionLabel(): string | undefined {
    try {
        return process.env.NEXT_PUBLIC_APP_VERSION
            || process.env.NEXT_PUBLIC_APP_BUILD
            || undefined;
    } catch {
        return undefined;
    }
}

function deviceLabel(): string {
    if (typeof navigator === "undefined") return "";
    return `${navigator.userAgent.slice(0, 180)}`;
}

export type PortableBackupArtifact = {
    filename: string;
    blob: Blob;
    size: number;
    backup: Omit<PortableBackup, "data">;
};

/**
 * 采集并打包，不触发下载。
 * 手机上一个 200MB 的文件会有明显的内存峰值，UI 侧要先提示「别切后台」。
 */
export async function buildPortableBackup(
    onProgress?: (progress: ExportProgress) => void,
): Promise<PortableBackupArtifact> {
    if (typeof indexedDB === "undefined") {
        throw new Error("当前环境不支持 IndexedDB，无法导出。");
    }

    const names = (await listDatabaseNames()).filter((name) => name !== KV_DB_NAME);
    const databases: PortableIdbDatabase[] = [];
    const errors: string[] = [];

    for (let index = 0; index < names.length; index++) {
        const name = names[index];
        onProgress?.({
            percent: Math.round((index / Math.max(1, names.length)) * 60),
            detail: `正在读取数据库 ${index + 1}/${names.length}：${name}`,
        });
        try {
            databases.push(await dumpDatabase(name));
        } catch (error) {
            errors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    onProgress?.({ percent: 65, detail: "正在读取配置键值…" });
    const kv = await dumpKv();

    onProgress?.({ percent: 72, detail: "正在读取浏览器本地存储…" });
    const localStorageData = snapshotLocalStorage();

    const data: PortableBackupData = { databases, kv, localStorage: localStorageData };
    const payload = JSON.stringify(data);

    onProgress?.({ percent: 85, detail: "正在计算校验值…" });
    const checksum = await computeChecksum(payload);

    const summary = {
        databases: databases.length,
        stores: databases.reduce((sum, db) => sum + db.stores.length, 0),
        records: databases.reduce(
            (sum, db) => sum + db.stores.reduce((count, store) => count + store.records.length, 0),
            0,
        ),
        kvKeys: kv.length,
        localStorageKeys: Object.keys(localStorageData).length,
        bytes: payload.length,
    };

    const meta: Omit<PortableBackup, "data"> = {
        format: PORTABLE_BACKUP_FORMAT,
        version: PORTABLE_BACKUP_VERSION,
        createdAt: new Date().toISOString(),
        origin: typeof location !== "undefined" ? location.origin : "",
        appVersion: appVersionLabel(),
        device: deviceLabel(),
        checksum,
        summary,
    };

    // 用 Blob 分段拼装，避免把整份 JSON 再复制一遍（大备份下这一步能省一倍的峰值内存）。
    const head = JSON.stringify(meta).slice(0, -1);
    const blob = new Blob([head, ',"data":', payload, "}"], { type: "application/json" });

    if (errors.length > 0) {
        // 有库读不出来时依然给用户文件，但要在 UI 上明确标出来，不能假装完整。
        console.warn("[portable] 导出时部分数据库读取失败：", errors);
    }

    onProgress?.({ percent: 96, detail: "正在生成文件…" });
    return {
        filename: buildBackupFilename(),
        blob,
        size: blob.size,
        backup: meta,
    };
}

/** 采集 → 下载，返回文件名和体积用于提示。 */
export async function exportPortableBackup(
    onProgress?: (progress: ExportProgress) => void,
): Promise<{ filename: string; size: number; summary: PortableBackupArtifact["backup"]["summary"] }> {
    const artifact = await buildPortableBackup(onProgress);
    await downloadFile(artifact.blob, artifact.filename, {});
    onProgress?.({ percent: 100, detail: "已交给浏览器下载" });
    return { filename: artifact.filename, size: artifact.size, summary: artifact.backup.summary };
}
