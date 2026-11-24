import JSZip from "jszip";
import type {
  BackupEnvelope,
  BackupManifest,
  DataModuleId,
  ImportResult,
  ModulePayload,
  SourceBackup,
  StoreBackup,
  StoreIndexBackup,
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
  { id: "worldbook", label: "世界书", description: "世界观设定与世界分组", moduleIds: ["social", "settings"] },
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

/**
 * 世界书分类的兼容筛选：旧版 ai-phone-backup 里的「世界书」是 social 模块下
 * ai_phone_character_worlds_v1 / ai_phone_character_world_layout_v1 两个 KV 键；
 * 真正的世界书配置（WorldBookConfig）则存在 settings 模块的 AiPhoneSettingsDB.worldBooks。
 * 这里两者都认，其它社交/设置数据一律不混入。
 */
function sourcesForCategory(envelope: BackupEnvelope, categoryId: MoveInCategoryId): SourceBackup[] {
  const definition = MOVE_IN_CATEGORIES.find((category) => category.id === categoryId);
  if (!definition) return [];
  const moduleIds = new Set(definition.moduleIds);
  const result: SourceBackup[] = [];
  for (const module of envelope.modules) {
    if (!moduleIds.has(module.moduleId)) continue;
    for (const source of module.sources) {
      if (categoryId === "worldbook") {
        if (source.type === "kv") {
          if (source.records.some((record) => WORLDBOOK_KEYS.includes(record.key))) {
            result.push({ ...source, records: source.records.filter((record) => WORLDBOOK_KEYS.includes(record.key)) });
          }
        } else if (source.type === "indexeddb" && source.dbName === "AiPhoneSettingsDB") {
          const stores = source.stores.filter((store) => store.name === "worldBooks");
          if (stores.length > 0) result.push({ ...source, stores });
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

// ── 兼容识别：鲸鱼机（littlephone）备份 ──────────────────────────
// 鲸鱼机导出的是纯 JSON（顶层 app === "littlephone"），字段与笨笨机差异较大。
// 这里把它的角色/世界书/聊天记录/长期记忆映射成笨笨机的 SourceBackup，
// 复用 importSource 的合并语义导入；用户设定因结构差异过大暂不映射。

type LittlephoneFriend = {
  id?: string;
  name?: string;
  avatar?: string;
  avatarImage?: string;
  remark?: string;
  role?: string;
};

type LittlephoneWorldBook = {
  id?: string;
  name?: string;
  content?: string;
  global?: boolean;
  keywords?: string[];
};

type LittlephoneMemory = {
  id?: string;
  friendId?: string;
  content?: string;
  importance?: number;
  isCore?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

type LittlephoneMessage = {
  id?: string;
  type?: string;
  content?: string;
  timestamp?: string;
};

type LittlephoneBackup = {
  app?: unknown;
  exportedAt?: string;
  friends?: unknown;
  worldBooks?: unknown;
  memories?: unknown;
  messages?: unknown;
  apiSettings?: unknown;
};

function isLittlephoneBackup(value: unknown): value is LittlephoneBackup {
  if (!value || typeof value !== "object") return false;
  return (value as { app?: unknown }).app === "littlephone";
}

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function validAvatar(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("data:") || trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  return null;
}

function buildChatStores(backup: LittlephoneBackup, exportedAt: string): StoreBackup[] | null {
  const friends = Array.isArray(backup.friends) ? backup.friends.filter((item): item is LittlephoneFriend => !!item && typeof item === "object") : [];
  const groups = Array.isArray(backup.messages) ? backup.messages.filter((item): item is { friendId?: unknown; messages?: unknown } => !!item && typeof item === "object") : [];

  const friendIds = new Set<string>();
  for (const friend of friends) if (typeof friend.id === "string") friendIds.add(friend.id);
  for (const group of groups) if (typeof group.friendId === "string") friendIds.add(group.friendId);
  if (friendIds.size === 0) return null;

  const contacts: StoreBackup["records"] = [];
  const sessions: StoreBackup["records"] = [];
  const messages: StoreBackup["records"] = [];

  for (const friendId of friendIds) {
    const friend = friends.find((item) => item.id === friendId);
    const remark = typeof friend?.remark === "string" && friend.remark ? friend.remark : "";
    const name = typeof friend?.name === "string" ? friend.name : "";
    const nickname = (remark || name) || undefined;
    const sessionId = `session_${friendId}`;
    contacts.push({
      value: { id: friendId, characterId: friendId, nickname, addedAt: exportedAt },
    });
    sessions.push({
      value: { id: sessionId, characterId: friendId, contactId: friendId, unreadCount: 0, updatedAt: exportedAt, isPinned: false },
    });

    const group = groups.find((item) => item.friendId === friendId);
    const groupMessages = Array.isArray(group?.messages) ? group.messages.filter((item): item is LittlephoneMessage => !!item && typeof item === "object") : [];
    for (const message of groupMessages) {
      const content = typeof message.content === "string" ? message.content : "";
      if (!content) continue;
      const role = message.type === "received" ? "assistant" : message.type === "system" ? "system" : "user";
      messages.push({
        value: {
          id: typeof message.id === "string" ? message.id : generateId("msg"),
          sessionId,
          role,
          content,
          status: "sent",
          createdAt: typeof message.timestamp === "string" ? message.timestamp : exportedAt,
        },
      });
    }
  }

  return [
    {
      name: "contacts",
      keyPath: "id",
      autoIncrement: false,
      indexes: [{ name: "characterId", keyPath: "characterId", unique: false, multiEntry: false }],
      records: contacts,
    },
    {
      name: "sessions",
      keyPath: "id",
      autoIncrement: false,
      indexes: [{ name: "contactId", keyPath: "contactId", unique: false, multiEntry: false }],
      records: sessions,
    },
    {
      name: "messages",
      keyPath: "id",
      autoIncrement: false,
      indexes: [
        { name: "sessionId", keyPath: "sessionId", unique: false, multiEntry: false },
        { name: "createdAt", keyPath: "createdAt", unique: false, multiEntry: false },
      ],
      records: messages,
    },
  ];
}

function buildMemoryStore(backup: LittlephoneBackup, exportedAt: string): StoreBackup | null {
  const memories = Array.isArray(backup.memories) ? backup.memories.filter((item): item is LittlephoneMemory => !!item && typeof item === "object") : [];
  const records: StoreBackup["records"] = [];
  for (const memory of memories) {
    const characterId = typeof memory.friendId === "string" ? memory.friendId : "";
    const content = typeof memory.content === "string" ? memory.content : "";
    if (!characterId || !content) continue;
    records.push({
      value: {
        id: typeof memory.id === "string" ? memory.id : generateId("mem"),
        characterId,
        sourceApp: "chat",
        type: memory.isCore ? "core" : "long_term",
        content,
        importance: typeof memory.importance === "number" ? memory.importance : 0.5,
        createdAt: typeof memory.createdAt === "string" ? memory.createdAt : exportedAt,
        updatedAt: typeof memory.updatedAt === "string" ? memory.updatedAt : exportedAt,
      },
    });
  }
  if (records.length === 0) return null;
  const indexes: StoreIndexBackup[] = [
    { name: "by_character", keyPath: "characterId", unique: false, multiEntry: false },
    { name: "by_character_type", keyPath: ["characterId", "type"], unique: false, multiEntry: false },
    { name: "by_character_created", keyPath: ["characterId", "createdAt"], unique: false, multiEntry: false },
  ];
  return { name: "memories", keyPath: "id", autoIncrement: false, indexes, records };
}

function buildWorldBookStore(backup: LittlephoneBackup, exportedAt: string): StoreBackup | null {
  const worldBooks = Array.isArray(backup.worldBooks) ? backup.worldBooks.filter((item): item is LittlephoneWorldBook => !!item && typeof item === "object") : [];
  const records: StoreBackup["records"] = [];
  const createdAt = Date.parse(exportedAt) || Date.now();
  worldBooks.forEach((book, index) => {
    const content = typeof book.content === "string" ? book.content : "";
    if (!content) return;
    const id = typeof book.id === "string" && book.id ? book.id : generateId("wb");
    const name = typeof book.name === "string" && book.name ? book.name : "未命名世界书";
    const keywords = Array.isArray(book.keywords) ? book.keywords.filter((item): item is string => typeof item === "string") : [];
    records.push({
      value: {
        id,
        name,
        description: "",
        createdAt,
        updatedAt: createdAt,
        entries: [
          {
            uid: `wb-entry_${id}`,
            key: keywords.length > 0 ? keywords.join(",") : name,
            content,
            comment: "",
            use_regex: false,
            disable: false,
            constant: Boolean(book.global),
            position: "before_char",
            insertion_order: index,
          },
        ],
      },
    });
  });
  if (records.length === 0) return null;
  return { name: "worldBooks", keyPath: "id", autoIncrement: false, records };
}

function buildApiConfigRecords(backup: LittlephoneBackup): { key: string; value: string }[] | null {
  if (!Array.isArray(backup.apiSettings)) return null;
  const main = backup.apiSettings.find((item): item is { id?: string; configs?: unknown } => !!item && typeof item === "object");
  const configs = main?.configs;
  if (!configs || typeof configs !== "object") return null;
  const chat = (configs as Record<string, unknown>).chat;
  if (!chat || typeof chat !== "object") return null;
  const c = chat as Record<string, unknown>;
  const url = typeof c.url === "string" ? c.url : "";
  const key = typeof c.key === "string" ? c.key : "";
  const model = typeof c.model === "string" ? c.model : "";
  if (!url && !key && !model) return null;
  // 鲸鱼机的聊天接口是 OpenAI 兼容中转，映射成一条可用的 ApiConfig。
  const apiConfig = {
    id: generateId("api"),
    name: "鲸鱼机导入的聊天 API",
    provider: "openai",
    apiKey: key,
    baseUrl: url || undefined,
    defaultModel: model || "gpt-4o-mini",
    enableNativeTools: false,
    enableImageRecognition: true,
    enableImageGeneration: false,
    preventEmptyGenerateRambling: true,
  };
  return [{ key: "ai_phone_api_configs_v1", value: JSON.stringify([apiConfig]) }];
}

function convertLittlephoneBackup(backup: LittlephoneBackup): BackupEnvelope {
  const exportedAt = typeof backup.exportedAt === "string" ? backup.exportedAt : new Date().toISOString();
  const modules: ModulePayload[] = [];

  // 角色人设 → KV ai_phone_characters_v1
  const friends = Array.isArray(backup.friends) ? backup.friends.filter((item): item is LittlephoneFriend => !!item && typeof item === "object") : [];
  const characters = friends
    .filter((friend): friend is LittlephoneFriend & { id: string } => typeof friend.id === "string")
    .map((friend) => ({
      id: friend.id,
      name: typeof friend.name === "string" && friend.name ? friend.name : friend.id,
      avatar: validAvatar(friend.avatarImage) ?? validAvatar(friend.avatar),
      persona: typeof friend.role === "string" ? friend.role : "",
      createdAt: exportedAt,
      updatedAt: exportedAt,
    }));
  if (characters.length > 0) {
    modules.push({
      moduleId: "characters",
      sources: [{ type: "kv", records: [{ key: "ai_phone_characters_v1", value: JSON.stringify(characters) }] }],
    });
  }

  // 聊天记录 → AiPhoneChatDB
  const chatStores = buildChatStores(backup, exportedAt);
  if (chatStores) {
    modules.push({ moduleId: "chat", sources: [{ type: "indexeddb", dbName: "AiPhoneChatDB", stores: chatStores }] });
  }

  // 长期记忆 → ai_phone_memory_db_v1
  const memoryStore = buildMemoryStore(backup, exportedAt);
  if (memoryStore) {
    modules.push({ moduleId: "memory", sources: [{ type: "indexeddb", dbName: "ai_phone_memory_db_v1", stores: [memoryStore] }] });
  }

  // 用户设定：世界书（worldbook 分类取）+ 聊天 API 配置（settings 分类取）
  const settingsSources: SourceBackup[] = [];
  const worldBookStore = buildWorldBookStore(backup, exportedAt);
  if (worldBookStore) {
    settingsSources.push({ type: "indexeddb", dbName: "AiPhoneSettingsDB", stores: [worldBookStore] });
  }
  const apiConfigRecords = buildApiConfigRecords(backup);
  if (apiConfigRecords) {
    settingsSources.push({ type: "kv", records: apiConfigRecords });
  }
  if (settingsSources.length > 0) {
    modules.push({ moduleId: "settings", sources: settingsSources });
  }

  if (modules.length === 0) throw new Error("备份文件中没有可导入的数据模块");
  const manifest = synthesizeManifest(modules);
  manifest.createdAt = exportedAt;
  return { manifest, modules };
}

function normalizeJsonEnvelope(value: unknown): BackupEnvelope {
  if (isLittlephoneBackup(value)) {
    return convertLittlephoneBackup(value);
  }
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
