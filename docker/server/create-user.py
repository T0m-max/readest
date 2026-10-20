#!/usr/bin/env python3
"""Create a confirmed personal account while public registration stays closed."""
import argparse
import getpass
import json
import os
from pathlib import Path
import urllib.error
import urllib.request

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("email")
args = parser.parse_args()
env_file = Path(os.environ.get("READEST_ENV_FILE", Path(__file__).resolve().parent / ".env.server.local"))
values = {}
for line in env_file.read_text().splitlines():
    key, separator, value = line.partition("=")
    if separator and key in ("PUBLIC_URL", "SERVICE_ROLE_KEY"):
        values[key] = value.strip().strip("\"'")
password = getpass.getpass("Password (at least 8 characters): ")
if len(password) < 8 or password != getpass.getpass("Repeat password: "):
    parser.exit(1, "Passwords must match and contain at least 8 characters.\n")
request = urllib.request.Request(
    values["PUBLIC_URL"].rstrip("/") + "/auth/v1/admin/users",
    data=json.dumps({"email": args.email, "password": password, "email_confirm": True}).encode(),
    headers={"Content-Type": "application/json", "apikey": values["SERVICE_ROLE_KEY"],
             "Authorization": "Bearer " + values["SERVICE_ROLE_KEY"]},
)
try:
    with urllib.request.urlopen(request, timeout=30) as response:
        user = json.load(response)
except urllib.error.HTTPError as error:
    parser.exit(1, f"Account creation failed (HTTP {error.code}): {error.read().decode()}\n")
except urllib.error.URLError as error:
    parser.exit(1, f"Cannot reach the server: {error.reason}\n")
print(f"Created confirmed account: {user['email']}")
