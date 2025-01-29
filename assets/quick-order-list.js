if (!customElements.get('quick-order-list')) {
  customElements.define(
    'quick-order-list',
    class QuickOrderList extends BulkAdd {
      cartUpdateUnsubscriber = undefined;

      constructor() {
        super();
        this.variantItemStatusElement = this.querySelector('#shopping-cart-variant-item-status');
        this.isListInsideModal = this.closest('bulk-modal');

        this.stickyHeaderElement = document.querySelector('sticky-header');
        if (this.stickyHeaderElement) {
          this.stickyHeader = {
            height: this.stickyHeaderElement.offsetHeight,
            type: `${this.stickyHeaderElement.getAttribute('data-sticky-type')}`,
          };
        }

        this.totalBar = this.dataset.section;
        if (this.totalBar) {
          this.totalBarPosition = window.innerHeight - this.totalBar.offsetHeight;

          window.addEventListener('resize', () => {
            this.totalBarPosition = window.innerHeight - this.totalBar.offsetHeight;
            this.stickyHeader.height = this.stickyHeaderElement ? this.stickyHeaderElement.offsetHeight : 0;
          });
        }

        this.querySelector('form').addEventListener('submit', (event) => event.preventDefault());

        document.addEventListener('keydown', () => {
          this.lastInteractionWasKeyboard = true;
        });

        document.addEventListener('mousedown', () => {
          this.lastInteractionWasKeyboard = false;
        });
      }

      connectedCallback() {
        this.pageNumber = this.currentPage;

        this.cartUpdateUnsubscriber = subscribe(PUB_SUB_EVENTS.cartUpdate, async (event) => {
          // skip if cart event was triggered by this section
          if (event.source === this.id) return;

          this.toggleTableLoading(true);
          await this.refresh();
          this.toggleTableLoading(false);
        });

        this.initEventListeners();
      }

      disconnectedCallback() {
        this.cartUpdateUnsubscriber?.();
      }

      initEventListeners() {
        this.querySelectorAll('.pagination__item').forEach((link) => {
          link.addEventListener('click', async (event) => {
            event.preventDefault();
            event.stopPropagation();

            const url = new URL(event.currentTarget.href);

            // do we need to set this as a prop anymore?
            this.pageNumber = url.searchParams.get('page') || '1';

            this.toggleTableLoading(true);
            await this.refresh();
            this.toggleTableLoading(false);
          });
        });

        this.querySelector('.quick-order-list__table').addEventListener('focusin', this.switchVariants.bind(this));

        this.initVariantEventListeners();
      }

      initVariantEventListeners() {
        this.allInputsArray = Array.from(this.querySelectorAll('input[type="number"]'));

        this.querySelectorAll('quantity-input').forEach((qty) => {
          const debouncedOnChange = debounce(this.onChange.bind(this), 250);
          qty.addEventListener('change', debouncedOnChange);
        });

        this.querySelectorAll('.quick-order-list-remove-button').forEach((button) => {
          button.addEventListener('click', (event) => {
            event.preventDefault();
            this.toggleLoading(true);
            this.startQueue(button.dataset.index, 0);
          });
        });
      }

      // is this helpful?
      get currentPage() {
        return this.querySelector('.pagination-wrapper').dataset.page;
      }

      get cartVariantsForProduct() {
        return JSON.parse(this.querySelector('[data-cart-contents]')?.innerHTML || '[]');
      }

      onChange(event) {
        const inputValue = parseInt(event.target.value);
        this.cleanErrorMessageOnType(event);
        if (inputValue == 0) {
          event.target.setAttribute('value', inputValue);
          this.startQueue(event.target.dataset.index, inputValue);
        } else {
          this.validateQuantity(event);
        }
      }

      cleanErrorMessageOnType(event) {
        const handleKeydown = () => {
          event.target.setCustomValidity(' ');
          event.target.reportValidity();
          event.target.removeEventListener('keydown', handleKeydown);
        };

        event.target.addEventListener('keydown', handleKeydown);
      }

      validateInput(target) {
        const targetValue = parseInt(target.value);
        const targetMin = parseInt(target.dataset.min);
        const targetStep = parseInt(target.step);

        if (target.max) {
          return (
            targetValue == 0 ||
            (targetValue >= targetMin && targetValue <= parseInt(target.max) && targetValue % targetStep == 0)
          );
        } else {
          return targetValue == 0 || (targetValue >= targetMin && targetValue % targetStep == 0);
        }
      }

      get sectionsToRender() {
        if (this._sectionsToRender) return this._sectionsToRender;

        return (this._sectionsToRender = [
          {
            id: this.id,
            section: this.dataset.section,
            selector: `#${this.id}`,
          },
          {
            id: 'cart-icon-bubble',
            section: 'cart-icon-bubble',
            selector: '#shopify-section-cart-icon-bubble',
          },
          {
            id: `quick-order-list-live-region-text-${this.dataset.productId}`,
            section: 'cart-live-region-text',
            selector: '.shopify-section',
          },
          {
            id: 'CartDrawer',
            selector: '.drawer__inner',
            section: 'cart-drawer',
          },
        ]);
      }

      toggleTableLoading(enable) {
        this.querySelector('.quick-order-list__table').classList.toggle(
          'quick-order-list__container--disabled',
          enable
        );
        this.toggleLoading(enable);
      }

      async refresh() {
        const url = this.dataset.url || window.location.pathname;

        return fetch(`${url}?section_id=${this.dataset.section}${this.pageNumber ? `&page=${this.pageNumber}` : ''}`)
          .then((response) => response.text())
          .then((responseText) => {
            const html = new DOMParser().parseFromString(responseText, 'text/html');
            const responseQuickOrderList = html.querySelector(`#${this.id}`);

            if (!responseQuickOrderList) {
              return;
            }

            this.innerHTML = responseQuickOrderList.innerHTML;

            // handle race condition between a page switch and a refetch post-quantity bump
            // if (currentPage === this.pageNumber) {

            // TODO what actually needs to get bound?
            this.initEventListeners();
            // }
          })
          .catch((e) => {
            console.error(e);
          });
      }

      renderSections(parsedState) {
        const { items, sections } = parsedState;

        this.sectionsToRender.forEach(({ id, selector, section }) => {
          const sectionElement = document.getElementById(id);
          if (!sectionElement) return;

          const newSection = new DOMParser().parseFromString(sections[section], 'text/html').querySelector(selector);

          if (section === this.dataset.section) {
            const focusedElement = document.activeElement;
            let target = focusedElement?.dataset?.target;
            if (target?.includes('remove')) {
              target = focusedElement.closest('quantity-popover')?.querySelector('[data-target*="increment-"]')
                ?.dataset.target;
            }

            // if requests are still pending, inject with loading state
            if (this.queue.length > 0) this.toggleLoading(true, newSection);
            this.querySelector('.quick-order-list__total').innerHTML =
              newSection.querySelector('.quick-order-list__total').innerHTML;

            // update all variants that are not queued for update
            const newTable = newSection.querySelector('.quick-order-list__table');
            const shouldUpdateVariants =
              this.pageNumber === newSection.querySelector('.pagination-wrapper').dataset.page;
            if (newTable && shouldUpdateVariants) {
              const table = this.querySelector('.quick-order-list__table');

              // skip variants that are queued for update
              [...new Set(this.queue.map(({ id }) => id))].forEach(
                (id) =>
                  (newTable.querySelector(`#Variant-${id}`).innerHTML = table.querySelector(`#Variant-${id}`).innerHTML)
              );

              table.innerHTML = newTable.innerHTML;

              const newFocusTarget = this.querySelector(`[data-target='${target}']`);
              if (newFocusTarget) {
                newFocusTarget?.focus();
              } else {
                getFocusableElements(this)?.[0]?.focus();
              }

              this.initVariantEventListeners();
            }

            return;
          } else if (section === 'cart-drawer') {
            sectionElement.closest('cart-drawer')?.classList.toggle('is-empty', items.length === 0);
            sectionElement.querySelector(selector).innerHTML = newSection.innerHTML;
          } else {
            sectionElement.innerHTML = newSection.innerHTML;
          }
        });
      }

      scrollQuickOrderListTable() {
        const inputTopBorder = this.variantListInput.getBoundingClientRect().top;
        const inputBottomBorder = this.variantListInput.getBoundingClientRect().bottom;

        if (this.isListInsideModal) {
          const totalBarCrossesInput = inputBottomBorder > this.totalBar.getBoundingClientRect().top;
          const tableHeadCrossesInput =
            inputTopBorder < this.querySelector('.quick-order-list__table thead').getBoundingClientRect().bottom;

          if (totalBarCrossesInput || tableHeadCrossesInput) {
            this.scrollToCenter();
          }
        } else {
          const stickyHeaderBottomBorder =
            this.stickyHeaderElement && this.stickyHeaderElement.getBoundingClientRect().bottom;
          const totalBarCrossesInput = inputBottomBorder > this.totalBarPosition;
          const inputOutsideOfViewPort =
            inputBottomBorder < this.querySelector('.variant-item__quantity-wrapper').offsetHeight;
          const stickyHeaderCrossesInput =
            this.stickyHeaderElement &&
            this.stickyHeader.type !== 'on-scroll-up' &&
            this.stickyHeader.height > inputTopBorder;
          const stickyHeaderScrollupCrossesInput =
            this.stickyHeaderElement &&
            this.stickyHeader.type === 'on-scroll-up' &&
            this.stickyHeader.height > inputTopBorder &&
            stickyHeaderBottomBorder > 0;

          if (
            totalBarCrossesInput ||
            inputOutsideOfViewPort ||
            stickyHeaderCrossesInput ||
            stickyHeaderScrollupCrossesInput
          ) {
            this.scrollToCenter();
          }
        }
      }

      scrollToCenter() {
        this.variantListInput.scrollIntoView({
          block: 'center',
          behavior: 'smooth',
        });
      }

      switchVariants(event) {
        if (event.target.tagName !== 'INPUT') {
          return;
        }

        this.variantListInput = event.target;
        this.variantListInput.select();
        if (this.allInputsArray.length !== 1) {
          this.variantListInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.target.blur();
              if (this.validateInput(e.target)) {
                const currentIndex = this.allInputsArray.indexOf(e.target);
                this.lastKey = e.shiftKey;
                if (!e.shiftKey) {
                  const nextIndex = currentIndex + 1;
                  const nextVariant = this.allInputsArray[nextIndex] || this.allInputsArray[0];
                  nextVariant.select();
                } else {
                  const previousIndex = currentIndex - 1;
                  const previousVariant =
                    this.allInputsArray[previousIndex] || this.allInputsArray[this.allInputsArray.length - 1];
                  this.lastElement = previousVariant.dataset.index;
                  previousVariant.select();
                }
              }
            }
          });

          this.scrollQuickOrderListTable();
        } else {
          this.variantListInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.target.blur();
            }
          });
        }
      }

      updateMultipleQty(items) {
        this.toggleLoading(true);
        const ids = Object.keys(items);
        const url = this.dataset.url || window.location.pathname;

        const body = JSON.stringify({
          updates: items,
          sections: this.sectionsToRender.map(({ section }) => section),
          sections_url: `${url}?page=${this.currentPage}`,
        });

        this.updateMessage();
        this.setErrorMessage();

        fetch(`${routes.cart_update_url}`, { ...fetchConfig(), ...{ body } })
          .then((response) => response.text())
          .then(async (state) => {
            const parsedState = JSON.parse(state);
            this.renderSections(parsedState, ids);
            publish(PUB_SUB_EVENTS.cartUpdate, {
              source: this.id,
              cartData: parsedState,
            });
          })
          .catch((e) => {
            this.setErrorMessage(window.cartStrings.error);
          })
          .finally(() => {
            this.queue.length === 0 && this.toggleLoading(false);
            this.setRequestStarted(false);
          });
      }

      setErrorMessage(message = null) {
        this.errorMessageTemplate =
          this.errorMessageTemplate ??
          document.getElementById(`QuickOrderListErrorTemplate-${this.dataset.productId}`).cloneNode(true);
        const errorElements = document.querySelectorAll('.quick-order-list-error');

        errorElements.forEach((errorElement) => {
          errorElement.innerHTML = '';
          if (!message) return;
          const updatedMessageElement = this.errorMessageTemplate.cloneNode(true);
          updatedMessageElement.content.querySelector('.quick-order-list-error-message').innerText = message;
          errorElement.appendChild(updatedMessageElement.content);
        });
      }

      updateMessage(quantity = null) {
        const messages = this.querySelectorAll('.quick-order-list__message-text');
        const icons = this.querySelectorAll('.quick-order-list__message-icon');

        if (quantity === null || isNaN(quantity)) {
          messages.forEach((message) => (message.innerHTML = ''));
          icons.forEach((icon) => icon.classList.add('hidden'));
          return;
        }

        const isQuantityNegative = quantity < 0;
        const absQuantity = Math.abs(quantity);

        const textTemplate = isQuantityNegative
          ? absQuantity === 1
            ? window.quickOrderListStrings.itemRemoved
            : window.quickOrderListStrings.itemsRemoved
          : quantity === 1
          ? window.quickOrderListStrings.itemAdded
          : window.quickOrderListStrings.itemsAdded;

        messages.forEach((msg) => (msg.innerHTML = textTemplate.replace('[quantity]', absQuantity)));

        if (!isQuantityNegative) {
          icons.forEach((i) => i.classList.remove('hidden'));
        }
      }

      updateError(updatedValue, id) {
        let message = '';
        if (typeof updatedValue === 'undefined') {
          message = window.cartStrings.error;
        } else {
          message = window.cartStrings.quantityError.replace('[quantity]', updatedValue);
        }
        this.updateLiveRegions(id, message);
      }

      updateLiveRegions(id, message) {
        const variantItemErrorDesktop = document.getElementById(`Quick-order-list-item-error-desktop-${id}`);
        if (variantItemErrorDesktop) {
          variantItemErrorDesktop.querySelector('.variant-item__error-text').innerHTML = message;
          variantItemErrorDesktop.closest('tr').classList.remove('hidden');
        }
        if (variantItemErrorMobile)
          variantItemErrorMobile.querySelector('.variant-item__error-text').innerHTML = message;

        this.variantItemStatusElement.setAttribute('aria-hidden', true);

        const cartStatus = document.getElementById('quick-order-list-live-region-text');
        cartStatus.setAttribute('aria-hidden', false);

        setTimeout(() => {
          cartStatus.setAttribute('aria-hidden', true);
        }, 1000);
      }

      toggleLoading(loading, target = this) {
        target.querySelector('#shopping-cart-variant-item-status').toggleAttribute('aria-hidden', !loading);
        target.querySelector('.variant-remove-total .loading__spinner')?.classList.toggle('hidden', !loading);
      }
    }
  );
}

