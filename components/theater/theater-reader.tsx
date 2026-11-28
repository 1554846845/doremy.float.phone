"use client";

import { useMemo, type ReactNode } from "react";
import {
    ArrowLeft, Save, Check, Square, BookMarked, Heart, Send, Clapperboard, Smartphone,
} from "lucide-react";
import type { TheaterStoryKind } from "@/lib/theater-types";

const STYLE = `
.tr { display:flex; flex-direction:column; flex:1 1 auto; min-height:0;
  --tr-ink:#111; --tr-paper:#fff; --tr-muted:#8a8a8a; --tr-line:#e6e6e6; --tr-accent:#111;
  --tr-danger:#c2410c; --tr-danger-bg:#fff1f2;
  background:var(--tr-paper); color:var(--tr-ink);
  font-family:Georgia,"Songti SC","Noto Serif SC",serif; }
.tr[data-dark="true"] { --tr-ink:#f2f2f2; --tr-paper:#0e0e0e; --tr-muted:#8a8a8a; --tr-line:#262626; --tr-accent:#f2f2f2; --tr-danger:#fca5a5; --tr-danger-bg:#2a1214; }
.tr-topbar { flex:0 0 auto; display:flex; align-items:center; gap:10px; padding:12px 12px;
  border-bottom:2px solid var(--tr-ink); }
.tr-back { display:inline-flex; align-items:center; gap:4px; padding:7px 10px; font-size:13px;
  border:1px solid var(--tr-ink); background:transparent; color:var(--tr-ink); cursor:pointer;
  font-family:inherit; letter-spacing:1px; }
.tr-title { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  font-size:15px; letter-spacing:1px; font-weight:700; }
.tr-kind { font-size:10px; letter-spacing:2px; color:var(--tr-muted); text-transform:uppercase; }
.tr-save { display:inline-flex; align-items:center; gap:5px; padding:7px 11px; font-size:12px;
  border:1px solid var(--tr-ink); background:var(--tr-ink); color:var(--tr-paper); cursor:pointer;
  font-family:inherit; letter-spacing:1px; }
.tr-save[data-saved="true"] { background:transparent; color:var(--tr-ink); }
.tr-save:disabled { opacity:.5; cursor:not-allowed; }
.tr-error { flex:0 0 auto; display:flex; align-items:flex-start; gap:8px; margin:10px 12px 0;
  padding:10px 12px; border:1px solid var(--tr-danger); background:var(--tr-danger-bg);
  color:var(--tr-danger); font-size:12.5px; line-height:1.6; word-break:break-word; }
.tr-error button { flex:0 0 auto; margin-left:auto; border:none; background:transparent; color:inherit;
  cursor:pointer; font-size:14px; padding:0 2px; }
.tr-body { flex:1 1 auto; overflow-y:auto; padding:20px 18px 40px; -webkit-overflow-scrolling:touch; }
.tr-para { margin:0 0 1.1em; font-size:16.5px; line-height:2; text-indent:2em; word-break:break-word; }
.tr-scene { margin:1.4em 0; text-align:center; font-size:13px; letter-spacing:3px; color:var(--tr-muted);
  font-weight:700; }
.tr-scene::before, .tr-scene::after { content:"— "; opacity:.7; }
.tr-scene::after { content:" —"; }
.tr-placeholder { color:var(--tr-muted); font-size:14px; line-height:1.9; }
.tr-cursor { display:inline-block; width:8px; height:16px; background:var(--tr-ink); vertical-align:text-bottom;
  animation:trblink 1s steps(2,start) infinite; margin-left:2px; }
@keyframes trblink { to { visibility:hidden; } }
.tr-actions { flex:0 0 auto; display:flex; flex-wrap:wrap; gap:8px; padding:12px;
  border-top:2px solid var(--tr-ink); }
.tr-action { display:inline-flex; align-items:center; gap:5px; padding:9px 11px; font-size:12px;
  border:1px solid var(--tr-ink); background:transparent; color:var(--tr-ink); cursor:pointer;
  font-family:inherit; letter-spacing:1px; }
.tr-action[data-solid="true"] { background:var(--tr-ink); color:var(--tr-paper); }
.tr-action:disabled { opacity:.5; cursor:not-allowed; }
`;

