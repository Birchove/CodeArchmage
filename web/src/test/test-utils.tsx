/**
 * 测试工具：React Query wrapper + renderHook 辅助。
 */

import { type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderOptions } from "@testing-library/react";

/** 创建测试用 QueryClient（关闭 retry/gcTime，让测试即时反映状态）。 */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

/** renderHook 的 wrapper 工厂。 */
export function createQueryClientWrapper(queryClient?: QueryClient) {
  const client = queryClient ?? createTestQueryClient();
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

/** 带 QueryClient 的 render（组件测试用）。 */
export function renderWithQueryClient(
  ui: ReactNode,
  options?: RenderOptions,
): ReturnType<typeof render> {
  const wrapper = createQueryClientWrapper();
  return render(ui, { wrapper, ...options });
}
