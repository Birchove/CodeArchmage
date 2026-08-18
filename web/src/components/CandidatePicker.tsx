/**
 * 多候选跳转浮层（Stage 7a A-1）。
 *
 * 同名符号有多个定义时弹出：列出每个候选的文件位置和签名，
 * 用户点选后跳转。替代「点了没反应」的静默失败。
 */
import { type JSX } from "react";
import type { SymbolOut } from "@/api/types";

interface CandidatePickerProps {
  /** 候选列表；null 表示关闭。 */
  candidates: SymbolOut[] | null;
  onPick: (sym: SymbolOut) => void;
  onClose: () => void;
}

export function CandidatePicker({
  candidates,
  onPick,
  onClose,
}: CandidatePickerProps): JSX.Element | null {
  if (!candidates) return null;

  return (
    <div className="candidate-backdrop" onClick={onClose} role="presentation">
      <div
        className="candidate-dialog"
        role="dialog"
        aria-label="选择跳转目标"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="candidate-header">
          <span className="candidate-title">
            找到 {candidates.length} 个同名定义
          </span>
          <button
            type="button"
            className="candidate-close"
            onClick={onClose}
            aria-label="关闭"
          >
            ×
          </button>
        </div>
        <p className="candidate-hint">
          按名匹配无法确定是哪一个，点击跳转到你想看的定义：
        </p>
        <ul className="candidate-list">
          {candidates.map((sym) => (
            <li key={sym.id}>
              <button
                type="button"
                className="candidate-item"
                onClick={() => onPick(sym)}
              >
                <span className="candidate-name">{sym.name}</span>
                <span className="candidate-loc">
                  {sym.file_path}:{sym.line}
                </span>
                <code className="candidate-signature">{sym.signature}</code>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
