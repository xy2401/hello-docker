#!/usr/bin/env python3
"""Validate official payloads, emit file ownership proofs, or install them offline."""
import argparse
import copy
import hashlib
import json
import os
import posixpath
import tarfile


def members(archive, strip):
    result = []
    for original in archive:
        parts = original.name.split('/')
        if original.name.startswith('/') or '..' in parts:
            raise ValueError('unsafe archive path: ' + original.name)
        name = '/'.join(parts[strip:]).rstrip('/')
        if not name:
            continue
        member = copy.copy(original)
        member.name = name
        if member.islnk():
            member.linkname = '/'.join(member.linkname.split('/')[strip:])
        if member.issym() or member.islnk():
            target = posixpath.normpath(posixpath.join(posixpath.dirname(name) if member.issym() else '', member.linkname))
            if member.linkname.startswith('/') or target == '..' or target.startswith('../'):
                raise ValueError('archive link escapes payload: ' + original.name)
        if not (member.isfile() or member.isdir() or member.issym() or member.islnk()):
            raise ValueError('special files are not accepted in installation payloads')
        result.append((original, member))
    if len({member.name for _, member in result}) != len(result):
        raise ValueError('duplicate archive entry')
    return result


def process(source, destination, strip=1, install=False, artifact_id=''):
    proofs = []
    with tarfile.open(source, 'r:*') as archive:
        entries = members(archive, strip)
        for original, member in entries:
            proof = {'path': posixpath.join(destination, member.name), 'artifact': artifact_id,
                     'type': 'file' if member.isfile() else 'directory' if member.isdir() else 'symlink' if member.issym() else 'hardlink',
                     'linkTarget': member.linkname if member.issym() else None, 'sha256': None}
            if member.isfile() or member.islnk():
                digest = hashlib.sha256()
                with archive.extractfile(original) as stream:
                    for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                        digest.update(chunk)
                proof['sha256'] = digest.hexdigest()
            proofs.append(proof)
        if install:
            os.makedirs(destination, exist_ok=True)
            # All names and links have been validated before any filesystem mutation.
            archive.extractall(destination, members=[member for _, member in entries], filter='fully_trusted')
    return proofs


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=['proof', 'install'])
    parser.add_argument('source')
    parser.add_argument('destination')
    parser.add_argument('--strip', type=int, default=1)
    parser.add_argument('--artifact', default='')
    args = parser.parse_args()
    proofs = process(args.source, args.destination, args.strip, args.mode == 'install', args.artifact)
    print(json.dumps(proofs if args.mode == 'proof' else {'installedEntries': len(proofs)}, ensure_ascii=True))
