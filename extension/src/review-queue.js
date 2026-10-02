export class ReviewQueue {
  constructor(rows) {
    this.rows = [];
    this.decisions = new Map();
    this.addRows(rows);
  }
  addRows(rows) {
    const known = new Map(this.rows.map(row => [row.id, row]));
    for (const row of rows) known.set(row.id, { id: row.id, handle: row.handle, name: row.name, eligible: true });
    this.rows = [...known.values()];
  }
  syncRows(rows) {
    for (const row of this.rows) row.eligible = false;
    this.addRows(rows);
  }
  get totalCount() { return this.rows.filter(row => row.eligible).length; }
  get position() { return this.rows.filter(row => row.eligible && this.decisions.has(row.id)).length; }
  get pendingCount() { return this.totalCount - this.position; }
  get current() { return this.rows.find(row => row.eligible && !this.decisions.has(row.id)) ?? null; }
  get complete() { return this.pendingCount === 0; }
  decide(id, choice) {
    if (!this.current || this.current.id !== id) throw new Error('只能确认当前正在展示的账号。');
    this.choose(id, choice);
  }
  choose(id, choice) {
    if (!this.rows.some(row => row.id === id)) throw new Error('该账号不在本轮确认名单中。');
    if (![null, 'remove', 'keep', 'skip'].includes(choice)) throw new Error('无效的确认选择。');
    if (choice === null) this.decisions.delete(id);
    else this.decisions.set(id, choice);
  }
  approvedIds() {
    return new Set(this.rows.filter(row => row.eligible && this.decisions.get(row.id) === 'remove').map(row => row.id));
  }
}
