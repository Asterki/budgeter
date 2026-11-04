/** Create, edit, archive or delete a category (with reassignment). */

import { useState, type FormEvent } from 'react';

import { ColorPicker, ConfirmDialog, Dialog } from './Dialog';
import { CATEGORY_COLORS, useBudget } from '../state/store';
import type { Category, CategoryKind } from '../domain/types';

interface CategoryDialogProps {
  category: Category | null;
  defaultGroupId: string | null;
  onClose: () => void;
}

export function CategoryDialog({ category, defaultGroupId, onClose }: CategoryDialogProps) {
  const { categories, categoryGroups, createCategory, updateCategory, deleteCategoryReassign } =
    useBudget();
  const [name, setName] = useState(category?.name ?? '');
  const [kind, setKind] = useState<CategoryKind>(category?.kind ?? 'expense');
  const [groupId, setGroupId] = useState(category?.groupId ?? defaultGroupId ?? '');
  const [color, setColor] = useState(category?.color ?? CATEGORY_COLORS[0]);
  const [archived, setArchived] = useState(category?.archived ?? false);
  const [targetId, setTargetId] = useState('');
  const [confirming, setConfirming] = useState(false);

  const others = categories.filter((item) => item.id !== category?.id);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;

    if (category) {
      updateCategory(category.id, {
        name: name.trim(),
        kind,
        groupId: groupId || null,
        color,
        archived,
      });
    } else {
      createCategory({ name: name.trim(), kind, groupId: groupId || null, color });
    }
    onClose();
  }

  if (confirming && category) {
    const moved = others.find((item) => item.id === targetId);
    return (
      <ConfirmDialog
        title="Delete category?"
        message={
          moved
            ? `Transactions in "${category.name}" will move to "${moved.name}". Budgets for this category are deleted.`
            : `Transactions in "${category.name}" will become uncategorized. Budgets for this category are deleted.`
        }
        confirmLabel="Delete category"
        onConfirm={() => {
          deleteCategoryReassign(category.id, targetId || null);
          onClose();
        }}
        onClose={() => setConfirming(false)}
      />
    );
  }

  return (
    <Dialog
      title={category ? 'Edit category' : 'New category'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button button--primary" form="category-form">
            {category ? 'Save category' : 'Create category'}
          </button>
        </>
      }
    >
      <form id="category-form" className="dialog__form" onSubmit={handleSubmit}>
        <label className="field">
          <span className="field__label">Name</span>
          <input
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Groceries"
            maxLength={80}
            autoFocus
          />
        </label>

        <div className="field-row">
          <label className="field">
            <span className="field__label">Kind</span>
            <select
              className="input"
              value={kind}
              onChange={(event) => setKind(event.target.value as CategoryKind)}
            >
              <option value="expense">Expense</option>
              <option value="income">Income</option>
            </select>
          </label>
          <label className="field">
            <span className="field__label">Group</span>
            <select
              className="input"
              value={groupId}
              onChange={(event) => setGroupId(event.target.value)}
            >
              <option value="">No group</option>
              {categoryGroups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <ColorPicker colors={CATEGORY_COLORS} value={color} onChange={setColor} />

        {category && (
          <label className="check-row">
            <input
              type="checkbox"
              checked={archived}
              onChange={(event) => setArchived(event.target.checked)}
            />
            <span>Archived (hidden from pickers)</span>
          </label>
        )}

        {category && (
          <div className="dialog__danger">
            <span className="field__label">Delete this category</span>
            <p className="dialog__description">
              Move its transactions to another category first, or leave them uncategorized.
            </p>
            <label className="field">
              <span className="field__label">Move transactions to</span>
              <select
                className="input"
                value={targetId}
                onChange={(event) => setTargetId(event.target.value)}
              >
                <option value="">Uncategorized</option>
                {others.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="button button--danger"
              onClick={() => setConfirming(true)}
            >
              Delete category
            </button>
          </div>
        )}
      </form>
    </Dialog>
  );
}
