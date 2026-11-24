// lib/lover-memory-xlsx.ts
// 表格（.xlsx）与「旧版软件导出格式」解析，统一转成 ImportedRecord。
// .xlsx 通过 JSZip 解包读取 sharedStrings + sheet，避免引入重型 xlsx 依赖。

import JSZip from "jszip";
import type { LoverMemoryEntry } from "./lover-memory-types";

export type ImportedRecord = {
    content: string;
    eventDate?: string;
    tags: string[];
    sender?: string;
};

export function normalizeDate(value: string | undefined): string | undefined {
    if (!value) return undefined;
    // 兼容 Excel 序列号日期（如 45292）→ 1900-01-01 起算
    const asNum = Number(value);
    if (!Number.isNaN(asNum) && value.trim() !== "" && !/[年月/\-:]/.test(value) && asNum > 20000 && asNum < 60000) {
        const ms = Math.round((asNum - 25569) * 86400 * 1000);
        const d = new Date(ms);
        if (!Number.isNaN(d.getTime())) {
            const pad = (n: number) => String(n).padStart(2, "0");
            return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        }
    }
    const m = value.match(/(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?/);
    if (!m) return undefined;
    const pad = (n: string) => n.padStart(2, "0");
    return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
}

/** 从二维表（含表头）转成导入记录；表头自动映射列。 */
export function rowsToImportedRecords(rows: string[][]): ImportedRecord[] {
    if (rows.length === 0) return [];
    const header = rows[0].map((h) => h.trim());
    const hasHeader = /内容|正文|消息|text|content|记录|日期|时间|标签|tag|发送人|昵称|名字/i.test(header.join(","));
    const contentIdx = hasHeader ? header.findIndex((h) => /内容|正文|消息|text|content|记录/i.test(h)) : 0;
    const dateIdx = hasHeader ? header.findIndex((h) => /日期|时间|date|time/i.test(h)) : 1;
    const tagIdx = hasHeader ? header.findIndex((h) => /标签|tag/i.test(h)) : -1;
    const senderIdx = hasHeader ? header.findIndex((h) => /发送人|昵称|名字|sender|name/i.test(h)) : -1;
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
            sender: senderIdx >= 0 ? row[senderIdx]?.trim() || undefined : undefined,
        });
    }
    return records;
}

// ── .xlsx 解析 ──

function parseXml(text: string): Document | null {
    try {
        return new DOMParser().parseFromString(text, "text/xml");
    } catch {
        return null;
    }
}

async function readZipText(zip: JSZip, path: string): Promise<string | null> {
    const file = zip.file(path);
    if (!file) return null;
    return file.async("string");
}

function xmlCells(root: Document, tag: string): Element[] {
    // 两种命名空间都兼容：前缀 c: 与默认命名空间。
    const byTag = Array.from(root.getElementsByTagName(tag));
    if (byTag.length > 0) return byTag;
    return Array.from(root.getElementsByTagNameNS("*", tag.split(":")[1] ?? tag));
}

