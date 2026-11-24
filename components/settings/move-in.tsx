"use client";

import { useRef, useState } from "react";
import {
  ArrowRight,
  Brain,
  CheckCircle2,
  FileArchive,
  FileJson,
  Globe,
  Loader2,
  MessageCircle,
  RefreshCw,
  Settings2,
  Sparkles,
  Upload,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import {
  MOVE_IN_CATEGORIES,
  importMoveIn,
  inspectMoveIn,
  type MoveInCategoryId,
  type MoveInPreview,
} from "@/lib/data-management/move-in";
import type { ImportResult } from "@/lib/data-management/types";

const CATEGORY_META: Record<MoveInCategoryId, { icon: LucideIcon; color: string }> = {
  characters: { icon: UserRound, color: "#8b6f52" },
  worldbook: { icon: Globe, color: "#3b82f6" },
  chat: { icon: MessageCircle, color: "#10b981" },
  memory: { icon: Brain, color: "#a855f7" },
  settings: { icon: Settings2, color: "#64748b" },
};

const STYLE = `
.mi-wrap { display:flex; flex-direction:column; gap:12px; }
.mi-hero { padding:16px; border-radius:16px; color:#fff; background:linear-gradient(135deg,#7c3aed,#4f46e5); }
.mi-hero h3 { margin:0 0 4px; font-size:15px; font-weight:700; }
.mi-hero p { margin:0; font-size:12px; opacity:.85; line-height:1.5; }
.mi-panel { border:1px solid var(--c-border,#eee); border-radius:14px; padding:12px; background:var(--c-bg-card,#fff); }
.mi-row { display:flex; align-items:center; gap:10px; }
.mi-file { display:flex; align-items:center; gap:10px; font-size:13px; color:var(--c-text,#222); }
.mi-muted { font-size:12px; color:var(--c-secondary,#888); }
.mi-cats { display:flex; flex-direction:column; gap:8px; margin-top:10px; }
.mi-cat { display:flex; align-items:center; gap:10px; padding:10px; border:1px solid var(--c-border,#eee); border-radius:12px; cursor:pointer; transition:border-color .15s, background .15s; }
.mi-cat[data-on="true"] { border-color:#7c3aed; background:rgba(124,58,237,.05); }
.mi-cat[data-on="false"] { opacity:.55; }
.mi-cat-icon { width:32px; height:32px; border-radius:9px; display:flex; align-items:center; justify-content:center; flex:none; }
.mi-cat-main { flex:1; min-width:0; }
.mi-cat-label { font-size:13px; font-weight:600; color:var(--c-text,#222); }
.mi-cat-desc { font-size:11px; color:var(--c-secondary,#888); }
.mi-cat-count { font-size:12px; font-weight:700; color:var(--c-text,#222); }
.mi-badge { display:inline-flex; align-items:center; gap:3px; font-size:11px; padding:2px 8px; border-radius:999px; }
.mi-badge-new { background:rgba(16,185,129,.14); color:#059669; }
.mi-badge-match { background:rgba(100,116,139,.14); color:#475569; }
.mi-chars { display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; }
.mi-actions { display:flex; gap:8px; margin-top:4px; }
.mi-btn { display:inline-flex; align-items:center; justify-content:center; gap:6px; border:none; border-radius:11px; padding:11px 14px; font-size:13px; font-weight:600; cursor:pointer; }
.mi-btn:disabled { opacity:.5; cursor:not-allowed; }
.mi-btn-primary { background:#7c3aed; color:#fff; }
.mi-btn-outline { background:transparent; color:var(--c-text,#222); border:1px solid var(--c-border,#ccc); }
.mi-result { border:1px solid rgba(16,185,129,.3); background:rgba(16,185,129,.08); border-radius:12px; padding:12px; }
.mi-result-title { display:flex; align-items:center; gap:6px; font-size:13px; font-weight:700; color:#059669; }
.mi-warn { margin-top:8px; font-size:12px; color:#b45309; line-height:1.5; }
.mi-empty { text-align:center; padding:20px; color:var(--c-secondary,#999); font-size:13px; }
`;

type MoveInImportProps = {
  onNotice?: (message: string) => void;
};

export function MoveInImport({ onNotice }: MoveInImportProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const lastFileRef = useRef<File | null>(null);
  const [preview, setPreview] = useState<MoveInPreview | null>(null);
  const [selected, setSelected] = useState<MoveInCategoryId[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const toggleCategory = (id: MoveInCategoryId) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    lastFileRef.current = file;
    setBusy("读取备份");
    setResult(null);
    try {
      const next = await inspectMoveIn(file);
      setPreview(next);
      setSelected(MOVE_IN_CATEGORIES.filter((category) => next.categories.some((c) => c.id === category.id && c.present)).map((category) => category.id));
    } catch (error) {
      onNotice?.(error instanceof Error ? error.message : "读取备份失败。");
      setPreview(null);
    } finally {
      setBusy(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const runImport = async () => {
    if (!preview || selected.length === 0) {
      onNotice?.("请至少选择一类数据。");
      return;
    }
    setBusy("导入中");
    setResult(null);
    try {
      // preview 里没保存原始 File，这里从上次选择的文件缓存里取。
      const file = lastFileRef.current;
      if (!file) {
        onNotice?.("请重新选择备份文件。");
        return;
      }
      const next = await importMoveIn(file, selected);
      setResult(next);
      const importedCount = next.added + next.overwritten;
      if (importedCount === 0 && next.errors.length > 0) {
        throw new Error(`导入失败：${next.errors[0]}`);
      }
      onNotice?.(`导入完成：新增 ${next.added}，覆盖 ${next.overwritten}，跳过 ${next.skipped}。`);
    } catch (error) {
      onNotice?.(error instanceof Error ? error.message : "导入失败，请稍后再试。");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mi-wrap">
      <style>{STYLE}</style>

      <div className="mi-hero">
        <h3><Sparkles size={16} style={{ verticalAlign: "-2px", marginRight: 6 }} />一键搬家</h3>
        <p>从旧小手机导出的备份文件（.zip 或 .json）中，识别并导入角色人设、世界书、聊天记录、长期记忆与用户设定。导入采用合并方式，不会清空本机现有数据。</p>
      </div>

      {!preview && (
        <div className="mi-panel" style={{ textAlign: "center" }}>
          <div className="mi-empty">还没有选择备份文件</div>
          <div className="mi-actions" style={{ justifyContent: "center" }}>
            <button
              type="button"
              className="mi-btn mi-btn-primary"
              onClick={() => fileInputRef.current?.click()}
              disabled={Boolean(busy)}
            >
              {busy === "读取备份" ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />} 选择备份文件
            </button>
          </div>
        </div>
      )}

      {preview && (
        <>
          <div className="mi-panel">
            <div className="mi-file">
              {preview.format === "zip" ? <FileArchive size={20} color="#7c3aed" /> : <FileJson size={20} color="#7c3aed" />}
              <div>
                <div>{preview.format === "zip" ? "ZIP 备份文件" : "JSON 备份文件"}</div>
                <div className="mi-muted">
                  {preview.createdAt ? `备份时间 ${preview.createdAt.slice(0, 16).replace("T", " ")}` : ""} · 共 {preview.totalRecords} 条记录
                </div>
              </div>
            </div>

            {preview.characters.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div className="mi-row">
                  <span style={{ fontSize: 13, fontWeight: 700 }}>角色兼容匹配</span>
                  <span className="mi-badge mi-badge-match"><CheckCircle2 size={11} /> 已匹配 {preview.matchedCharacterCount} 个</span>
                  {preview.newCharacterCount > 0 && <span className="mi-badge mi-badge-new">新增 {preview.newCharacterCount} 个</span>}
                </div>
                <div className="mi-chars">
                  {preview.characters.slice(0, 12).map((character) => (
                    <span key={character.id} className={character.matched ? "mi-badge mi-badge-match" : "mi-badge mi-badge-new"}>
                      {character.name}
                    </span>
                  ))}
                  {preview.characters.length > 12 && <span className="mi-muted">等 {preview.characters.length} 个角色</span>}
                </div>
              </div>
            )}

            <div className="mi-cats">
              {MOVE_IN_CATEGORIES.map((category) => {
                const stat = preview.categories.find((item) => item.id === category.id);
                const on = selected.includes(category.id);
                const meta = CATEGORY_META[category.id];
                const Icon = meta.icon;
                return (
                  <div
                    key={category.id}
                    className="mi-cat"
                    data-on={on ? "true" : "false"}
                    onClick={() => toggleCategory(category.id)}
                  >
                    <span className="mi-cat-icon" style={{ background: `${meta.color}1f`, color: meta.color }}><Icon size={16} /></span>
                    <span className="mi-cat-main">
                      <span className="mi-cat-label">{category.label}</span>
                      <span className="mi-cat-desc">{category.description}</span>
                    </span>
                    <span className="mi-cat-count">{stat?.records ?? 0}</span>
                  </div>
                );
              })}
            </div>

            <div className="mi-actions" style={{ marginTop: 12 }}>
              <button
                type="button"
                className="mi-btn mi-btn-primary"
                onClick={() => void runImport()}
                disabled={Boolean(busy) || selected.length === 0}
                style={{ flex: 1 }}
              >
                {busy === "导入中" ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />} 开始导入（合并）
              </button>
              <button
                type="button"
                className="mi-btn mi-btn-outline"
                onClick={() => { setPreview(null); setResult(null); setSelected([]); }}
                disabled={Boolean(busy)}
              >
                重新选择
              </button>
            </div>
          </div>

          {result && (
            <div className="mi-result">
              <div className="mi-result-title"><CheckCircle2 size={16} /> 导入完成</div>
              <div className="mi-muted" style={{ marginTop: 4 }}>
                新增 {result.added} · 覆盖 {result.overwritten} · 跳过 {result.skipped}
                {result.errors.length > 0 ? ` · ${result.errors.length} 项出错` : ""}
              </div>
              <div className="mi-warn">
                数据已写入本机，但当前页面仍在使用旧缓存运行。请彻底重启应用（从后台划掉再打开）后再继续使用，否则旧缓存可能覆盖刚导入的数据。
              </div>
              <div className="mi-actions" style={{ marginTop: 8 }}>
                <button type="button" className="mi-btn mi-btn-primary" onClick={() => window.location.reload()}>
                  <RefreshCw size={15} /> 立即重启
                </button>
              </div>
            </div>
          )}
        </>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".zip,.json,.aiphone,application/zip,application/json"
        style={{ display: "none" }}
        onChange={(event) => void handleFile(event.target.files?.[0])}
      />
    </div>
  );
}
