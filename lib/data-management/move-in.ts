import JSZip from "jszip";
import type {
  BackupEnvelope,
  BackupManifest,
  DataModuleId,
  ImportResult,
  ModulePayload,
  SourceBackup,
} from "./types";
import type { MediaResolver } from "./serializers";
import { importSource } from "./idb";
import { readBackupBlob } from "./backup";
import { sha256BlobHex } from "../sha256-stream";
import { loadCharacters } from "../character-storage";

/**
 * 「一键搬家」：从旧小手机导出的备份文件（.zip 或 .json）中，按用户关心的
 * 五大类（角色人设 / 世界书 / 聊天记录 / 长期记忆 / 用户设定）做识别、预览、
 * 兼容匹配与合并导入。导入走 importSource 的合并语义（列表型数据按 id 去重、
 * 同 id 以备份为准、本机独有数据保留），绝不覆盖清空现有数据。
 */

export type MoveInCategoryId = "characters" | "worldbook" | "chat" | "memory" | "settings";

export type MoveInCategory = {
  id: MoveInCategoryId;
  label: string;
  description: string;
  /** 该分类来自哪些整模块（worldbook 特殊：只取 social 模块里的世界书键，见 below） */
  moduleIds: DataModuleId[];
};

export const MOVE_IN_CATEGORIES: MoveInCategory[] = [
  { id: "characters", label: "角色人设", description: "角色卡与角色素材", moduleIds: ["characters"] },
  { id: "worldbook", label: "世界书", description: "世界观设定", moduleIds: ["social"] },
  { id: "chat", label: "聊天记录", description: "会话、消息与联系人", moduleIds: ["chat"] },
  { id: "memory", label: "长期记忆", description: "记忆库与恋人记忆", moduleIds: ["memory"] },
  { id: "settings", label: "用户设定", description: "API、预设、绑定与规则", moduleIds: ["settings"] },
];

const WORLDBOOK_KEYS = ["ai_phone_character_worlds_v1", "ai_phone_character_world_layout_v1"];

function countSourceRecords(source: SourceBackup): number {
  if (source.type === "indexeddb") {
    return source.stores.reduce((sum, store) => sum + store.records.length, 0);
  }
  return source.records.length;
}

/** 世界书只取 social 模块里的世界书键，不把朋友圈/小红书等社交数据一并搬进来 */
function worldbookOnlySource(source: SourceBackup): SourceBackup {
  if (source.type === "kv") {
    return { ...source, records: source.records.filter((record) => WORLDBOOK_KEYS.includes(record.key)) };
  }
  return source;
}

function sourcesForCategory(envelope: BackupEnvelope, categoryId: MoveInCategoryId): SourceBackup[] {
  const definition = MOVE_IN_CATEGORIES.find((category) => category.id === categoryId);
  if (!definition) return [];
  const moduleIds = new Set(definition.moduleIds);
  const result: SourceBackup[] = [];
  for (const module of envelope.modules) {
    if (!moduleIds.has(module.moduleId)) continue;
    for (const source of module.sources) {
      if (categoryId === "worldbook") {
        if (source.type === "kv" && source.records.some((record) => WORLDBOOK_KEYS.includes(record.key))) {
          result.push(worldbookOnlySource(source));
        }
        continue;
      }
      result.push(source);
    }
  }
  return result;
}

function extractCharacterSummaries(envelope: BackupEnvelope): Array<{ id: string; name: string }> {
  const result: Array<{ id: string; name: string }> = [];
  for (const module of envelope.modules) {
    if (module.moduleId !== "characters") continue;
    for (const source of module.sources) {
      if (source.type !== "kv") continue;
      for (const record of source.records) {
        if (record.key !== "ai_phone_characters_v1") continue;
        try {
          const parsed = JSON.parse(record.value) as unknown;
          if (!Array.isArray(parsed)) continue;
          for (const item of parsed) {
            if (item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string") {
              const character = item as { id: string; name?: unknown };
              result.push({
                id: character.id,
                name: typeof character.name === "string" ? character.name : character.id,
              });
            }
          }
        } catch {
          // 单条角色数据损坏不影响整体预览
        }
      }
    }
  }
  return result;
}

// ── 文件读取：自动识别 .zip 与 .json ──────────────────────────────

function isZipBytes(bytes: Uint8Array): boolean {
  // PK\x03\x04 / PK\x05\x06 / PK\x07\x08
  return bytes.length >= 4
    && bytes[0] === 0x50
    && bytes[1] === 0x4b
    && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07);
}

function isSourceBackupLike(value: unknown): value is SourceBackup {
  if (!value || typeof value !== "object") return false;
  const source = value as Partial<SourceBackup>;
  if (source.type === "kv" || source.type === "localStorage") {
    return Array.isArray(source.records);
  }
  return source.type === "indexeddb" && typeof source.dbName === "string" && Array.isArray(source.stores);
}

function isModulePayloadLike(value: unknown): value is ModulePayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<ModulePayload>;
  return typeof payload.moduleId === "string"
    && Array.isArray(payload.sources)
    && payload.sources.length > 0
    && payload.sources.every(isSourceBackupLike);
}

