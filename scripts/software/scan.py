#!/usr/bin/env python3
"""Read-only rootfs inventory. JSONL is written to stdout, never into the image."""
import argparse
import base64
import ctypes
import errno
import hashlib
import json
import os
import stat
import struct
import sys


class Timestamp(ctypes.Structure):
    _fields_ = [('seconds', ctypes.c_int64), ('nanoseconds', ctypes.c_uint32), ('reserved', ctypes.c_int32)]


class Statx(ctypes.Structure):
    _fields_ = [('mask', ctypes.c_uint32), ('blockSize', ctypes.c_uint32),
                ('attributes', ctypes.c_uint64), ('nlink', ctypes.c_uint32),
                ('uid', ctypes.c_uint32), ('gid', ctypes.c_uint32),
                ('mode', ctypes.c_uint16), ('spare', ctypes.c_uint16),
                ('inode', ctypes.c_uint64), ('size', ctypes.c_uint64),
                ('blocks', ctypes.c_uint64), ('attributesMask', ctypes.c_uint64),
                ('atime', Timestamp), ('btime', Timestamp), ('ctime', Timestamp), ('mtime', Timestamp),
                ('rdevMajor', ctypes.c_uint32), ('rdevMinor', ctypes.c_uint32),
                ('devMajor', ctypes.c_uint32), ('devMinor', ctypes.c_uint32),
                ('mountId', ctypes.c_uint64), ('reserved2', ctypes.c_uint64 * 13)]


def account_names(root, filename):
    result = {}
    try:
        with open(os.path.join(root, 'etc', filename), encoding='utf-8', errors='replace') as source:
            for line in source:
                fields = line.rstrip().split(':')
                if len(fields) > 2:
                    result[fields[2]] = fields[0]
    except OSError:
        pass
    return result


