/**
 * One-line transaction composer.
 *
 * Parses as you type and renders the resulting chips, then writes the
 * transaction (and any confirmed new payee/category) through the store.
 */

import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import {
  FiArrowRight,
  FiCalendar,
  FiCheck,
  FiDollarSign,
  FiRepeat,
  FiTag,
  FiUser,
} from 'react-icons/fi';

import { formatMoney } from '../domain/money';
import { RecurrenceEditor } from './RecurrenceEditor';
import { parseTransactionInput, type ParsedToken } from '../domain/parser';
import {
  applySuggestion,
  buildSuggestions,
  collectTags,
  findActiveToken,
  type Suggestion,
} from '../domain/suggestions';
import { todayISO } from '../domain/date';
import { createRecurrence, nextOccurrence } from '../domain/recurrence';
import { matchCategoryRule } from '../domain/rules';
import type { RecurrenceRule } from '../domain/types';
import { useBudget } from '../state/store';
interface QuickAddProps {
  /** Account selected in the ledger scope, used when the line omits `^account`. */
  defaultAccountId?: string;
  /** Bumping this number focuses the input (keyboard shortcut `n`). */
  focusSignal?: number;
  /** Day used when the line has no date token, e.g. a selected calendar day. */
  defaultDate?: string;
  /** Focus the field once on mount, so a cold open is ready to type into. */
  autoFocus?: boolean;
  onCreated?: () => void;
}

function tokenIcon(kind: ParsedToken['kind']) {
  switch (kind) {
    case 'amount':
      return <FiDollarSign aria-hidden="true" />;
    case 'payee':
      return <FiUser aria-hidden="true" />;
    case 'category':
      return <FiTag aria-hidden="true" />;
    case 'account':
      return <FiArrowRight aria-hidden="true" />;
    case 'tag':
      return <FiTag aria-hidden="true" />;
    case 'cleared':
      return <FiCheck aria-hidden="true" />;
    case 'date':
      return <FiCalendar aria-hidden="true" />;
    case 'recurrence':
      return <FiRepeat aria-hidden="true" />;
    case 'transfer':
      return <FiArrowRight aria-hidden="true" />;
  }
}

