// lib/llm-http.ts
// LLM 请求的统一 fetch 出口。所有走 buildProviderRequest 的调用点统一经它发请求：
//  - 普通 provider：浏览器直连（现状不变）；
//  - serverProxy 标记（OpenCode 网关）：改发本站 /api/llm-proxy，由服务端转发，
//    绕过 opencode.ai 未开放浏览器 CORS 的问题。

import type { LlmRequestPayload } from "./llm-provider-adapter";
import { pushApiLog } from "./api-log-store";

export type FetchLlmPayloadOptions = {
    signal?: AbortSignal;
};

export function fetchLlmPayload(
    payload: LlmRequestPayload,
    options: FetchLlmPayloadOptions = {},
): Promise<Response> {
    const bodyText = JSON.stringify(payload.body);
    const requestPromise = payload.serverProxy
        ? fetch("/api/llm-proxy", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                url: payload.url,
                headers: payload.headers,
                body: bodyText,
            }),
            signal: options.signal,
        })
        : fetch(payload.url, {
            method: "POST",
            headers: payload.headers,
            body: bodyText,
            signal: options.signal,
        });

    // 统一记录非 2xx 的错误：聊天引擎/原生工具的成功日志在各自调用点记，
    // 这里只补错误（clone 读取 body，不消费原始响应），让「API 运行与报错日志」
    // 能捕捉到 HTTP 状态码与上游返回内容，而不重复记成功调用。
    return requestPromise.then((response) => {
        if (!response.ok) {
            void response.clone().text().then((text) => {
                pushApiLog({
                    source: "chat",
                    endpoint: payload.url,
                    model: typeof payload.body?.model === "string" ? payload.body.model : undefined,
                    messages: [],
                    rawResponse: `[API 错误 ${response.status}] ${text.slice(0, 4000)}`,
                    statusCode: response.status,
                    error: text.slice(0, 2000),
                });
            }).catch(() => { /* 日志失败不影响主流程 */ });
        }
        return response;
    });
}
