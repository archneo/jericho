#!/usr/bin/env python3
"""
Jericho Agent Sandbox — Docker-based isolation wrapper
Runs agents inside a minimal Alpine container with seccomp + cap-drop.
Build 42 prototype. Full gVisor/Firecracker integration deferred to Build 43.
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

SANDBOX_DIR = Path(__file__).parent
POLICY_PATH = SANDBOX_DIR / "seccomp-policy.json"
IMAGE_NAME = "jericho-sandbox:latest"


def build_image():
    """Build the sandbox Docker image if it doesn't exist."""
    result = subprocess.run(
        ["docker", "images", "-q", IMAGE_NAME],
        capture_output=True, text=True,
    )
    if result.stdout.strip():
        return  # Already built

    print(f"[sandbox] Building {IMAGE_NAME}...")
    subprocess.run(
        ["docker", "build", "-t", IMAGE_NAME, "-f", str(SANDBOX_DIR / "Dockerfile.sandbox"), str(SANDBOX_DIR)],
        check=True,
    )
    print(f"[sandbox] {IMAGE_NAME} built.")


def run_sandboxed(
    command: str,
    cwd: str = "/home/agent",
    env: dict = None,
    timeout: int = 300,
    memory_limit: str = "512m",
    cpu_limit: float = 1.0,
) -> dict:
    """
    Run a shell command inside the sandbox container.

    Security flags:
      --read-only          : root filesystem is read-only
      --tmpfs /tmp:rw,noexec,nosuid,size=100m : writable tmpfs for temp files
      --cap-drop ALL       : drop all Linux capabilities
      --security-opt seccomp=... : restrict syscalls
      --network none       : no network access (adjust per agent type)
      --user agent         : run as non-root
    """
    build_image()

    # Write command to a temp script that the container will execute
    with tempfile.NamedTemporaryFile(mode="w", suffix=".sh", delete=False) as f:
        f.write("#!/bin/bash\nset -e\n")
        f.write(command)
        f.write("\n")
        script_path = f.name

    docker_cmd = [
        "docker", "run", "--rm",
        "--read-only",
        "--tmpfs", "/tmp:rw,noexec,nosuid,size=100m",
        "--cap-drop", "ALL",
        "--security-opt", f"seccomp={POLICY_PATH}",
        "--network", "none",
        "--user", "agent",
        "--workdir", cwd,
        "-v", f"{script_path}:/tmp/run.sh:ro",
        "-m", memory_limit,
        "--cpus", str(cpu_limit),
        IMAGE_NAME,
        "/bin/bash", "/tmp/run.sh",
    ]

    try:
        result = subprocess.run(
            docker_cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        return {
            "ok": result.returncode == 0,
            "exit_code": result.returncode,
            "stdout": result.stdout,
            "stderr": result.stderr,
        }
    except subprocess.TimeoutExpired:
        return {"ok": False, "exit_code": -1, "stdout": "", "stderr": f"Sandbox timeout after {timeout}s"}
    finally:
        Path(script_path).unlink(missing_ok=True)


if __name__ == "__main__":
    # CLI usage: python sandbox.py "echo hello"
    cmd = " ".join(sys.argv[1:]) if len(sys.argv) > 1 else "echo 'sandbox test'"
    print(json.dumps(run_sandboxed(cmd), indent=2))
