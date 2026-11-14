/** Mobile overflow destination: everything that is not a primary tab. */

import { FiChevronRight, FiSettings } from 'react-icons/fi';

import { MORE_VIEWS, type ViewKey } from '../state/navigation';

interface MoreViewProps {
  active: ViewKey;
  onSelect: (view: ViewKey) => void;
}

export function MoreView({ active, onSelect }: MoreViewProps) {
  return (
    <section className="view">
      <header className="view__header">
        <div>
          <h1 className="view__title">More</h1>
          <p className="view__subtitle">Planning and settings</p>
        </div>
      </header>

      <div className="more-list">
        {MORE_VIEWS.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.view}
              type="button"
              className={`more-list__item${active === item.view ? ' more-list__item--active' : ''}`}
              onClick={() => onSelect(item.view)}
            >
              <Icon aria-hidden="true" />
              <span>{item.label}</span>
              <FiChevronRight className="more-list__chevron" aria-hidden="true" />
            </button>
          );
        })}
        <button
          type="button"
          className={`more-list__item${active === 'settings' ? ' more-list__item--active' : ''}`}
          onClick={() => onSelect('settings')}
        >
          <FiSettings aria-hidden="true" />
          <span>Settings</span>
          <FiChevronRight className="more-list__chevron" aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
