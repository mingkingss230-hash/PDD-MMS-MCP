import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

/** 多店铺配置：config/shops.json（含账密，已 gitignore；模板见 shops.example.json） */
export function loadShops() {
  const file = path.join(ROOT, 'config', 'shops.json');
  if (!fs.existsSync(file)) return {};
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    delete j._说明;
    return j;
  } catch (e) {
    throw new Error(`shops.json 解析失败: ${e.message}`);
  }
}

/** 取指定店铺配置；未指定时若只有一个店铺则返回它 */
export function getShop(name) {
  const shops = loadShops();
  const names = Object.keys(shops);
  if (!names.length) throw new Error('未找到 config/shops.json（多店铺配置），请按 shops.example.json 创建并填入账密');
  const key = name && names.find((n) => n === name);
  if (name && !key) throw new Error(`店铺 "${name}" 不在 shops.json 中（现有: ${names.join(', ')}）`);
  const chosen = key || (names.length === 1 ? names[0] : null);
  if (!chosen) throw new Error(`存在多个店铺（${names.join(', ')}），请指定 shop 参数`);
  return { name: chosen, ...shops[chosen] };
}
