#!/usr/bin/env python3
"""Create fresh deployment secrets without overwriting an existing deployment."""
import argparse
import base64
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import time

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("domain", help="Public DNS hostname, without scheme, path or port")
args = parser.parse_args()
domain = args.domain.lower()
label = r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"
if len(domain) > 253 or not re.fullmatch(rf"{label}(?:\.{label})+", domain):
    parser.error("Use a DNS hostname such as readest.example.com")

directory = Path(__file__).resolve().parent
target = directory / ".env.server.local"
jwt_secret = secrets.token_hex(32)
issued_at = int(time.time())


def encode(value):
    return base64.urlsafe_b64encode(value).rstrip(b"=")


def token(role):
    header = encode(b'{"alg":"HS256","typ":"JWT"}')
    payload = encode(json.dumps({
        "iss": "supabase", "role": role, "iat": issued_at,
        "exp": issued_at + 10 * 365 * 24 * 3600,
    }, separators=(",", ":")).encode())
    message = header + b"." + payload
    signature = encode(hmac.new(jwt_secret.encode(), message, hashlib.sha256).digest())
    return (message + b"." + signature).decode()


values = {
    "DOMAIN": domain, "PUBLIC_URL": f"https://{domain}",
    "POSTGRES_PASSWORD": secrets.token_hex(24), "JWT_SECRET": jwt_secret,
    "ANON_KEY": token("anon"), "SERVICE_ROLE_KEY": token("service_role"),
    "MINIO_ROOT_USER": "readest-" + secrets.token_hex(8),
    "MINIO_ROOT_PASSWORD": secrets.token_hex(32),
}
template = (directory / ".env.server.example").read_text()
content = "\n".join(
    f"{line.split('=', 1)[0]}={values[line.split('=', 1)[0]]}"
    if line.split("=", 1)[0] in values else line
    for line in template.splitlines()
) + "\n"
try:
    descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
except FileExistsError:
    parser.exit(1, f"Refusing to replace existing secrets: {target}\n")
with os.fdopen(descriptor, "w") as output:
    output.write(content)
print(f"Created {target} (mode 0600). Keep a private backup of this file.")
