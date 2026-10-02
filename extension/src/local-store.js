import { normalizeHandle } from './x-page.js';
import { DEFAULT_SETTINGS, validateSettings } from './cleanup-session.js';

export class LocalStore {
  constructor(storage, owner) {
    this.storage = storage;
    this.prefix = `fake-friend/v0/${normalizeHandle(owner)}/`;
    this.run = null;
  }
  async load() {
    const key = `${this.prefix}config`;
    const data = (await this.storage.get(key))[key];
    if (data === undefined) return { settings: { ...DEFAULT_SETTINGS }, keep: new Set(), keepProfiles: new Map() };
    if (data.protocol !== 'v0' || !Array.isArray(data.keep)) throw new Error('本地配置格式不正确，请检查扩展存储。');
    const keep = new Set(data.keep.map(normalizeHandle));
    const profileData = keep.size ? await this.storage.get([...keep].map(handle => `${this.prefix}profile/${handle}`)) : {};
    return { settings: validateSettings(data.settings), keep, keepProfiles: this.readKeepProfiles(profileData, keep) };
  }
  async save(settings, keep, keepProfiles = new Map()) {
    await this.storage.set({
      [`${this.prefix}config`]: { protocol: 'v0', settings: validateSettings(settings), keep: [...keep].map(normalizeHandle) },
      ...this.keepProfileRecords(keepProfiles)
    });
  }
  readKeepProfiles(data, keep) {
    const profiles = new Map();
    for (const handle of keep) {
      const value = data[`${this.prefix}profile/${handle}`];
      // 以前的白名单和备份只有账号，没有头像资料。
      if (value === undefined) continue;
      profiles.set(handle, this.readKeepProfile(handle, value));
    }
    return profiles;
  }
  readKeepProfile(handle, value) {
    if (!value || typeof value !== 'object' || value.handle !== handle || typeof value.name !== 'string' || typeof value.avatarUrl !== 'string' ||
      value.avatarUrl && !/^https:\/\//.test(value.avatarUrl)) {
      throw new Error('白名单头像和名称资料格式不正确。');
    }
    return { handle, name: value.name, avatarUrl: value.avatarUrl };
  }
  keepProfileRecords(profiles) {
    return Object.fromEntries([...profiles].map(([handle, value]) => {
      const normalized = normalizeHandle(handle);
      return [`${this.prefix}profile/${normalized}`, this.readKeepProfile(normalized, value)];
    }));
  }
  readKeepBackup(text) {
    let data;
    try { data = JSON.parse(text); }
    catch { throw new Error('备份文件不是有效的 JSON。'); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('备份白名单格式不正确。');
    const key = `${this.prefix}config`;
    if (!Object.hasOwn(data, key)) throw new Error('备份中没有当前登录账号的白名单，请选择这个账号导出的文件。');
    const config = data[key];
    if (!config || config.protocol !== 'v0' || !Array.isArray(config.keep) || config.keep.some(handle => typeof handle !== 'string')) {
      throw new Error('备份白名单格式不正确。');
    }
    const keep = new Set(config.keep.map(normalizeHandle));
    return { keep, keepProfiles: this.readKeepProfiles(data, keep) };
  }
  async beginRun(kind) {
    this.run = { id: crypto.randomUUID(), protocol: 'v0', kind, createdAt: new Date().toISOString(), events: [] };
    await this.storage.set({ [`${this.prefix}run/${this.run.id}`]: this.run });
  }
  async audit(event) {
    if (!this.run) throw new Error('尚未建立本轮操作记录。');
    this.run.events.push({ at: new Date().toISOString(), ...event });
    await this.storage.set({ [`${this.prefix}run/${this.run.id}`]: this.run });
  }
  async exportData() {
    const all = await this.storage.get(null);
    return Object.fromEntries(Object.entries(all).filter(([key]) => key.startsWith(this.prefix)));
  }
}