def timestamp(value):
    return {'seconds': str(value // 1_000_000_000), 'nanoseconds': value % 1_000_000_000}


def extended_stat(path):
    if sys.platform != 'linux':
        return None, 'statx requires Linux'
    libc = ctypes.CDLL(None, use_errno=True)
    call = getattr(libc, 'statx', None)
    if call is None:
        return None, 'libc does not expose statx'
    result = Statx()
    # AT_SYMLINK_NOFOLLOW | AT_NO_AUTOMOUNT; request basic stats and birth time.
    if call(-100, ctypes.c_char_p(os.fsencode(path)), 0x900, 0xfff, ctypes.byref(result)) != 0:
        return None, os.strerror(ctypes.get_errno())
    return result, None


def acl_entries(raw):
    if len(raw) < 4 or struct.unpack_from('<I', raw)[0] != 2 or (len(raw) - 4) % 8:
        return {'rawBase64': base64.b64encode(raw).decode(), 'decodeError': 'unknown POSIX ACL encoding'}
    tags = {1: 'owner', 2: 'user', 4: 'owning-group', 8: 'group', 16: 'mask', 32: 'other'}
    return [{'tag': tags.get(tag, str(tag)), 'permissions': perm, 'id': None if identifier == 0xffffffff else identifier}
            for tag, perm, identifier in struct.iter_unpack('<HHI', raw[4:])]


def xattributes(path):
    values, errors = {}, []
    if not hasattr(os, 'listxattr'):
        return values, {'status': 'unsupported', 'reason': 'extended attributes unavailable'}, errors
    try:
        names = os.listxattr(path, follow_symlinks=False)
    except OSError as error:
        state = 'unsupported' if error.errno in (errno.ENOTSUP, errno.EOPNOTSUPP) else 'unavailable'
        return values, {'status': state, 'reason': str(error)}, [] if state == 'unsupported' else [{'operation': 'listxattr', 'error': str(error)}]
    for name in sorted(names):
        try:
            values[name] = base64.b64encode(os.getxattr(path, name, follow_symlinks=False)).decode()
        except OSError as error:
            errors.append({'operation': 'getxattr', 'name': name, 'error': str(error)})
    return values, {'status': 'partial' if errors else 'available'}, errors


def inspect_path(path, relative, users, groups):
    info = os.lstat(path)
    kinds = [(stat.S_ISREG, 'file'), (stat.S_ISDIR, 'directory'), (stat.S_ISLNK, 'symlink'),
             (stat.S_ISCHR, 'character-device'), (stat.S_ISBLK, 'block-device'),
             (stat.S_ISFIFO, 'fifo'), (stat.S_ISSOCK, 'socket')]
    kind = next((name for test, name in kinds if test(info.st_mode)), 'unknown')
    sx, sx_error = extended_stat(path)
    attrs, attrs_state, errors = xattributes(path)
    mode = stat.S_IMODE(info.st_mode)
    record = {
        'path': relative, 'pathBytesBase64': base64.b64encode(os.fsencode(relative)).decode(), 'type': kind,
        'mode': info.st_mode, 'permissionsOctal': format(mode, '04o'), 'permissions': stat.filemode(info.st_mode),
        'accessBits': {name: {'read': bool(mode & (4 << shift)), 'write': bool(mode & (2 << shift)), 'execute': bool(mode & (1 << shift))}
                       for name, shift in [('owner', 6), ('group', 3), ('other', 0)]},
        'specialBits': {'setuid': bool(mode & stat.S_ISUID), 'setgid': bool(mode & stat.S_ISGID), 'sticky': bool(mode & stat.S_ISVTX)},
        'uid': info.st_uid, 'gid': info.st_gid, 'user': users.get(str(info.st_uid)), 'group': groups.get(str(info.st_gid)),
        'sizeBytes': str(info.st_size), 'blocks': str(getattr(info, 'st_blocks', 0)) if hasattr(info, 'st_blocks') else None,
        'allocatedBytes': str(info.st_blocks * 512) if hasattr(info, 'st_blocks') else None,
        'blockSize': getattr(info, 'st_blksize', None), 'inode': str(info.st_ino), 'device': str(info.st_dev),
        'deviceMajor': os.major(info.st_dev) if hasattr(os, 'major') else None,
        'deviceMinor': os.minor(info.st_dev) if hasattr(os, 'minor') else None,
        'rdev': str(info.st_rdev) if hasattr(info, 'st_rdev') else None, 'hardlinkCount': info.st_nlink,
        'rdevMajor': os.major(info.st_rdev) if hasattr(os, 'major') and hasattr(info, 'st_rdev') else None,
        'rdevMinor': os.minor(info.st_rdev) if hasattr(os, 'minor') and hasattr(info, 'st_rdev') else None,
        'hardlinkKey': f'{info.st_dev}:{info.st_ino}' if kind == 'file' and info.st_nlink > 1 else None,
        'times': {'modified': timestamp(info.st_mtime_ns), 'accessed': timestamp(info.st_atime_ns),
                  'changed': timestamp(info.st_ctime_ns), 'created': None},
        'attributes': None, 'attributesMask': None, 'statxMask': None,
        'fieldAvailability': {'statx': {'status': 'available' if sx else 'unsupported', 'reason': sx_error}, 'xattrs': attrs_state,
                              'birthTime': {'status': 'unsupported', 'reason': sx_error or 'STATX_BTIME not returned'}},
        'linkTarget': os.readlink(path) if kind == 'symlink' else None,
        'xattrs': attrs, 'acl': {}, 'capabilities': attrs.get('security.capability'),
        'sha256': None, 'hashStatus': 'not-applicable', 'errors': errors,
    }
    if sx:
        record.update(attributes=str(sx.attributes), attributesMask=str(sx.attributesMask), statxMask=sx.mask)
        if sx.mask & 0x800:
            record['times']['created'] = {'seconds': str(sx.btime.seconds), 'nanoseconds': sx.btime.nanoseconds}
            record['fieldAvailability']['birthTime'] = {'status': 'available'}
        else:
            record['fieldAvailability']['birthTime'] = {'status': 'unsupported', 'reason': 'STATX_BTIME not returned'}
    elif os.name == 'nt':
        # Windows st_ctime is creation time, and lstat/fstat can observe different
        # deferred NTFS values. It is not POSIX metadata-change time.
        record['times']['changed'] = None
        record['fieldAvailability']['changeTime'] = {'status': 'unsupported', 'reason': 'Windows stat does not expose POSIX ctime'}
        if hasattr(info, 'st_birthtime_ns'):
            record['times']['created'] = timestamp(info.st_birthtime_ns)
            record['fieldAvailability']['birthTime'] = {'status': 'available'}
    for name in ('system.posix_acl_access', 'system.posix_acl_default'):
        if name in attrs:
            record['acl'][name] = acl_entries(base64.b64decode(attrs[name]))
    if kind == 'file':
        try:
            digest = hashlib.sha256()
            # Do not follow a substituted symlink; ensure metadata and hashed inode match.
            flags = os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_NONBLOCK', 0)
            descriptor = os.open(path, flags)
            with os.fdopen(descriptor, 'rb') as source:
                before = os.fstat(source.fileno())
                identity = ['st_dev', 'st_ino', 'st_mode', 'st_uid', 'st_gid', 'st_size', 'st_mtime_ns'] + (['st_ctime_ns'] if os.name == 'posix' else [])
                if any(getattr(before, key) != getattr(info, key) for key in identity):
                    raise OSError('file changed before hashing')
                for chunk in iter(lambda: source.read(1024 * 1024), b''):
                    digest.update(chunk)
                after = os.fstat(source.fileno())
                stable = ['st_size', 'st_mtime_ns'] + (['st_ctime_ns'] if os.name == 'posix' else [])
                if any(getattr(before, key) != getattr(after, key) for key in stable):
                    raise OSError('file changed during hashing')
            record.update(sha256=digest.hexdigest(), hashStatus='complete')
        except OSError as error:
            record['hashStatus'] = 'failed'
            record['errors'].append({'operation': 'hash', 'error': str(error)})
    return record


def resolve_link(path, root, excluded, record):
    """Resolve link metadata only; never walk or hash its destination contents."""
    record['resolvedPath'] = None
    try:
        target = os.path.realpath(path, strict=True)
        if os.path.commonpath([root, target]) != root:
            record['linkState'] = 'outside-inventory'
            return
        relative = '/' + os.path.relpath(target, root).replace(os.sep, '/') if target != root else '/'
        record['resolvedPath'] = relative
        record['linkState'] = 'excluded' if any(relative == item or relative.startswith(item + '/') for item in excluded) else 'resolved'
    except OSError as error:
        record['linkState'] = 'cycle' if error.errno == errno.ELOOP else 'dangling' if error.errno in (errno.ENOENT, errno.ENOTDIR) else 'unavailable'
        record['fieldAvailability']['linkResolution'] = {'status': 'unavailable', 'reason': str(error)}
        if record['linkState'] == 'unavailable':
            record['errors'].append({'operation': 'resolve-link', 'error': str(error)})


def package_owners(root):
    owners = {}
    directory = os.path.join(root, 'var/lib/dpkg/info')
    try:
        names = sorted(os.listdir(directory))
    except OSError:
        return owners
    for name in names:
        if not name.endswith('.list'):
            continue
        with open(os.path.join(directory, name), encoding='utf-8', errors='surrogateescape') as source:
            for line in source:
                item = line.rstrip('\n')
                if item.startswith('/'):
                    owners.setdefault(item, []).append(name[:-5])
    return owners


def package_versions(root):
    versions = {}
    try:
        with open(os.path.join(root, 'var/lib/dpkg/status'), encoding='utf-8', errors='surrogateescape') as source:
            for block in source.read().split('\n\n'):
                fields = dict(line.split(': ', 1) for line in block.splitlines() if ': ' in line and not line.startswith(' '))
                if fields.get('Status') == 'install ok installed' and fields.get('Package'):
                    value = {'name': fields['Package'], 'version': fields.get('Version'), 'architecture': fields.get('Architecture')}
                    versions[fields['Package']] = value
                    versions[fields['Package'] + ':' + fields.get('Architecture', '')] = value
    except FileNotFoundError:
        pass
    return versions


def scan(root, excluded, emit):
    users, groups = account_names(root, 'passwd'), account_names(root, 'group')
    owners = package_owners(root)
    versions = package_versions(root)
    counters = {'entries': 0, 'files': 0, 'errors': 0}
    root = os.path.abspath(root)

    def visit(path, relative):
        if any(relative == item or relative.startswith(item + '/') for item in excluded):
            return
        try:
            record = inspect_path(path, relative, users, groups)
        except OSError as error:
            record = {'path': relative, 'type': 'unavailable', 'errors': [{'operation': 'lstat', 'error': str(error)}]}
        if record['type'] == 'symlink':
            resolve_link(path, root, excluded, record)
        record['packages'] = owners.get(relative, [])
        record['packageVersions'] = [versions.get(name, {'name': name, 'version': None, 'reason': 'not found in installed package database'}) for name in record['packages']]
        counters['entries'] += 1
        counters['files'] += record['type'] == 'file'
        counters['errors'] += len(record['errors'])
        emit(record)
        if record['type'] == 'directory':
            try:
                with os.scandir(path) as source:
                    children = sorted(source, key=lambda item: os.fsencode(item.name))
                for child in children:
                    visit(child.path, (relative.rstrip('/') + '/' + child.name))
            except OSError as error:
                counters['errors'] += 1
                emit({'path': relative, 'type': 'traversal-error', 'errors': [{'operation': 'scandir', 'error': str(error)}]})

    visit(root, '/')
    return counters


def mounted_paths():
    excluded = set(['/__collector'])
    with open('/proc/self/mountinfo', encoding='utf-8') as source:
        for line in source:
            path = line.split(' ')[4]
            for escaped, literal in [('\\040', ' '), ('\\011', '\t'), ('\\012', '\n'), ('\\134', '\\')]:
                path = path.replace(escaped, literal)
            if path != '/':
                excluded.add(path)
    return sorted(excluded)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', default='/')
    parser.add_argument('--stage', required=True, choices=['base', 'dependencies', 'software'])
    parser.add_argument('--exclude', action='append', default=[])
    args = parser.parse_args()
    excluded = sorted(set(args.exclude + (mounted_paths() if args.root == '/' and sys.platform == 'linux' else [])))
    emit = lambda value: print(json.dumps(value, ensure_ascii=True, separators=(',', ':')), flush=True)
    emit({'recordType': 'header', 'schemaVersion': 1, 'stage': args.stage, 'excludedMounts': excluded,
          'platform': sys.platform, 'metadataPolicy': 'lstat before hash; no symlink traversal; no special-file reads'})
    counts = scan(args.root, excluded, emit)
    emit({'recordType': 'summary', **counts, 'complete': counts['errors'] == 0})
    sys.exit(0 if counts['errors'] == 0 else 2)
