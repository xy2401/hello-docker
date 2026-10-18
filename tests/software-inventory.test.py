import hashlib
import importlib.util
import io
import os
from pathlib import Path
import stat
import tarfile
import tempfile
import unittest
from unittest.mock import patch


def module(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).resolve().parents[1] / 'scripts/software' / (name + '.py'))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


scan = module('scan')
archive = module('archive')


class InventoryTests(unittest.TestCase):
    def test_package_owner_has_exact_version_and_architecture(self):
        with tempfile.TemporaryDirectory() as root:
            info = Path(root, 'var/lib/dpkg/info')
            info.mkdir(parents=True)
            Path(root, 'example.conf').write_bytes(b'config')
            owner = 'example:amd64' if os.name == 'posix' else 'example'
            Path(info, owner + '.list').write_text('/example.conf\n', encoding='utf-8')
            Path(root, 'var/lib/dpkg/status').write_text('Package: example\nStatus: install ok installed\nVersion: 1.2.3-4\nArchitecture: amd64\n\n', encoding='utf-8')
            records = []
            scan.scan(root, [], records.append)
            record = next(item for item in records if item['path'] == '/example.conf')
            self.assertEqual(record['packages'], [owner])
            self.assertEqual(scan.package_versions(root)['example:amd64']['version'], '1.2.3-4')
            self.assertEqual(record['packageVersions'], [{'name': 'example', 'version': '1.2.3-4', 'architecture': 'amd64'}])

    def test_includes_hidden_non_executable_empty_and_directories(self):
        with tempfile.TemporaryDirectory() as root:
            Path(root, '.hidden.conf').write_bytes(b'configuration')
            Path(root, 'empty').write_bytes(b'')
            Path(root, 'directory').mkdir()
            records = []
            counts = scan.scan(root, [], records.append)
            by_path = {item['path']: item for item in records}
            self.assertTrue(counts['errors'] == 0)
            self.assertEqual(by_path['/.hidden.conf']['sha256'], hashlib.sha256(b'configuration').hexdigest())
            self.assertEqual(by_path['/empty']['sizeBytes'], '0')
            self.assertEqual(by_path['/empty']['sha256'], hashlib.sha256(b'').hexdigest())
            self.assertEqual(by_path['/directory']['type'], 'directory')
            self.assertIn('accessBits', by_path['/.hidden.conf'])
            self.assertIn('fieldAvailability', by_path['/.hidden.conf'])

    def test_hash_error_is_retained(self):
        with tempfile.TemporaryDirectory() as root:
            file = Path(root, 'private')
            file.write_bytes(b'private')
            with patch.object(scan.os, 'open', side_effect=PermissionError('fixture denied')):
                record = scan.inspect_path(str(file), '/private', {}, {})
            self.assertEqual(record['hashStatus'], 'failed')
            self.assertIsNone(record['sha256'])
            self.assertEqual(record['errors'][-1]['operation'], 'hash')

    def test_traversal_failure_does_not_disappear(self):
        with tempfile.TemporaryDirectory() as root:
            records = []
            with patch.object(scan.os, 'scandir', side_effect=PermissionError('fixture denied')):
                counts = scan.scan(root, [], records.append)
            self.assertEqual(counts['errors'], 1)
            self.assertEqual(records[-1]['type'], 'traversal-error')

    def test_sparse_file_hashes_logical_content(self):
        with tempfile.TemporaryDirectory() as root:
            file = Path(root, 'sparse')
            with file.open('wb') as stream:
                stream.seek(1024 * 1024)
                stream.write(b'x')
            record = scan.inspect_path(str(file), '/sparse', {}, {})
            self.assertEqual(record['sizeBytes'], str(1024 * 1024 + 1))
            self.assertEqual(record['sha256'], hashlib.sha256(b'\0' * 1024 * 1024 + b'x').hexdigest(), record['errors'])

    @unittest.skipUnless(os.name == 'posix', 'POSIX permissions, links and special files are exercised in Linux CI')
    def test_links_permissions_fifo_socket_and_lossless_paths(self):
        import socket
        with tempfile.TemporaryDirectory() as root:
            file = Path(root, 'tool')
            file.write_bytes(b'payload')
            file.chmod(0o6751)
            os.symlink('tool', Path(root, 'alias'))
            os.symlink('missing', Path(root, 'dangling'))
            os.symlink('cycle', Path(root, 'cycle'))
            os.link(file, Path(root, 'hardlink'))
            os.mkfifo(Path(root, 'fifo'))
            Path(root, 'space and\nnewline').write_bytes(b'file')
            raw = os.fsencode(root) + b'/invalid-\xff'
            fd = os.open(raw, os.O_CREAT | os.O_WRONLY, 0o600)
            os.close(fd)
            with socket.socket(socket.AF_UNIX) as sock:
                sock.bind(str(Path(root, 'socket')))
                records = []
                counts = scan.scan(root, [], records.append)
            entries = {entry['path']: entry for entry in records}
            self.assertEqual(counts['errors'], 0)
            self.assertEqual(entries['/alias']['type'], 'symlink')
            self.assertEqual(entries['/alias']['resolvedPath'], '/tool')
            self.assertEqual(entries['/alias']['linkState'], 'resolved')
            self.assertEqual(entries['/dangling']['linkState'], 'dangling')
            self.assertEqual(entries['/cycle']['linkState'], 'cycle')
            self.assertIsNone(entries['/alias']['sha256'])
            self.assertEqual(entries['/tool']['hardlinkKey'], entries['/hardlink']['hardlinkKey'])
            self.assertEqual(entries['/tool']['permissionsOctal'], '6751')
            self.assertTrue(entries['/tool']['specialBits']['setuid'])
            self.assertEqual(entries['/fifo']['hashStatus'], 'not-applicable')
            self.assertEqual(entries['/socket']['hashStatus'], 'not-applicable')
            self.assertIn('/space and\nnewline', entries)
            self.assertTrue(all('pathBytesBase64' in item for item in records))

    def test_acl_mask_and_named_user_are_decoded(self):
        import struct
        raw = struct.pack('<IHHIHHI', 2, 2, 6, 1001, 16, 4, 0xffffffff)
        self.assertEqual(scan.acl_entries(raw), [{'tag': 'user', 'permissions': 6, 'id': 1001}, {'tag': 'mask', 'permissions': 4, 'id': None}])


