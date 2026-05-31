#!/usr/bin/env python3
"""LabPay presence scanner.

One-shot: sweep the local subnet with ping (to populate the ARP cache),
read ARP, and POST visible (MAC, IP) pairs to LabPay's /api/presence/scan.

Designed to be run every ~60s by Task Scheduler (Windows) or cron (Linux/Mac).
Cross-platform: tested on Windows 10/11 and Rocky Linux.

Config: edit `scanner.config.json` next to this file, or set env vars.
Required keys:
  - labpay_url       e.g. "https://pay.nkmr.io"
  - room_id          e.g. "10F"
  - scanner_token    the token printed by /api/admin/rooms POST
  - subnet           e.g. "192.168.50.0/24" (auto-detected if omitted)

Optional:
  - ping_workers     default 64
  - ping_timeout_ms  default 300
"""

from __future__ import annotations

import ipaddress
import json
import os
import re
import socket
import ssl
import subprocess
import sys
import urllib.request
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

CONFIG_PATH = Path(__file__).with_name("scanner.config.json")


def load_config() -> dict:
    cfg = {}
    if CONFIG_PATH.exists():
        # utf-8-sig tolerates an optional BOM (PowerShell's `Set-Content -Encoding UTF8` writes one)
        cfg = json.loads(CONFIG_PATH.read_text(encoding="utf-8-sig"))
    # env vars override file
    for k in ("labpay_url", "room_id", "scanner_token", "subnet"):
        env = os.environ.get("LABPAY_" + k.upper())
        if env:
            cfg[k] = env
    cfg.setdefault("ping_workers", int(os.environ.get("LABPAY_PING_WORKERS", "64")))
    cfg.setdefault("ping_timeout_ms", int(os.environ.get("LABPAY_PING_TIMEOUT_MS", "300")))
    for required in ("labpay_url", "room_id", "scanner_token"):
        if not cfg.get(required):
            raise SystemExit(
                f"missing config key '{required}'. "
                f"Edit {CONFIG_PATH} or set LABPAY_{required.upper()}"
            )
    return cfg


def autodetect_subnet() -> str:
    """Best-effort: figure out our primary IPv4 and assume /24."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
    finally:
        s.close()
    net = ipaddress.IPv4Network(f"{ip}/24", strict=False)
    return str(net)


def own_ip() -> str:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    finally:
        s.close()


def own_mac() -> str | None:
    """Return this host's primary MAC (best-effort, formatted aa:bb:cc:dd:ee:ff)."""
    try:
        m = uuid.getnode()
        # If uuid.getnode() couldn't read a real MAC, it returns a random 48-bit int with the
        # multicast bit set (the OUI's first byte LSB is 1). Skip those.
        if (m >> 40) & 1:
            return None
        mac = ":".join(f"{(m >> (8 * (5 - i))) & 0xff:02x}" for i in range(6))
        return mac
    except Exception:
        return None


def iter_hosts(cidr: str):
    net = ipaddress.IPv4Network(cidr, strict=False)
    return [str(h) for h in net.hosts()]


def ping_one(ip: str, timeout_ms: int) -> None:
    if sys.platform.startswith("win"):
        cmd = ["ping", "-n", "1", "-w", str(timeout_ms), ip]
    else:
        sec = max(1, int(round(timeout_ms / 1000)))
        cmd = ["ping", "-c", "1", "-W", str(sec), ip]
    try:
        subprocess.run(
            cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=max(2, timeout_ms / 1000 + 1),
        )
    except Exception:
        pass


def sweep(cidr: str, workers: int, timeout_ms: int) -> None:
    hosts = iter_hosts(cidr)
    with ThreadPoolExecutor(max_workers=workers) as ex:
        list(ex.map(lambda h: ping_one(h, timeout_ms), hosts))


_MAC_RE_WIN = re.compile(r"\s*(\d+\.\d+\.\d+\.\d+)\s+([0-9a-fA-F-]{17})\s+\w+")
_MAC_RE_NIX = re.compile(r"(\d+\.\d+\.\d+\.\d+)\s+.*\s(?:lladdr|HWaddress)\s+([0-9a-fA-F:]{17})")


def read_arp(cidr: str) -> list[dict]:
    """Returns [{mac, ip}, ...] from the OS ARP cache, restricted to `cidr`."""
    net = ipaddress.IPv4Network(cidr, strict=False)
    observations: dict[str, str] = {}  # mac -> ip (dedup; keep last)

    if sys.platform.startswith("win"):
        out = subprocess.check_output(["arp", "-a"], text=True, errors="ignore")
        for line in out.splitlines():
            m = _MAC_RE_WIN.match(line)
            if not m:
                continue
            ip, mac = m.group(1), m.group(2).lower().replace("-", ":")
            if ipaddress.IPv4Address(ip) in net and is_real_mac(mac):
                observations[mac] = ip
    else:
        try:
            out = subprocess.check_output(["ip", "neigh"], text=True, errors="ignore")
        except FileNotFoundError:
            out = subprocess.check_output(["arp", "-an"], text=True, errors="ignore")
        for line in out.splitlines():
            m = _MAC_RE_NIX.search(line)
            if not m:
                continue
            ip, mac = m.group(1), m.group(2).lower()
            try:
                if ipaddress.IPv4Address(ip) in net and is_real_mac(mac):
                    observations[mac] = ip
            except ipaddress.AddressValueError:
                pass

    return [{"mac": mac, "ip": ip} for mac, ip in observations.items()]


def is_real_mac(mac: str) -> bool:
    if mac in ("00:00:00:00:00:00", "ff:ff:ff:ff:ff:ff"):
        return False
    if mac.startswith("01:00:5e"):  # IPv4 multicast
        return False
    if mac.startswith("33:33:"):    # IPv6 multicast
        return False
    return True


def post_to_labpay(cfg: dict, observations: list[dict]) -> tuple[int, str]:
    body = json.dumps({"room_id": cfg["room_id"], "observations": observations}).encode()
    req = urllib.request.Request(
        f"{cfg['labpay_url'].rstrip('/')}/api/presence/scan",
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {cfg['scanner_token']}",
            "User-Agent": "labpay-scanner/1.0",
        },
        method="POST",
    )
    ctx = ssl.create_default_context()
    try:
        with urllib.request.urlopen(req, timeout=15, context=ctx) as resp:
            return resp.status, resp.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(errors="replace")


def main() -> int:
    cfg = load_config()
    cidr = cfg.get("subnet") or autodetect_subnet()
    cfg["subnet"] = cidr

    sweep(cidr, cfg["ping_workers"], cfg["ping_timeout_ms"])
    obs = read_arp(cidr)
    # Add the scanner host itself (we know we're in the room — ARP doesn't show our own MAC)
    me_mac = own_mac()
    if me_mac and is_real_mac(me_mac):
        if not any(o["mac"] == me_mac for o in obs):
            obs.append({"mac": me_mac, "ip": own_ip()})
    status, body = post_to_labpay(cfg, obs)
    print(f"[scanner] room={cfg['room_id']} subnet={cidr} observed={len(obs)} -> HTTP {status}")
    if status >= 400:
        print(body, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
