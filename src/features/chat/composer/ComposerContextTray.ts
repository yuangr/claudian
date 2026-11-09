import { setIcon } from 'obsidian';

import {
  cancelScheduledAnimationFrame,
  scheduleAnimationFrame,
  type ScheduledAnimationFrame,
} from '@/features/chat/utils/animationFrame';
import { t } from '@/i18n/i18n';

/** Per-turn context only; Linked content lives in the composer info row. */
export type ComposerContextSlot =
  | 'editor-selection'
  | 'browser-selection'
  | 'canvas-selection'
  | 'images';

export type ComposerContextItemKind = 'selection' | 'image';

export interface ComposerContextItem {
  id: string;
  kind: ComposerContextItemKind;
  label: string;
  icon?: string;
  ariaLabel?: string;
  onActivate?: () => void;
  onRemove?: () => void;
}

export interface ComposerContextTrayOptions {
  onDidChange?: () => void;
}

const SLOT_ORDER: readonly ComposerContextSlot[] = [
  'editor-selection',
  'browser-selection',
  'canvas-selection',
  'images',
];

const MAX_COLLAPSED_ROWS = 1;
const ROW_OVERLAP_TOLERANCE = 1;

interface ContextTrayRow {
  top: number;
  bottom: number;
  firstIndex: number;
  lastIndex: number;
}

/**
 * Owns composer context layout while context managers retain their data and behavior.
 */
export class ComposerContextTray {
  private readonly containerEl: HTMLElement;
  private readonly options: ComposerContextTrayOptions;
  private readonly itemsBySlot = new Map<ComposerContextSlot, ComposerContextItem[]>();
  private resizeObserver: ResizeObserver | null = null;
  private pendingLayout: ScheduledAnimationFrame | null = null;
  private expanded = false;

  get hasContent(): boolean { return this.itemsBySlot.size > 0; }

  constructor(containerEl: HTMLElement, options: ComposerContextTrayOptions = {}) {
    this.containerEl = containerEl;
    this.options = options;
    this.containerEl.addClass('claudian-context-row');
    try {
      this.#observeSize();
      this.render();
    } catch (error) {
      this.destroy();
      throw error;
    }
  }

  setItems(slot: ComposerContextSlot, items: readonly ComposerContextItem[]): void {
    if (items.length === 0) {
      this.itemsBySlot.delete(slot);
    } else {
      this.itemsBySlot.set(slot, [...items]);
    }
    this.expanded = false;
    this.render();
  }

  clearItems(slot: ComposerContextSlot): void {
    if (!this.itemsBySlot.delete(slot)) return;
    this.expanded = false;
    this.render();
  }

  refreshLayout(): void {
    const allChips = Array.from(
      this.containerEl.querySelectorAll<HTMLElement>('.claudian-context-chip')
    );
    const moreButton = this.containerEl.querySelector<HTMLElement>('.claudian-context-more');
    if (!moreButton || allChips.length === 0) return;

    for (const chip of allChips) {
      chip.removeClass('claudian-context-chip--overflow-hidden');
    }
    if (moreButton !== this.containerEl.ownerDocument.activeElement) moreButton.addClass('claudian-hidden');
    // Chips that are not rendered (hidden by a presentation, or the whole tray undisplayed) occupy no row.
    const chips = allChips.filter(chip => chip.offsetParent !== null);
    if (chips.length === 0) return;

    const rows = this.#getRows(chips);
    const hasOverflow = rows.length > MAX_COLLAPSED_ROWS;
    if (!hasOverflow) {
      if (moreButton === this.containerEl.ownerDocument.activeElement) {
        this.containerEl.querySelector<HTMLElement>('.claudian-context-chip button')?.focus();
      }
      moreButton.addClass('claudian-hidden');
      this.expanded = false;
      this.containerEl.removeClass('claudian-context-row--expanded');
      moreButton.setAttribute('aria-expanded', 'false');
      return;
    }

    moreButton.removeClass('claudian-hidden');
    if (this.expanded) {
      this.containerEl.addClass('claudian-context-row--expanded');
      const label = t('chat.composer.showLess');
      moreButton.textContent = label;
      moreButton.setAttribute('aria-label', label);
      moreButton.setAttribute('aria-expanded', 'true');
      return;
    }

    this.containerEl.removeClass('claudian-context-row--expanded');
    moreButton.setAttribute('aria-expanded', 'false');

    const lastVisibleRow = rows[MAX_COLLAPSED_ROWS - 1];
    let visibleCount = lastVisibleRow.lastIndex + 1;

    for (let index = visibleCount; index < chips.length; index++) {
      chips[index].addClass('claudian-context-chip--overflow-hidden');
    }

    const minimumVisibleCount = Math.max(1, lastVisibleRow.firstIndex);
    while (visibleCount > minimumVisibleCount && moreButton.offsetTop >= lastVisibleRow.bottom) {
      visibleCount -= 1;
      chips[visibleCount].addClass('claudian-context-chip--overflow-hidden');
    }

    const hiddenCount = chips.length - visibleCount;
    moreButton.textContent = t('chat.composer.moreItems', { count: hiddenCount });
    moreButton.setAttribute('aria-label', t('chat.composer.moreContext', { count: hiddenCount }));
  }

