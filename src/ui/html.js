// Pequenos ajudantes para montar HTML com segurança.
import { robotById } from '../data/robots.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// nome do robô na cor dele
export const who = (id) => (id ? `<span style="color:${robotById(id)?.color || 'inherit'}">${esc(id)}</span>` : '—');
export const fmtN = (n) => (n || 0).toLocaleString('pt-BR');
