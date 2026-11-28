// lib/portable/types.ts
// 「一键搬家」全量备份格式定义。
//
// 这份格式刻意独立于 lib/data-management 的模块化备份：
// - data-management 按业务模块挑选数据，适合日常增量备份；
// - portable 直接按「数据库 / 对象仓库 / 键值」原样搬运，适合换机、换浏览器、
//   换部署后的整机迁移，不依赖任何业务代码是否记得登记某个 key。
//
// 兼容性约定：
//   1. 文件顶层必须有 format + version，导入时先校验再动手；
//   2. 所有数据放在 data 下，checksum 覆盖 data 的规范化 JSON 字符串；
//   3. 新增字段一律可选，旧版本导入器遇到未知字段直接忽略。

export const PORTABLE_BACKUP_FORMAT = "ai-phone-portable-backup";
export const PORTABLE_BACKUP_VERSION = 1;

/** 对象仓库里的一条记录。in-line key 的仓库 value 自带主键，out-of-line 的才有 key。 */
export type PortableIdbRecord = {
    key?: unknown;
    value: unknown;
};

export type PortableIdbIndex = {
    name: string;
    keyPath: string | string[];
    unique: boolean;
    multiEntry: boolean;
};

export type PortableIdbStore = {
    name: string;
    keyPath: string | string[] | null;
    autoIncrement: boolean;
    indexes: PortableIdbIndex[];
    records: PortableIdbRecord[];
};

export type PortableIdbDatabase = {
    name: string;
    version: number;
    stores: PortableIdbStore[];
};

export type PortableKvRecord = {
    key: string;
    value: string;
};

export type PortableBackupData = {
    databases: PortableIdbDatabase[];
    kv: PortableKvRecord[];
    localStorage: Record<string, string>;
};

export type PortableBackupSummary = {
    databases: number;
    stores: number;
    records: number;
    kvKeys: number;
    localStorageKeys: number;
    bytes: number;
};

export type PortableBackup = {
    format: typeof PORTABLE_BACKUP_FORMAT;
    version: number;
    createdAt: string;
    origin: string;
    appVersion?: string;
    /** 设备/浏览器标识，仅用于展示，不参与校验。 */
    device?: string;
    checksum: string;
    summary: PortableBackupSummary;
    data: PortableBackupData;
};

export type PortableImportPhase =
    | "read"
    | "parse"
    | "verify"
    | "clear"
    | "write"
    | "kv"
    | "localStorage"
    | "done";

export type PortableImportProgress = {
    phase: PortableImportPhase;
    percent: number;
    detail: string;
};

export type PortableImportResult = {
    databases: number;
    stores: number;
    records: number;
    kvKeys: number;
    localStorageKeys: number;
    errors: string[];
};

export type LegacyBackupKind = "whale" | "unknown";

export type LegacyBackupPreview = {
    kind: LegacyBackupKind;
    app?: string;
    exportedAt?: string;
    characters: number;
    messages: number;
    sessions: number;
    memories: number;
    worldBooks: number;
    apiConfigs: number;
    rawBytes: number;
};

export type LegacyImportResult = {
    characters: number;
    contacts: number;
    sessions: number;
    messages: number;
    memories: number;
    apiConfigs: number;
    skipped: string[];
    errors: string[];
};
