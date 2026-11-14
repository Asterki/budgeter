/** Settings: appearance, accounts, categories, portability and About. */

import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { FiDownload, FiEdit2, FiPlus, FiTrash2, FiUpload } from 'react-icons/fi';

import { AccountDialog } from '../components/AccountDialog';
import { CategoryDialog } from '../components/CategoryDialog';
import { ConfirmDialog, Dialog } from '../components/Dialog';
import { RecurringDialog } from '../components/RecurringDialog';
import { CsvImportDialog } from '../components/CsvImportDialog';
import { useBudget } from '../state/store';
import { accountBalance, formatMoney } from '../domain/money';
import { ACHIEVEMENTS } from '../domain/achievements';
import { levelProgress } from '../domain/progress';
import { formatDate, todayISO } from '../domain/date';
import { describeRecurrence } from '../domain/recurrence';
import { connectSync, disconnectSync, getSyncInfo, getSyncStatus, syncNow, subscribeSync } from '../sync/engine';
import { NewSyncSpaceError, type SyncInfo, type SyncStatus } from '../sync/types';
import type { Account, Category, CategoryGroup, RecurringRule } from '../domain/types';

type Notice = { tone: 'ok' | 'warn' | 'error'; text: string } | null;

export function SettingsView() {
  const {
    accounts,
    categories,
    categoryGroups,
    transactions,
    budgets,
    payees,
    recurring,
    rules,
    settings,
    createCategoryGroup,
    deleteCategoryGroup,
    createRule,
    deleteRule,
    updateSettings,
    updateRecurring,
    deleteRecurring,
    skipRecurring,
    catchUpRecurring,
    buildBackup,
    restoreBackup,
    resetEverything,
  } = useBudget();

  const [accountDialog, setAccountDialog] = useState<{ account: Account | null } | null>(null);
  const [categoryDialog, setCategoryDialog] = useState<{
    category: Category | null;
    groupId: string | null;
  } | null>(null);
  const [recurringEdit, setRecurringEdit] = useState<RecurringRule | null>(null);
  const [recurringDelete, setRecurringDelete] = useState<RecurringRule | null>(null);
  const [groupName, setGroupName] = useState('');
  const [groupToDelete, setGroupToDelete] = useState<CategoryGroup | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [csvOpen, setCsvOpen] = useState(false);
  const [rulePattern, setRulePattern] = useState('');
  const [ruleCategory, setRuleCategory] = useState('');
  const [notice, setNotice] = useState<Notice>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(() => getSyncStatus());
  const [syncInfo, setSyncInfo] = useState<SyncInfo | null>(null);
  const [relayUrl, setRelayUrl] = useState(import.meta.env.VITE_SYNC_URL ?? '');
  const [passphrase, setPassphrase] = useState('');
  const [syncBusy, setSyncBusy] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribeSync(setSyncStatus);
    void getSyncInfo().then(setSyncInfo);
    return unsubscribe;
  }, []);

  async function handleConnect(create: boolean) {
    if (!relayUrl.trim()) {
      setNotice({ tone: 'error', text: 'Enter the relay URL first.' });
      return;
    }
    if (passphrase.trim().length < 8) {
      setNotice({ tone: 'error', text: 'Use a passphrase of at least 8 characters.' });
      return;
    }

    setSyncBusy(true);
    try {
      const result = await connectSync(relayUrl, passphrase, create);
      setPassphrase('');
      setSyncInfo(await getSyncInfo());
      setNotice({
        tone: 'ok',
        text: result.created ? 'Created a new sync space.' : 'Connected to the sync space.',
      });
    } catch (error) {
      setNotice({
        tone: 'error',
        text:
          error instanceof NewSyncSpaceError
            ? 'No sync space exists for that passphrase. Choose “Create space” to start one.'
            : error instanceof Error
              ? error.message
              : 'Could not connect to the relay.',
      });
    } finally {
      setSyncBusy(false);
    }
  }

  async function handleDisconnect() {
    setSyncBusy(true);
    try {
      await disconnectSync();
      setSyncInfo(null);
      setNotice({ tone: 'warn', text: 'Sync disconnected. Local data is unchanged.' });
    } finally {
      setSyncBusy(false);
    }
  }

  async function handleSyncNow() {
    setSyncBusy(true);
    try {
      await syncNow();
      setSyncInfo(await getSyncInfo());
    } finally {
      setSyncBusy(false);
    }
  }

  function handleAddGroup(event: FormEvent) {
    event.preventDefault();
    if (!groupName.trim()) return;
    createCategoryGroup(groupName.trim());
    setGroupName('');
  }

  function handleExport() {
    const backup = buildBackup();
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `budget-backup-${todayISO()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice({ tone: 'ok', text: `Exported ${backup.transactions.length} transactions.` });
  }

  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const parsed: unknown = JSON.parse(await file.text());
      await restoreBackup(parsed as Parameters<typeof restoreBackup>[0]);
      setNotice({ tone: 'ok', text: 'Backup restored.' });
    } catch (error) {
      setNotice({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Could not restore that file.',
      });
    }
  }

  const groupsWithCategories = categoryGroups.map((group) => ({
    group,
    categories: categories.filter((category) => category.groupId === group.id),
  }));
  const ungrouped = categories.filter((category) => category.groupId === null);
  const { level, floor, next } = levelProgress(settings.progress.xp);
  const ratio = next > floor ? Math.min(1, (settings.progress.xp - floor) / (next - floor)) : 0;
  const unlockedIds = new Set(settings.progress.unlocked);

  return (
    <section className="settings">
      <header className="settings__head">
        <h1 className="settings__title">Settings</h1>
        <p className="settings__subtitle">
          Everything is stored on this device. Export a JSON backup before clearing browser data.
        </p>
      </header>

      {notice && (
        <p className={`notice notice--${notice.tone}`} role="status">
          {notice.text}
        </p>
      )}

      <div className="card">
        <div className="card__head">
          <h2>Progress</h2>
          <span className="badge">Level {level}</span>
        </div>
        <div className="card__body">
          <div className="progress-summary">
            <div>
              <strong>{settings.progress.xp} XP</strong>
              <span className="settings-row__hint">
                {Math.max(0, next - settings.progress.xp)} XP to level {level + 1}
              </span>
            </div>
            <span className="progress-summary__streak">
              {settings.progress.streak}-day streak
            </span>
          </div>
          <div className="progress-meter" aria-hidden="true">
            <span style={{ width: `${Math.round(ratio * 100)}%` }} />
          </div>

          <div className="stat-grid">
            <div className="stat">
              <strong>{settings.progress.totalLogged}</strong>
              <span>logged</span>
            </div>
            <div className="stat">
              <strong>{settings.progress.bestStreak}</strong>
              <span>best streak</span>
            </div>
            <div className="stat">
              <strong>{settings.progress.underBudgetMonths}</strong>
              <span>months under</span>
            </div>
            <div className="stat">
              <strong>{settings.progress.bestSavingsStreak}</strong>
              <span>savings streak</span>
            </div>
            <div className="stat">
              <strong>{settings.progress.reconciled}</strong>
              <span>reconciled</span>
            </div>
            <div className="stat">
              <strong>
                {settings.progress.unlocked.length}/{ACHIEVEMENTS.length}
              </strong>
              <span>achievements</span>
            </div>
          </div>

          <ul className="achievement-list">
            {ACHIEVEMENTS.map((achievement) => {
              const unlocked = unlockedIds.has(achievement.id);
              return (
                <li
                  key={achievement.id}
                  className={`achievement${unlocked ? ' achievement--on' : ''}`}
                >
                  <span className="achievement__mark" aria-hidden="true">
                    {achievement.title.slice(0, 1)}
                  </span>
                  <span className="achievement__body">
                    <strong>{achievement.title}</strong>
                    <span>{achievement.description}</span>
                  </span>
                  <span className="achievement__state">{unlocked ? 'Unlocked' : 'Locked'}</span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      <div className="card">
        <div className="card__head">
          <h2>Appearance</h2>
        </div>
        <div className="card__body">
          <div className="settings-row">
            <div>
              <span className="settings-row__label">Theme</span>
              <span className="settings-row__hint">Dark or light GitHub Primer surfaces.</span>
            </div>
            <div className="segmented">
              {(['light', 'dark'] as const).map((theme) => (
                <button
                  key={theme}
                  type="button"
                  className={`segmented__item${settings.theme === theme ? ' segmented__item--active' : ''}`}
                  aria-pressed={settings.theme === theme}
                  onClick={() => updateSettings({ theme })}
                >
                  {theme === 'light' ? 'Light' : 'Dark'}
                </button>
              ))}
            </div>
          </div>

          <div className="settings-row">
            <div>
              <span className="settings-row__label">Currency</span>
              <span className="settings-row__hint">ISO 4217 code used for every amount.</span>
            </div>
            <input
              className="input input--short"
              value={settings.currency}
              maxLength={3}
              aria-label="Currency code"
              onChange={(event) =>
                updateSettings({ currency: event.target.value.toUpperCase().slice(0, 3) })
              }
            />
          </div>

          <div className="settings-row">
            <div>
              <span className="settings-row__label">Locale</span>
              <span className="settings-row__hint">BCP 47 locale for numbers and dates.</span>
            </div>
            <input
              className="input input--short"
              value={settings.locale}
              aria-label="Locale"
              onChange={(event) => updateSettings({ locale: event.target.value })}
            />
          </div>

          <div className="settings-row">
            <div>
              <span className="settings-row__label">Hide balances</span>
              <span className="settings-row__hint">
                Masks amounts in the header, ledger and account lists.
              </span>
            </div>
            <label className="check-row check-row--inline">
              <input
                type="checkbox"
                checked={settings.hideBalances}
                onChange={(event) => updateSettings({ hideBalances: event.target.checked })}
              />
              Mask amounts
            </label>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card__head">
          <h2>Accounts</h2>
          <button
            type="button"
            className="button"
            onClick={() => setAccountDialog({ account: null })}
          >
            <FiPlus aria-hidden="true" />
            Add account
          </button>
        </div>
        <div className="card__body card__body--flush">
          {accounts.length === 0 ? (
            <p className="card__empty">No accounts yet. Add one to start recording transactions.</p>
          ) : (
            <ul className="settings-list">
              {accounts.map((account) => (
                <li key={account.id} className="settings-list__row">
                  <span className="dot" style={{ background: account.color }} aria-hidden="true" />
                  <span className="settings-list__main">
                    <span className="settings-list__name">
                      {account.name}
                      {account.archived && <span className="badge">Archived</span>}
                    </span>
                    <span className="settings-list__meta">
                      {account.type}
                      {account.creditLimit
                        ? ` · limit ${formatMoney(
                            account.creditLimit,
                            settings.currency,
                            settings.locale,
                            settings.hideBalances,
                          )}`
                        : ''}
                      {account.currency ? ` · ${account.currency}` : ''}
                    </span>
                  </span>
                  <span
                    className={`settings-list__value${
                      account.type === 'credit' &&
                      accountBalance(account, transactions) < 0
                        ? ' amount--out'
                        : ''
                    }`}
                  >
                    {formatMoney(
                      accountBalance(account, transactions),
                      settings.currency,
                      settings.locale,
                      settings.hideBalances,
                    )}
                  </span>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => setAccountDialog({ account })}
                    aria-label={`Edit ${account.name}`}
                  >
                    <FiEdit2 />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card__head">
          <h2>Categories</h2>
          <button
            type="button"
            className="button"
            onClick={() => setCategoryDialog({ category: null, groupId: null })}
          >
            <FiPlus aria-hidden="true" />
            Add category
          </button>
        </div>
        <div className="card__body">
          <form className="inline-form" onSubmit={handleAddGroup}>
            <input
              className="input"
              value={groupName}
              onChange={(event) => setGroupName(event.target.value)}
              placeholder="New category group"
              aria-label="New category group name"
              maxLength={80}
            />
            <button type="submit" className="button" disabled={!groupName.trim()}>
              Add group
            </button>
          </form>

          {groupsWithCategories.map(({ group, categories: groupCategories }) => (
            <div key={group.id} className="category-group">
              <div className="category-group__head">
                <h3>{group.name}</h3>
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => setGroupToDelete(group)}
                  aria-label={`Delete ${group.name}`}
                >
                  <FiTrash2 />
                </button>
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={() => setCategoryDialog({ category: null, groupId: group.id })}
                >
                  <FiPlus aria-hidden="true" />
                  Category
                </button>
              </div>
              {groupCategories.length === 0 ? (
                <p className="card__empty">No categories in this group.</p>
              ) : (
                <ul className="settings-list">
                  {groupCategories.map((category) => (
                    <CategoryRow
                      key={category.id}
                      category={category}
                      onEdit={() => setCategoryDialog({ category, groupId: null })}
                    />
                  ))}
                </ul>
              )}
            </div>
          ))}

          {ungrouped.length > 0 && (
            <div className="category-group">
              <div className="category-group__head">
                <h3>No group</h3>
              </div>
              <ul className="settings-list">
                {ungrouped.map((category) => (
                  <CategoryRow
                    key={category.id}
                    category={category}
                    onEdit={() => setCategoryDialog({ category, groupId: null })}
                  />
                ))}
              </ul>
            </div>
          )}

          {categoryGroups.length === 0 && ungrouped.length === 0 && (
            <p className="card__empty">No categories yet. Add a group first, then a category.</p>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card__head">
          <h2>Recurring</h2>
          <span className="badge">{recurring.filter((rule) => rule.active).length} active</span>
        </div>
        <div className="card__body card__body--flush">
          {recurring.length === 0 ? (
            <p className="card__empty">
              No schedules yet. Add “Repeat” to a transaction, or type “rent 1200 monthly” in the
              ledger.
            </p>
          ) : (
            <ul className="settings-list">
              {recurring.map((rule) => {
                const payee = payees.find((item) => item.id === rule.payeeId);
                const category = categories.find((item) => item.id === rule.categoryId);
                return (
                  <li key={rule.id} className="settings-list__row recurring-row">
                    <span className="settings-list__main">
                      <span className="settings-list__name">
                        {payee?.name || rule.notes || category?.name || 'Recurring transaction'}
                        {!rule.active && <span className="badge">Paused</span>}
                      </span>
                      <span className="settings-list__meta">
                        Next {formatDate(rule.nextDate)} · {describeRecurrence(rule.recurrence)}
                        {category ? ` · ${category.name}` : ''}
                      </span>
                    </span>
                    <span className="settings-list__value">
                      {formatMoney(rule.amount, settings.currency, settings.locale)}
                    </span>
                    <span className="recurring-row__actions">
                      <button
                        type="button"
                        className="button button--ghost"
                        onClick={() => {
                          if (rule.active) {
                            updateRecurring(rule.id, { active: false });
                          } else {
                            updateRecurring(rule.id, { active: true });
                            void catchUpRecurring();
                          }
                        }}
                      >
                        {rule.active ? 'Pause' : 'Resume'}
                      </button>
                      {rule.active && (
                        <button
                          type="button"
                          className="button button--ghost"
                          onClick={() => skipRecurring(rule.id)}
                        >
                          Skip next
                        </button>
                      )}
                      <button
                        type="button"
                        className="icon-button"
                        onClick={() => setRecurringEdit(rule)}
                        aria-label="Edit recurring rule"
                      >
                        <FiEdit2 />
                      </button>
                      <button
                        type="button"
                        className="icon-button"
                        onClick={() => setRecurringDelete(rule)}
                        aria-label="Delete recurring rule"
                      >
                        <FiTrash2 />
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card__head">
          <h2>Sync</h2>
          <span className="badge">{syncStatus.configured ? 'Connected' : 'Off'}</span>
        </div>
        <div className="card__body">
          {syncStatus.configured && syncInfo ? (
            <>
              <div className="settings-row">
                <div>
                  <span className="settings-row__label">Relay</span>
                  <span className="settings-row__hint">{syncInfo.serverUrl}</span>
                </div>
                <span className="settings-row__value">Fingerprint {syncInfo.fingerprint}</span>
              </div>
              <div className="settings-row">
                <div>
                  <span className="settings-row__label">Status</span>
                  <span className="settings-row__hint">
                    {syncStatus.state === 'syncing'
                      ? 'Syncing…'
                      : syncStatus.state === 'offline'
                        ? 'Offline — changes are queued'
                        : syncStatus.state === 'error'
                          ? (syncStatus.error ?? 'Sync error')
                          : syncStatus.state === 'degraded'
                            ? `${syncStatus.quarantined} change(s) rejected by the relay`
                            : 'Up to date'}
                    {syncStatus.pending > 0 ? ` · ${syncStatus.pending} queued` : ''}
                    {syncStatus.skipped > 0 ? ` · ${syncStatus.skipped} skipped` : ''}
                  </span>
                </div>
                <span className="settings-row__value">
                  {syncStatus.lastSyncAt
                    ? `Last sync ${new Date(syncStatus.lastSyncAt).toLocaleString()}`
                    : 'Not synced yet'}
                </span>
              </div>
              <p className="settings-row__hint">
                Accounts, categories and groups, payees, transactions (both transfer legs),
                budgets, recurring rules, categorization rules and settings sync automatically.
              </p>
              <div className="button-row">
                <button
                  type="button"
                  className="button"
                  disabled={syncBusy}
                  onClick={() => void handleSyncNow()}
                >
                  Sync now
                </button>
                <button
                  type="button"
                  className="button button--danger"
                  disabled={syncBusy}
                  onClick={() => void handleDisconnect()}
                >
                  Disconnect
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="settings-row__hint">
                Optional end-to-end encrypted sync through your own relay. The passphrase never
                leaves this device; a forgotten passphrase cannot be recovered.
              </p>
              <label className="field">
                <span>Relay URL</span>
                <input
                  className="input"
                  type="url"
                  placeholder="https://sync.example.com"
                  value={relayUrl}
                  onChange={(event) => setRelayUrl(event.target.value)}
                  autoComplete="off"
                />
              </label>
              <label className="field">
                <span>Passphrase</span>
                <input
                  className="input"
                  type="password"
                  value={passphrase}
                  onChange={(event) => setPassphrase(event.target.value)}
                  autoComplete="new-password"
                />
              </label>
              <div className="button-row">
                <button
                  type="button"
                  className="button button--primary"
                  disabled={syncBusy}
                  onClick={() => void handleConnect(false)}
                >
                  {syncBusy ? 'Working…' : 'Connect'}
                </button>
                <button
                  type="button"
                  className="button"
                  disabled={syncBusy}
                  onClick={() => void handleConnect(true)}
                >
                  Create space
                </button>
              </div>
              {syncStatus.error && (
                <p className="notice notice--error" role="status">
                  {syncStatus.error}
                </p>
              )}
            </>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card__head">
          <h2>Categorization rules</h2>
        </div>
        <div className="card__body">
          <p className="settings-row__hint">
            When a transaction's payee or notes contain the pattern, the category is assigned
            automatically in quick add and CSV import.
          </p>
          {rules.length > 0 ? (
            <ul className="settings-list">
              {rules.map((rule) => (
                <li className="settings-list__item" key={rule.id}>
                  <span className="settings-list__main">
                    <span className="settings-list__name">“{rule.pattern}”</span>
                    <span className="settings-list__meta">
                      {categories.find((category) => category.id === rule.categoryId)?.name ??
                        'Uncategorized'}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => deleteRule(rule.id)}
                    aria-label={`Delete rule ${rule.pattern}`}
                  >
                    <FiTrash2 />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="hint">No rules yet.</p>
          )}

          <form
            className="button-row"
            onSubmit={(event) => {
              event.preventDefault();
              if (!rulePattern.trim() || !ruleCategory) return;
              createRule(rulePattern, ruleCategory);
              setRulePattern('');
              setRuleCategory('');
            }}
          >
            <input
              className="input"
              value={rulePattern}
              onChange={(event) => setRulePattern(event.target.value)}
              placeholder="Contains text, e.g. coffee"
              aria-label="Rule pattern"
            />
            <select
              className="input"
              value={ruleCategory}
              onChange={(event) => setRuleCategory(event.target.value)}
              aria-label="Rule category"
            >
              <option value="">Choose category</option>
              {categories
                .filter((category) => !category.archived)
                .map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
            </select>
            <button
              type="submit"
              className="button"
              disabled={!rulePattern.trim() || !ruleCategory}
            >
              <FiPlus aria-hidden="true" />
              Add rule
            </button>
          </form>
        </div>
      </div>

      <div className="card">
        <div className="card__head">
          <h2>Data</h2>
        </div>
        <div className="card__body">
          <p className="settings-row__hint">
            {transactions.length} transactions · {accounts.length} accounts · {categories.length}{' '}
            categories · {payees.length} payees · {budgets.length} budgets
          </p>
          <div className="button-row">
            <button type="button" className="button" onClick={() => setCsvOpen(true)}>
              <FiUpload aria-hidden="true" />
              Import CSV
            </button>
            <button type="button" className="button" onClick={handleExport}>
              <FiDownload aria-hidden="true" />
              Export JSON
            </button>
            <label className="button button--file">
              <FiUpload aria-hidden="true" />
              Import JSON
              <input type="file" accept="application/json,.json" onChange={handleImport} hidden />
            </label>
            <button
              type="button"
              className="button button--danger"
              onClick={() => setResetOpen(true)}
            >
              Reset app
            </button>
          </div>
          <p className="settings-row__hint">
            Importing replaces the current data. The app must be disconnected from sync first.
          </p>
        </div>
      </div>

      <div className="card">
        <div className="card__head">
          <h2>About</h2>
        </div>
        <div className="card__body about-grid">
          <span>Version</span>
          <span>{__APP_VERSION__}</span>
          <span>Mode</span>
          <span>{__APP_MODE__}</span>
          <span>Build</span>
          <span>{__BUILD_TIME__}</span>
          <span>Storage</span>
          <span>IndexedDB (local device)</span>
        </div>
      </div>

      {csvOpen && <CsvImportDialog onClose={() => setCsvOpen(false)} />}

      {accountDialog && (
        <AccountDialog
          account={accountDialog.account}
          onClose={() => setAccountDialog(null)}
        />
      )}

      {categoryDialog && (
        <CategoryDialog
          category={categoryDialog.category}
          defaultGroupId={categoryDialog.groupId}
          onClose={() => setCategoryDialog(null)}
        />
      )}

      {groupToDelete && (
        <ConfirmDialog
          title="Delete group?"
          message={`"${groupToDelete.name}" will be removed. Its categories become ungrouped.`}
          confirmLabel="Delete group"
          onConfirm={() => {
            deleteCategoryGroup(groupToDelete.id);
            setGroupToDelete(null);
          }}
          onClose={() => setGroupToDelete(null)}
        />
      )}

      {resetOpen && (
        <ConfirmDialog
          title="Reset everything?"
          message="Every account, transaction, category and setting on this device will be deleted. Export a backup first."
          confirmLabel="Reset app"
          onConfirm={() => {
            void resetEverything();
            setResetOpen(false);
            setNotice({ tone: 'warn', text: 'All local data was cleared.' });
          }}
          onClose={() => setResetOpen(false)}
        />
      )}

      {recurringEdit && (
        <RecurringDialog rule={recurringEdit} onClose={() => setRecurringEdit(null)} />
      )}

      {recurringDelete && (
        <Dialog
          title="Delete recurring transaction?"
          description="Choose whether the rows it already created should stay in the ledger."
          onClose={() => setRecurringDelete(null)}
          footer={
            <>
              <button type="button" className="button" onClick={() => setRecurringDelete(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="button button--danger"
                onClick={() => {
                  const removed = deleteRecurring(recurringDelete.id, true);
                  setNotice({
                    tone: 'warn',
                    text: `Rule deleted with ${removed} generated ${removed === 1 ? 'entry' : 'entries'} from today onward.`,
                  });
                  setRecurringDelete(null);
                }}
              >
                Delete rule + rows
              </button>
              <button
                type="button"
                className="button button--danger"
                onClick={() => {
                  deleteRecurring(recurringDelete.id);
                  setNotice({ tone: 'warn', text: 'Rule deleted. Existing ledger rows were kept.' });
                  setRecurringDelete(null);
                }}
              >
                Delete rule only
              </button>
            </>
          }
        >
          <p className="dialog__description">
            “Delete rule + rows” removes entries generated from today onward. Past entries stay.
          </p>
        </Dialog>
      )}
    </section>
  );
}

function CategoryRow({ category, onEdit }: { category: Category; onEdit: () => void }) {
  return (
    <li className="settings-list__row">
      <span className="dot" style={{ background: category.color }} aria-hidden="true" />
      <span className="settings-list__main">
        <span className="settings-list__name">
          {category.name}
          <span className="badge">{category.kind}</span>
          {category.archived && <span className="badge">Archived</span>}
        </span>
      </span>
      <button
        type="button"
        className="icon-button"
        onClick={onEdit}
        aria-label={`Edit ${category.name}`}
      >
        <FiEdit2 />
      </button>
    </li>
  );
}
