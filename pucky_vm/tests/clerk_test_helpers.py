from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import time
import uuid

from pucky_vm.clerk_auth import ClerkAuthClient


TEST_CLERK_FRONTEND_API_URL = "https://example.clerk.accounts.dev"
TEST_CLERK_PUBLISHABLE_KEY = "pk_test_ZXhhbXBsZS5jbGVyay5hY2NvdW50cy5kZXYk"
NODE_BINARY = (
    shutil.which("node")
    or "/Users/jimmythompson/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
)
NODE_CLERK_KEYPAIR_SCRIPT = r"""
const crypto = require("crypto");
const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
process.stdout.write(JSON.stringify({
  privateKey: privateKey.export({ type: "pkcs8", format: "pem" }),
  publicJwk: Object.assign({ kid: "kid_test", alg: "RS256", use: "sig" }, publicKey.export({ format: "jwk" })),
}) + "\n");
"""
NODE_CLERK_SIGN_SCRIPT = r"""
const crypto = require("crypto");
const privateKey = process.env.PRIVATE_KEY;
const payload = JSON.parse(process.env.PAYLOAD_JSON || "{}");
const header = { alg: "RS256", typ: "JWT", kid: "kid_test" };
function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
const encodedHeader = encode(header);
const encodedPayload = encode(payload);
const signingInput = `${encodedHeader}.${encodedPayload}`;
const signature = crypto.sign("RSA-SHA256", Buffer.from(signingInput), privateKey).toString("base64url");
process.stdout.write(`${signingInput}.${signature}\n`);
"""


class ClerkTestHarness:
    def __init__(self) -> None:
        keypair = subprocess.run(
            [NODE_BINARY, "-e", NODE_CLERK_KEYPAIR_SCRIPT],
            check=True,
            capture_output=True,
            text=True,
        )
        payload = json.loads(keypair.stdout)
        self.private_key = str(payload["privateKey"])
        self.public_jwk = dict(payload["publicJwk"])
        self.client = ClerkAuthClient(
            publishable_key=TEST_CLERK_PUBLISHABLE_KEY,
            secret_key="sk_test_example",
            frontend_api_url=TEST_CLERK_FRONTEND_API_URL,
            jwks_fetcher=lambda: {"keys": [dict(self.public_jwk)]},
        )

    def issue_token(
        self,
        *,
        email: str,
        origin: str,
        clerk_user_id: str = "",
        session_id: str = "",
        exp_offset_seconds: int = 3600,
    ) -> str:
        now = int(time.time())
        user_id = str(clerk_user_id or f"user_{hashlib.sha256(email.encode('utf-8')).hexdigest()[:10]}")
        payload = {
            "azp": origin,
            "email": email,
            "exp": now + int(exp_offset_seconds),
            "iat": now,
            "iss": TEST_CLERK_FRONTEND_API_URL,
            "jti": uuid.uuid4().hex[:20],
            "nbf": now - 5,
            "role": "authenticated",
            "sid": str(session_id or f"sess_{uuid.uuid4().hex[:10]}"),
            "sub": user_id,
            "v": 2,
        }
        completed = subprocess.run(
            [NODE_BINARY, "-e", NODE_CLERK_SIGN_SCRIPT],
            check=True,
            capture_output=True,
            text=True,
            env={
                **dict(os.environ),
                "PRIVATE_KEY": self.private_key,
                "PAYLOAD_JSON": json.dumps(payload),
            },
        )
        return completed.stdout.strip()

    def session_cookie(self, *, email: str, origin: str, clerk_user_id: str = "", exp_offset_seconds: int = 3600) -> str:
        token = self.issue_token(
            email=email,
            origin=origin,
            clerk_user_id=clerk_user_id,
            exp_offset_seconds=exp_offset_seconds,
        )
        return f"__session={token}"