/** 解析 .xlsx 为二维字符串表（首行为表头）。 */
export async function parseXlsxFile(file: Blob): Promise<string[][]> {
    const zip = await JSZip.loadAsync(file);

    // sharedStrings
    const sharedStrings: string[] = [];
    const ssXmlText = await readZipText(zip, "xl/sharedStrings.xml");
    if (ssXmlText) {
        const ssDoc = parseXml(ssXmlText);
        if (ssDoc) {
            for (const si of xmlCells(ssDoc, "si")) {
                // 富文本可能拆成多个 <t>
                const texts = xmlCells(si as unknown as Document, "t").map((t) => t.textContent ?? "").join("");
                sharedStrings.push(texts);
            }
        }
    }

    // 定位第一个工作表路径：workbook.xml -> rels -> sheetN.xml
    let sheetPath = "xl/worksheets/sheet1.xml";
    const wbXmlText = await readZipText(zip, "xl/workbook.xml");
    const relsText = await readZipText(zip, "xl/_rels/workbook.xml.rels");
    if (wbXmlText && relsText) {
        const wbDoc = parseXml(wbXmlText);
        const relsDoc = parseXml(relsText);
        const firstSheet = wbDoc ? xmlCells(wbDoc, "sheet")[0] : undefined;
        if (firstSheet) {
            const rid = firstSheet.getAttribute("r:id") || firstSheet.getAttribute("id");
            if (rid && relsDoc) {
                for (const rel of xmlCells(relsDoc, "Relationship")) {
                    if (rel.getAttribute("Id") === rid) {
                        const target = rel.getAttribute("Target") || "";
                        sheetPath = target.replace(/^\//, "").replace(/^xl\//, "xl/");
                        break;
                    }
                }
            }
        }
    }

    const rows: string[][] = [];
    const sheetText = await readZipText(zip, sheetPath);
    if (!sheetText) return rows;
    const sheetDoc = parseXml(sheetText);
    if (!sheetDoc) return rows;

    for (const rowEl of xmlCells(sheetDoc, "row")) {
        const cells: string[] = [];
        for (const c of xmlCells(rowEl as unknown as Document, "c")) {
            const t = c.getAttribute("t");
            const vEl = xmlCells(c as unknown as Document, "v")[0];
            const raw = vEl?.textContent ?? "";
            if (t === "s") {
                const idx = Number(raw);
                cells.push(Number.isFinite(idx) ? sharedStrings[idx] ?? "" : raw);
            } else if (t === "inlineStr") {
                const isEl = xmlCells(c as unknown as Document, "is")[0];
                const text = isEl ? xmlCells(isEl as unknown as Document, "t").map((x) => x.textContent ?? "").join("") : "";
                cells.push(text);
            } else {
                cells.push(raw);
            }
        }
        // 跳过空行
        if (cells.some((c) => c.trim() !== "")) rows.push(cells);
    }
    return rows;
}

/** 解析 .xlsx 为导入记录。 */
export async function parseXlsxImport(file: Blob): Promise<ImportedRecord[]> {
    const rows = await parseXlsxFile(file);
    return rowsToImportedRecords(rows);
}

// ── 旧版软件导出格式 ──

/**
 * 解析「旧版软件导出」的常见格式：
 * 1) JSON 数组：[{name,time,content} | {date,content} | {sender,content}]
 * 2) 微信/QQ 导出：每行「昵称 YYYY-MM-DD HH:mm:ss」后跟消息
 * 3) 制表/冒号分隔的对话文本
 * 兜底走文本行解析。
 */
export function parseLegacyExport(text: string): ImportedRecord[] {
    const trimmed = text.trim();
    if (!trimmed) return [];

    // 1) JSON
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
        try {
            const data = JSON.parse(trimmed) as unknown;
            const arr = Array.isArray(data) ? data : [data];
            const records: ImportedRecord[] = [];
            for (const item of arr) {
                if (!item || typeof item !== "object") continue;
                const o = item as Record<string, unknown>;
                const content = String(o.content ?? o.msg ?? o.message ?? o.text ?? o.正文 ?? o.消息 ?? "").trim();
                if (!content) continue;
                const dateVal = o.time ?? o.date ?? o.datetime ?? o.时间 ?? o.日期;
                const sender = String(o.name ?? o.sender ?? o.nickname ?? o.昵称 ?? "").trim();
                records.push({
                    content,
                    eventDate: normalizeDate(typeof dateVal === "number" ? String(dateVal) : String(dateVal ?? "")),
                    sender: sender || undefined,
                    tags: Array.isArray(o.tags) ? o.tags.map(String) : [],
                });
            }
            if (records.length > 0) return records;
        } catch {
            /* 不是合法 JSON，继续按文本解析 */
        }
    }

    // 2) 微信/QQ 导出：日期时间行或「昵称 2024-01-01 12:00:00」行
    const records: ImportedRecord[] = [];
    let currentDate: string | undefined;
    let currentSender: string | undefined;
    const lines = trimmed.split(/\r?\n/);
    const dateTimeRe = /(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?[ T]?(\d{1,2}):(\d{2})(?::(\d{2}))?/;
    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;
        const dt = line.match(dateTimeRe);
        if (dt) {
            const pad = (n: string) => n.padStart(2, "0");
            currentDate = `${dt[1]}-${pad(dt[2])}-${pad(dt[3])}`;
            // 形如「昵称 2024-01-01 12:00:00」：时间戳前是发送人
            const before = line.slice(0, dt.index).trim();
            if (before && before.length <= 20 && !/^\d/.test(before)) currentSender = before;
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
        } else if (currentDate) {
            records.push({ content: line, eventDate: currentDate, sender: currentSender, tags: [] });
        } else {
            records.push({ content: line, tags: [] });
        }
    }
    return records;
}

/** 旧版导出 + 表格记录统一转成记忆条目（供预览/落库）。 */
export function importedRecordsToEntries(characterId: string, records: ImportedRecord[], source: LoverMemoryEntry["source"] = "import"): LoverMemoryEntry[] {
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
            source,
            importance: 0.6,
        };
    });
}
