/**
 * 后端不可用态（O-2）。
 */

import { type JSX } from "react";

export function ErrorState(): JSX.Element {
  return (
    <div className="error-state">
      <p>无法连接后端，请确认服务已启动。</p>
    </div>
  );
}