export function QuickAdd({
  defaultAccountId,
  focusSignal = 0,
  defaultDate,
  autoFocus = false,
  onCreated,
}: QuickAddProps) {
  const {
    accounts,
    categories,
    payees,
    rules,
    transactions,
    settings,
    createCategory,
    createPayee,
    createTransaction,
    createTransfer,
    createRecurring,
  } = useBudget();

  const [value, setValue] = useState('');
  const [caret, setCaret] = useState(0);
  const [highlight, setHighlight] = useState(0);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [repeatRule, setRepeatRule] = useState<RecurrenceRule | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const autoFocused = useRef(false);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  const tags = useMemo(
    () => collectTags(transactions.map((transaction) => transaction.tags)),
    [transactions],
  );

  const parsed = useMemo(
    () =>
      parseTransactionInput(value, {
        accounts,
        categories,
        payees,
        defaultAccountId,
        currency: settings.currency,
        locale: settings.locale,
        today: defaultDate ?? todayISO(),
      }),
    [
      value,
      accounts,
      categories,
      payees,
      defaultAccountId,
      defaultDate,
      settings.currency,
      settings.locale,
    ],
  );

  // The token under the caret is tracked even while the popup is closed so
  // arrow keys can reopen and navigate it from anywhere in the line.
  const caretToken = useMemo(() => findActiveToken(value, caret), [value, caret]);
  const activeToken = suggestionsOpen ? caretToken : null;
  const suggestions = useMemo(
    () => (caretToken ? buildSuggestions(caretToken, { accounts, categories, payees, tags }) : []),
    [caretToken, accounts, categories, payees, tags],
  );

  useEffect(() => {
    if (focusSignal > 0) inputRef.current?.focus();
  }, [focusSignal]);

  useEffect(() => {
    if (!autoFocus || autoFocused.current) return;
    autoFocused.current = true;
    inputRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    if (!suggestionsOpen) return;
    const option = listRef.current?.querySelector('[aria-selected="true"]');
    option?.scrollIntoView({ block: 'nearest' });
  }, [highlight, suggestionsOpen, suggestions.length]);

  function update(nextValue: string, nextCaret = nextValue.length) {
    setValue(nextValue);
    setCaret(nextCaret);
    setSuggestionsOpen(true);
    setHighlight(0);
    setSubmitError(null);
  }

  function accept(suggestion: Suggestion) {
    if (!activeToken) return;
    const applied = applySuggestion(value, activeToken, suggestion);
    setValue(applied.value);
    setCaret(applied.caret);
    setSuggestionsOpen(false);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(applied.caret, applied.caret);
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const caretNow = event.currentTarget.selectionStart ?? caret;
    if (caretNow !== caret) setCaret(caretNow);

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const token = findActiveToken(value, caretNow);
      const available = token
        ? buildSuggestions(token, { accounts, categories, payees, tags })
        : [];
      if (available.length > 0) {
        event.preventDefault();
        if (!suggestionsOpen) {
          setSuggestionsOpen(true);
          setHighlight(event.key === 'ArrowUp' ? available.length - 1 : 0);
        } else {
          setHighlight((index) =>
            event.key === 'ArrowUp'
              ? (index - 1 + available.length) % available.length
              : (index + 1) % available.length,
          );
        }
        return;
      }
    }
    if ((event.key === 'Tab' || (event.key === 'Enter' && suggestionsOpen)) && suggestions.length > 0) {
      event.preventDefault();
      accept(suggestions[Math.min(highlight, suggestions.length - 1)]);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      if (suggestionsOpen) setSuggestionsOpen(false);
      else {
        setValue('');
        setSubmitError(null);
      }
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!parsed.valid || parsed.amount === null) {
      setSubmitError(parsed.errors[0]?.message ?? 'Add an amount first.');
      return;
    }

    try {
      let categoryId = parsed.categoryId;
      if (!categoryId && parsed.categoryName) {
        categoryId = createCategory({
          name: parsed.categoryName,
          kind: parsed.type === 'income' ? 'income' : 'expense',
        }).id;
      }
      if (!categoryId) {
        categoryId =
          matchCategoryRule(rules, [parsed.payeeName, parsed.notes])?.categoryId ?? null;
      }

      let payeeId = parsed.payeeId;
      if (!payeeId && parsed.payeeName) {
        payeeId = createPayee(parsed.payeeName, categoryId).id;
      }

      const shared = {
        date: parsed.date,
        categoryId,
        payeeId,
        notes: parsed.notes,
        tags: parsed.tags,
        cleared: parsed.cleared,
      };
      const recurrence = repeatRule ?? parsed.recurrence;

      if (parsed.type === 'transfer' && parsed.accountId && parsed.transferAccountId) {
        createTransfer({
          fromAccountId: parsed.accountId,
          toAccountId: parsed.transferAccountId,
          amount: parsed.amount,
          ...shared,
        });
      } else if (recurrence && parsed.accountId) {
        const signed = parsed.type === 'income' ? parsed.amount : -parsed.amount;
        const rule = createRecurring({
          accountId: parsed.accountId,
          amount: signed,
          type: parsed.type,
          ...shared,
          recurrence,
          nextDate: nextOccurrence(recurrence, parsed.date),
          lastGeneratedDate: parsed.date,
        });
        createTransaction({
          accountId: parsed.accountId,
          amount: signed,
          type: parsed.type,
          ...shared,
          recurringId: rule.id,
        });
      } else if (parsed.accountId) {
        const signed = parsed.type === 'income' ? parsed.amount : -parsed.amount;
        createTransaction({
          accountId: parsed.accountId,
          amount: signed,
          type: parsed.type,
          ...shared,
        });
      }

      setValue('');
      setCaret(0);
      setSuggestionsOpen(false);
      setSubmitError(null);
      setRepeatRule(null);
      onCreated?.();
      inputRef.current?.focus();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Could not add this transaction.');
    }
  }

  return (
    <form className="quick-add" onSubmit={handleSubmit}>
      <div className="quick-add__bar">
        <FiDollarSign className="quick-add__leading" aria-hidden="true" />
        <input
          ref={inputRef}
          className="quick-add__input"
          value={value}
          onChange={(event) => update(event.target.value, event.target.selectionStart ?? event.target.value.length)}
          onKeyDown={handleKeyDown}
          onKeyUp={(event) => setCaret(event.currentTarget.selectionStart ?? 0)}
          onSelect={(event) => setCaret(event.currentTarget.selectionStart ?? 0)}
          onClick={(event) => {
            setCaret(event.currentTarget.selectionStart ?? 0);
            setSuggestionsOpen(true);
          }}
          onBlur={() => setSuggestionsOpen(false)}
          placeholder="coffee 4.50 @Starbucks #Food"
          aria-label="Add a transaction in plain language"
          aria-autocomplete="list"
          aria-controls={listId}
          aria-expanded={suggestionsOpen && suggestions.length > 0}
          autoComplete="off"
          spellCheck={false}
        />
        <button
          type="submit"
          className="button button--primary quick-add__submit"
          disabled={value.trim().length === 0}
        >
          Add
          <kbd>↵</kbd>
        </button>
      </div>

      {parsed.type !== 'transfer' && (
        <div className="quick-add__repeat">
          <button
            type="button"
            className="button button--ghost"
            aria-pressed={repeatRule !== null}
            onClick={() =>
              setRepeatRule((current) =>
                current ? null : createRecurrence('monthly', parsed.date),
              )
            }
          >
            <FiRepeat aria-hidden="true" />
            {repeatRule ? 'Repeat on' : 'Repeat'}
          </button>
          {repeatRule && (
            <div className="quick-add__repeat-editor">
              <RecurrenceEditor
                value={repeatRule}
                startDate={parsed.date}
                onChange={setRepeatRule}
              />
            </div>
          )}
        </div>
      )}

      {suggestionsOpen && suggestions.length > 0 && activeToken && (
        <ul className="suggestions" id={listId} role="listbox" ref={listRef}>
          {suggestions.map((suggestion, index) => (
            <li
              key={`${suggestion.kind}:${suggestion.value}:${suggestion.detail ?? ''}`}
              role="option"
              aria-selected={index === highlight}
            >
              <button
                type="button"
                className={`suggestion${index === highlight ? ' suggestion--active' : ''}`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  accept(suggestion);
                }}
              >
                <span>{suggestion.label}</span>
                {suggestion.detail && <small>{suggestion.detail}</small>}
              </button>
            </li>
          ))}
        </ul>
      )}

      {value.trim() && (
        <div className="quick-add__result">
          <div className="chips">
            {parsed.tokens.map((token, index) => (
              <span
                key={`${token.kind}:${token.raw}:${index}`}
                className={`chip${token.status ? ` chip--${token.status}` : ''}`}
                title={
                  token.status === 'new'
                    ? 'This will be created when you add the transaction.'
                    : undefined
                }
              >
                {tokenIcon(token.kind)}
                {token.label}
              </span>
            ))}
            {parsed.amount === null && (
              <span className="chip chip--error">
                <FiDollarSign aria-hidden="true" />
                Amount needed
              </span>
            )}
          </div>

          {parsed.errors.length > 0 ? (
            <p className="quick-add__error" role="alert">
              {parsed.errors[0].message}
            </p>
          ) : (
            <p className="quick-add__preview">
              {parsed.notes || 'New transaction'} ·{' '}
              {formatMoney(
                parsed.type === 'income' ? (parsed.amount ?? 0) : -(parsed.amount ?? 0),
                settings.currency,
                settings.locale,
              )}
              {parsed.isNewPayee || parsed.isNewCategory ? ' · new details will be created' : ''}
            </p>
          )}
          {submitError && (
            <p className="quick-add__error" role="alert">
              {submitError}
            </p>
          )}
        </div>
      )}

      {!value.trim() && (
        <p className="quick-add__hint">
          Try <code>coffee 4.50 @Starbucks #Food</code>,{' '}
          <code>salary +2500 ^Checking friday</code> or{' '}
          <code>transfer 300 from Checking to Savings</code>. Type <code>@ # ^ + !</code> for
          suggestions.
        </p>
      )}
    </form>
  );
}