if (!customElements.get('quick-order-list-remove-all-button')) {
  customElements.define(
    'quick-order-list-remove-all-button',
    class QuickOrderListRemoveAllButton extends HTMLElement {
      constructor() {
        super();
        this.quickOrderList = this.closest('quick-order-list');

        this.actions = {
          confirm: 'confirm',
          remove: 'remove',
          cancel: 'cancel',
        };

        this.addEventListener('click', (event) => {
          event.preventDefault();
          if (this.dataset.action === this.actions.confirm) {
            this.toggleConfirmation(false, true);
          } else if (this.dataset.action === this.actions.remove) {
            const items = this.quickOrderList.cartVariantsForProduct.reduce(
              (acc, variantId) => ({ ...acc, [variantId]: 0 }),
              {}
            );

            // TODO this should pass through the queue, not directly call updateMultipleQty
            this.quickOrderList.updateMultipleQty(items);
            this.toggleConfirmation(true, false);
          } else if (this.dataset.action === this.actions.cancel) {
            this.toggleConfirmation(true, false);
          }
        });
      }

      toggleConfirmation(showConfirmation, showInfo) {
        this.quickOrderList
          .querySelector('.quick-order-list-total__confirmation')
          .classList.toggle('hidden', showConfirmation);
        this.quickOrderList.querySelector('.quick-order-list-total__info').classList.toggle('hidden', showInfo);
      }
    }
  );
}