function isManifestLike(value: unknown): value is BackupManifest {
  if (!value || typeof value !== "object") return false;
  const manifest = value as Partial<BackupManifest>;
  return manifest.format === "ai-phone-backup"
    && typeof manifest.createdAt === "string"
    && Array.isArray(manifest.modules);
}

function synthesizeManifest(modules: ModulePayload[]): BackupManifest {
  let totalRecords = 0;
  const manifestModules = modules.map((module) => {
    const records = module.sources.reduce((sum, source) => sum + countSourceRecords(source), 0);
    totalRecords += records;
    return { id: module.moduleId, label: module.moduleId, records, bytes: 0 };
  });
  return {
    format: "ai-phone-backup",
    version: 1,
    createdAt: new Date().toISOString(),
    origin: "",
    modules: manifestModules,
    totalBytes: 0,
    totalRecords,
  };
}

function normalizeJsonEnvelope(value: unknown): BackupEnvelope {
  if (Array.isArray(value)) {
    const modules = value.filter(isModulePayloadLike);
    if (modules.length === 0) throw new Error("备份文件中没有可导入的数据模块");
    return { manifest: synthesizeManifest(modules), modules };
  }
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    if (Array.isArray(object.modules)) {
      const modules = object.modules.filter(isModulePayloadLike);
      if (modules.length === 0) throw new Error("备份文件中没有可导入的数据模块");
      const manifest = isManifestLike(object.manifest) ? object.manifest : synthesizeManifest(modules);
      return { manifest, modules };
    }
    if (isModulePayloadLike(object)) {
      const modules = [object];
      return { manifest: synthesizeManifest(modules), modules };
    }
  }
  throw new Error("无法识别的备份文件格式");
}

async function readMoveInEnvelope(file: File): Promise<{ envelope: BackupEnvelope; format: "zip" | "json" }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (isZipBytes(bytes)) {
    const envelope = await readBackupBlob(file);
    return { envelope, format: "zip" };
  }
  const text = new TextDecoder().decode(bytes);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("无法解析该 JSON 备份文件");
  }
  return { envelope: normalizeJsonEnvelope(value), format: "json" };
}

// ── 预览与导入 ──────────────────────────────

export type MoveInCategoryPreview = {
  id: MoveInCategoryId;
  label: string;
  description: string;
  records: number;
  present: boolean;
};

export type MoveInCharacterMatch = {
  id: string;
  name: string;
  matched: boolean;
};

export type MoveInPreview = {
  format: "zip" | "json";
  createdAt: string;
  totalRecords: number;
  categories: MoveInCategoryPreview[];
  characters: MoveInCharacterMatch[];
  matchedCharacterCount: number;
  newCharacterCount: number;
};

export async function inspectMoveIn(file: File): Promise<MoveInPreview> {
  const { envelope, format } = await readMoveInEnvelope(file);

  const categories: MoveInCategoryPreview[] = MOVE_IN_CATEGORIES.map((category) => {
    const sources = sourcesForCategory(envelope, category.id);
    const records = sources.reduce((sum, source) => sum + countSourceRecords(source), 0);
    return {
      id: category.id,
      label: category.label,
      description: category.description,
      records,
      present: records > 0,
    };
  });

  const backupCharacters = extractCharacterSummaries(envelope);
  const localIds = new Set(loadCharacters().map((character) => character.id));
  const characters: MoveInCharacterMatch[] = backupCharacters.map((character) => ({
    id: character.id,
    name: character.name,
    matched: localIds.has(character.id),
  }));

  return {
    format,
    createdAt: envelope.manifest.createdAt,
    totalRecords: categories.reduce((sum, category) => sum + category.records, 0),
    categories,
    characters,
    matchedCharacterCount: characters.filter((character) => character.matched).length,
    newCharacterCount: characters.length - characters.filter((character) => character.matched).length,
  };
}

export async function importMoveIn(file: File, categoryIds: MoveInCategoryId[]): Promise<ImportResult> {
  const { envelope, format } = await readMoveInEnvelope(file);
  const total: ImportResult = { added: 0, skipped: 0, overwritten: 0, errors: [] };

  const invalidMedia = new Set<string>();
  let resolver: MediaResolver | undefined;
  if (format === "zip") {
    const zip = await JSZip.loadAsync(file);
    resolver = async (ref) => {
      const mediaFile = zip.file(`media/${ref}.bin`);
      if (!mediaFile) {
        invalidMedia.add(ref);
        return null;
      }
      const media = await mediaFile.async("blob");
      if ((await sha256BlobHex(media)) !== ref) {
        invalidMedia.add(ref);
        return null;
      }
      return media;
    };
  }

  for (const categoryId of categoryIds) {
    for (const source of sourcesForCategory(envelope, categoryId)) {
      const result = await importSource(source, false, resolver);
      total.added += result.added;
      total.skipped += result.skipped;
      total.overwritten += result.overwritten;
      total.errors.push(...result.errors);
    }
  }

  if (invalidMedia.size > 0) {
    total.errors.push(`${invalidMedia.size} 个媒体对象缺失或损坏，部分图片/文件可能丢失`);
  }

  return total;
}
