"use client";

import { useState, useEffect, useCallback } from "react";
import { Box, Brain, MessageSquare, type LucideIcon } from "lucide-react";
import type { ApiConfig, BindingConfig } from "@/lib/settings-types";
import { loadApiConfigs, loadBindingConfig, saveBindingConfig } from "@/lib/settings-storage";

type AssignField = "chatApiConfigId" | "memorySummaryApiConfigId" | "embeddingApiConfigId";

const ROWS: { field: AssignField; label: string; desc: string; icon: LucideIcon }[] = [
    { field: "chatApiConfigId", label: "聊天", desc: "角色对话使用的文本生成 API", icon: MessageSquare },
    { field: "memorySummaryApiConfigId", label: "记忆总结", desc: "聊天记忆压缩 / 长期记忆生成", icon: Brain },
    { field: "embeddingApiConfigId", label: "记忆检索", desc: "语义向量召回 / 记忆搜索", icon: Box },
];

export function ApiAssignment() {
    const [config, setConfig] = useState<BindingConfig | null>(null);
    const [apiConfigs, setApiConfigs] = useState<ApiConfig[]>([]);

    useEffect(() => {
        setConfig(loadBindingConfig());
        setApiConfigs(loadApiConfigs());
    }, []);

    const persist = useCallback((next: BindingConfig) => {
        setConfig(next);
        saveBindingConfig(next);
    }, []);

    if (!config) return null;

    const options = apiConfigs.map(c => ({ id: c.id, name: c.name || c.provider }));
    const globalDefaultId = config.globalDefaults.apiConfigId;
    const globalDefaultName = options.find(o => o.id === globalDefaultId)?.name;

    const setGlobalDefault = (value: string) => {
        persist({ ...config, globalDefaults: { ...config.globalDefaults, apiConfigId: value || undefined } });
    };

    const setAssignField = (field: AssignField, value: string) => {
        persist({ ...config, [field]: value || undefined });
    };

    const effectiveValue = (field: AssignField): string => {
        const id = config[field];
        return id && options.some(o => o.id === id) ? id : "";
    };

    return (
        <div className="flex flex-col gap-6">
            <div className="flex items-center">
                <h2 className="m-0 mx-2 ts-28 font-bold italic leading-none text-black">API 分配</h2>
            </div>

            <p className="menu-desc">
                三个功能默认共用「全局默认 API」，也可以各自指定独立的 API 配置。未单独指定的功能会跟随全局默认。
            </p>

            {options.length === 0 ? (
                <div className="ui-empty">
                    <span className="menu-label font-semibold">还没有 API 配置</span>
                    <span className="menu-desc max-w-[240px]">
                        请先在「API 设置」里添加至少一个 API 配置。
                    </span>
                </div>
            ) : (
                <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-1">
                        <label className="menu-desc ml-1">全局默认 API</label>
                        <select
                            value={globalDefaultId || ""}
                            onChange={(e) => setGlobalDefault(e.target.value)}
                            className="ui-select"
                        >
                            {options.map(o => (
                                <option key={o.id} value={o.id}>{o.name}</option>
                            ))}
                        </select>
                        <span className="menu-desc ml-1">聊天、记忆总结、记忆检索的共同兜底配置</span>
                    </div>

                    <div className="flex flex-col gap-3">
                        {ROWS.map(row => {
                            const Icon = row.icon;
                            const value = effectiveValue(row.field);
                            return (
                                <div key={row.field} className="ui-toggle-row overflow-visible" style={{ display: "block", position: "relative", height: "auto", flexShrink: 0, padding: "14px 16px" }}>
                                    <div className="flex items-center gap-3">
                                        <span className="shrink-0" style={{ color: "var(--c-text-title)" }}>
                                            <Icon size={22} strokeWidth={1.8} />
                                        </span>
                                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                                            <span className="menu-label font-medium">{row.label}</span>
                                            <span className="menu-desc whitespace-normal break-words leading-[1.45]">{row.desc}</span>
                                        </div>
                                    </div>
                                    <div className="mt-3 flex flex-col gap-1">
                                        <select
                                            value={value}
                                            onChange={(e) => setAssignField(row.field, e.target.value)}
                                            className="ui-select"
                                        >
                                            <option value="">使用全局默认{globalDefaultName ? `（${globalDefaultName}）` : ""}</option>
                                            {options.map(o => (
                                                <option key={o.id} value={o.id}>{o.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}