  destroy(): void {
    if (this.pendingLayout) {
      cancelScheduledAnimationFrame(this.pendingLayout);
      this.pendingLayout = null;
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.itemsBySlot.clear();
    this.containerEl.empty();
    this.containerEl.removeClass('has-content');
    delete this.containerEl.dataset.contextSlots;
    this.containerEl.removeClass('claudian-context-row');
    this.containerEl.removeClass('claudian-context-row--expanded');
  }

  private render(): void {
    const active = this.containerEl.ownerDocument.activeElement as HTMLElement | null;
    const oldButtons = Array.from(this.containerEl.querySelectorAll<HTMLElement>('button'));
    const oldIndex = active ? oldButtons.indexOf(active) : -1;
    const chip = oldIndex >= 0 ? active?.closest<HTMLElement>('.claudian-context-chip') : null;
    const focusedMore = oldIndex >= 0 && active?.classList.contains('claudian-context-more');
    const focusedRemove = active?.classList.contains('claudian-context-chip-remove');
    this.containerEl.empty();
    this.containerEl.removeClass('claudian-context-row--expanded');

    const entries = SLOT_ORDER.flatMap(slot =>
      (this.itemsBySlot.get(slot) ?? []).map(item => ({ item, slot }))
    );
    this.containerEl.toggleClass('has-content', entries.length > 0);
    const filledSlots = SLOT_ORDER.filter(slot => this.itemsBySlot.has(slot));
    if (filledSlots.length > 0) this.containerEl.dataset.contextSlots = filledSlots.join(' ');
    else delete this.containerEl.dataset.contextSlots;

    for (const { item, slot } of entries) {
      this.#renderItem(slot, item);
    }

    if (entries.length > 0) {
      const moreButton = this.containerEl.createEl('button', {
        cls: 'claudian-context-more claudian-hidden',
        attr: {
          type: 'button',
          'aria-expanded': 'false',
        },
      });
      moreButton.addEventListener('click', () => {
        this.expanded = !this.expanded;
        this.refreshLayout();
        this.options.onDidChange?.();
      });
    }

    this.options.onDidChange?.();
    if (oldIndex >= 0) {
      const buttons = Array.from(this.containerEl.querySelectorAll<HTMLElement>('button'));
      const more = this.containerEl.querySelector<HTMLElement>('.claudian-context-more');
      const same = focusedMore ? more : buttons.find(button => {
        const candidate = button.closest<HTMLElement>('.claudian-context-chip');
        return candidate?.dataset.contextSlot === chip?.dataset.contextSlot
          && candidate?.dataset.contextId === chip?.dataset.contextId
          && button.classList.contains('claudian-context-chip-remove') === focusedRemove;
      });
      const target = same ?? buttons[Math.min(oldIndex, buttons.length - 1)];
      this.refreshLayout();
      if (target?.closest('.claudian-context-chip--overflow-hidden')) {
        this.expanded = true;
        this.refreshLayout();
      }
      const visibleTarget = target?.classList.contains('claudian-hidden') ? buttons.find(button => button !== more) : target;
      visibleTarget?.focus();
    }
    this.#scheduleLayout();
  }

  #renderItem(slot: ComposerContextSlot, item: ComposerContextItem): void {
    const chipEl = this.containerEl.createDiv({
      cls: `claudian-context-chip claudian-context-chip--${item.kind}`,
    });
    chipEl.dataset.contextSlot = slot;
    chipEl.dataset.contextId = item.id;

    const contentEl = item.onActivate
      ? chipEl.createEl('button', {
        cls: 'claudian-context-chip-main',
        attr: { type: 'button' },
      })
      : chipEl.createSpan({ cls: 'claudian-context-chip-main' });

    contentEl.setAttribute('aria-label', item.ariaLabel ?? item.label);
    if (item.onActivate) {
      contentEl.addEventListener('click', item.onActivate);
    }

    if (item.icon) {
      const iconEl = contentEl.createSpan({ cls: 'claudian-context-chip-icon' });
      setIcon(iconEl, item.icon);
    }

    contentEl.createSpan({ cls: 'claudian-context-chip-label', text: item.label });

    if (item.onRemove) {
      const removeButton = chipEl.createEl('button', {
        cls: 'claudian-context-chip-remove',
        text: '\u00D7',
        attr: {
          type: 'button',
          'aria-label': t('chat.removeItem', { item: item.ariaLabel ?? item.label }),
        },
      });
      removeButton.addEventListener('click', item.onRemove);
    }
  }

  #getRows(chips: readonly HTMLElement[]): ContextTrayRow[] {
    const rows: ContextTrayRow[] = [];
    for (const [index, chip] of chips.entries()) {
      const top = chip.offsetTop;
      const height = chip.offsetHeight > 0 ? chip.offsetHeight : 1;
      const bottom = top + height;
      const row = rows.find(candidate =>
        top < candidate.bottom + ROW_OVERLAP_TOLERANCE
        && bottom > candidate.top - ROW_OVERLAP_TOLERANCE
      );
      if (row) {
        row.top = Math.min(row.top, top);
        row.bottom = Math.max(row.bottom, bottom);
        row.lastIndex = index;
      } else {
        rows.push({ top, bottom, firstIndex: index, lastIndex: index });
      }
    }
    return rows.sort((left, right) => left.top - right.top);
  }

  #scheduleLayout(): void {
    if (this.pendingLayout) {
      cancelScheduledAnimationFrame(this.pendingLayout);
    }
    this.pendingLayout = scheduleAnimationFrame(() => {
      this.pendingLayout = null;
      this.refreshLayout();
    }, this.containerEl.ownerDocument.defaultView);
  }

  #observeSize(): void {
    const ResizeObserverConstructor = this.containerEl.ownerDocument.defaultView?.ResizeObserver;
    if (typeof ResizeObserverConstructor !== 'function') return;

    this.resizeObserver = new ResizeObserverConstructor(() => this.#scheduleLayout());
    this.resizeObserver.observe(this.containerEl);
  }
}
