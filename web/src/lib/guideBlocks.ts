/**
 * 前端导读块解析（Stage 7b，流式渲染用）。
 *
 * 与引擎 guide_blocks.py 同构的宽容解析，但允许未闭合的 code 围栏
 * （流式中途围栏还没收完）：closed=false 让 UI 先渲染骨架。
 */

export type StreamBlock =
  | { type: "text"; text: string }
  | {
      type: "code";
      file_path: string;
      start_line: number;
      end_line: number;
      closed: boolean;
    };

const FENCE_RE = /^\s*```(.*)$/;
const CODE_ATTR_RE = /^\s*code\s+file=(\S+)\s+lines=(\d+)-(\d+)\s*$/;

export function parseStreamingBlocks(md: string): StreamBlock[] {
  const lines = md.split("\n");
  const blocks: StreamBlock[] = [];
  let textBuf: string[] = [];

  const flush = (): void => {
    const text = textBuf.join("\n").trim();
    if (text) blocks.push({ type: "text", text });
    textBuf = [];
  };

  let i = 0;
  const n = lines.length;
  while (i < n) {
    const m = FENCE_RE.exec(lines[i]);
    if (m && m[1].trim().startsWith("code")) {
      const attr = CODE_ATTR_RE.exec(m[1]);
      if (attr) {
        // 找闭合围栏
        let j = i + 1;
        while (j < n && !FENCE_RE.test(lines[j])) j++;
        const closed = j < n;
        flush();
        blocks.push({
          type: "code",
          file_path: attr[1],
          start_line: parseInt(attr[2], 10),
          end_line: parseInt(attr[3], 10),
          closed,
        });
        i = closed ? j + 1 : n;
        continue;
      }
      // 属性畸形 → 围栏行并入 text
      textBuf.push(lines[i]);
      i++;
      continue;
    }

    textBuf.push(lines[i]);
    if (m) {
      // 普通围栏：把围栏体收进来直到闭合
      i++;
      while (i < n && !FENCE_RE.test(lines[i])) {
        textBuf.push(lines[i]);
        i++;
      }
      if (i < n) textBuf.push(lines[i]);
    }
    i++;
  }
  flush();
  return blocks;
}
