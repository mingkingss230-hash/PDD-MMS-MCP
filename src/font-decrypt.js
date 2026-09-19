import opentype from 'opentype.js';

/**
 * 拼多多数据中心字体反爬解密（还原自店透视 _pdd_sycm chunk 的字体映射模块）：
 * 1. 拿到 webspider TTF 字体（phantom 接口下发，或页面 HTML 内嵌）
 * 2. 解析 glyph 表，建立 PUA 字符 → 数字/小数点 的映射
 *    策略A：glyph.name 即 zero/one/.../nine/period
 *    策略B：按字形最后一笔 x 坐标排序，与参照位置表逐位比对（容差 8）
 * 3. 密文串逐字符过映射还原
 */

const NAME_MAP = {
  period: '.',
  zero: '0', one: '1', two: '2', three: '3', four: '4',
  five: '5', six: '6', seven: '7', eight: '8', nine: '9',
};

// 参照位置表（该字体字形在文件中的固定横向排布）
const REFERENCE = [
  { value: '2', lastX: 0x2c }, { value: '.', lastX: 0x53 }, { value: '0', lastX: 0x84 },
  { value: '9', lastX: 0x86 }, { value: '8', lastX: 0x9b }, { value: '3', lastX: 0xda },
  { value: '4', lastX: 0x153 }, { value: '1', lastX: 0x164 }, { value: '6', lastX: 0x19e },
  { value: '5', lastX: 0x1d6 }, { value: '7', lastX: 0x1fd },
];

function lastXOfGlyph(g) {
  const cmds = g && g.path && Array.isArray(g.path.commands) ? g.path.commands : [];
  for (let i = cmds.length - 1; i >= 0; i--) {
    if (typeof cmds[i].x === 'number') return cmds[i].x;
  }
  if (g && Array.isArray(g.points) && g.points.length) {
    return g.points[g.points.length - 1].x;
  }
  return null;
}

/** 从 opentype 解析出的 font 对象构建 PUA→数字 映射；失败返回 null */
export function buildFontMap(font) {
  const glyphs = font && font.glyphs && font.glyphs.glyphs ? font.glyphs.glyphs : null;
  if (!glyphs) return null;
  const keys = Object.keys(glyphs).filter((k) => glyphs[k] && typeof glyphs[k].unicode === 'number');

  // 策略A：glyph 名
  const byName = {};
  for (const k of keys) {
    const g = glyphs[k];
    const digit = g.name ? NAME_MAP[g.name] : '';
    if (digit) byName[String.fromCharCode(g.unicode)] = digit;
  }
  if (keys.length && Object.keys(byName).length === keys.length) return byName;

  // 策略B：字形位置指纹
  const entries = [];
  for (const k of keys) {
    const g = glyphs[k];
    const lx = lastXOfGlyph(g);
    if (typeof lx !== 'number') return null;
    entries.push({ unicode: g.unicode, lastX: lx });
  }
  if (entries.length !== REFERENCE.length) return null;
  entries.sort((a, b) => a.lastX - b.lastX);
  const map = {};
  for (let i = 0; i < entries.length; i++) {
    if (Math.abs(entries[i].lastX - REFERENCE[i].lastX) > 8) return null;
    map[String.fromCharCode(entries[i].unicode)] = REFERENCE[i].value;
  }
  return map;
}

const isPua = (ch) => {
  const c = ch.codePointAt(0);
  return c >= 0xe000 && c <= 0xf8ff;
};

export function hasPuaChars(str) {
  if (typeof str !== 'string') return false;
  for (const ch of str) if (isPua(ch)) return true;
  return false;
}

/** 密文串还原；不含 PUA 字符的原样返回 */
export function decodeWithMap(str, map) {
  if (typeof str !== 'string' || !map || !hasPuaChars(str)) return str;
  return str.split('').map((ch) => (map[ch] !== undefined ? map[ch] : ch)).join('');
}

/** 递归解密对象里的所有字符串 */
export function deepDecode(obj, map) {
  if (!map) return obj;
  if (typeof obj === 'string') return decodeWithMap(obj, map);
  if (Array.isArray(obj)) return obj.map((v) => deepDecode(v, map));
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) out[k] = deepDecode(v, map);
    return out;
  }
  return obj;
}

/**
 * 下载 TTF 并构建映射。fetchTtfUrl: 异步取字体下载地址；
 * fetchBuf: (url) => Promise<ArrayBuffer>
 */
export async function buildMapFromFont(fetchTtfUrl, fetchBuf) {
  const url = await fetchTtfUrl();
  if (!url) throw new Error('未获取到字体下载地址');
  const buf = await fetchBuf(url);
  const font = opentype.parse(buf instanceof ArrayBuffer ? buf : buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const map = buildFontMap(font);
  if (!map) throw new Error('字体映射构建失败（glyph 名与位置指纹均未匹配）');
  return { url, map };
}
