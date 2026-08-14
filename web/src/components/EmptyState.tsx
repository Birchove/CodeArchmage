/**
 * 空状态：仓库未索引或索引后无 Python 文件（B-4）。
 */

import { type JSX } from "react";

interface EmptyStateProps {
  onTriggerIndex: () => void;
}

export function EmptyState({ onTriggerIndex }: EmptyStateProps): JSX.Element {
  return (
    <div className="empty-state">
      <p className="empty-state-msg">
        此仓库尚未索引，或索引后无 Python 文件。
      </p>
      <button type="button" className="index-btn" onClick={onTriggerIndex}>
        索引此仓库
      </button>
    </div>
  );
}