type Block = { type: "scene"; label: string } | { type: "para"; text: string };

function splitBlocks(content: string): Block[] {
    const blocks: Block[] = [];
    const parts = content.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    for (const part of parts) {
        const scene = part.match(/^【([^】\n]{1,80})】\s*$/);
        if (scene) {
            blocks.push({ type: "scene", label: scene[1] });
            continue;
        }
        blocks.push({ type: "para", text: part });
    }
    return blocks;
}

function Para({ text }: { text: string }): ReactNode {
    const lines = text.split("\n");
    return (
        <p className="tr-para">
            {lines.map((line, i) => (
                <span key={i}>
                    {i > 0 && <br />}
                    {line}
                </span>
            ))}
        </p>
    );
}

export type TheaterReaderProps = {
    title: string;
    kind: TheaterStoryKind;
    content: string;
    generating: boolean;
    saved: boolean;
    favorite: boolean;
    error: string | null;
    dark: boolean;
    onBack: () => void;
    onSave: () => void;
    onStop: () => void;
    onContinue: () => void;
    onToggleFavorite: () => void;
    onTransfer: () => void;
    onDismissError: () => void;
};

export function TheaterReader(props: TheaterReaderProps) {
    const {
        title, kind, content, generating, saved, favorite, error, dark,
        onBack, onSave, onStop, onContinue, onToggleFavorite, onTransfer, onDismissError,
    } = props;

    const blocks = useMemo(() => splitBlocks(content), [content]);

    return (
        <>
            <style>{STYLE}</style>
            <div className="tr" data-dark={dark}>
                <div className="tr-topbar">
                    <button className="tr-back" onClick={onBack} aria-label="返回">
                        <ArrowLeft size={15} /> 返回
                    </button>
                    <div style={{ minWidth: 0, display: "flex", flexDirection: "column", flex: 1 }}>
                        <span className="tr-title">{title || "未命名"}</span>
                        <span className="tr-kind">
                            {kind === "pickup" ? <><Smartphone size={10} style={{ verticalAlign: "-1px" }} /> 捡手机</> : <><Clapperboard size={10} style={{ verticalAlign: "-1px" }} /> 小剧场</>}
                        </span>
                    </div>
                    <button className="tr-save" data-saved={saved} onClick={onSave} disabled={generating || saved}>
                        {saved ? <><Check size={14} /> 已保存</> : <><Save size={14} /> 保存记录</>}
                    </button>
                </div>

                {error && (
                    <div className="tr-error" role="alert">
                        <span>{error}</span>
                        <button onClick={onDismissError} aria-label="关闭">×</button>
                    </div>
                )}

                <div className="tr-body">
                    {blocks.length === 0 && !generating && (
                        <div className="tr-placeholder">剧情正文将在此逐字呈现…</div>
                    )}
                    {blocks.map((block, i) => {
                        if (block.type === "scene") {
                            return <div key={i} className="tr-scene">{block.label}</div>;
                        }
                        return <Para key={i} text={block.text} />;
                    })}
                    {generating && <span className="tr-cursor" />}
                </div>

                <div className="tr-actions">
                    {generating ? (
                        <button className="tr-action" onClick={onStop}><Square size={14} /> 停止</button>
                    ) : (
                        <>
                            <button className="tr-action" onClick={onContinue}><BookMarked size={14} /> 续写</button>
                            <button className="tr-action" onClick={onToggleFavorite}>
                                <Heart size={14} fill={favorite ? "currentColor" : "none"} /> {favorite ? "已收藏" : "收藏"}
                            </button>
                            <button className="tr-action" data-solid onClick={onTransfer}><Send size={14} /> 一键转入主聊天</button>
                        </>
                    )}
                </div>
            </div>
        </>
    );
}
