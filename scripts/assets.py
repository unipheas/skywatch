"""Reproducible tiny transparent pixel icons; no image dependencies."""
from pathlib import Path
import struct, zlib
root = Path(__file__).resolve().parents[1]
def png(path, rows, color):
    h, w = len(rows), len(rows[0])
    raw = b''.join(b'\0' + b''.join(bytes(color if c == '#' else (0,0,0,0)) for c in row) for row in rows)
    def chunk(t, data):
        return struct.pack('>I',len(data))+t+data+struct.pack('>I',zlib.crc32(t+data)&0xffffffff)
    path.write_bytes(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',w,h,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(raw))+chunk(b'IEND',b''))
png(root/'src/appmeta/icon_front_8x8.png',[
'...#....','...#....','..###...','.#####..','#######.','...#....','..###...','........'],(82,217,255,255))
png(root/'src/appmeta/icon_back_11x11.png',[
'.....#.....','.....#.....','.....#.....','....###....','...#####...','.#########.','###########','.....#.....','....###....','...#####...','...........'],(136,136,136,255))
