"""
Generate an RSA key pair for the Snowflake service user PI_SVC.

  private key -> keys/snowflake_rsa_key.p8   (git-ignored, never share it)
  public key  -> printed, paste it into 00_bootstrap.sql in place of <PASTE_PUBLIC_KEY_HERE>

Key-pair auth is what Snowflake recommends for service users: no password to leak,
no MFA prompt blocking scripts.

Run:  python sql/snowflake/make_keypair.py
"""

from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

KEY_DIR = Path(__file__).resolve().parent.parent.parent / "keys"
PRIVATE_PATH = KEY_DIR / "snowflake_rsa_key.p8"


def main():
    if PRIVATE_PATH.exists():
        raise SystemExit(f"{PRIVATE_PATH} already exists; delete it first if you really want a new key.")

    KEY_DIR.mkdir(exist_ok=True)
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    PRIVATE_PATH.write_bytes(key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ))

    public_pem = key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode()
    # Snowflake wants the key body only, without the BEGIN/END lines or newlines.
    body = "".join(line for line in public_pem.splitlines() if "-----" not in line)

    print(f"Private key written to {PRIVATE_PATH}")
    print("\nPaste this into 00_bootstrap.sql as RSA_PUBLIC_KEY:\n")
    print(body)


if __name__ == "__main__":
    main()
