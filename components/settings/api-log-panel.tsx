"use client";

import { useState, useEffect, useCallback, useContext } from "react";
import { RefreshCw, Trash2, ChevronRight, AlertCircle } from "lucide-react";
import { getApiLogs, clearApiLogs, type DebugInfo } from "@/lib/api-log-store";
import { SettingsContext } from "../phone-settings-app";

function formatTime(ts: string): string {
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

export function ApiLogPanel() {
    const { setSubpageRightAction } = useContext(SettingsContext);
    const [logs, setLogs] = useState<DebugInfo[]>([]);
    const [expandedId, setExpandedId] = useState<string | null>(null);

    const refresh = useCallback(() => setLogs([...getApiLogs()].reverse()), []);

    useEffect(() => {
        refresh();
    }, [refresh]);

    useEffect(() => {
        setSubpageRightAction("apiLog", logs.length > 0 ? (
            <div className="flex items-center gap-1">
                <button type="button" className="page-back-btn" onClick={refresh} title="刷新" aria-label="刷新">
                    <RefreshCw size={18} strokeWidth={1.6} />
                </button>
                <button
                    type="button"
                    className="page-back-btn"
                    onClick={() => { clearApiLogs(); setLogs([]); }}
                    title="清空日志"
                    aria-label="清空日志"
                >
                    <Trash2 size={18} strokeWidth={1.6} />
                </button>
            </div>
        ) : null);
        return () => setSubpageRightAction("apiLog", null);
    }, [logs.length, refresh, setSubpageRightAction]);

    return (
        <div className="page-menu">
            <p className="menu-group-desc">记录每次聊天、总结、检索与 TTS 语音请求的时间、接口、状态码与报错内容，方便排查问题。</p>
            {logs.length === 0 ? (
                <div className="ui-empty">
                    <span className="menu-desc">还没有 API 调用记录</span>
                </div>
            ) : (
                <div className="flex flex-col gap-3">
                    {logs.map(log => {
                        const isOpen = expandedId === log.id;
                        const statusCode = log.statusCode;
                        const isError = Boolean(log.error) || (statusCode !== undefined && statusCode >= 400);
                        return (
                            <div key={log.id} className="menu-group">
                                <button onClick={() => setExpandedId(isOpen ? null : log.id)} className="menu-item">
                                    <div className="menu-label-group">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            {(log.endpoint || log.characterName) && (
                                                <span className="ts-11 font-semibold text-white bg-[var(--c-icon-active)] rounded-[4px] px-[6px] py-[1px] shrink-0">
                                                    {log.endpoint || log.characterName}
                                                </span>
                                            )}
                                            {statusCode !== undefined && (
                                                <span className={`ts-11 font-semibold rounded-[4px] px-[6px] py-[1px] shrink-0 text-white ${statusCode >= 400 ? "bg-[var(--c-danger)]" : "bg-[#2dd36f]"}`}>
                                                    {statusCode}
                                                </span>
                                            )}
                                            {isError && <AlertCircle size={14} className="text-[var(--c-danger)] shrink-0" />}
                                            <span className="menu-label font-semibold">{formatTime(log.timestamp)}</span>
                                        </div>
                                        <div className="menu-desc mt-1 flex gap-3 flex-wrap">
                                            {log.model && <span>Model: {log.model}</span>}
                                            {log.usage && <span>Tokens: {log.usage.prompt_tokens ?? "—"} / {log.usage.completion_tokens ?? "—"}</span>}
                                            {log.messages.length > 0 && <span>{log.messages.length} 条消息</span>}
                                        </div>
                                        {log.error && <div className="menu-desc mt-1 text-[var(--c-danger)] break-all line-clamp-2">{log.error}</div>}
                                    </div>
                                    <div className="menu-right">
                                        <ChevronRight size={16} className="ui-chevron-flip" {...(isOpen ? { "data-open": "" } : {})} />
                                    </div>
                                </button>

                                {isOpen && (
                                    <div className="api-log-panel">
                                        {log.error && (
                                            <>
                                                <div className="font-bold px-1 pt-3 pb-2 text-[var(--c-danger)]">报错返回内容</div>
                                                <div className="api-log-response whitespace-pre-wrap break-all leading-[1.4]">{log.error}</div>
                                            </>
                                        )}
                                        {log.messages.length > 0 && (
                                            <>
                                                <div className="font-bold px-1 pt-3 pb-2 text-[var(--c-warning)]">Prompt ({log.messages.length} 条消息)</div>
                                                {log.messages.map((m, i) => (
                                                    <div key={i} className="api-log-entry" data-role={m.role}>
                                                        <div className="flex items-center gap-[6px] mb-1 flex-wrap">
                                                            <span className="font-bold text-[var(--log-role-color)]">[{i}] {m.role}</span>
                                                            {m.marker && <span className="api-log-marker">{m.marker}</span>}
                                                        </div>
                                                        <div className="whitespace-pre-wrap break-all leading-[1.4]">{m.content}</div>
                                                    </div>
                                                ))}
                                            </>
                                        )}
                                        {log.reasoning && (
                                            <>
                                                <div className="font-bold px-1 pt-3 pb-2 text-[var(--c-warning)]">思维链（Reasoning）</div>
                                                <div className="api-log-reasoning whitespace-pre-wrap break-all leading-[1.4]">{log.reasoning}</div>
                                            </>
                                        )}
                                        <div className="font-bold mt-3 mb-[6px] text-[var(--c-danger)]">原始返回 / 内容</div>
                                        <div className="api-log-response whitespace-pre-wrap break-all leading-[1.4]">{log.rawResponse}</div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
