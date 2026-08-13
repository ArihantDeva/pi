#!/usr/bin/env python3
"""ipython-driver.py — persistent IPython kernel driver for the pi `ipython` tool.

Protocol (JSON lines over stdin/stdout, one reply per request):
  in : {"seq": 1, "code": "...", "timeout": 30}
  out: {"seq": 1, "output": "...", "error": null}
  in : {"seq": 2, "interrupt": true}   -> interrupts the running cell, no reply
  out: {"seq": 0, "output": "", "error": "kernel failed to start: ..."} then exit

The kernel process stays alive for the driver's lifetime, so module state,
imports, and variables survive across cells (persistent REPL semantics).
"""
import json
import queue
import sys
import time

MAX_OUTPUT_CHARS = 60_000

from jupyter_client import KernelManager


def main() -> int:
    km = KernelManager(kernel_name="python3")
    try:
        km.start_kernel()
    except Exception as e:  # noqa: BLE001
        reply({"seq": 0, "output": "", "error": f"kernel failed to start: {e}"})
        return 1
    kc = km.client()
    kc.start_channels()
    try:
        kc.wait_for_ready(timeout=60)
    except Exception as e:  # noqa: BLE001
        reply({"seq": 0, "output": "", "error": f"kernel not ready: {e}"})
        return 1

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError:
            continue
        seq = req.get("seq", 0)
        if req.get("interrupt"):
            try:
                kc.interrupt_kernel()
            except Exception:  # noqa: BLE001
                pass
            continue
        code = req.get("code", "")
        timeout = float(req.get("timeout", 30))
        error = None
        parts = []
        part_len = 0
        truncated = False
        try:
            msg_id = kc.execute(code, allow_stdin=False)
        except Exception as e:  # noqa: BLE001
            reply({"seq": seq, "output": "", "error": str(e)})
            continue
        deadline = time.monotonic() + timeout
        got_result = False
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                error = f"cell timed out after {timeout:.0f}s (kernel still running)"
                break
            try:
                msg = kc.get_iopub_msg(timeout=remaining)
            except queue.Empty:
                error = f"cell timed out after {timeout:.0f}s (no output)"
                break
            if msg["parent_header"].get("msg_id") != msg_id:
                continue
            mtype = msg["msg_type"]
            content = msg["content"]
            if mtype == "stream":
                text = content.get("text", "")
                if text:
                    room = MAX_OUTPUT_CHARS - part_len
                    if room > 0:
                        parts.append(text[:room])
                        part_len += min(len(text), room)
                        if len(text) > room:
                            truncated = True
                    else:
                        truncated = True
            elif mtype in ("execute_result", "display_data"):
                data = content.get("data", {})
                if "text/plain" in data:
                    text = data["text/plain"]
                    room = MAX_OUTPUT_CHARS - part_len
                    if room > 0:
                        parts.append(text[:room])
                        part_len += min(len(text), room)
                        if len(text) > room:
                            truncated = True
                    else:
                        truncated = True
                    got_result = True
            elif mtype == "error":
                error = "\n".join(content.get("traceback", []))
            elif mtype == "status" and content.get("execution_state") == "idle":
                break
        # A bare expression result without a final newline is normal; keep it.
        if error is not None and "timed out" in error:
            # Interrupt the still-running cell so subsequent cells don't queue
            # behind a busy kernel.
            try:
                kc.interrupt_kernel()
            except Exception:  # noqa: BLE001
                pass
        output = "".join(parts)
        if truncated:
            output += f"\n...[output truncated at {MAX_OUTPUT_CHARS} chars]..."
        reply({"seq": seq, "output": output, "error": error})
    return 0


def reply(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.stdout.flush()


if __name__ == "__main__":
    sys.exit(main())