class ArchiveTests(unittest.TestCase):
    def make_archive(self, filename, entries):
        with tarfile.open(filename, 'w:gz') as target:
            for name, content in entries:
                info = tarfile.TarInfo(name)
                if isinstance(content, str):
                    info.type = tarfile.SYMTYPE
                    info.linkname = content
                    target.addfile(info)
                else:
                    info.size = len(content)
                    target.addfile(info, io.BytesIO(content))

    def test_payload_proof_hashes_all_files_not_just_bin(self):
        with tempfile.TemporaryDirectory() as root:
            filename = Path(root, 'payload.tar.gz')
            self.make_archive(filename, [('release/bin/tool', b'executable'), ('release/share/docs/readme', b'document')])
            proofs = archive.process(str(filename), '/opt/product', 1, artifact_id='fixture')
            self.assertEqual([entry['path'] for entry in proofs], ['/opt/product/bin/tool', '/opt/product/share/docs/readme'])
            self.assertEqual(proofs[1]['sha256'], hashlib.sha256(b'document').hexdigest())

    def test_validated_payload_installs_with_stripped_root(self):
        with tempfile.TemporaryDirectory() as root:
            filename = Path(root, 'payload.tar.gz')
            self.make_archive(filename, [('release/bin/tool', b'executable'), ('release/share/readme', b'document')])
            target = Path(root, 'target')
            archive.process(str(filename), str(target), 1, install=True)
            self.assertEqual(Path(target, 'bin/tool').read_bytes(), b'executable')
            self.assertEqual(Path(target, 'share/readme').read_bytes(), b'document')

    def test_unsafe_paths_and_links_are_rejected_before_install(self):
        with tempfile.TemporaryDirectory() as root:
            for entries in [[('release/../escape', b'bad')], [('release/link', '../../escape')]]:
                filename = Path(root, 'payload.tar.gz')
                self.make_archive(filename, entries)
                target = Path(root, 'target')
                with self.assertRaises(ValueError):
                    archive.process(str(filename), str(target), 1, install=True)
                self.assertFalse(target.exists())


if __name__ == '__main__':
    unittest.main()
