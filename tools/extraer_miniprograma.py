"""Decrypt a PC WeChat V1MMWX .wxapkg and unpack it. Usage: wxapkg.py <appid> <in.wxapkg> <out_dir>"""
import hashlib, os, struct, sys
from Crypto.Cipher import AES

appid, src, out = sys.argv[1], sys.argv[2], sys.argv[3]
data = open(src, 'rb').read()

if data[:6] == b'V1MMWX':
    key = hashlib.pbkdf2_hmac('sha1', appid.encode(), b'saltiest', 1000, 32)
    head = AES.new(key, AES.MODE_CBC, b'the iv: 16 bytes').decrypt(data[6:1030])[:1023]
    xor = ord(appid[-2]) if len(appid) >= 2 else 0x66
    data = head + bytes(b ^ xor for b in data[1030:])

if data[0] != 0xBE or data[13] != 0xED:
    sys.exit(f'not a wxapkg after decryption: first={data[0]:#x} mark={data[13]:#x}')

_, index_len, body_len = struct.unpack('>III', data[1:13])
count = struct.unpack('>I', data[14:18])[0]
pos, root = 18, os.path.realpath(out)
for _ in range(count):
    (nlen,) = struct.unpack('>I', data[pos:pos + 4]); pos += 4
    name = data[pos:pos + nlen].decode('utf-8', 'replace'); pos += nlen
    off, size = struct.unpack('>II', data[pos:pos + 8]); pos += 8
    dest = os.path.realpath(os.path.join(root, name.lstrip('/' + chr(92))))
    if not dest.startswith(root + os.sep):
        print('skip unsafe path', name); continue
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, 'wb') as f:
        f.write(data[off:off + size])
    print(f'{size:9d}  {name}')
print(f'{count} files')
