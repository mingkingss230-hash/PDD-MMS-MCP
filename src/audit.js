import fs from 'node:fs';
import { AUDIT_LOG } from './config.js';

/** 每次写操作追加一行 JSONL 审计日志 */
export function audit(entry) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
  fs.appendFileSync(AUDIT_LOG, line + '\n');
  return line;
}
