/**
 * 加载指示器（B-9）。
 */

import { type JSX } from "react";

export function Spinner(): JSX.Element {
  return <span className="spinner" aria-label="加载中" />;
}
