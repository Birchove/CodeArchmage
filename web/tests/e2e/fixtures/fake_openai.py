"""
假 OpenAI SSE 服务器（循环 16 E2E）。

cc 盲点：E2E mock 层次应 mock 供应商，不 mock 内部 /api/chat。
本服务器模拟 OpenAI /v1/chat/completions 流式响应。

用法：python fake_openai.py [--port 8767]
"""
import argparse
import json
import time
from http.server import BaseHTTPRequestHandler, HTTPServer


class FakeOpenAIHandler(BaseHTTPRequestHandler):
    """处理 /v1/chat/completions，返回 SSE 流。"""

    def do_GET(self):
        """健康检查（Playwright webServer 探活）。"""
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(b"ok")

    def do_POST(self):
        if self.path != "/v1/chat/completions":
            self.send_error(404)
            return

        # 读取请求体（不验证内容，E2E 只关心流式回传）
        _ = self.rfile.read(int(self.headers.get("Content-Length", 0)))

        # SSE 响应头（S-4：三响应头防缓冲）
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "close")
        self.end_headers()

        # 模拟流式分片
        chunks = ["这是", "一个", "测试", "函数", "。", "它", "什么", "也不做", "。"]
        for chunk in chunks:
            data = {
                "choices": [
                    {"delta": {"content": chunk}, "index": 0, "finish_reason": None}
                ]
            }
            line = f"data: {json.dumps(data)}\n\n"
            self.wfile.write(line.encode("utf-8"))
            self.wfile.flush()
            time.sleep(0.05)  # 模拟网络延迟

        # 结束标记
        done_data = {"choices": [{"delta": {}, "index": 0, "finish_reason": "stop"}]}
        self.wfile.write(f"data: {json.dumps(done_data)}\n\n".encode("utf-8"))
        self.wfile.write(b"data: [DONE]\n\n")
        self.wfile.flush()

    def log_message(self, format, *args):
        """静默日志（E2E 不需要）"""
        pass


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8767)
    args = parser.parse_args()

    server = HTTPServer(("127.0.0.1", args.port), FakeOpenAIHandler)
    print(f"Fake OpenAI server on http://127.0.0.1:{args.port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
