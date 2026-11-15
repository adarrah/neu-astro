#!/usr/bin/env python3
import argparse
import ftplib
import os
import sys
import time

parser = argparse.ArgumentParser(description="Deploy dist directory via FTP")
parser.add_argument("--server", default=os.environ.get("FTP_SERVER", ""))
parser.add_argument("--username", default=os.environ.get("FTP_USERNAME", ""))
parser.add_argument("--password", default=os.environ.get("FTP_PASSWORD", ""))
parser.add_argument("--server-dir", default=os.environ.get("FTP_SERVER_DIR", "/"))
parser.add_argument("--local-dir", default=os.environ.get("LOCAL_DIR", "dist"))
args = parser.parse_args()

FTP_SERVER = args.server.strip()
FTP_USERNAME = args.username.strip()
FTP_PASSWORD = args.password.strip()
FTP_SERVER_DIR = args.server_dir.strip() or "/"
LOCAL_DIR = args.local_dir.strip()

if not FTP_SERVER or not FTP_USERNAME or not FTP_PASSWORD:
    print("Error: FTP_SERVER, FTP_USERNAME, and FTP_PASSWORD environment variables are required.", file=sys.stderr)
    sys.exit(1)

# Strip ftp:// prefix if provided
if FTP_SERVER.startswith("ftp://"):
    FTP_SERVER = FTP_SERVER[len("ftp://"):]
FTP_SERVER = FTP_SERVER.rstrip("/")


def connect():
    ftp = ftplib.FTP(timeout=30)
    ftp.connect(FTP_SERVER, 21)
    ftp.login(FTP_USERNAME, FTP_PASSWORD)
    ftp.set_pasv(True)
    return ftp


def ensure_remote_dir(ftp, remote_dir):
    parts = [p for p in remote_dir.split("/") if p and p != "."]
    curr = ""
    for part in parts:
        curr = f"{curr}/{part}"
        try:
            ftp.cwd(curr)
        except ftplib.error_perm:
            try:
                ftp.mkd(curr)
            except ftplib.error_perm:
                pass
            ftp.cwd(curr)
    ftp.cwd("/")


def upload_file_with_retry(ftp_ref, local_path, remote_path, max_retries=5):
    for attempt in range(1, max_retries + 1):
        try:
            ftp = ftp_ref[0]
            with open(local_path, "rb") as f:
                ftp.storbinary(f"STOR {remote_path}", f, blocksize=32768)
            return
        except Exception as err:
            print(f"  [Attempt {attempt}/{max_retries}] Retry {remote_path} after {err}...")
            time.sleep(2 * attempt)
            try:
                ftp_ref[0].close()
            except Exception:
                pass
            ftp_ref[0] = connect()


def main():
    if not os.path.isdir(LOCAL_DIR):
        print(f"Error: Local directory '{LOCAL_DIR}' does not exist.", file=sys.stderr)
        sys.exit(1)

    print(f"Connecting to {FTP_SERVER} as {FTP_USERNAME}...")
    ftp_ref = [connect()]

    base_remote = "/" + FTP_SERVER_DIR.strip("/.")
    if base_remote == "//":
        base_remote = "/"

    # Remove Hostinger's placeholder default.php if present
    try:
        entries = ftp_ref[0].nlst(base_remote)
        if any(e.endswith("default.php") for e in entries):
            placeholder = f"{base_remote.rstrip('/')}/default.php"
            print(f"Removing Hostinger placeholder {placeholder}...")
            ftp_ref[0].delete(placeholder)
    except Exception:
        pass

    # Collect all directories and files to upload
    dirs_to_create = set()
    files_to_upload = []

    for root, dirs, files in os.walk(LOCAL_DIR):
        rel_root = os.path.relpath(root, LOCAL_DIR)
        if rel_root == ".":
            remote_root = base_remote.rstrip("/")
        else:
            rel_posix = rel_root.replace(os.sep, "/")
            remote_root = f"{base_remote.rstrip('/')}/{rel_posix}"
            dirs_to_create.add(remote_root)

        for d in dirs:
            d_rel = os.path.relpath(os.path.join(root, d), LOCAL_DIR).replace(os.sep, "/")
            dirs_to_create.add(f"{base_remote.rstrip('/')}/{d_rel}")

        for fn in files:
            local_file = os.path.join(root, fn)
            remote_file = f"{remote_root}/{fn}" if remote_root else f"/{fn}"
            files_to_upload.append((local_file, remote_file))

    print(f"Ensuring {len(dirs_to_create)} remote directories...")
    for rdir in sorted(dirs_to_create):
        for attempt in range(1, 5):
            try:
                ensure_remote_dir(ftp_ref[0], rdir)
                break
            except Exception as err:
                print(f"  [Dir retry {attempt}] {rdir}: {err}")
                time.sleep(2 * attempt)
                try:
                    ftp_ref[0].close()
                except Exception:
                    pass
                ftp_ref[0] = connect()

    total = len(files_to_upload)
    print(f"Uploading {total} files from {LOCAL_DIR}/ to {FTP_SERVER}...")
    for idx, (local_file, remote_file) in enumerate(sorted(files_to_upload), 1):
        print(f"[{idx}/{total}] Uploading {remote_file}")
        upload_file_with_retry(ftp_ref, local_file, remote_file)

    try:
        ftp_ref[0].quit()
    except Exception:
        pass
    print("Deployment complete!")


if __name__ == "__main__":
    main()
